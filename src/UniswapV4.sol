// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// OpenZeppelin imports
import "../lib/openzeppelin-contracts/contracts/access/Ownable.sol";
import "../lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import "../lib/openzeppelin-contracts/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../lib/openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import "../lib/openzeppelin-contracts/contracts/token/ERC721/IERC721Receiver.sol";
import "../lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

interface IWETH {
    function deposit() external payable;

    function withdraw(uint256 amount) external;
}

import "../lib/openzeppelin-contracts/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import "../lib/openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

// Uniswap V4 imports
import {Actions} from "@uniswap/v4-periphery/src/libraries/Actions.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPositionManager} from "@uniswap/v4-periphery/src/interfaces/IPositionManager.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
    // Overloaded version if you only pass one input and don't want an array
    function execute(bytes calldata commands, bytes calldata inputs, uint256 deadline) external payable;
}

/**
 * @title Uniswap V4 Router Interface
 * @dev Interface for interacting with Uniswap V4 Router for swaps
 */
interface IV4Router {
    struct ExactInputSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint256 amountIn;
        uint256 amountOutMinimum;
        bytes hookData;
    }
}

/**
 * @title Permit2 Allowance Transfer Interface
 * @dev Interface for interacting with Permit2 for token approvals and transfers
 */
interface IAllowanceTransfer {
    struct PermitDetails {
        address token;
        uint160 amount;
        uint48 expiration;
        uint48 nonce;
    }

    struct PermitSingle {
        PermitDetails details;
        address spender;
        uint256 sigDeadline;
    }

    struct PermitBatch {
        PermitDetails[] details;
        address spender;
        uint256 sigDeadline;
    }

    function transferFrom(
        address from,
        address to,
        uint160 amount,
        address token
    ) external;

    function approve(
        address token,
        address spender,
        uint160 amount,
        uint48 expiration
    ) external;

    function allowance(address user, address token, address spender) external view returns (uint160 amount, uint48 expiration, uint48 nonce);

    function permit(address owner, PermitSingle memory permitSingle, bytes calldata signature) external;

    function permit(address owner, PermitBatch memory permitBatch, bytes calldata signature) external;
}

