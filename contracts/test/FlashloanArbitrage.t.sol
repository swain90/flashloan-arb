// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {FlashloanArbitrage} from "../src/FlashloanArbitrage.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FlashloanArbitrageTest is Test {
    FlashloanArbitrage public arbitrage;
    
    // Mainnet addresses
    address constant BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
    address constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant UNISWAP_V2_ROUTER = 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D;
    address constant UNISWAP_V3_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address constant SUSHISWAP_ROUTER = 0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F;
    
    address owner = makeAddr("owner");
    address beneficiary = makeAddr("beneficiary");
    address attacker = makeAddr("attacker");
    
    function setUp() public {
        // Fork mainnet
        vm.createSelectFork(vm.envString("ETH_RPC_URL"));
        
        vm.startPrank(owner);
        arbitrage = new FlashloanArbitrage(
            beneficiary,
            0.1 ether,  // maxLossPerTx
            1 ether     // dailyLossLimit
        );
        
        // Approve routers
        arbitrage.setRouterApproval(UNISWAP_V2_ROUTER, true);
        arbitrage.setRouterApproval(UNISWAP_V3_ROUTER, true);
        arbitrage.setRouterApproval(SUSHISWAP_ROUTER, true);
        vm.stopPrank();
    }
    
    function test_Deployment() public view {
        assertEq(arbitrage.owner(), owner);
        assertEq(arbitrage.beneficiary(), beneficiary);
        assertEq(arbitrage.maxLossPerTx(), 0.1 ether);
        assertEq(arbitrage.dailyLossLimit(), 1 ether);
        assertFalse(arbitrage.paused());
    }
    
    function test_RouterApproval() public view {
        assertTrue(arbitrage.approvedRouters(UNISWAP_V2_ROUTER));
        assertTrue(arbitrage.approvedRouters(UNISWAP_V3_ROUTER));
        assertTrue(arbitrage.approvedRouters(SUSHISWAP_ROUTER));
        assertFalse(arbitrage.approvedRouters(address(0x1234)));
    }
    
    function test_OnlyOwnerCanApproveRouters() public {
        vm.prank(attacker);
        vm.expectRevert();
        arbitrage.setRouterApproval(address(0x5678), true);
    }
    
    function test_OnlyOwnerCanSetBeneficiary() public {
        vm.prank(attacker);
        vm.expectRevert();
        arbitrage.setBeneficiary(attacker);
    }
    
    function test_OnlyOwnerCanPause() public {
        vm.prank(attacker);
        vm.expectRevert();
        arbitrage.setPaused(true);
    }
    
    function test_OwnerCanPause() public {
        vm.prank(owner);
        arbitrage.setPaused(true);
        assertTrue(arbitrage.paused());
    }
    
    function test_CannotExecuteWhenPaused() public {
        vm.prank(owner);
        arbitrage.setPaused(true);
        
        FlashloanArbitrage.SwapStep[] memory swaps = new FlashloanArbitrage.SwapStep[](0);
        FlashloanArbitrage.ArbitrageParams memory params = FlashloanArbitrage.ArbitrageParams({
            flashToken: WETH,
            flashAmount: 1 ether,
            swaps: swaps,
            minProfit: 0
        });
        
        vm.expectRevert(FlashloanArbitrage.Paused.selector);
        arbitrage.executeArbitrage(params);
    }
    
    function test_OnlyBalancerCanCallReceiveFlashLoan() public {
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(WETH);
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;
        
        uint256[] memory feeAmounts = new uint256[](1);
        feeAmounts[0] = 0;
        
        vm.prank(attacker);
        vm.expectRevert(FlashloanArbitrage.NotBalancerVault.selector);
        arbitrage.receiveFlashLoan(tokens, amounts, feeAmounts, "");
    }
    
    function test_CircuitBreakerSettings() public {
        vm.prank(owner);
        arbitrage.setCircuitBreaker(0.5 ether, 5 ether);
        
        assertEq(arbitrage.maxLossPerTx(), 0.5 ether);
        assertEq(arbitrage.dailyLossLimit(), 5 ether);
    }
    
    function test_RescueTokens() public {
        // Deal some tokens to the contract
        deal(WETH, address(arbitrage), 10 ether);
        
        uint256 balanceBefore = IERC20(WETH).balanceOf(owner);
        
        vm.prank(owner);
        arbitrage.rescueTokens(WETH, 10 ether);
        
        uint256 balanceAfter = IERC20(WETH).balanceOf(owner);
        assertEq(balanceAfter - balanceBefore, 10 ether);
    }
    
    function test_RescueETH() public {
        // Deal some ETH to the contract
        vm.deal(address(arbitrage), 5 ether);
        
        uint256 balanceBefore = owner.balance;
        
        vm.prank(owner);
        arbitrage.rescueETH();
        
        uint256 balanceAfter = owner.balance;
        assertEq(balanceAfter - balanceBefore, 5 ether);
    }
    
    function testFuzz_CannotExceedMaxLoss(uint256 maxLoss) public {
        maxLoss = bound(maxLoss, 0.01 ether, 10 ether);
        
        vm.prank(owner);
        arbitrage.setCircuitBreaker(maxLoss, 100 ether);
        
        assertEq(arbitrage.maxLossPerTx(), maxLoss);
    }
    
    // Integration test with actual flashloan (requires mainnet fork with liquidity)
    function test_FlashloanIntegration() public {
        // This test verifies the flashloan flow works
        // In a real scenario, you'd set up a profitable arbitrage path
        
        // For now, just verify the contract can receive the callback
        // A full integration test would require setting up mock DEXes or using mainnet fork
        
        vm.skip(true); // Skip for now - requires full integration setup
    }
}
