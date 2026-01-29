import 'dotenv/config';
import { PriceMonitor } from './services/price-monitor.js';
import { TradeExecutor } from './services/executor.js';
import type { ArbitrageOpportunity, BotConfig, ChainId, BotState, TradeHistory } from './types/index.js';
import { CHAIN_CONFIGS } from './config/chains.js';
import pino from 'pino';
import { createServer } from 'http';

const logger = pino({
  name: 'arb-bot',
  level: process.env.LOG_LEVEL || 'info',
});

// Bot state
const state: BotState = {
  isRunning: false,
  isPaused: false,
  currentChains: [],
  totalProfit: 0n,
  totalTrades: 0,
  successfulTrades: 0,
  failedTrades: 0,
  uptime: Date.now(),
};

// Trade history (keep last 100 trades)
const tradeHistory: TradeHistory[] = [];
const MAX_HISTORY = 100;

// Pending opportunities queue
const opportunityQueue: ArbitrageOpportunity[] = [];
let isProcessing = false;

// Configuration
function loadConfig(): BotConfig {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable is required');
  }

  // Parse enabled chains
  const enabledChainsStr = process.env.ENABLED_CHAINS || '42161,8453';
  const enabledChains = enabledChainsStr.split(',').map(Number) as ChainId[];

  return {
    minProfitUsd: Number(process.env.MIN_PROFIT_USD) || 10,
    maxGasPriceGwei: Number(process.env.MAX_GAS_PRICE_GWEI) || 100,
    maxSlippageBps: Number(process.env.MAX_SLIPPAGE_BPS) || 50,
    simulateBeforeExecute: process.env.SIMULATE !== 'false',
    dryRun: process.env.DRY_RUN === 'true',
    maxConcurrentTrades: Number(process.env.MAX_CONCURRENT_TRADES) || 1,
    cooldownMs: Number(process.env.COOLDOWN_MS) || 1000,
    enabledChains,
    privateKey: privateKey as `0x${string}`,
    flashbotsEnabled: process.env.FLASHBOTS_ENABLED === 'true',
  };
}

// Process opportunity queue
async function processQueue(executor: TradeExecutor, config: BotConfig): Promise<void> {
  if (isProcessing || state.isPaused || opportunityQueue.length === 0) return;
  
  isProcessing = true;

  try {
    while (opportunityQueue.length > 0 && !state.isPaused) {
      const opportunity = opportunityQueue.shift();
      if (!opportunity) continue;

      // Check if opportunity is still valid
      if (Date.now() > opportunity.expiresAt) {
        logger.debug({ id: opportunity.id }, 'Opportunity expired');
        continue;
      }

      // Check minimum profit
      if (opportunity.netProfitUsd < config.minProfitUsd) {
        logger.debug({ id: opportunity.id, profit: opportunity.netProfitUsd }, 'Profit below threshold');
        continue;
      }

      logger.info({
        id: opportunity.id,
        chain: CHAIN_CONFIGS[opportunity.chain]?.name,
        path: opportunity.path.map(s => `${s.tokenIn.slice(0, 8)}→${s.tokenOut.slice(0, 8)}`),
        expectedProfit: opportunity.expectedProfit.toString(),
        profitUsd: opportunity.profitUsd,
      }, 'Executing opportunity');

      const result = await executor.execute(opportunity);

      state.totalTrades++;
      
      if (result.success) {
        state.successfulTrades++;
        state.totalProfit += result.profit || 0n;
        state.lastTradeTime = Date.now();
        
        logger.info({
          id: opportunity.id,
          txHash: result.txHash,
          profit: result.profit?.toString(),
          gasUsed: result.gasUsed?.toString(),
        }, 'Trade successful');
      } else {
        state.failedTrades++;
        logger.warn({
          id: opportunity.id,
          error: result.error,
        }, 'Trade failed');
      }

      // Add to history
      tradeHistory.unshift({
        id: opportunity.id,
        chain: opportunity.chain,
        timestamp: Date.now(),
        txHash: result.txHash || ('0x' + '0'.repeat(64) as `0x${string}`),
        inputToken: opportunity.inputToken,
        inputAmount: opportunity.inputAmount,
        outputAmount: opportunity.expectedOutput,
        profit: result.profit || 0n,
        profitUsd: result.success ? opportunity.profitUsd : 0,
        gasUsed: result.gasUsed || 0n,
        gasCostUsd: opportunity.gasCostUsd,
        path: opportunity.path.map(s => s.tokenOut),
        success: result.success,
        error: result.error,
      });

      // Trim history
      while (tradeHistory.length > MAX_HISTORY) {
        tradeHistory.pop();
      }

      // Cooldown
      await new Promise(resolve => setTimeout(resolve, config.cooldownMs));
    }
  } finally {
    isProcessing = false;
  }
}

