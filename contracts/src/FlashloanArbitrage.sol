// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title FlashloanArbitrage
/// @notice Multi-chain flashloan arbitrage executor supporting Balancer (zero-fee) and multiple DEXes
/// @dev Designed for Ethereum mainnet, Arbitrum, Base, and Optimism
contract FlashloanArbitrage is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    
    /// @notice Balancer V2 Vault address (same on all chains)
    address public constant BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
    
    // ============ State Variables ============
    
    /// @notice Mapping of approved DEX routers
    mapping(address => bool) public approvedRouters;
    
    /// @notice Maximum loss per transaction (circuit breaker)
    uint256 public maxLossPerTx;
    
    /// @notice Daily loss limit
    uint256 public dailyLossLimit;
    
    /// @notice Current daily loss tracking
    uint256 public dailyLoss;
    
    /// @notice Last reset timestamp
    uint256 public lastResetTimestamp;
    
    /// @notice Emergency pause flag
    bool public paused;
    
    /// @notice Beneficiary address for profits
    address public beneficiary;

    // ============ Structs ============
    
    /// @notice Swap instruction for a single DEX swap
    struct SwapStep {
        address router;      // DEX router address
        address tokenIn;     // Input token
        address tokenOut;    // Output token
        uint256 amountIn;    // Amount to swap (0 = use all balance)
        bytes data;          // Encoded swap data for the router
        uint8 dexType;       // 0=UniV2, 1=UniV3, 2=Curve, 3=Aerodrome/Velodrome
    }
    
    /// @notice Full arbitrage parameters
    struct ArbitrageParams {
        address flashToken;   // Token to flashloan
        uint256 flashAmount;  // Amount to flashloan
        SwapStep[] swaps;     // Sequence of swaps to execute
        uint256 minProfit;    // Minimum profit required (in flashToken)
    }

    // ============ Events ============
    
    event ArbitrageExecuted(
        address indexed token,
        uint256 flashAmount,
        uint256 profit,
        uint256 gasUsed
    );
    
    event RouterApproved(address indexed router, bool approved);
    event CircuitBreakerTriggered(uint256 loss);
    event EmergencyPause(bool paused);
    event BeneficiaryUpdated(address indexed newBeneficiary);

    // ============ Errors ============
    
    error Paused();
    error NotBalancerVault();
    error RouterNotApproved();
    error InsufficientProfit();
    error MaxLossExceeded();
    error DailyLossLimitExceeded();
    error InvalidSwapData();
    error SwapFailed();

    // ============ Constructor ============
    
    constructor(
        address _beneficiary,
        uint256 _maxLossPerTx,
        uint256 _dailyLossLimit
    ) Ownable(msg.sender) {
        beneficiary = _beneficiary;
        maxLossPerTx = _maxLossPerTx;
        dailyLossLimit = _dailyLossLimit;
        lastResetTimestamp = block.timestamp;
    }

    // ============ External Functions ============
    
    /// @notice Execute arbitrage via Balancer flashloan (zero fees)
    /// @param params Arbitrage parameters including flashloan and swap details
    function executeArbitrage(ArbitrageParams calldata params) external nonReentrant {
        if (paused) revert Paused();
        
        uint256 gasStart = gasleft();
        
        // Reset daily loss counter if new day
        if (block.timestamp >= lastResetTimestamp + 1 days) {
            dailyLoss = 0;
            lastResetTimestamp = block.timestamp;
        }
        
        // Prepare flashloan request
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = IERC20(params.flashToken);
        
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = params.flashAmount;
        
        // Encode arbitrage params for callback
        bytes memory userData = abi.encode(params);
        
        // Execute Balancer flashloan
        IBalancerVault(BALANCER_VAULT).flashLoan(
            IFlashLoanRecipient(address(this)),
            tokens,
            amounts,
            userData
        );
        
        uint256 gasUsed = gasStart - gasleft();
        
        emit ArbitrageExecuted(
            params.flashToken,
            params.flashAmount,
            IERC20(params.flashToken).balanceOf(address(this)),
            gasUsed
        );
    }
    
    /// @notice Balancer flashloan callback
    /// @dev Called by Balancer Vault during flashloan execution
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external {
        if (msg.sender != BALANCER_VAULT) revert NotBalancerVault();
        
        ArbitrageParams memory params = abi.decode(userData, (ArbitrageParams));
        
        uint256 balanceBefore = tokens[0].balanceOf(address(this));
        
        // Execute swap sequence
        for (uint256 i = 0; i < params.swaps.length; i++) {
            _executeSwap(params.swaps[i]);
        }
        
        uint256 balanceAfter = tokens[0].balanceOf(address(this));
        uint256 repayAmount = amounts[0] + feeAmounts[0]; // feeAmounts should be 0 for Balancer
        
        // Check profit
        if (balanceAfter < repayAmount + params.minProfit) {
            revert InsufficientProfit();
        }
        
        // Circuit breaker check
        if (balanceAfter < balanceBefore) {
            uint256 loss = balanceBefore - balanceAfter;
            if (loss > maxLossPerTx) revert MaxLossExceeded();
            
            dailyLoss += loss;
            if (dailyLoss >= dailyLossLimit) {
                paused = true;
                emit CircuitBreakerTriggered(dailyLoss);
            }
        }
        
        // Repay flashloan
        tokens[0].safeTransfer(BALANCER_VAULT, repayAmount);
        
        // Send profit to beneficiary
        uint256 profit = tokens[0].balanceOf(address(this));
        if (profit > 0) {
            tokens[0].safeTransfer(beneficiary, profit);
        }
    }

    // ============ Internal Functions ============
    
    /// @notice Execute a single swap based on DEX type
    function _executeSwap(SwapStep memory swap) internal {
        if (!approvedRouters[swap.router]) revert RouterNotApproved();
        
        uint256 amountIn = swap.amountIn;
        if (amountIn == 0) {
            amountIn = IERC20(swap.tokenIn).balanceOf(address(this));
        }
        
        // Approve router if needed
        IERC20(swap.tokenIn).forceApprove(swap.router, amountIn);
        
        if (swap.dexType == 0) {
            // UniswapV2-style swap
            _executeV2Swap(swap.router, swap.tokenIn, swap.tokenOut, amountIn, swap.data);
        } else if (swap.dexType == 1) {
            // UniswapV3-style swap
            _executeV3Swap(swap.router, swap.tokenIn, swap.tokenOut, amountIn, swap.data);
        } else if (swap.dexType == 2) {
            // Curve-style swap
            _executeCurveSwap(swap.router, swap.tokenIn, swap.tokenOut, amountIn, swap.data);
        } else if (swap.dexType == 3) {
            // Aerodrome/Velodrome swap
            _executeVelodromeSwap(swap.router, swap.tokenIn, swap.tokenOut, amountIn, swap.data);
        } else {
            revert InvalidSwapData();
        }
    }
    
    function _executeV2Swap(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes memory /* data */
    ) internal {
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        
        IUniswapV2Router(router).swapExactTokensForTokens(
            amountIn,
            0, // Accept any amount (MEV protection handled externally)
            path,
            address(this),
            block.timestamp
        );
    }
    
    function _executeV3Swap(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes memory data
    ) internal {
        // Decode V3 specific params (fee tier)
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
    
    function _executeCurveSwap(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes memory data
    ) internal {
        // Decode Curve params (i, j indices)
        (int128 i, int128 j) = abi.decode(data, (int128, int128));
        
        ICurvePool(pool).exchange(i, j, amountIn, 0);
    }
    
    function _executeVelodromeSwap(
        address router,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes memory data
    ) internal {
        // Decode Velodrome params (stable flag)
        bool stable = abi.decode(data, (bool));
        
        IVelodromeRouter.Route[] memory routes = new IVelodromeRouter.Route[](1);
        routes[0] = IVelodromeRouter.Route({
            from: tokenIn,
            to: tokenOut,
            stable: stable,
            factory: address(0) // Use default factory
        });
        
        IVelodromeRouter(router).swapExactTokensForTokens(
            amountIn,
            0,
            routes,
            address(this),
            block.timestamp
        );
    }

    // ============ Admin Functions ============
    
    function setRouterApproval(address router, bool approved) external onlyOwner {
        approvedRouters[router] = approved;
        emit RouterApproved(router, approved);
    }
    
    function setBeneficiary(address _beneficiary) external onlyOwner {
        beneficiary = _beneficiary;
        emit BeneficiaryUpdated(_beneficiary);
    }
    
    function setCircuitBreaker(uint256 _maxLossPerTx, uint256 _dailyLossLimit) external onlyOwner {
        maxLossPerTx = _maxLossPerTx;
        dailyLossLimit = _dailyLossLimit;
    }
    
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit EmergencyPause(_paused);
    }
    
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }
    
    function rescueETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
    
    receive() external payable {}
}

// ============ Interfaces ============

interface IBalancerVault {
    function flashLoan(
        IFlashLoanRecipient recipient,
        IERC20[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

interface IFlashLoanRecipient {
    function receiveFlashLoan(
        IERC20[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
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

interface ICurvePool {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256);
}

interface IVelodromeRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }
    
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
