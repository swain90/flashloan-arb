#!/bin/bash

# Flashloan Arbitrage Bot - Setup Script
set -e

echo "=================================="
echo "Flashloan Arbitrage Bot Setup"
echo "=================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "\n${YELLOW}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js is not installed. Please install Node.js 20+${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}Node.js 20+ is required. Current version: $(node -v)${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v)${NC}"

if ! command -v forge &> /dev/null; then
    echo -e "${YELLOW}Foundry not found. Installing...${NC}"
    curl -L https://foundry.paradigm.xyz | bash
    source ~/.bashrc
    foundryup
fi
echo -e "${GREEN}✓ Foundry $(forge --version | head -1)${NC}"

# Install contract dependencies
echo -e "\n${YELLOW}Installing contract dependencies...${NC}"
cd contracts
forge install OpenZeppelin/openzeppelin-contracts --no-commit || true
forge install foundry-rs/forge-std --no-commit || true
echo -e "${GREEN}✓ Contract dependencies installed${NC}"

# Build contracts
echo -e "\n${YELLOW}Building contracts...${NC}"
forge build
echo -e "${GREEN}✓ Contracts built${NC}"

# Install bot dependencies
echo -e "\n${YELLOW}Installing bot dependencies...${NC}"
cd ../bot
npm install
echo -e "${GREEN}✓ Bot dependencies installed${NC}"

# Create .env if not exists
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${YELLOW}Created .env from template - please update with your settings${NC}"
fi

# Install UI dependencies
echo -e "\n${YELLOW}Installing UI dependencies...${NC}"
cd ../ui
npm install
echo -e "${GREEN}✓ UI dependencies installed${NC}"

# Create .env if not exists
if [ ! -f .env ]; then
    cp .env.example .env
fi

cd ..

echo -e "\n${GREEN}=================================="
echo "Setup complete!"
echo "==================================${NC}"
echo ""
echo "Next steps:"
echo "1. Update bot/.env with your configuration"
echo "2. Deploy contracts to your target chains:"
echo "   cd contracts && forge script script/Deploy.s.sol --rpc-url \$RPC_URL --broadcast"
echo "3. Update bot/src/config/chains.ts with contract addresses"
echo "4. Start the bot: cd bot && npm run dev"
echo "5. Start the UI: cd ui && npm run dev"
echo ""
echo "Or use Docker:"
echo "   docker-compose up -d"
