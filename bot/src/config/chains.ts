import type { ChainConfig, DexConfig, TokenInfo } from '../types/index.js';
import { DexType } from '../types/index.js';

// ============ Common Tokens ============

type TokenMap = {
  ethereum: {
    WETH: TokenInfo;
    USDC: TokenInfo;
    USDT: TokenInfo;
    DAI: TokenInfo;
    WBTC: TokenInfo;
  };
  arbitrum: {
    WETH: TokenInfo;
    USDC: TokenInfo;
    USDT: TokenInfo;
    ARB: TokenInfo;
    WBTC: TokenInfo;
  };
  base: {
    WETH: TokenInfo;
    USDC: TokenInfo;
    cbETH: TokenInfo;
    AERO: TokenInfo;
  };
  optimism: {
    WETH: TokenInfo;
    USDC: TokenInfo;
    USDT: TokenInfo;
    OP: TokenInfo;
    VELO: TokenInfo;
  };
  arbitrumSepolia: {
    WETH: TokenInfo;
    USDC: TokenInfo;
    LINK: TokenInfo;
  };
};

const TOKENS: TokenMap = {
  ethereum: {
    WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    USDC: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6, name: 'Tether USD' },
    DAI: { address: '0x6B175474E89094C44Da98b954EesdfFD691903dCB', symbol: 'DAI', decimals: 18, name: 'Dai Stablecoin' },
    WBTC: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8, name: 'Wrapped BTC' },
  },
  arbitrum: {
    WETH: { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    USDC: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    USDT: { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6, name: 'Tether USD' },
    ARB: { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB', decimals: 18, name: 'Arbitrum' },
    WBTC: { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC', decimals: 8, name: 'Wrapped BTC' },
  },
  base: {
    WETH: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    cbETH: { address: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', symbol: 'cbETH', decimals: 18, name: 'Coinbase Wrapped Staked ETH' },
    AERO: { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', symbol: 'AERO', decimals: 18, name: 'Aerodrome' },
  },
  optimism: {
    WETH: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    USDC: { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    USDT: { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT', decimals: 6, name: 'Tether USD' },
    OP: { address: '0x4200000000000000000000000000000000000042', symbol: 'OP', decimals: 18, name: 'Optimism' },
    VELO: { address: '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db', symbol: 'VELO', decimals: 18, name: 'Velodrome' },
  },
  arbitrumSepolia: {
    WETH: { address: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73', symbol: 'WETH', decimals: 18, name: 'Wrapped Ether' },
    USDC: { address: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d', symbol: 'USDC', decimals: 6, name: 'USD Coin' },
    LINK: { address: '0xb1D4538B4571d411F07960EF2838Ce337FE1E80E', symbol: 'LINK', decimals: 18, name: 'Chainlink' },
  },
};

// ============ DEX Configurations ============

const ethereumDexes: DexConfig[] = [
  {
    name: 'Uniswap V2',
    type: DexType.UniswapV2,
    router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
    factory: '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f',
    pools: [],
  },
  {
    name: 'Uniswap V3',
    type: DexType.UniswapV3,
    router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    pools: [],
  },
  {
    name: 'SushiSwap',
    type: DexType.UniswapV2,
    router: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
    factory: '0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac',
    pools: [],
  },
  {
    name: 'Curve 3Pool',
    type: DexType.Curve,
    router: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
    factory: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
    pools: [
      {
        address: '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
        token0: '0x6B175474E89094C44Da98b954EedsfdFD691903dCB', // DAI
        token1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      },
    ],
  },
];

const arbitrumDexes: DexConfig[] = [
  {
    name: 'Uniswap V3',
    type: DexType.UniswapV3,
    router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    pools: [],
  },
  {
    name: 'Camelot V2',
    type: DexType.UniswapV2,
    router: '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
    factory: '0x6EcCab422D763aC031210895C81787E87B43A652',
    pools: [],
  },
  {
    name: 'SushiSwap',
    type: DexType.UniswapV2,
    router: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4',
    pools: [],
  },
];

const baseDexes: DexConfig[] = [
  {
    name: 'Uniswap V3',
    type: DexType.UniswapV3,
    router: '0x2626664c2603336E57B271c5C0b26F421741e481',
    factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
    quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    pools: [],
  },
  {
    name: 'Aerodrome',
    type: DexType.Velodrome,
    router: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
    factory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
    pools: [],
  },
];

const optimismDexes: DexConfig[] = [
  {
    name: 'Uniswap V3',
    type: DexType.UniswapV3,
    router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
    pools: [],
  },
  {
    name: 'Velodrome V2',
    type: DexType.Velodrome,
    router: '0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858',
    factory: '0xF1046053aa5682b4F9a81b5481394DA16BE5FF5a',
    pools: [],
  },
];

const arbitrumSepoliaDexes: DexConfig[] = [
  {
    name: 'Uniswap V3',
    type: DexType.UniswapV3,
    router: '0x101F443B4d1b059569D643917553c771E1b9663E', // SwapRouter02
    factory: '0x248AB79Bbb9bC29bB72f7Cd42F17e054Fc40188e',
    quoter: '0x2779a0CC1c3e0E44D2542EC3e79e3864Ae93Ef0B',
    pools: [],
  },
];

// ============ Chain Configurations ============

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  1: {
    id: 1,
    name: 'Ethereum',
    rpcUrl: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
    wsUrl: process.env.ETH_WS_URL || 'wss://eth.llamarpc.com',
    flashbotsRpc: 'https://rpc.flashbots.net/fast?builders=flashbots,beaverbuild.org,rsync,Titan',
    blockTime: 12000,
    nativeToken: TOKENS.ethereum.WETH,
    contracts: {
      arbitrage: '0x0000000000000000000000000000000000000000', // Deploy and update
      balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    },
    dexes: ethereumDexes,
  },
  42161: {
    id: 42161,
    name: 'Arbitrum',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    wsUrl: process.env.ARBITRUM_WS_URL || 'wss://arb1.arbitrum.io/ws',
    blockTime: 250,
    nativeToken: TOKENS.arbitrum.WETH,
    contracts: {
      arbitrage: '0x0000000000000000000000000000000000000000', // Deploy and update
      balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    },
    dexes: arbitrumDexes,
  },
  8453: {
    id: 8453,
    name: 'Base',
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    wsUrl: process.env.BASE_WS_URL || 'wss://base-mainnet.flashblocks.chainstack.io',
    blockTime: 2000,
    nativeToken: TOKENS.base.WETH,
    contracts: {
      arbitrage: '0x0000000000000000000000000000000000000000', // Deploy and update
      balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    },
    dexes: baseDexes,
  },
  10: {
    id: 10,
    name: 'Optimism',
    rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    wsUrl: process.env.OPTIMISM_WS_URL || 'wss://mainnet.optimism.io',
    blockTime: 2000,
    nativeToken: TOKENS.optimism.WETH,
    contracts: {
      arbitrage: '0x0000000000000000000000000000000000000000', // Deploy and update
      balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    },
    dexes: optimismDexes,
  },
  421614: {
    id: 421614,
    name: 'Arbitrum Sepolia',
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || process.env.ARBITRUM_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    wsUrl: process.env.ARBITRUM_SEPOLIA_WS_URL || process.env.ARBITRUM_WS_URL || '',
    blockTime: 250,
    nativeToken: TOKENS.arbitrumSepolia.WETH,
    contracts: {
      arbitrage: '0x0000000000000000000000000000000000000000', // Deploy and update
      balancerVault: '0x0000000000000000000000000000000000000000',
    },
    dexes: arbitrumSepoliaDexes,
  },
};

export { TOKENS };
