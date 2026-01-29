import {
  createWalletClient,
  createPublicClient,
  http,
  parseAbi,
  encodeFunctionData,
  type Address,
  type Hash,
  type Hex,
  type WalletClient,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, base, optimism } from 'viem/chains';
import type {
  ArbitrageOpportunity,
  ChainId,
  ExecutionResult,
  SimulationResult,
  BotConfig,
} from '../types/index.js';
import { CHAIN_CONFIGS } from '../config/chains.js';
import pino from 'pino';

const logger = pino({ name: 'executor' });

const ARBITRAGE_ABI = parseAbi([
  'struct SwapStep { address router; address tokenIn; address tokenOut; uint256 amountIn; bytes data; uint8 dexType; }',
  'struct ArbitrageParams { address flashToken; uint256 flashAmount; SwapStep[] swaps; uint256 minProfit; }',
  'function executeArbitrage((address flashToken, uint256 flashAmount, (address router, address tokenIn, address tokenOut, uint256 amountIn, bytes data, uint8 dexType)[] swaps, uint256 minProfit) params)',
]);

const chainMap = {
  1: mainnet,
  42161: arbitrum,
  8453: base,
  10: optimism,
} as const;

interface FlashbotsBundle {
  signedTransactions: Hex[];
  blockNumber: bigint;
  minTimestamp?: number;
  maxTimestamp?: number;
}

export class TradeExecutor {
  private walletClients: Map<ChainId, WalletClient> = new Map();
  private publicClients: Map<ChainId, PublicClient> = new Map();
  private config: BotConfig;
  private account: ReturnType<typeof privateKeyToAccount>;

  constructor(config: BotConfig) {
    this.config = config;
    this.account = privateKeyToAccount(config.privateKey);

    for (const chainId of config.enabledChains) {
      const chainConfig = CHAIN_CONFIGS[chainId];
      if (!chainConfig) continue;

      const chain = chainMap[chainId];

      // Public client for reads and simulation
      const publicClient = createPublicClient({
        chain,
        transport: http(chainConfig.rpcUrl),
      });

      // Wallet client for signing
      // Use Flashbots RPC on mainnet if enabled
      const rpcUrl = chainId === 1 && config.flashbotsEnabled
        ? chainConfig.flashbotsRpc || chainConfig.rpcUrl
        : chainConfig.rpcUrl;

      const walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(rpcUrl),
      });

