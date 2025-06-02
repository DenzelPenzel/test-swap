// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./MockERC20.sol";
import "./MockPancakeFactory.sol";
import {IERC20 as IPancakeERC20} from "../interfaces/IERC20.sol";


contract MockPancakeRouter {
    address public immutable WETH;
    
    struct LiquidityPosition {
        uint amountToken;
        uint amountETH;
        uint liquidity;
    }
    
    mapping(address => mapping(address => LiquidityPosition)) public liquidityPositions;
    mapping(address => mapping(address => address)) public pairs;
    
    
    event SwapExactETHForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] path,
        address to,
        uint deadline
    );
    
    event AddLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline,
        uint amountToken,
        uint amountETH,
        uint liquidity
    );

    constructor(address _weth) {
        WETH = _weth;
        factoryAddress = address(new MockPancakeFactory());
    }

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts) {
        require(path[0] == WETH, "First token must be WETH");
        require(deadline >= block.timestamp, "Deadline expired");
        require(msg.value > 0, "Must send ETH");
        
        address tokenOut = path[path.length - 1];
        uint outputAmount = msg.value * 100;
        require(outputAmount >= amountOutMin, "Insufficient output amount");
        
        MockERC20(tokenOut).mint(to, outputAmount);
        
        amounts = new uint[](path.length);
        amounts[0] = msg.value;
        amounts[path.length - 1] = outputAmount;
        
        emit SwapExactETHForTokens(
            msg.value,
            amountOutMin,
            path,
            to,
            deadline
        );
        
        return amounts;
    }
    
    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) external payable returns (uint amountToken, uint amountETH, uint liquidity) {
        require(deadline >= block.timestamp, "Deadline expired");
        require(msg.value >= amountETHMin, "Insufficient ETH amount");
        
        // transfer tokens from sender to this contract
        IPancakeERC20(token).transferFrom(msg.sender, address(this), amountTokenDesired);
        
        // use the desired amounts
        amountToken = amountTokenDesired;
        amountETH = msg.value;
        
        // fixed liquidity formula
        liquidity = (amountToken + amountETH) / 2;
        
        // store the liquidity position
        liquidityPositions[to][token] = LiquidityPosition({
            amountToken: amountToken,
            amountETH: amountETH,
            liquidity: liquidity
        });
        
        emit AddLiquidityETH(
            token,
            amountTokenDesired,
            amountTokenMin,
            amountETHMin,
            to,
            deadline,
            amountToken,
            amountETH,
            liquidity
        );
        
        return (amountToken, amountETH, liquidity);
    }
    
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable {
        require(path[0] == WETH, "First token must be WETH");
        require(deadline >= block.timestamp, "Deadline expired");
        require(msg.value > 0, "Must send ETH");
        
        address tokenOut = path[path.length - 1];
        uint outputAmount = msg.value * 100;
        require(outputAmount >= amountOutMin, "Insufficient output amount");
        
        // mint tokens
        MockERC20(tokenOut).mint(to, outputAmount);
        
        emit SwapExactETHForTokens(
            msg.value,
            amountOutMin,
            path,
            to,
            deadline
        );
    }
    
    address private immutable factoryAddress;

    function factory() external view returns (address) {
        return factoryAddress;
    }
    
    function getPair(address tokenA, address tokenB) external view returns (address) {
        // Return a deterministic address based on the token addresses
        return pairs[tokenA][tokenB] != address(0) ? pairs[tokenA][tokenB] : address(uint160(uint(keccak256(abi.encodePacked(tokenA, tokenB)))));
    }
    
    function getAmountsOut(uint amountIn, address[] calldata path) external pure returns (uint[] memory amounts) {
        amounts = new uint[](path.length);
        amounts[0] = amountIn;
        
        // Simple mock calculation - each hop multiplies by 100
        for (uint i = 1; i < path.length; i++) {
            amounts[i] = amounts[i-1] * 100;
        }
        
        return amounts;
    }
    
    /**
     * @dev Receive function to accept ETH
     */
    receive() external payable {}
}
