import {
  createPublicClient,
  webSocket,
  http,
  parseAbiItem,
  type Address,
  type PublicClient,
  type WatchContractEventReturnType,
  getContract,
} from 'viem';
import { mainnet, arbitrum, base, optimism } from 'viem/chains';
import type { ChainConfig, ChainId, PoolReserves, Edge, DexConfig } from '../types/index.js';
import { DexType } from '../types/index.js';
import { ArbitrageDetector } from './arbitrage-detector.js';
import { CHAIN_CONFIGS } from '../config/chains.js';
import pino from 'pino';

const logger = pino({ name: 'price-monitor' });

// ABIs for different pool types
const UNISWAP_V2_PAIR_ABI = [
  parseAbiItem('event Sync(uint112 reserve0, uint112 reserve1)'),
  parseAbiItem('function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)'),
  parseAbiItem('function token0() view returns (address)'),
  parseAbiItem('function token1() view returns (address)'),
] as const;

const UNISWAP_V2_FACTORY_ABI = [
  parseAbiItem('function getPair(address tokenA, address tokenB) view returns (address pair)'),
  parseAbiItem('function allPairs(uint256) view returns (address pair)'),
  parseAbiItem('function allPairsLength() view returns (uint256)'),
] as const;

const UNISWAP_V3_POOL_ABI = [
  parseAbiItem('event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)'),
  parseAbiItem('function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'),
  parseAbiItem('function liquidity() view returns (uint128)'),
  parseAbiItem('function token0() view returns (address)'),
  parseAbiItem('function token1() view returns (address)'),
  parseAbiItem('function fee() view returns (uint24)'),
] as const;

const UNISWAP_V3_FACTORY_ABI = [
  parseAbiItem('function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)'),
] as const;

const chainMap = {
  1: mainnet,
  42161: arbitrum,
  8453: base,
  10: optimism,
} as const;

interface PoolSubscription {
  pool: Address;
  dex: string;
  dexType: DexType;
  router: Address;
  token0: Address;
  token1: Address;
  fee: number;
  unwatch?: WatchContractEventReturnType;
}

export class PriceMonitor {
  private clients: Map<ChainId, PublicClient> = new Map();
  private subscriptions: Map<ChainId, PoolSubscription[]> = new Map();
  private reserves: Map<string, PoolReserves> = new Map();
  private detectors: Map<ChainId, ArbitrageDetector> = new Map();
  private onOpportunityCallback?: (opportunities: ReturnType<ArbitrageDetector['findArbitrageOpportunities']>) => void;

  constructor(private enabledChains: ChainId[]) {
    for (const chainId of enabledChains) {
      const config = CHAIN_CONFIGS[chainId];
      if (!config) continue;

      const chain = chainMap[chainId];
      
      // Create client with WebSocket for subscriptions
      const client = createPublicClient({
        chain,
        transport: config.wsUrl 
          ? webSocket(config.wsUrl, { reconnect: true })
          : http(config.rpcUrl),
      });

      this.clients.set(chainId, client);
      this.subscriptions.set(chainId, []);
      this.detectors.set(chainId, new ArbitrageDetector(chainId));
    }
  }

  /**
   * Initialize monitoring for all configured DEXes
   */
  async initialize(): Promise<void> {
    logger.info('Initializing price monitor...');

    for (const chainId of this.enabledChains) {
      const config = CHAIN_CONFIGS[chainId];
      if (!config) continue;

      logger.info({ chain: config.name }, 'Discovering pools...');

      for (const dex of config.dexes) {
        await this.discoverPools(chainId, dex);
      }

      const subs = this.subscriptions.get(chainId) || [];
      logger.info({ chain: config.name, pools: subs.length }, 'Pool discovery complete');
    }
  }

  /**
   * Discover pools for a DEX
   */
  private async discoverPools(chainId: ChainId, dex: DexConfig): Promise<void> {
    const client = this.clients.get(chainId);
    if (!client) return;

    const config = CHAIN_CONFIGS[chainId];
    if (!config) return;

    // Key token pairs to monitor
    const tokenPairs = this.getKeyTokenPairs(chainId);

    if (dex.type === DexType.UniswapV2 || dex.type === DexType.Velodrome) {
      await this.discoverV2Pools(chainId, dex, tokenPairs);
    } else if (dex.type === DexType.UniswapV3) {
      await this.discoverV3Pools(chainId, dex, tokenPairs);
    }
  }

