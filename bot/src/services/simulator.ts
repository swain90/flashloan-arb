import {
  createPublicClient,
  http,
  encodeFunctionData,
  decodeFunctionResult,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { mainnet, arbitrum, base, optimism } from 'viem/chains';
import type { ArbitrageOpportunity, ChainId, SimulationResult } from '../types/index.js';
import { CHAIN_CONFIGS } from '../config/chains.js';
import pino from 'pino';

const logger = pino({ name: 'simulator' });

const chainMap = {
  1: mainnet,
  42161: arbitrum,
  8453: base,
  10: optimism,
} as const;

const ARBITRAGE_ABI = parseAbi([
  'function executeArbitrage((address flashToken, uint256 flashAmount, (address router, address tokenIn, address tokenOut, uint256 amountIn, bytes data, uint8 dexType)[] swaps, uint256 minProfit) params)',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) view returns (uint256)',
]);

interface SimulationOptions {
  blockNumber?: bigint;
  gasLimit?: bigint;
  value?: bigint;
}

export class TradeSimulator {
  private clients: Map<ChainId, ReturnType<typeof createPublicClient>> = new Map();

  constructor(enabledChains: ChainId[]) {
    for (const chainId of enabledChains) {
      const config = CHAIN_CONFIGS[chainId];
      if (!config) continue;

      const chain = chainMap[chainId];
      const client = createPublicClient({
        chain,
        transport: http(config.rpcUrl),
      });

      this.clients.set(chainId, client);
    }
  }

