# PancakeSwap

A smart contract system for interacting with PancakeSwap DEX, built with Foundry.

## Overview

This project implements a smart contract for interacting with PancakeSwap's Router V2. The system provides the following key functionalities:

1. **Token Purchase**: Swap native currency (ETH/BNB) for specific ERC20 tokens
2. **Add Liquidity**: Provide liquidity with an ERC20 token and native currency
3. **Atomic Swap and Add Liquidity**: Perform token purchase and add liquidity in a single transaction

## Architecture

The system consists of the following components:

- **PancakeSwapInteractor.sol**: Main contract that handles all interactions with PancakeSwap
- **Interfaces**:
  - IERC20.sol: Standard ERC20 token interface
  - IPancakeRouter02.sol: PancakeSwap Router V2 interface

## Key Features

- **Security**: Implements ReentrancyGuard to prevent reentrancy attacks
- **Validation**: Comprehensive input validation to prevent common errors
- **Event Logging**: Detailed events for off-chain tracking
- **Utility Functions**: Helper functions for token deposits and withdrawals

## Contract Functions

### Core Functions

1. **purchaseTokensWithNative**: 
   - Swaps native currency (ETH/BNB) for tokens
   - Uses PancakeSwap's `swapExactETHForTokens` function

2. **addLiquidityNative**:
   - Adds liquidity to a token/native currency pair
   - Uses PancakeSwap's `addLiquidityETH` function
   - Requires tokens to be deposited to the contract first

3. **swapAndAddLiquidity**:
   - Atomically swaps native currency for tokens and adds liquidity
   - Combines both operations in a single transaction for gas efficiency

### Utility Functions

1. **depositTokens**:
   - Deposits ERC20 tokens into the contract
   - Required before calling `addLiquidityNative`

2. **withdrawTokens**:
   - Withdraws tokens from the contract
   - Useful for recovering unused tokens

## Testing

- Unit tests for each function
- Integration tests for complex operations
- Edge case testing for error conditions
- Event emission verification

### Running Tests

```shell
$ forge test
```

For detailed test output with gas usage:

```shell
$ forge test -vv
```

## Usage Examples

### 1. Purchase Tokens

```solidity
// path (WETH -> TOKEN)
address[] memory path = new address[](2);
path[0] = WETH_ADDRESS;
path[1] = TOKEN_ADDRESS;

// Set minimum amount of tokens to receive (slippage protection)
uint amountOutMin = 100 * 10**18; // 100 tokens

uint deadline = block.timestamp + 30 minutes;

// Call the function with 1 ETH
pancakeSwapInteractor.purchaseTokensWithNative{value: 1 ether}(
    path,
    amountOutMin,
    recipient,
    deadline
);
```

### 2. Add Liquidity

```solidity
token.approve(address(pancakeSwapInteractor), 1000 * 10**18);
pancakeSwapInteractor.depositTokens(TOKEN_ADDRESS, 1000 * 10**18);

pancakeSwapInteractor.addLiquidityNative{value: 5 ether}(
    TOKEN_ADDRESS,
    1000 * 10**18, // Amount of tokens to add
    950 * 10**18,  // Minimum token amount (5% slippage)
    4.75 ether,    // Minimum ETH amount (5% slippage)
    recipient,     // LP tokens recipient
    block.timestamp + 30 minutes
);
```

### 3. Swap and Add Liquidity (Atomic)

```solidity
address[] memory path = new address[](2);
path[0] = WETH_ADDRESS;
path[1] = TOKEN_ADDRESS;

// Call the function with 6 ETH total
pancakeSwapInteractor.swapAndAddLiquidity{value: 6 ether}(
    1 ether,       // ETH amount for swap
    path,          // Swap path
    95 * 10**18,   // Minimum tokens from swap (5% slippage)
    90 * 10**18,   // Minimum tokens for liquidity (5% slippage)
    4.75 ether,    // Minimum ETH for liquidity (5% slippage)
    recipient,     // LP tokens recipient
    block.timestamp + 30 minutes
);
```

## Development

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- [Node.js](https://nodejs.org/) (v14 or later)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### Setup

```shell
# Clone the repository
git clone https://github.com/DenzelPenzel/swap

# Install Foundry dependencies
forge install

# Build the contracts
forge build

# Run tests
forge test

# Install Node.js dependencies for scripts
cd scripts
npm install
cd ..
```

### Environment Configuration

Create a `.env` file in the project root with the following variables:

```
PRIVATE_KEY=your_wallet_private_key_here
RPC_BSC=your_bsc_mainnet_rpc_url_here
RPC_BSC_TESTNET=your_bsc_testnet_rpc_url_here
```

### JavaScript

The project includes a JavaScript script (`scripts/main.js`) for interacting with the deployed contract:

#### Running JS

```shell
node scripts/main.js
```

The script performs the following operations:

1. **Contract Deployment**: Deploys the PancakeSwapInteractor contract
2. **Token Purchase**: Tests the `purchaseTokensWithNative` function to swap BNB for BUSD
3. **Token Deposit**: Tests the `depositTokens` function to deposit BUSD to the contract
4. **Token Withdrawal**: Tests the `withdrawTokens` function to withdraw BUSD from the contract
5. **Add Liquidity**: Tests the `addLiquidityNative` function to add BNB-BUSD liquidity
6. **Swap and Add Liquidity**: Tests the `swapAndAddLiquidity` function to perform both operations atomically

You can modify the script parameters in the `config` object to customize token addresses, amounts, and gas settings.

#### Example Output

```
Starting PancakeSwapInteractor test flow...
Using wallet address: 0xf91f056855522C267624d5a921578D9a812E78F4
Wallet balance: 0.3 BNB

1. Deploying PancakeSwapInteractor contract...
PancakeSwapInteractor deployed at: 0xDfd7aaF93655D1f8C129E8a64DB1DAD6CF5d9421

2. Testing purchaseTokensWithNative function...
Transaction hash: 0x4863453789e785d2c2c296c986ab142032fb1b2a6a499615c7e376b7428f1931
Purchase transaction confirmed!
BUSD balance after purchase: 3.753704029946719412 BUSD

...

6. Testing swapAndAddLiquidity function...
Executing swapAndAddLiquidity with 0.01 BNB for swap and 0.005 BNB for liquidity...
Transaction hash: 0x1234...
Swap and add liquidity transaction confirmed!
Tokens received from swap: 1.234 BUSD
Liquidity tokens minted: 0.567 LP tokens

Test completed successfully!
```

## License

MIT