  /**
   * Get key token pairs for a chain
   */
  private getKeyTokenPairs(chainId: ChainId): [Address, Address][] {
    const pairs: [Address, Address][] = [];
    
    // Common tokens per chain
    const tokens: Record<ChainId, Address[]> = {
      1: [
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        '0x6B175474E89094C44Da98b954EedefdFD691903dCB', // DAI
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
      ],
      42161: [
        '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
        '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
        '0x912CE59144191C1204E64559FE8253a0e49E6548', // ARB
      ],
      8453: [
        '0x4200000000000000000000000000000000000006', // WETH
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
        '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', // cbETH
      ],
      10: [
        '0x4200000000000000000000000000000000000006', // WETH
        '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC
        '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', // USDT
        '0x4200000000000000000000000000000000000042', // OP
      ],
    };

    const chainTokens = tokens[chainId] || [];
    
    // Generate all pairs
    for (let i = 0; i < chainTokens.length; i++) {
      for (let j = i + 1; j < chainTokens.length; j++) {
        const tokenA = chainTokens[i];
        const tokenB = chainTokens[j];
        if (tokenA && tokenB) {
          pairs.push([tokenA, tokenB]);
        }
      }
    }

    return pairs;
  }

  /**
   * Discover V2-style pools
   */
  private async discoverV2Pools(
    chainId: ChainId,
    dex: DexConfig,
    tokenPairs: [Address, Address][]
  ): Promise<void> {
    const client = this.clients.get(chainId);
    if (!client) return;

    const factory = getContract({
      address: dex.factory,
      abi: UNISWAP_V2_FACTORY_ABI,
      client,
    });

    for (const [tokenA, tokenB] of tokenPairs) {
      try {
        const pairAddress = await factory.read.getPair([tokenA, tokenB]);
        
        if (pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000') {
          const pair = getContract({
            address: pairAddress,
            abi: UNISWAP_V2_PAIR_ABI,
            client,
          });

          const [token0, token1, reserves] = await Promise.all([
            pair.read.token0(),
            pair.read.token1(),
            pair.read.getReserves(),
          ]);

          // Determine fee (V2 = 30bps, Velodrome varies)
          const fee = dex.type === DexType.Velodrome ? 2 : 30; // 0.02% for stable, 0.3% for volatile

          const subscription: PoolSubscription = {
            pool: pairAddress,
            dex: dex.name,
            dexType: dex.type,
            router: dex.router,
            token0,
            token1,
            fee,
          };

          const subs = this.subscriptions.get(chainId) || [];
          subs.push(subscription);
          this.subscriptions.set(chainId, subs);

          // Store initial reserves
          this.updateReserves(chainId, subscription, reserves[0], reserves[1]);
        }
      } catch (error) {
        logger.debug({ dex: dex.name, tokenA, tokenB, error }, 'Pair not found');
      }
    }
  }

  /**
   * Discover V3-style pools
   */
  private async discoverV3Pools(
    chainId: ChainId,
    dex: DexConfig,
    tokenPairs: [Address, Address][]
  ): Promise<void> {
    const client = this.clients.get(chainId);
    if (!client) return;

    const feeTiers = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

    const factory = getContract({
      address: dex.factory,
      abi: UNISWAP_V3_FACTORY_ABI,
      client,
    });

    for (const [tokenA, tokenB] of tokenPairs) {
      for (const fee of feeTiers) {
        try {
          const poolAddress = await factory.read.getPool([tokenA, tokenB, fee]);
          
          if (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') {
            const pool = getContract({
              address: poolAddress,
              abi: UNISWAP_V3_POOL_ABI,
              client,
            });

            const [token0, token1, liquidity, slot0] = await Promise.all([
              pool.read.token0(),
              pool.read.token1(),
              pool.read.liquidity(),
              pool.read.slot0(),
            ]);

            // Convert V3 data to "reserve-like" values for comparison
            // This is simplified - real V3 quotes need more complex calculation
            const sqrtPriceX96 = slot0[0];

            const subscription: PoolSubscription = {
              pool: poolAddress,
              dex: dex.name,
              dexType: DexType.UniswapV3,
              router: dex.router,
              token0,
              token1,
              fee: fee / 100, // Convert to basis points
            };

            const subs = this.subscriptions.get(chainId) || [];
            subs.push(subscription);
            this.subscriptions.set(chainId, subs);

            // Store V3 pool data (using sqrtPrice and liquidity)
            this.updateV3Pool(chainId, subscription, sqrtPriceX96, liquidity);
          }
        } catch (error) {
          logger.debug({ dex: dex.name, tokenA, tokenB, fee, error }, 'V3 pool not found');
        }
      }
    }
  }