// Simple HTTP API server for UI
function startApiServer(port: number, monitor: PriceMonitor, executor: TradeExecutor): void {
  const server = createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${port}`);
    
    try {
      if (url.pathname === '/api/status') {
        // Get balances
        const balances: Record<number, string> = {};
        for (const chainId of state.currentChains) {
          const balance = await executor.getBalance(chainId);
          balances[chainId] = balance.toString();
        }

        res.writeHead(200);
        res.end(JSON.stringify({
          ...state,
          totalProfit: state.totalProfit.toString(),
          address: executor.getAddress(),
          balances,
          uptime: Date.now() - state.uptime,
        }));
      } else if (url.pathname === '/api/trades') {
        res.writeHead(200);
        res.end(JSON.stringify(tradeHistory.map(t => ({
          ...t,
          inputAmount: t.inputAmount.toString(),
          outputAmount: t.outputAmount.toString(),
          profit: t.profit.toString(),
          gasUsed: t.gasUsed.toString(),
        }))));
      } else if (url.pathname === '/api/opportunities') {
        res.writeHead(200);
        res.end(JSON.stringify(opportunityQueue.map(o => ({
          ...o,
          inputAmount: o.inputAmount.toString(),
          expectedOutput: o.expectedOutput.toString(),
          expectedProfit: o.expectedProfit.toString(),
          gasEstimate: o.gasEstimate.toString(),
        }))));
      } else if (url.pathname === '/api/pools') {
        const chainId = Number(url.searchParams.get('chain')) as ChainId;
        const reserves = chainId ? monitor.getAllReserves(chainId) : [];
        res.writeHead(200);
        res.end(JSON.stringify(reserves.map(r => ({
          ...r,
          reserve0: r.reserve0.toString(),
          reserve1: r.reserve1.toString(),
        }))));
      } else if (url.pathname === '/api/pause' && req.method === 'POST') {
        state.isPaused = true;
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, isPaused: true }));
      } else if (url.pathname === '/api/resume' && req.method === 'POST') {
        state.isPaused = false;
        res.writeHead(200);
        res.end(JSON.stringify({ success: true, isPaused: false }));
      } else if (url.pathname === '/api/config') {
        const config = loadConfig();
        res.writeHead(200);
        res.end(JSON.stringify({
          minProfitUsd: config.minProfitUsd,
          maxGasPriceGwei: config.maxGasPriceGwei,
          maxSlippageBps: config.maxSlippageBps,
          dryRun: config.dryRun,
          enabledChains: config.enabledChains,
          flashbotsEnabled: config.flashbotsEnabled,
        }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      logger.error({ error }, 'API error');
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });

  server.listen(port, () => {
    logger.info({ port }, 'API server started');
  });
}

// Main entry point
async function main(): Promise<void> {
  logger.info('Starting Flashloan Arbitrage Bot v2.0');

  const config = loadConfig();
  
  logger.info({
    chains: config.enabledChains.map(c => CHAIN_CONFIGS[c]?.name),
    minProfitUsd: config.minProfitUsd,
    dryRun: config.dryRun,
    flashbotsEnabled: config.flashbotsEnabled,
  }, 'Configuration loaded');

  // Initialize components
  const monitor = new PriceMonitor(config.enabledChains);
  const executor = new TradeExecutor(config);

  logger.info({ address: executor.getAddress() }, 'Wallet loaded');

  // Initialize pools
  await monitor.initialize();

  // Set up opportunity handler
  monitor.onOpportunity((opportunities) => {
    for (const opp of opportunities) {
      // Calculate USD values (simplified - should use price feeds)
      const ethPriceUsd = 3000; // TODO: Get from oracle
      const profitEth = Number(opp.expectedProfit) / 1e18;
      const gasCostEth = Number(opp.gasEstimate * 30n * 10n ** 9n) / 1e18; // Assume 30 gwei
      
      opp.profitUsd = profitEth * ethPriceUsd;
      opp.gasCostUsd = gasCostEth * ethPriceUsd;
      opp.netProfitUsd = opp.profitUsd - opp.gasCostUsd;

      if (opp.netProfitUsd >= config.minProfitUsd) {
        logger.info({
          id: opp.id,
          chain: CHAIN_CONFIGS[opp.chain]?.name,
          profitUsd: opp.netProfitUsd.toFixed(2),
          confidence: opp.confidence.toFixed(2),
        }, 'Opportunity found');
        
        opportunityQueue.push(opp);
      }
    }

    // Process queue
    processQueue(executor, config);
  });

  // Start monitoring
  await monitor.startMonitoring();

  // Update state
  state.isRunning = true;
  state.currentChains = config.enabledChains;

  // Start API server
  const apiPort = Number(process.env.API_PORT) || 3001;
  startApiServer(apiPort, monitor, executor);

  logger.info('Bot started successfully');

  // Handle shutdown
  process.on('SIGINT', () => {
    logger.info('Shutting down...');
    state.isRunning = false;
    monitor.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Shutting down...');
    state.isRunning = false;
    monitor.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.fatal({ error }, 'Fatal error');
  process.exit(1);
});
