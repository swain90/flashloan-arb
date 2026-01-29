# Flashloan Arbitrage Bot v2.0

A modern multi-chain flashloan arbitrage trading system with zero-fee Balancer flashloans, MEV protection, and a real-time React dashboard.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DASHBOARD UI                                    │
│  (React + Vite + Recharts)                                                  │
│  - Real-time trade monitoring                                               │
│  - Profit/loss visualization                                                │
│  - Live opportunity feed                                                    │
│  - Wallet management                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP API (:3001)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             BOT ENGINE                                       │
│  (TypeScript + Viem + WebSocket)                                            │
│                                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  Price Monitor  │  │ Arb Detector    │  │ Trade Executor  │             │
│  │  - WebSocket    │  │ - Bellman-Ford  │  │ - MEV Protection│             │
│  │  - Multi-DEX    │  │ - Graph-based   │  │ - Flashbots     │             │
│  │  - Multi-Chain  │  │ - Real-time     │  │ - Simulation    │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ RPC / WebSocket
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SMART CONTRACTS                                     │
│  (Solidity + Foundry)                                                       │
│                                                                             │
│  FlashloanArbitrage.sol                                                     │
│  - Balancer V2 flashloans (0% fee)                                          │
│  - Multi-DEX routing (UniV2, UniV3, Curve, Aerodrome)                       │
│  - Circuit breakers                                                         │
│  - Upgradeable via owner                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SUPPORTED CHAINS                                    │
│                                                                             │
│  Ethereum (1)  │  Arbitrum (42161)  │  Base (8453)  │  Optimism (10)       │
│  - Flashbots   │  - Timeboost       │  - Flashblocks │  - Private mempool  │
│  - UniV2/V3    │  - Camelot         │  - Aerodrome   │  - Velodrome        │
│  - Curve       │  - SushiSwap       │  - UniV3       │  - UniV3            │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Features

### Smart Contracts
- **Zero-fee flashloans** via Balancer V2 Vault
- **Multi-DEX support**: Uniswap V2/V3, SushiSwap, Curve, Aerodrome, Velodrome
- **Circuit breakers**: Per-transaction and daily loss limits
- **Emergency controls**: Pause functionality, token rescue

### Bot Engine
- **Bellman-Ford algorithm** for optimal arbitrage path detection
- **Real-time price monitoring** via WebSocket subscriptions
- **MEV protection**:
  - Flashbots Protect on Ethereum mainnet
  - Standard submission on L2s (private mempools)
- **Pre-execution simulation** using Foundry/Anvil
- **Multi-chain support**: Ethereum, Arbitrum, Base, Optimism

### Dashboard UI
- **Real-time metrics**: Profit, trades, success rate
- **Trade history** with transaction links
- **Live opportunity feed** with confidence scores
- **Multi-wallet balances** across chains
- **Profit visualization** charts

## Quick Start

### Prerequisites
- Node.js 20+
- Foundry (for contracts)
- Private key with ETH on target chains

### 1. Clone and Install

```bash
# Install contract dependencies
cd contracts
forge install

# Install bot dependencies
cd ../bot
npm install

# Install UI dependencies
cd ../ui
npm install
```

### 2. Configure Environment

```bash
cd bot
cp .env.example .env
# Edit .env with your settings
```

Required environment variables:
```
PRIVATE_KEY=0x...           # Your wallet private key
ENABLED_CHAINS=42161,8453   # Chain IDs to monitor
MIN_PROFIT_USD=10           # Minimum profit threshold
DRY_RUN=true                # Set false for live trading
```

### 3. Deploy Contracts

```bash
cd contracts

# Deploy to Arbitrum
forge script script/Deploy.s.sol --rpc-url $ARBITRUM_RPC_URL --broadcast

# Deploy to Base
forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast
```

Update `bot/src/config/chains.ts` with deployed contract addresses.

### 4. Run the Bot

```bash
cd bot
npm run dev

# In another terminal
cd ui
npm run dev
```

Open http://localhost:3000 for the dashboard.

## Configuration

### Bot Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `ENABLED_CHAINS` | Comma-separated chain IDs | `42161,8453` |
| `MIN_PROFIT_USD` | Minimum profit to execute | `10` |
| `MAX_GAS_PRICE_GWEI` | Max gas price | `100` |
| `MAX_SLIPPAGE_BPS` | Max slippage (basis points) | `50` |
| `DRY_RUN` | Log but don't execute | `true` |
| `FLASHBOTS_ENABLED` | Use Flashbots on mainnet | `true` |

### Adding New DEXes

1. Add router/factory addresses to `bot/src/config/chains.ts`
2. Add DEX type to `contracts/src/FlashloanArbitrage.sol`
3. Approve router: `arbitrage.setRouterApproval(router, true)`

### Adding New Chains

1. Add chain config to `bot/src/config/chains.ts`
2. Deploy contract to new chain
3. Add to `ENABLED_CHAINS` environment variable

## Testing

### Contract Tests

```bash
cd contracts

# Run all tests
forge test

# Run with verbosity
forge test -vvv

# Run specific test
forge test --match-test test_Deployment

# Fork testing
forge test --fork-url $ETH_RPC_URL
```

### Bot Tests

```bash
cd bot
npm test
```

## Security Considerations

### Circuit Breakers
The contract includes multiple safety mechanisms:
- **Max loss per transaction**: Reverts if single trade loses too much
- **Daily loss limit**: Auto-pauses if cumulative losses exceed threshold
- **Manual pause**: Owner can pause at any time

### MEV Protection
- **Ethereum**: Flashbots Protect RPC prevents frontrunning
- **Arbitrum**: Private mempool + optional Timeboost
- **Base/Optimism**: Sequencer-based private mempools

### Best Practices
1. Start with `DRY_RUN=true` to verify detection works
2. Use small `MIN_PROFIT_USD` initially to catch opportunities
3. Monitor the dashboard for unexpected behavior
4. Keep circuit breaker limits conservative
5. Never share your private key

## API Endpoints

The bot exposes a simple HTTP API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Bot status, profit, trade counts |
| `/api/trades` | GET | Recent trade history |
| `/api/opportunities` | GET | Current opportunity queue |
| `/api/pools` | GET | Monitored pool reserves |
| `/api/pause` | POST | Pause the bot |
| `/api/resume` | POST | Resume the bot |
| `/api/config` | GET | Current configuration |

## Troubleshooting

### "No opportunities found"
- Check WebSocket connections in logs
- Verify pool liquidity is sufficient
- Lower `MIN_PROFIT_USD` threshold
- Ensure RPC endpoints are responsive

### "Transaction reverted"
- Check gas estimation (may need higher buffer)
- Verify slippage settings
- Opportunity may have expired (2s validity)
- Check pool reserves haven't changed

### "MEV attack detected"
- Enable Flashbots on mainnet
- Use private RPCs on L2s
- Increase priority fee

## License

MIT

## Disclaimer

This software is for educational purposes. Trading cryptocurrencies involves significant risk. Always:
- Start with small amounts
- Test thoroughly on testnets
- Understand the code before running
- Never risk more than you can afford to lose
