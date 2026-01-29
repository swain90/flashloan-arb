import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  encodeFunctionData,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum, base, optimism } from 'viem/chains';
import type { ChainId } from '../types/index.js';
import pino from 'pino';

const logger = pino({ name: 'cross-chain' });

// Across Protocol SpokePool addresses
const SPOKE_POOLS: Record<ChainId, Address> = {
  1: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',
  42161: '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A',
  8453: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64',
  10: '0x6f26Bf09B1C792e3228e5467807a900A503c0281',
};

// Supported tokens for bridging
const BRIDGE_TOKENS: Record<ChainId, Record<string, Address>> = {
  1: {
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  },
  42161: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  8453: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  10: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },
};

const SPOKE_POOL_ABI = parseAbi([
  'function deposit(address recipient, address originToken, uint256 amount, uint256 destinationChainId, int64 relayerFeePct, uint32 quoteTimestamp, bytes message, uint256 maxCount) payable',
  'function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) payable',
  'event V3FundsDeposited(address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint32 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, address indexed depositor, address recipient, address exclusiveRelayer, bytes message)',
]);

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
]);

const chainMap = {
  1: mainnet,
  42161: arbitrum,
  8453: base,
  10: optimism,
} as const;

interface BridgeQuote {
  inputAmount: bigint;
  outputAmount: bigint;
  relayerFeePct: bigint;
  estimatedFillTime: number; // seconds
  timestamp: number;
}

interface BridgeResult {
  success: boolean;
  txHash?: Hash;
  depositId?: number;
  estimatedArrival?: number;
  error?: string;
}

export class CrossChainBridge {
  private account;
  private rpcUrls: Record<ChainId, string>;

  constructor(privateKey: Hex, rpcUrls: Record<ChainId, string>) {
    this.account = privateKeyToAccount(privateKey);
    this.rpcUrls = rpcUrls;
  }

