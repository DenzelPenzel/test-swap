// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@pancakeswap/projects/exchange-protocol/contracts/interfaces/IPancakeRouter02.sol";
import "./interfaces/IPancakeFactory.sol";


contract PancakeSwapInteractor is ReentrancyGuard, Ownable {
    address public immutable pancakeRouterAddress;
    address public immutable wNativeAddress; // WETH on Ethereum, WBNB on BSC

    event TokensPurchased(
        address indexed buyer,
        address indexed tokenOut,
        uint amountNativeIn,
        uint amountTokenOutMin,
        uint actualAmountTokenOut
    );
    
    event LiquidityAdded(
        address indexed provider,
        address indexed token,
        uint amountToken,
        uint amountNative,
        uint liquidityTokensMinted
    );
    
    event SwappedAndLiquidityAdded(
        address indexed initiator,
        address indexed token,
        uint nativeAmountUsedForSwap,
        uint tokensReceived,
        uint nativeAmountAddedToLP,
        uint liquidityTokensMinted
    );
    
    event SwapFailed(
        address indexed initiator,
        uint nativeAmountAttempted
    );
    
    event SwappedOnly(
        address indexed initiator,
        address indexed token,
        uint nativeAmountUsedForSwap,
        uint tokensReceived
    );
    
    event LiquidityAdditionFailed(
        address indexed initiator,
        address indexed token,
        uint tokensReceived,
        uint nativeAmountAttempted
    );

    constructor(address _pancakeRouterAddress) Ownable(msg.sender) {
        require(_pancakeRouterAddress != address(0), "PancakeSwapInteractor: zero router address");
        pancakeRouterAddress = _pancakeRouterAddress;
        wNativeAddress = IPancakeRouter02(_pancakeRouterAddress).WETH();
    }

    /**
     * @notice Purchases ERC20 tokens using native currency (BNB/ETH)
     * @dev Directly calls swapExactETHForTokens on the PancakeSwap Router
     * @param path Token swap route (e.g., [WNATIVE, TOKEN_ADDRESS]). Must start with WNATIVE
     * @param amountOutMin Minimum tokens expected in return
     * @param to Recipient address for the purchased tokens
     * @param deadline Transaction expiry timestamp
     */
    function purchaseTokensWithNative(
        address[] calldata path,
        uint amountOutMin,
        address to,
        uint deadline
    ) external payable nonReentrant {
        require(path.length >= 2, "Path must have at least 2 tokens");
        require(path[0] == wNativeAddress, "Path must start with WNATIVE address");
        require(to != address(0), "Recipient address cannot be zero");
        require(deadline > block.timestamp, "Deadline has passed");
        require(msg.value > 0, "Native currency amount must be > 0");

        uint[] memory amounts = IPancakeRouter02(pancakeRouterAddress)
            .swapExactETHForTokens{value: msg.value}(
            amountOutMin,
            path,
            to,
            deadline
        );

        emit TokensPurchased(
            msg.sender,
            path[path.length - 1],
            msg.value,
            amountOutMin,
            amounts[amounts.length - 1]
        );
    }

    /**
     * @notice Adds liquidity to a PancakeSwap pool using an ERC20 token and native currency (ETH/BNB)
     * @dev This contract must hold and have approved `amountTokenDesired` of the token to the router
     * @param token Address of the ERC20 token
     * @param amountTokenDesired The amount of token to add as liquidity. This contract must possess these tokens
     * @param amountTokenMin Minimum tokens to add (slippage tolerance)
     * @param amountNativeMin Minimum native currency to contribute (slippage tolerance)
     * @param to Recipient address for the LP tokens
     * @param deadline Transaction expiry timestamp
     */
    function addLiquidityNative(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountNativeMin,
        address to,
        uint deadline
    ) external payable nonReentrant {
        require(token != address(0), "Token address cannot be zero");
        require(to != address(0), "LP recipient address cannot be zero");
        require(deadline > block.timestamp, "Deadline has passed");
        require(msg.value > 0, "Native currency amount must be > 0");
        require(amountTokenDesired > 0, "Token amount desired must be > 0");

        uint contractTokenBalance = IERC20(token).balanceOf(address(this));
        require(contractTokenBalance >= amountTokenDesired, "Insufficient token balance in contract");

        IERC20(token).approve(pancakeRouterAddress, amountTokenDesired);

        (uint actualAmountToken, uint actualAmountNative, uint liquidity) = IPancakeRouter02(pancakeRouterAddress)
            .addLiquidityETH{value: msg.value}(
            token,
            amountTokenDesired,
            amountTokenMin,
            amountNativeMin,
            to,
            deadline
        );

        emit LiquidityAdded(
            msg.sender,
            token,
            actualAmountToken,
            actualAmountNative,
            liquidity
        );
    }

    /**
     * @notice Atomically swaps native currency for tokens and then adds liquidity using those tokens
     * @param nativeAmountForSwap Amount of `msg.value` to be used for the token swap
     * @param swapPath Token swap route (e.g., [WNATIVE, TOKEN_ADDRESS])
     * @param lpTokensTo Recipient address for the LP tokens
     * @param deadline Transaction expiry timestamp for both operations
     */
    function swapAndAddLiquidity(
        uint nativeAmountForSwap,
        address[] calldata swapPath,
        address lpTokensTo,
        uint deadline
    ) external payable nonReentrant {
        require(nativeAmountForSwap > 0, "Native currency for swap must be > 0");
        require(msg.value >= nativeAmountForSwap, "Insufficient native currency for swap");
        require(swapPath.length >= 2, "Swap path must have at least 2 tokens");
        require(swapPath[0] == wNativeAddress, "Swap path must start with WNATIVE");
        
        address tokenToLP = swapPath[swapPath.length - 1];
        address lpRecipient = lpTokensTo == address(0) ? msg.sender : lpTokensTo;
        uint txDeadline = deadline <= block.timestamp ? block.timestamp + 20 minutes : deadline;
        
        uint[] memory amounts = IPancakeRouter02(pancakeRouterAddress)
            .swapExactETHForTokens{value: nativeAmountForSwap}(
                0,
                swapPath,
                address(this),
                txDeadline
            );
        
        uint actualTokensBought = amounts[amounts.length - 1];
        require(actualTokensBought > 0, "Swap resulted in 0 tokens");
        
        uint nativeAmountForLiquidity = msg.value - nativeAmountForSwap;
        
        if (nativeAmountForLiquidity == 0) {
            IERC20(tokenToLP).transfer(msg.sender, actualTokensBought);
            emit SwappedOnly(
                msg.sender,
                tokenToLP,
                nativeAmountForSwap,
                actualTokensBought
            );
            return;
        }
        
        IERC20(tokenToLP).approve(pancakeRouterAddress, actualTokensBought);
        
        (uint amountToken, uint amountETH, uint liquidity) = IPancakeRouter02(pancakeRouterAddress)
            .addLiquidityETH{value: nativeAmountForLiquidity}(
                tokenToLP,
                actualTokensBought,
                0, // No minimum token amount
                0, // No minimum ETH amount
                lpRecipient,
                txDeadline
            );
        
        uint unusedTokens = actualTokensBought - amountToken;
        if (unusedTokens > 0) {
            IERC20(tokenToLP).transfer(msg.sender, unusedTokens);
        }
        
        emit SwappedAndLiquidityAdded(
            msg.sender,
            tokenToLP,
            nativeAmountForSwap,
            actualTokensBought,
            amountETH,
            liquidity
        );
    }

    function withdrawTokens(address token, uint amount, address to) external nonReentrant onlyOwner {
        require(token != address(0), "Token address cannot be zero");
        require(amount > 0, "Amount must be greater than 0");
        require(to != address(0), "Recipient address cannot be zero");

        uint balance = IERC20(token).balanceOf(address(this));
        require(balance >= amount, "Insufficient token balance");

        bool success = IERC20(token).transfer(to, amount);
        require(success, "Token transfer failed");
    }

    function depositTokens(address token, uint amount) external nonReentrant {
        require(token != address(0), "Token address cannot be zero");
        require(amount > 0, "Amount must be greater than 0");

        bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(success, "Token transfer failed");
    }

    receive() external payable {}
}