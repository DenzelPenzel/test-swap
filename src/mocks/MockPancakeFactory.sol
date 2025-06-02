// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MockPancakeFactory {
    mapping(address => mapping(address => address)) public getPair;
    
    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "IDENTICAL_ADDRESSES");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "ZERO_ADDRESS");
        
        pair = address(uint160(uint256(keccak256(abi.encodePacked(token0, token1)))));
        
        // connect pairss
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        
        return pair;
    }
}
