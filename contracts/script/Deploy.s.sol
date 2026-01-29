// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FlashloanArbitrage} from "../src/FlashloanArbitrage.sol";

contract DeployArbitrage is Script {
    // Chain-specific router addresses
    
    // Ethereum Mainnet
    address constant UNISWAP_V2_ROUTER_ETH = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address constant UNISWAP_V3_ROUTER_ETH = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address constant SUSHISWAP_ROUTER_ETH = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F;
    
    // Arbitrum
    address constant UNISWAP_V3_ROUTER_ARB = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address constant CAMELOT_ROUTER_ARB = 0xc873fEcbd354f5A56E00E710B90EF4201db2448d;
    address constant SUSHISWAP_ROUTER_ARB = 0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506;
    
    // Base
    address constant UNISWAP_V3_ROUTER_BASE = 0x2626664c2603336E57B271c5C0b26F421741e481;
    address constant AERODROME_ROUTER_BASE = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    
    // Optimism
    address constant UNISWAP_V3_ROUTER_OP = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address constant VELODROME_ROUTER_OP = 0xa062aE8A9c5e11aaA026fc2670B0D65cCc8B2858;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address beneficiary = vm.envAddress("BENEFICIARY_ADDRESS");
        
        // Circuit breaker settings (in wei)
        uint256 maxLossPerTx = 0.1 ether;      // Max 0.1 ETH loss per tx
        uint256 dailyLossLimit = 1 ether;      // Max 1 ETH loss per day
        
        vm.startBroadcast(deployerPrivateKey);
        
        FlashloanArbitrage arbitrage = new FlashloanArbitrage(
            beneficiary,
            maxLossPerTx,
            dailyLossLimit
        );
        
        console2.log("FlashloanArbitrage deployed at:", address(arbitrage));
        
        // Approve routers based on chain
        uint256 chainId = block.chainid;
        
        if (chainId == 1) {
            // Ethereum Mainnet
            arbitrage.setRouterApproval(UNISWAP_V2_ROUTER_ETH, true);
            arbitrage.setRouterApproval(UNISWAP_V3_ROUTER_ETH, true);
            arbitrage.setRouterApproval(SUSHISWAP_ROUTER_ETH, true);
            console2.log("Approved Ethereum mainnet routers");
        } else if (chainId == 42161) {
            // Arbitrum
            arbitrage.setRouterApproval(UNISWAP_V3_ROUTER_ARB, true);
            arbitrage.setRouterApproval(CAMELOT_ROUTER_ARB, true);
            arbitrage.setRouterApproval(SUSHISWAP_ROUTER_ARB, true);
            console2.log("Approved Arbitrum routers");
        } else if (chainId == 8453) {
            // Base
            arbitrage.setRouterApproval(UNISWAP_V3_ROUTER_BASE, true);
            arbitrage.setRouterApproval(AERODROME_ROUTER_BASE, true);
            console2.log("Approved Base routers");
        } else if (chainId == 10) {
            // Optimism
            arbitrage.setRouterApproval(UNISWAP_V3_ROUTER_OP, true);
            arbitrage.setRouterApproval(VELODROME_ROUTER_OP, true);
            console2.log("Approved Optimism routers");
        }
        
        vm.stopBroadcast();
    }
}