  /**
   * Simulate an arbitrage opportunity using eth_call
   */
  async simulate(
    opportunity: ArbitrageOpportunity,
    executorAddress: Address,
    options: SimulationOptions = {}
  ): Promise<SimulationResult> {
    const client = this.clients.get(opportunity.chain);
    if (!client) {
      return {
        success: false,
        profit: 0n,
        gasUsed: 0n,
        error: 'No client for chain',
        logs: [],
      };
    }

    const config = CHAIN_CONFIGS[opportunity.chain];
    if (!config) {
      return {
        success: false,
        profit: 0n,
        gasUsed: 0n,
        error: 'No config for chain',
        logs: [],
      };
    }

    const logs: string[] = [];

    try {
      // Build calldata
      const calldata = this.encodeArbitrageCall(opportunity);
      
      logs.push(`Simulating on ${config.name}...`);
      logs.push(`Flash amount: ${opportunity.inputAmount.toString()}`);
      logs.push(`Swap steps: ${opportunity.path.length}`);

      // Get balances before (for profit calculation)
      const balanceBefore = await this.getTokenBalance(
        opportunity.chain,
        opportunity.inputToken,
        config.contracts.arbitrage
      );

      // Simulate the transaction
      const result = await client.call({
        to: config.contracts.arbitrage,
        data: calldata,
        account: executorAddress,
        blockNumber: options.blockNumber,
        gas: options.gasLimit || 1000000n,
      });

      // Get balance after (simulated)
      const balanceAfter = await this.getTokenBalance(
        opportunity.chain,
        opportunity.inputToken,
        config.contracts.arbitrage
      );

      // Estimate gas
      const gasEstimate = await client.estimateGas({
        to: config.contracts.arbitrage,
        data: calldata,
        account: executorAddress,
      });

      const profit = balanceAfter - balanceBefore;
      
      logs.push(`Simulation successful`);
      logs.push(`Estimated gas: ${gasEstimate.toString()}`);
      logs.push(`Simulated profit: ${profit.toString()}`);

      return {
        success: true,
        profit,
        gasUsed: gasEstimate,
        logs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logs.push(`Simulation failed: ${errorMessage}`);
      
      // Try to parse revert reason
      const revertReason = this.parseRevertReason(errorMessage);
      if (revertReason) {
        logs.push(`Revert reason: ${revertReason}`);
      }

      logger.debug({
        opportunity: opportunity.id,
        error: errorMessage,
      }, 'Simulation failed');

      return {
        success: false,
        profit: 0n,
        gasUsed: 0n,
        error: revertReason || errorMessage,
        logs,
      };
    }
  }

  /**
   * Simulate multiple swap paths and return the most profitable
   */
  async findBestPath(
    opportunities: ArbitrageOpportunity[],
    executorAddress: Address
  ): Promise<{ best: ArbitrageOpportunity | null; results: Map<string, SimulationResult> }> {
    const results = new Map<string, SimulationResult>();
    let best: ArbitrageOpportunity | null = null;
    let bestProfit = 0n;

    // Run simulations in parallel (with concurrency limit)
    const BATCH_SIZE = 5;
    
    for (let i = 0; i < opportunities.length; i += BATCH_SIZE) {
      const batch = opportunities.slice(i, i + BATCH_SIZE);
      
      const batchResults = await Promise.all(
        batch.map(async (opp) => {
          const result = await this.simulate(opp, executorAddress);
          return { opp, result };
        })
      );

      for (const { opp, result } of batchResults) {
        results.set(opp.id, result);
        
        if (result.success && result.profit > bestProfit) {
          bestProfit = result.profit;
          best = opp;
        }
      }
    }

    return { best, results };
  }

  /**
   * Quick profitability check without full simulation
   */
  async quickCheck(
    opportunity: ArbitrageOpportunity,
    executorAddress: Address
  ): Promise<{ profitable: boolean; estimatedProfit: bigint }> {
    const client = this.clients.get(opportunity.chain);
    if (!client) {
      return { profitable: false, estimatedProfit: 0n };
    }

    const config = CHAIN_CONFIGS[opportunity.chain];
    if (!config) {
      return { profitable: false, estimatedProfit: 0n };
    }

    try {
      // Quick gas estimate
      const calldata = this.encodeArbitrageCall(opportunity);
      
      const gasEstimate = await client.estimateGas({
        to: config.contracts.arbitrage,
        data: calldata,
        account: executorAddress,
      });

      // Get gas price
      const gasPrice = await client.getGasPrice();
      const gasCost = gasEstimate * gasPrice;

      // Compare expected profit vs gas cost
      const profitable = opportunity.expectedProfit > gasCost * 2n; // 2x buffer
      const estimatedProfit = opportunity.expectedProfit - gasCost;

      return { profitable, estimatedProfit };
    } catch {
      return { profitable: false, estimatedProfit: 0n };
    }
  }

  /**
   * Get token balance
   */
  private async getTokenBalance(
    chainId: ChainId,
    token: Address,
    account: Address
  ): Promise<bigint> {
    const client = this.clients.get(chainId);
    if (!client) return 0n;

    try {
      const balance = await client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account],
      });
      return balance;
    } catch {
      return 0n;
    }
  }

  /**
   * Encode arbitrage call
   */
  private encodeArbitrageCall(opportunity: ArbitrageOpportunity): Hex {
    return encodeFunctionData({
      abi: ARBITRAGE_ABI,
      functionName: 'executeArbitrage',
      args: [{
        flashToken: opportunity.inputToken,
        flashAmount: opportunity.inputAmount,
        swaps: opportunity.path.map(step => ({
          router: step.router,
          tokenIn: step.tokenIn,
          tokenOut: step.tokenOut,
          amountIn: step.amountIn,
          data: step.data,
          dexType: step.dexType,
        })),
        minProfit: 0n, // For simulation, accept any outcome
      }],
    });
  }

  /**
   * Parse revert reason from error message
   */
  private parseRevertReason(error: string): string | null {
    // Common revert patterns
    const patterns = [
      /revert(?:ed)?\s*(?:with\s*)?(?:reason\s*)?[:\s]*["']?([^"'\n]+)["']?/i,
      /execution reverted[:\s]*([^\n]+)/i,
      /VM Exception[:\s]*([^\n]+)/i,
    ];

    for (const pattern of patterns) {
      const match = error.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }

    // Check for custom error selectors
    if (error.includes('InsufficientProfit')) return 'Insufficient profit';
    if (error.includes('RouterNotApproved')) return 'Router not approved';
    if (error.includes('MaxLossExceeded')) return 'Max loss exceeded';
    if (error.includes('Paused')) return 'Contract paused';

    return null;
  }

  /**
   * Validate opportunity is still viable
   */
  async validateOpportunity(
    opportunity: ArbitrageOpportunity,
    maxAgeMs: number = 2000
  ): Promise<boolean> {
    // Check timestamp
    if (Date.now() - opportunity.timestamp > maxAgeMs) {
      logger.debug({ id: opportunity.id }, 'Opportunity expired');
      return false;
    }

    // Check confidence threshold
    if (opportunity.confidence < 0.5) {
      logger.debug({ id: opportunity.id, confidence: opportunity.confidence }, 'Low confidence');
      return false;
    }

    return true;
  }
}
