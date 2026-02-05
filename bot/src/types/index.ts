import type { Address, Hash, Hex } from 'viem';

// ============ Chain Configuration ============

export type ChainId = 1 | 42161 | 8453 | 10 | 421614;

export interface ChainConfig {
  id: ChainId;
  name: string;
  rpcUrl: string;
  wsUrl: string;
  flashbotsRpc?: string;
  blockTime: number;
  nativeToken: TokenInfo;
  contracts: {
    arbitrage: Address;
    balancerVault: Address;
  };
  dexes: DexConfig[];
}

// ============ DEX Configuration ============

export enum DexType {
  UniswapV2 = 0,
  UniswapV3 = 1,
  Curve = 2,
  Velodrome = 3,
}

export interface DexConfig {
  name: string;
  type: DexType;
  router: Address;
  factory: Address;
  quoter?: Address;
  pools: PoolInfo[];
}

export interface PoolInfo {
  address: Address;
  token0: Address;
  token1: Address;
  fee?: number; // For V3 pools (basis points)
  stable?: boolean; // For Velodrome/Aerodrome
}

// ============ Token Information ============

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
  name: string;
}

// ============ Price & Reserves ============

export interface PoolReserves {
  pool: Address;
  dex: string;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
  fee: number;
  timestamp: number;
}

export interface PriceQuote {
  dex: string;
  pool: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  priceImpact: number;
  gasEstimate: bigint;
}

// ============ Arbitrage Opportunity ============

export interface ArbitrageOpportunity {
  id: string;
  chain: ChainId;
  path: SwapStep[];
  inputToken: Address;
  inputAmount: bigint;
  expectedOutput: bigint;
  expectedProfit: bigint;
  profitUsd: number;
  gasEstimate: bigint;
  gasCostUsd: number;
  netProfitUsd: number;
  confidence: number;
  timestamp: number;
  expiresAt: number;
}

export interface SwapStep {
  router: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  expectedAmountOut: bigint;
  pool: Address;
  dexType: DexType;
  data: Hex;
}

// ============ Execution ============

export interface ExecutionResult {
  success: boolean;
  txHash?: Hash;
  profit?: bigint;
  gasUsed?: bigint;
  error?: string;
  blockNumber?: bigint;
  timestamp: number;
}

export interface SimulationResult {
  success: boolean;
  profit: bigint;
  gasUsed: bigint;
  error?: string;
  logs: string[];
}

// ============ Graph for Bellman-Ford ============

export interface Edge {
  from: Address;
  to: Address;
  pool: Address;
  dex: string;
  dexType: DexType;
  router: Address;
  weight: number; // -ln(exchange_rate)
  reserve0: bigint;
  reserve1: bigint;
  fee: number;
}

export interface Graph {
  vertices: Set<Address>;
  edges: Map<Address, Edge[]>;
}

// ============ Bot State ============

export interface BotState {
  isRunning: boolean;
  isPaused: boolean;
  currentChains: ChainId[];
  totalProfit: bigint;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  lastTradeTime?: number;
  uptime: number;
}

export interface TradeHistory {
  id: string;
  chain: ChainId;
  timestamp: number;
  txHash: Hash;
  inputToken: Address;
  inputAmount: bigint;
  outputAmount: bigint;
  profit: bigint;
  profitUsd: number;
  gasUsed: bigint;
  gasCostUsd: number;
  path: string[];
  success: boolean;
  error?: string;
}

// ============ Configuration ============

export interface BotConfig {
  minProfitUsd: number;
  maxGasPriceGwei: number;
  maxSlippageBps: number;
  simulateBeforeExecute: boolean;
  dryRun: boolean;
  maxConcurrentTrades: number;
  cooldownMs: number;
  enabledChains: ChainId[];
  privateKey: Hex;
  flashbotsEnabled: boolean;
}

// ============ Events ============

export type BotEvent =
  | { type: 'OPPORTUNITY_FOUND'; data: ArbitrageOpportunity }
  | { type: 'TRADE_EXECUTED'; data: ExecutionResult }
  | { type: 'TRADE_FAILED'; data: { error: string; opportunity: ArbitrageOpportunity } }
  | { type: 'PRICE_UPDATE'; data: { chain: ChainId; pool: Address; reserves: PoolReserves } }
  | { type: 'CIRCUIT_BREAKER'; data: { reason: string; chain: ChainId } }
  | { type: 'BOT_STARTED'; data: { chains: ChainId[] } }
  | { type: 'BOT_STOPPED'; data: { reason: string } };
