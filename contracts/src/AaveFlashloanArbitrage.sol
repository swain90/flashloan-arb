// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title AaveFlashloanArbitrage
/// @notice Flashloan arbitrage executor using Aave V3 (0.05% fee)
/// @dev Use this when Balancer doesn't have sufficient liquidity
contract AaveFlashloanArbitrage is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Interfaces ============
    
    IPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
    IPool public immutable POOL;

    // ============ State Variables ============
    
    mapping(address => bool) public approvedRouters;
    address public beneficiary;
    uint256 public maxLossPerTx;
    uint256 public dailyLossLimit;
    uint256 public dailyLoss;
    uint256 public lastResetTimestamp;
    bool public paused;

    // ============ Structs ============
    
    struct SwapStep {
        address router;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        bytes data;
        uint8 dexType;
    }
    
    struct ArbitrageParams {
        address flashToken;
        uint256 flashAmount;
        SwapStep[] swaps;
        uint256 minProfit;
    }

    // ============ Events ============
    
    event ArbitrageExecuted(address indexed token, uint256 flashAmount, uint256 profit, uint256 fee);
    event RouterApproved(address indexed router, bool approved);

    // ============ Errors ============
    
    error Paused();
    error NotAavePool();
    error RouterNotApproved();
    error InsufficientProfit();
    error MaxLossExceeded();

    // ============ Constructor ============
    
    constructor(
        address _addressesProvider,
        address _beneficiary,
        uint256 _maxLossPerTx,
        uint256 _dailyLossLimit
    ) Ownable(msg.sender) {
        ADDRESSES_PROVIDER = IPoolAddressesProvider(_addressesProvider);
        POOL = IPool(ADDRESSES_PROVIDER.getPool());
        beneficiary = _beneficiary;
        maxLossPerTx = _maxLossPerTx;
        dailyLossLimit = _dailyLossLimit;
        lastResetTimestamp = block.timestamp;
    }

    // ============ External Functions ============
    
    /// @notice Execute arbitrage via Aave V3 flashloan
    function executeArbitrage(ArbitrageParams calldata params) external nonReentrant {
        if (paused) revert Paused();
        
        if (block.timestamp >= lastResetTimestamp + 1 days) {
            dailyLoss = 0;
            lastResetTimestamp = block.timestamp;
        }

        address[] memory assets = new address[](1);
        assets[0] = params.flashToken;
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = params.flashAmount;
        
        uint256[] memory interestRateModes = new uint256[](1);
        interestRateModes[0] = 0; // No debt (flashloan)
        
        bytes memory userData = abi.encode(params);
        
        POOL.flashLoan(
            address(this),
            assets,
            amounts,
            interestRateModes,
            address(this),
            userData,
            0 // referralCode
        );
    }
    
    /// @notice Aave flashloan callback
    function executeOperation(
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata premiums,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        if (msg.sender != address(POOL)) revert NotAavePool();
        if (initiator != address(this)) revert NotAavePool();
        
        ArbitrageParams memory arbParams = abi.decode(params, (ArbitrageParams));
        
        uint256 balanceBefore = IERC20(assets[0]).balanceOf(address(this));
        
        // Execute swap sequence
        for (uint256 i = 0; i < arbParams.swaps.length; i++) {
            _executeSwap(arbParams.swaps[i]);
        }
        
        uint256 balanceAfter = IERC20(assets[0]).balanceOf(address(this));
        uint256 repayAmount = amounts[0] + premiums[0]; // Amount + 0.05% fee
        
        if (balanceAfter < repayAmount + arbParams.minProfit) {
            revert InsufficientProfit();
        }
        
        // Check circuit breaker
        if (balanceAfter < balanceBefore) {
            uint256 loss = balanceBefore - balanceAfter;
            if (loss > maxLossPerTx) revert MaxLossExceeded();
            dailyLoss += loss;
            if (dailyLoss >= dailyLossLimit) {
                paused = true;
            }
        }
        
        // Approve repayment
        IERC20(assets[0]).forceApprove(address(POOL), repayAmount);
        
        // Send profit to beneficiary
        uint256 profit = balanceAfter - repayAmount;
        if (profit > 0) {
            IERC20(assets[0]).safeTransfer(beneficiary, profit);
        }
        
        emit ArbitrageExecuted(assets[0], amounts[0], profit, premiums[0]);
        
        return true;
    }

    // ============ Internal Functions ============
    
    function _executeSwap(SwapStep memory swap) internal {
        if (!approvedRouters[swap.router]) revert RouterNotApproved();
        
        uint256 amountIn = swap.amountIn;
        if (amountIn == 0) {
            amountIn = IERC20(swap.tokenIn).balanceOf(address(this));
        }
        
        IERC20(swap.tokenIn).forceApprove(swap.router, amountIn);
        
        if (swap.dexType == 0) {
            _executeV2Swap(swap.router, swap.tokenIn, swap.tokenOut, amountIn);
        } else if (swap.dexType == 1) {
            _executeV3Swap(swap.router, swap.tokenIn, swap.tokenOut, amountIn, swap.data);
        }
        // Add more DEX types as needed
    }
    
    function _executeV2Swap(address router, address tokenIn, address tokenOut, uint256 amountIn) internal {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        
        IUniswapV2Router(router).swapExactTokensForTokens(
            amountIn,
            0,
            path,
            address(this),
            block.timestamp
        );
    }
    
    function _executeV3Swap(address router, address tokenIn, address tokenOut, uint256 amountIn, bytes memory data) internal {
        uint24 fee = abi.decode(data, (uint24));
        
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: amountIn,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });
        
        ISwapRouter(router).exactInputSingle(params);
    }

    // ============ Admin Functions ============
    
    function setRouterApproval(address router, bool approved) external onlyOwner {
        approvedRouters[router] = approved;
        emit RouterApproved(router, approved);
    }
    
    function setBeneficiary(address _beneficiary) external onlyOwner {
        beneficiary = _beneficiary;
    }
    
    function setCircuitBreaker(uint256 _maxLossPerTx, uint256 _dailyLossLimit) external onlyOwner {
        maxLossPerTx = _maxLossPerTx;
        dailyLossLimit = _dailyLossLimit;
    }
    
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }
    
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }
    
    receive() external payable {}
}

// ============ Interfaces ============

interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}

interface IPool {
    function flashLoan(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata interestRateModes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}