  /**
   * Start listening for price updates
   */
  async startMonitoring(): Promise<void> {
    logger.info('Starting price monitoring...');

    for (const chainId of this.enabledChains) {
      const client = this.clients.get(chainId);
      const subs = this.subscriptions.get(chainId);
      if (!client || !subs) continue;

      for (const sub of subs) {
        if (sub.dexType === DexType.UniswapV2 || sub.dexType === DexType.Velodrome) {
          // Watch Sync events for V2 pools
          sub.unwatch = client.watchContractEvent({
            address: sub.pool,
            abi: UNISWAP_V2_PAIR_ABI,
            eventName: 'Sync',
            onLogs: (logs) => {
              for (const log of logs) {
                const { reserve0, reserve1 } = log.args;
                if (reserve0 !== undefined && reserve1 !== undefined) {
                  this.updateReserves(chainId, sub, reserve0, reserve1);
                  this.checkArbitrage(chainId);
                }
              }
            },
          });
        } else if (sub.dexType === DexType.UniswapV3) {
          // Watch Swap events for V3 pools
          sub.unwatch = client.watchContractEvent({
            address: sub.pool,
            abi: UNISWAP_V3_POOL_ABI,
            eventName: 'Swap',
            onLogs: async (logs) => {
              for (const log of logs) {
                const { sqrtPriceX96, liquidity } = log.args;
                if (sqrtPriceX96 !== undefined && liquidity !== undefined) {
                  this.updateV3Pool(chainId, sub, sqrtPriceX96, liquidity);
                  this.checkArbitrage(chainId);
                }
              }
            },
          });
        }
      }

      const config = CHAIN_CONFIGS[chainId];
      logger.info({ chain: config?.name, subscriptions: subs.length }, 'Monitoring started');
    }
  }

  /**
   * Update reserves and graph edges for V2 pools
   */
  private updateReserves(
    chainId: ChainId,
    sub: PoolSubscription,
    reserve0: bigint,
    reserve1: bigint
  ): void {
    const key = `${chainId}-${sub.pool}`;
    
    this.reserves.set(key, {
      pool: sub.pool,
      dex: sub.dex,
      token0: sub.token0,
      token1: sub.token1,
      reserve0,
      reserve1,
      fee: sub.fee,
      timestamp: Date.now(),
    });

    // Update graph edges
    const detector = this.detectors.get(chainId);
    if (!detector) return;

    // Forward edge (token0 -> token1)
    const { rate: rate01 } = ArbitrageDetector.calculateRate(
      reserve0, reserve1, 10n ** 18n, sub.fee
    );
    
    detector.addEdge({
      from: sub.token0,
      to: sub.token1,
      pool: sub.pool,
      dex: sub.dex,
      dexType: sub.dexType,
      router: sub.router,
      weight: ArbitrageDetector.calculateWeight(rate01),
      reserve0,
      reserve1,
      fee: sub.fee,
    });

    // Reverse edge (token1 -> token0)
    const { rate: rate10 } = ArbitrageDetector.calculateRate(
      reserve1, reserve0, 10n ** 18n, sub.fee
    );
    
    detector.addEdge({
      from: sub.token1,
      to: sub.token0,
      pool: sub.pool,
      dex: sub.dex,
      dexType: sub.dexType,
      router: sub.router,
      weight: ArbitrageDetector.calculateWeight(rate10),
      reserve0: reserve1,
      reserve1: reserve0,
      fee: sub.fee,
    });
  }

  /**
   * Update V3 pool data
   */
  private updateV3Pool(
    chainId: ChainId,
    sub: PoolSubscription,
    sqrtPriceX96: bigint,
    liquidity: bigint
  ): void {
    // Convert sqrtPriceX96 to approximate reserves for graph
    // price = (sqrtPriceX96 / 2^96)^2
    const Q96 = 2n ** 96n;
    
    // Simplified reserve calculation from sqrtPrice
    // This is an approximation - real V3 quotes use tick math
    const price = (sqrtPriceX96 * sqrtPriceX96) / (Q96 * Q96);
    
    // Use liquidity as proxy for reserves
    const reserve0 = liquidity;
    const reserve1 = (liquidity * price) / (10n ** 18n);

    this.updateReserves(chainId, sub, reserve0 > 0n ? reserve0 : 1n, reserve1 > 0n ? reserve1 : 1n);
  }

  /**
   * Check for arbitrage opportunities
   */
  private checkArbitrage(chainId: ChainId): void {
    const detector = this.detectors.get(chainId);
    if (!detector) return;

    const config = CHAIN_CONFIGS[chainId];
    if (!config) return;

    // Check from WETH as source
    const weth = config.nativeToken.address;
    const inputAmount = 10n ** 18n; // 1 WETH

    const opportunities = detector.findArbitrageOpportunities(weth, inputAmount);

    if (opportunities.length > 0 && this.onOpportunityCallback) {
      this.onOpportunityCallback(opportunities);
    }
  }

  /**
   * Set callback for when opportunities are found
   */
  onOpportunity(callback: typeof this.onOpportunityCallback): void {
    this.onOpportunityCallback = callback;
  }

  /**
   * Get current reserves for a pool
   */
  getReserves(chainId: ChainId, pool: Address): PoolReserves | undefined {
    return this.reserves.get(`${chainId}-${pool}`);
  }

  /**
   * Get all reserves for a chain
   */
  getAllReserves(chainId: ChainId): PoolReserves[] {
    const reserves: PoolReserves[] = [];
    for (const [key, value] of this.reserves) {
      if (key.startsWith(`${chainId}-`)) {
        reserves.push(value);
      }
    }
    return reserves;
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    for (const subs of this.subscriptions.values()) {
      for (const sub of subs) {
        sub.unwatch?.();
      }
    }
    logger.info('Price monitoring stopped');
  }
}
