// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./MockERC20.sol";


contract MockWETH is MockERC20 {
    constructor() MockERC20("Wrapped Ether", "WETH", 18, 1000000 ether) {}
    
    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }
    
    function withdraw(uint amount) external {
        require(balanceOf(msg.sender) >= amount, "Insufficient WETH balance");
        _burn(msg.sender, amount);
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");
    }
    
    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}
