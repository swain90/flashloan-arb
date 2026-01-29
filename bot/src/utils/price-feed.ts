import { createPublicClient, http, parseAbi, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import pino from 'pino';

const logger = pino({ name: 'price-feed' });

// Chainlink price feed addresses (Ethereum mainnet)
const CHAINLINK_FEEDS: Record<string, Address> = {
  'ETH/USD': '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
  'BTC/USD': '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
  'USDC/USD': '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
  'DAI/USD': '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9',
  'LINK/USD': '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c',
  'ARB/USD': '0x31697852a68433DbCc2Ff612c516d69E3D9bd08F',
  'OP/USD': '0x0D276FC14719f9292D5C1eA2198673d1f4269246',
};

const CHAINLINK_ABI = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
]);

// Token to feed mapping
const TOKEN_FEEDS: Record<string, string> = {
  // Ethereum
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'ETH/USD', // WETH
  '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599': 'BTC/USD', // WBTC
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'USDC/USD', // USDC
  '0x6B175474E89094C44Da98b954EedefdFD691903dCB': 'DAI/USD', // DAI
  
  // Arbitrum
  '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1': 'ETH/USD', // WETH
  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': 'USDC/USD', // USDC
  '0x912CE59144191C1204E64559FE8253a0e49E6548': 'ARB/USD', // ARB
  
  // Base
  '0x4200000000000000000000000000000000000006': 'ETH/USD', // WETH
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 'USDC/USD', // USDC
  
  // Optimism
  '0x4200000000000000000000000000000000000006': 'ETH/USD', // WETH (same address)
  '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85': 'USDC/USD', // USDC
  '0x4200000000000000000000000000000000000042': 'OP/USD', // OP
};

interface PriceData {
  price: number;
  decimals: number;
  updatedAt: Date;
}

export class PriceFeed {
  private client;
  private cache: Map<string, { data: PriceData; timestamp: number }> = new Map();
  private cacheTtlMs: number;

  constructor(rpcUrl?: string, cacheTtlMs = 30000) {
    this.client = createPublicClient({
      chain: mainnet,
      transport: http(rpcUrl || 'https://eth.llamarpc.com'),
    });
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Get price for a feed pair (e.g., 'ETH/USD')
   */
  async getPrice(feedName: string): Promise<PriceData | null> {
    // Check cache
    const cached = this.cache.get(feedName);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      return cached.data;
    }

    const feedAddress = CHAINLINK_FEEDS[feedName];
    if (!feedAddress) {
      logger.warn({ feedName }, 'Unknown price feed');
      return null;
    }

    try {
      const [roundData, decimals] = await Promise.all([
        this.client.readContract({
          address: feedAddress,
          abi: CHAINLINK_ABI,
          functionName: 'latestRoundData',
        }),
        this.client.readContract({
          address: feedAddress,
          abi: CHAINLINK_ABI,
          functionName: 'decimals',
        }),
      ]);

      const price = Number(roundData[1]) / Math.pow(10, decimals);
      const data: PriceData = {
        price,
        decimals,
        updatedAt: new Date(Number(roundData[3]) * 1000),
      };

      // Update cache
      this.cache.set(feedName, { data, timestamp: Date.now() });

      return data;
    } catch (error) {
      logger.error({ feedName, error }, 'Failed to fetch price');
      return null;
    }
  }

  /**
   * Get price for a token address
   */
  async getTokenPrice(tokenAddress: Address): Promise<number | null> {
    const feedName = TOKEN_FEEDS[tokenAddress.toLowerCase()] || TOKEN_FEEDS[tokenAddress];
    if (!feedName) {
      // Default to USDC = $1 for unknown stablecoins
      const symbol = tokenAddress.slice(0, 10);
      logger.debug({ tokenAddress: symbol }, 'Unknown token, assuming stablecoin');
      return 1;
    }

    const data = await this.getPrice(feedName);
    return data?.price ?? null;
  }

  /**
   * Convert token amount to USD
   */
  async toUsd(tokenAddress: Address, amount: bigint, decimals: number): Promise<number> {
    const price = await this.getTokenPrice(tokenAddress);
    if (price === null) return 0;

    const tokenAmount = Number(amount) / Math.pow(10, decimals);
    return tokenAmount * price;
  }

  /**
   * Get ETH price in USD
   */
  async getEthPrice(): Promise<number> {
    const data = await this.getPrice('ETH/USD');
    return data?.price ?? 3000; // Fallback
  }

  /**
   * Estimate gas cost in USD
   */
  async estimateGasCostUsd(gasUnits: bigint, gasPriceGwei: number): Promise<number> {
    const ethPrice = await this.getEthPrice();
    const gasCostEth = Number(gasUnits) * gasPriceGwei / 1e9;
    return gasCostEth * ethPrice;
  }

  /**
   * Get all cached prices
   */
  getCachedPrices(): Record<string, number> {
    const prices: Record<string, number> = {};
    for (const [feed, { data }] of this.cache) {
      prices[feed] = data.price;
    }
    return prices;
  }

  /**
   * Preload common prices
   */
  async preload(): Promise<void> {
    const feeds = ['ETH/USD', 'BTC/USD', 'USDC/USD', 'ARB/USD', 'OP/USD'];
    await Promise.all(feeds.map(f => this.getPrice(f)));
    logger.info({ feeds: feeds.length }, 'Price feeds preloaded');
  }
}

// Singleton instance
let instance: PriceFeed | null = null;

export function getPriceFeed(rpcUrl?: string): PriceFeed {
  if (!instance) {
    instance = new PriceFeed(rpcUrl);
  }
  return instance;
}