contract UniswapV4 is ReentrancyGuard, Ownable {

    /// @notice Permit2 contract address for token approvals
    address public constant PERMIT2_ADDRESS = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    /// @notice Permit2 interface for token approvals and transfers
    IAllowanceTransfer public immutable permit2 = IAllowanceTransfer(PERMIT2_ADDRESS);


    uint24 public immutable poolFee;
    /// @notice Tick spacing for the pool
    int24 public immutable tickSpacing;
    uint8 private immutable token1Decimals;

    address public constant WETH_ADDRESS = 0x4200000000000000000000000000000000000006;
    address public immutable universalRouter;
    
    address public immutable token0;
    address public immutable token1;
    uint8 private immutable token0Decimals;
    
    event DebugLogString(string indexed key, string value);
    event DebugLogBytes(string indexed key, bytes value);
    event SwapExecuted(
        address indexed token0,
        address indexed token1,
        bool swapToken0ForToken1,
        uint256 amountIn,
        uint256 amountOutReceived
    );
    
    uint256 constant V4_SWAP = 0x0a;
    
    constructor(
        address _token0,
        address _token1,
        address _uniswapRouter,
        uint24 _poolFee,
        int24 _tickSpacing
    ) Ownable(msg.sender) {
        require(_token0 != address(0), "Invalid token0");
        require(_token0 < _token1, "Invalid token order");
        require(_poolFee > 0, "Invalid pool fee");
        require(_tickSpacing > 0, "Invalid tick spacing");
        
        token0 = _token0;
        token1 = _token1;

        // Handle token0 decimals - if it's address(0) for native ETH, use 18 decimals
        if (_token0 == address(0)) {
            token0Decimals = 18; // ETH has 18 decimals
        } else {
            token0Decimals = IERC20Metadata(_token0).decimals();
        }

        token1Decimals = IERC20Metadata(_token1).decimals();
        universalRouter = _uniswapRouter;
        poolFee = _poolFee;
        tickSpacing = _tickSpacing;

        poolFee = _poolFee;
        tickSpacing = _tickSpacing;
    }
         
    function swapTestV4(
        address safe,
        uint256 wethAmount
    ) external nonReentrant returns (uint256) {
        require(wethAmount > 0, "WETH amount must be > 0");

        IERC20(address(token0)).transferFrom(safe, address(this), wethAmount);

        // If token0 is address(0) (native ETH), use WETH address for Uniswap
        address token0ForUniswap = (token0 == WETH_ADDRESS) ? address(0) : address(token0);

        Currency currency0 = Currency.wrap(token0ForUniswap);
        Currency currency1 = Currency.wrap(address(token1));

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: poolFee,
            tickSpacing: tickSpacing,
            hooks: IHooks(address(0))
        });

        uint256 amountIn = wethAmount;

        uint256 amountOut = _internalSwapConfiguredTokens(
            key,
            true,
            amountIn,
            0
        );
        
        emit SwapExecuted(
            token0,
            token1,
            true,
            amountIn,
            amountOut
        );
        
        return amountOut;
    }
    
    function _internalSwapConfiguredTokens(
        PoolKey memory key,
        bool swapToken0ForToken1,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) internal returns (uint256 amountOutReceived) {
        bool isFromNativeEthSwap = (swapToken0ForToken1 && address(token0) == address(0)) ||
            (!swapToken0ForToken1 && address(token1) == address(0));

        address tokenToUse = swapToken0ForToken1 ?
            (address(token0) == address(0) ? WETH_ADDRESS : address(token0)) :
            address(token1);

        if (!isFromNativeEthSwap) {
            IERC20(tokenToUse).approve(PERMIT2_ADDRESS, type(uint256).max);
            permit2.approve(tokenToUse, address(universalRouter), type(uint160).max, uint48(block.timestamp + 3600));
        }

        bytes memory commands;
        bytes[] memory inputs;

        commands = abi.encodePacked(V4_SWAP);

        inputs = new bytes[](1);

        bytes memory actions = abi.encodePacked(
            uint8(Actions.SWAP_EXACT_IN_SINGLE),
            uint8(Actions.SETTLE_ALL),
            uint8(Actions.TAKE_ALL)
        );

        bytes[] memory swapParams = new bytes[](3);
        swapParams[0] = abi.encode(
            IV4Router.ExactInputSingleParams(
                key,
                swapToken0ForToken1,
                amountIn,
                amountOutMinimum,
                bytes("")
            )
        );

        swapParams[1] = abi.encode(swapToken0ForToken1 ? key.currency0 : key.currency1, amountIn);
        swapParams[2] = abi.encode(swapToken0ForToken1 ? key.currency1 : key.currency0, amountOutMinimum);

        inputs[0] = abi.encode(actions, swapParams);

        IUniversalRouter(universalRouter).execute{value: isFromNativeEthSwap ? amountIn : 0}(commands, inputs, block.timestamp + 20);

        // Check if we're dealing with native ETH or an ERC20 token
        if (swapToken0ForToken1 ? key.currency1 == CurrencyLibrary.ADDRESS_ZERO : key.currency0 == CurrencyLibrary.ADDRESS_ZERO) {
            amountOutReceived = address(this).balance;
        } else {
            address tokenToCheck = swapToken0ForToken1 ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0);
            amountOutReceived = IERC20(tokenToCheck).balanceOf(address(this));
        }
    }

    // Function to withdraw ERC20 tokens
    function withdrawTokens(address token, uint256 amount, address to) external onlyOwner {
        require(token != address(0), "Token address cannot be zero");
        require(amount > 0, "Amount must be greater than 0");
        require(to != address(0), "Recipient address cannot be zero");
        
        IERC20(token).transfer(to, amount);
    }
    
    // Function to withdraw ETH
    function withdrawETH(uint256 amount, address payable to) external onlyOwner {
        require(amount > 0, "Amount must be greater than 0");
        require(to != address(0), "Recipient address cannot be zero");
        require(address(this).balance >= amount, "Insufficient ETH balance");
        
        (bool success, ) = to.call{value: amount}("");
        require(success, "ETH transfer failed");
    }
    
    // Function to receive ETH
    receive() external payable {}
}