  /**
   * Get bridge quote from Across API
   */
  async getQuote(
    originChain: ChainId,
    destChain: ChainId,
    token: 'WETH' | 'USDC',
    amount: bigint
  ): Promise<BridgeQuote | null> {
    try {
      const inputToken = BRIDGE_TOKENS[originChain]?.[token];
      const outputToken = BRIDGE_TOKENS[destChain]?.[token];
      
      if (!inputToken || !outputToken) {
        logger.warn({ originChain, destChain, token }, 'Token not supported for bridge');
        return null;
      }

      // Call Across API for quote
      const url = new URL('https://across.to/api/suggested-fees');
      url.searchParams.set('originChainId', originChain.toString());
      url.searchParams.set('destinationChainId', destChain.toString());
      url.searchParams.set('token', inputToken);
      url.searchParams.set('amount', amount.toString());

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      // Calculate output after fees
      const relayerFeePct = BigInt(data.relayFeePct || '0');
      const lpFeePct = BigInt(data.lpFeePct || '0');
      const totalFeePct = relayerFeePct + lpFeePct;
      const outputAmount = amount - (amount * totalFeePct) / BigInt(1e18);

      return {
        inputAmount: amount,
        outputAmount,
        relayerFeePct,
        estimatedFillTime: data.estimatedFillTimeSec || 120,
        timestamp: Math.floor(Date.now() / 1000),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get bridge quote');
      return null;
    }
  }

  /**
   * Execute cross-chain bridge deposit
   */
  async bridge(
    originChain: ChainId,
    destChain: ChainId,
    token: 'WETH' | 'USDC',
    amount: bigint,
    recipient?: Address
  ): Promise<BridgeResult> {
    const inputToken = BRIDGE_TOKENS[originChain]?.[token];
    const outputToken = BRIDGE_TOKENS[destChain]?.[token];
    const spokePool = SPOKE_POOLS[originChain];

    if (!inputToken || !outputToken || !spokePool) {
      return { success: false, error: 'Unsupported route' };
    }

    const recipientAddress = recipient || this.account.address;
    const chain = chainMap[originChain];

    try {
      // Get quote
      const quote = await this.getQuote(originChain, destChain, token, amount);
      if (!quote) {
        return { success: false, error: 'Failed to get quote' };
      }

      // Create clients
      const publicClient = createPublicClient({
        chain,
        transport: http(this.rpcUrls[originChain]),
      });

      const walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(this.rpcUrls[originChain]),
      });

      // Check and approve allowance
      const allowance = await publicClient.readContract({
        address: inputToken,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [this.account.address, spokePool],
      });

      if (allowance < amount) {
        logger.info({ token, spokePool }, 'Approving token for bridge');
        const approveTx = await walletClient.writeContract({
          address: inputToken,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [spokePool, amount * 2n], // Approve 2x for future use
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      // Calculate fill deadline (30 minutes from now)
      const quoteTimestamp = Math.floor(Date.now() / 1000);
      const fillDeadline = quoteTimestamp + 1800;

      // Execute deposit using V3
      const depositTx = await walletClient.writeContract({
        address: spokePool,
        abi: SPOKE_POOL_ABI,
        functionName: 'depositV3',
        args: [
          this.account.address, // depositor
          recipientAddress, // recipient
          inputToken, // inputToken
          outputToken, // outputToken
          amount, // inputAmount
          quote.outputAmount, // outputAmount (minimum)
          BigInt(destChain), // destinationChainId
          '0x0000000000000000000000000000000000000000' as Address, // exclusiveRelayer (none)
          quoteTimestamp, // quoteTimestamp
          fillDeadline, // fillDeadline
          0, // exclusivityDeadline (none)
          '0x' as Hex, // message (empty)
        ],
      });

      logger.info({
        originChain,
        destChain,
        amount: amount.toString(),
        txHash: depositTx,
      }, 'Bridge deposit submitted');

      // Wait for confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });

      // Extract deposit ID from logs
      let depositId: number | undefined;
      for (const log of receipt.logs) {
        try {
          // Parse V3FundsDeposited event
          if (log.topics[0] === '0x...') { // Event signature
            depositId = Number(log.topics[2]);
          }
        } catch {
          // Not our event
        }
      }

      return {
        success: receipt.status === 'success',
        txHash: depositTx,
        depositId,
        estimatedArrival: Date.now() + quote.estimatedFillTime * 1000,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage }, 'Bridge failed');
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Check if a cross-chain opportunity is profitable after bridge fees
   */
  async isProfitableAfterBridge(
    buyChain: ChainId,
    sellChain: ChainId,
    token: 'WETH' | 'USDC',
    amount: bigint,
    expectedProfitBps: number
  ): Promise<{ profitable: boolean; netProfit: bigint }> {
    const quote = await this.getQuote(buyChain, sellChain, token, amount);
    if (!quote) {
      return { profitable: false, netProfit: 0n };
    }

    // Fee in basis points
    const feeBps = Number((amount - quote.outputAmount) * 10000n / amount);
    
    // Net profit after bridge
    const netProfitBps = expectedProfitBps - feeBps;
    const netProfit = (amount * BigInt(netProfitBps)) / 10000n;

    logger.debug({
      buyChain,
      sellChain,
      expectedProfitBps,
      bridgeFeeBps: feeBps,
      netProfitBps,
    }, 'Cross-chain profitability check');

    return {
      profitable: netProfitBps > 10, // At least 10 bps after fees
      netProfit,
    };
  }

  /**
   * Get balances across all chains
   */
  async getBalances(token: 'WETH' | 'USDC'): Promise<Record<ChainId, bigint>> {
    const balances: Record<ChainId, bigint> = {} as Record<ChainId, bigint>;

    await Promise.all(
      (Object.keys(BRIDGE_TOKENS) as unknown as ChainId[]).map(async (chainId) => {
        const tokenAddress = BRIDGE_TOKENS[chainId]?.[token];
        if (!tokenAddress || !this.rpcUrls[chainId]) return;

        try {
          const client = createPublicClient({
            chain: chainMap[chainId],
            transport: http(this.rpcUrls[chainId]),
          });

          const balance = await client.readContract({
            address: tokenAddress,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [this.account.address],
          });

          balances[chainId] = balance;
        } catch (error) {
          logger.debug({ chainId, error }, 'Failed to get balance');
          balances[chainId] = 0n;
        }
      })
    );

    return balances;
  }

  /**
   * Rebalance funds between chains
   */
  async rebalance(
    targetDistribution: Record<ChainId, number>, // Percentage per chain (should sum to 100)
    token: 'WETH' | 'USDC',
    minRebalanceAmount: bigint
  ): Promise<BridgeResult[]> {
    const balances = await this.getBalances(token);
    const totalBalance = Object.values(balances).reduce((a, b) => a + b, 0n);
    
    if (totalBalance === 0n) {
      logger.warn('No balance to rebalance');
      return [];
    }

    const results: BridgeResult[] = [];

    // Calculate target amounts
    const targetAmounts: Record<ChainId, bigint> = {} as Record<ChainId, bigint>;
    for (const [chainId, pct] of Object.entries(targetDistribution)) {
      targetAmounts[Number(chainId) as ChainId] = (totalBalance * BigInt(pct)) / 100n;
    }

    // Find chains that need rebalancing
    const overweight: { chain: ChainId; excess: bigint }[] = [];
    const underweight: { chain: ChainId; deficit: bigint }[] = [];

    for (const chainId of Object.keys(balances) as unknown as ChainId[]) {
      const current = balances[chainId] || 0n;
      const target = targetAmounts[chainId] || 0n;
      const diff = current - target;

      if (diff > minRebalanceAmount) {
        overweight.push({ chain: chainId, excess: diff });
      } else if (diff < -minRebalanceAmount) {
        underweight.push({ chain: chainId, deficit: -diff });
      }
    }

    // Execute bridges from overweight to underweight
    for (const from of overweight) {
      for (const to of underweight) {
        if (from.excess <= 0n || to.deficit <= 0n) continue;

        const amount = from.excess < to.deficit ? from.excess : to.deficit;
        
        logger.info({
          from: from.chain,
          to: to.chain,
          amount: amount.toString(),
        }, 'Rebalancing');

        const result = await this.bridge(from.chain, to.chain, token, amount);
        results.push(result);

        if (result.success) {
          from.excess -= amount;
          to.deficit -= amount;
        }
      }
    }

    return results;
  }
}