      this.publicClients.set(chainId, publicClient);
      this.walletClients.set(chainId, walletClient);
    }
  }

  /**
   * Simulate trade before execution
   */
  async simulate(opportunity: ArbitrageOpportunity): Promise<SimulationResult> {
    const publicClient = this.publicClients.get(opportunity.chain);
    if (!publicClient) {
      return { success: false, profit: 0n, gasUsed: 0n, error: 'No client for chain', logs: [] };
    }

    const chainConfig = CHAIN_CONFIGS[opportunity.chain];
    if (!chainConfig) {
      return { success: false, profit: 0n, gasUsed: 0n, error: 'No config for chain', logs: [] };
    }

    try {
      const calldata = this.encodeArbitrageCall(opportunity);

      const result = await publicClient.simulateContract({
        address: chainConfig.contracts.arbitrage,
        abi: ARBITRAGE_ABI,
        functionName: 'executeArbitrage',
        args: [this.buildArbitrageParams(opportunity)],
        account: this.account.address,
      });

      // Estimate gas
      const gasEstimate = await publicClient.estimateGas({
        to: chainConfig.contracts.arbitrage,
        data: calldata,
        account: this.account.address,
      });

      return {
        success: true,
        profit: opportunity.expectedProfit,
        gasUsed: gasEstimate,
        logs: [`Simulation successful, estimated gas: ${gasEstimate}`],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn({ opportunity: opportunity.id, error: errorMessage }, 'Simulation failed');
      
      return {
        success: false,
        profit: 0n,
        gasUsed: 0n,
        error: errorMessage,
        logs: [`Simulation failed: ${errorMessage}`],
      };
    }
  }

  /**
   * Execute arbitrage trade
   */
  async execute(opportunity: ArbitrageOpportunity): Promise<ExecutionResult> {
    const walletClient = this.walletClients.get(opportunity.chain);
    const publicClient = this.publicClients.get(opportunity.chain);
    
    if (!walletClient || !publicClient) {
      return { success: false, error: 'No client for chain', timestamp: Date.now() };
    }

    const chainConfig = CHAIN_CONFIGS[opportunity.chain];
    if (!chainConfig) {
      return { success: false, error: 'No config for chain', timestamp: Date.now() };
    }

    // Check if dry run
    if (this.config.dryRun) {
      logger.info({ opportunity: opportunity.id }, 'DRY RUN - Would execute trade');
      return {
        success: true,
        txHash: '0x' + '0'.repeat(64) as Hash,
        profit: opportunity.expectedProfit,
        gasUsed: opportunity.gasEstimate,
        timestamp: Date.now(),
      };
    }

    try {
      // Simulate first if enabled
      if (this.config.simulateBeforeExecute) {
        const simResult = await this.simulate(opportunity);
        if (!simResult.success) {
          return { success: false, error: simResult.error, timestamp: Date.now() };
        }
      }

      // Get current gas price
      const gasPrice = await publicClient.getGasPrice();
      const maxGasPrice = BigInt(this.config.maxGasPriceGwei) * 10n ** 9n;
      
      if (gasPrice > maxGasPrice) {
        return { success: false, error: `Gas price too high: ${gasPrice}`, timestamp: Date.now() };
      }

      // Choose execution method based on chain
      let txHash: Hash;
      
      if (opportunity.chain === 1 && this.config.flashbotsEnabled) {
        txHash = await this.executeViaFlashbots(opportunity, walletClient, publicClient);
      } else {
        txHash = await this.executeStandard(opportunity, walletClient, publicClient, chainConfig);
      }

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
      });

      const success = receipt.status === 'success';
      
      logger.info({
        opportunity: opportunity.id,
        txHash,
        success,
        gasUsed: receipt.gasUsed,
        blockNumber: receipt.blockNumber,
      }, 'Trade executed');

      return {
        success,
        txHash,
        profit: success ? opportunity.expectedProfit : 0n,
        gasUsed: receipt.gasUsed,
        blockNumber: receipt.blockNumber,
        timestamp: Date.now(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ opportunity: opportunity.id, error: errorMessage }, 'Trade execution failed');
      
      return {
        success: false,
        error: errorMessage,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Execute via standard transaction
   */
  private async executeStandard(
    opportunity: ArbitrageOpportunity,
    walletClient: WalletClient,
    publicClient: PublicClient,
    chainConfig: typeof CHAIN_CONFIGS[1]
  ): Promise<Hash> {
    const calldata = this.encodeArbitrageCall(opportunity);
    
    // Get nonce
    const nonce = await publicClient.getTransactionCount({
      address: this.account.address,
    });

    // Get gas estimate with buffer
    const gasEstimate = await publicClient.estimateGas({
      to: chainConfig.contracts.arbitrage,
      data: calldata,
      account: this.account.address,
    });
    const gasLimit = (gasEstimate * 120n) / 100n; // 20% buffer

    // Get gas price
    const gasPrice = await publicClient.getGasPrice();
    const priorityFee = this.getPriorityFee(opportunity.chain);

    // Send transaction
    const txHash = await walletClient.sendTransaction({
      to: chainConfig.contracts.arbitrage,
      data: calldata,
      gas: gasLimit,
      maxFeePerGas: gasPrice + priorityFee,
      maxPriorityFeePerGas: priorityFee,
      nonce,
    });

    return txHash;
  }

  /**
   * Execute via Flashbots (mainnet only)
   */
  private async executeViaFlashbots(
    opportunity: ArbitrageOpportunity,
    walletClient: WalletClient,
    publicClient: PublicClient
  ): Promise<Hash> {
    const chainConfig = CHAIN_CONFIGS[1];
    if (!chainConfig) throw new Error('No mainnet config');

    const calldata = this.encodeArbitrageCall(opportunity);
    
    // Get current block
    const blockNumber = await publicClient.getBlockNumber();
    const targetBlock = blockNumber + 1n;

    // Get gas estimate
    const gasEstimate = await publicClient.estimateGas({
      to: chainConfig.contracts.arbitrage,
      data: calldata,
      account: this.account.address,
    });

    // Get gas price
    const gasPrice = await publicClient.getGasPrice();
    
    // Sign transaction
    const nonce = await publicClient.getTransactionCount({
      address: this.account.address,
    });

    // For Flashbots, we use the Flashbots RPC which handles bundle submission
    // The transaction is sent directly - Flashbots Protect RPC handles the MEV protection
    const txHash = await walletClient.sendTransaction({
      to: chainConfig.contracts.arbitrage,
      data: calldata,
      gas: (gasEstimate * 120n) / 100n,
      maxFeePerGas: gasPrice * 2n, // Higher fee for priority
      maxPriorityFeePerGas: gasPrice / 2n,
      nonce,
    });

    logger.info({ txHash, targetBlock }, 'Submitted via Flashbots Protect');

    return txHash;
  }

  /**
   * Get priority fee for chain
   */
  private getPriorityFee(chainId: ChainId): bigint {
    // Priority fees in gwei
    const fees: Record<ChainId, bigint> = {
      1: 2n * 10n ** 9n,      // 2 gwei on mainnet
      42161: 1n * 10n ** 8n,  // 0.1 gwei on Arbitrum
      8453: 1n * 10n ** 8n,   // 0.1 gwei on Base
      10: 1n * 10n ** 8n,     // 0.1 gwei on Optimism
    };
    return fees[chainId] || 1n * 10n ** 9n;
  }

  /**
   * Encode arbitrage call data
   */
  private encodeArbitrageCall(opportunity: ArbitrageOpportunity): Hex {
    return encodeFunctionData({
      abi: ARBITRAGE_ABI,
      functionName: 'executeArbitrage',
      args: [this.buildArbitrageParams(opportunity)],
    });
  }

  /**
   * Build arbitrage params for contract call
   */
  private buildArbitrageParams(opportunity: ArbitrageOpportunity) {
    return {
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
      minProfit: (opportunity.expectedProfit * BigInt(100 - this.config.maxSlippageBps)) / 100n,
    };
  }

  /**
   * Get wallet address
   */
  getAddress(): Address {
    return this.account.address;
  }

  /**
   * Get balance on chain
   */
  async getBalance(chainId: ChainId): Promise<bigint> {
    const client = this.publicClients.get(chainId);
    if (!client) return 0n;
    
    return client.getBalance({ address: this.account.address });
  }

  /**
   * Get token balance
   */
  async getTokenBalance(chainId: ChainId, token: Address): Promise<bigint> {
    const client = this.publicClients.get(chainId);
    if (!client) return 0n;

    const balance = await client.readContract({
      address: token,
      abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
      functionName: 'balanceOf',
      args: [this.account.address],
    });

    return balance;
  }
}
