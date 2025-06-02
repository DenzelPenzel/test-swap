const ethers = require('ethers');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const PancakeSwapInteractorArtifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../out/PancakeSwapInteractor.sol/PancakeSwapInteractor.json'), 'utf8')
);

const networks = {
  testnet: {
    name: 'BSC Testnet',
    chainId: 97,
    rpcUrl: process.env.RPC_BSC_TESTNET || 'https://data-seed-prebsc-1-s1.binance.org:8545/',
    pancakeRouterAddress: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
    wbnbAddress: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd',
    busdAddress: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7', // BUSD
    cakeAddress: '0xFa60D973F7642B748046464e165A65B7323b0DEE', // CAKE
    usdtAddress: '0x7ef95a0FEE0Dd31b22626fA2e10Ee6A223F8a684', // USDT
    contractAddress: '0x60be936d3b8912cA84c049A659b4cFD3F37150b4',
    explorerUrl: 'https://testnet.bscscan.com/tx/'
  },
  mainnet: {
    name: 'BSC Mainnet',
    chainId: 56,
    rpcUrl: process.env.RPC_BSC || 'https://bsc-dataseed.binance.org/',
    pancakeRouterAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    wbnbAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    busdAddress: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
    cakeAddress: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', // CAKE
    usdtAddress: '0x55d398326f99059fF775485246999027B3197955', // USDT (BSC)
    contractAddress: '0xDfd7aaF93655D1f8C129E8a64DB1DAD6CF5d9421',
    explorerUrl: 'https://bscscan.com/tx/'
  }
};

const DEADLINE_MINUTES = 20;

function printUsage() {
  console.log(`
Usage: node ${path.basename(__filename)} [network] [token] [amount]

Options:
  network: 'testnet' (default) or 'mainnet'
  token:   'busd' (default), 'cake', or 'usdt'
  amount:  Amount in BNB (default: 0.001) - minimum viable amount for testing

Examples:
  node ${path.basename(__filename)}                     # Use testnet, BUSD, 0.001 BNB
  node ${path.basename(__filename)} cake                # Use testnet, CAKE, 0.001 BNB
  node ${path.basename(__filename)} usdt 0.05          # Use testnet, USDT, 0.05 BNB
  node ${path.basename(__filename)} testnet cake 0.02  # Use testnet, CAKE, 0.02 BNB
  node ${path.basename(__filename)} mainnet busd 0.1   # Use mainnet, BUSD, 0.1 BNB
`);
}

async function main() {
  try {
    const networkArg = process.argv[2]?.toLowerCase();
    const tokenArg = process.argv[3]?.toLowerCase();
    const amountArg = process.argv[4];

    let networkName = 'testnet';
    let tokenName, amount;

    if (networkArg === 'mainnet' || networkArg === 'testnet') {
      networkName = networkArg;
      tokenName = tokenArg;
      amount = amountArg;
    } else {
      tokenName = networkArg;
      amount = tokenArg;
    }

    const config = networks[networkName];

    if (networkName === 'mainnet' && !config.contractAddress) {
      console.error('Error: No contract address specified for mainnet. Please update the script with your mainnet contract address.');
      return {success: false, error: 'Missing mainnet contract address'};
    }

    if (networkName === 'mainnet') {
      console.log('\n⚠️  WARNING: You are executing on MAINNET! Real funds will be used! ⚠️');
      console.log('Press Ctrl+C within 5 seconds to abort...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      console.log('Proceeding with mainnet transaction...\n');
    }

    console.log(`Starting PancakeSwapInteractor interaction on ${config.name}...`);

    const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    const privateKey = process.env.PRIVATE_KEY;

    if (!privateKey) {
      throw new Error('Private key not found in .env file');
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`Using wallet address: ${wallet.address}`);

    const networkInfo = await provider.getNetwork();
    console.log(`Connected to network with chain ID: ${networkInfo.chainId}`);

    const balance = await wallet.getBalance();
    console.log(`Wallet balance: ${ethers.utils.formatEther(balance)} BNB`);

    if (balance.lt(ethers.utils.parseEther('0.01'))) {
      console.warn('Warning: Low balance! You might not have enough BNB for transaction.');
      console.log('Tip: Get testnet BNB from https://testnet.binance.org/faucet-smart');
      return {success: false, error: 'Insufficient balance'};
    }

    const contract = new ethers.Contract(
      config.contractAddress,
      PancakeSwapInteractorArtifact.abi,
      wallet
    );

    console.log(`Connected to PancakeSwapInteractor at: ${config.contractAddress}`);

    let tokenAddress;

    if (tokenName === 'cake') {
      tokenAddress = config.cakeAddress;
      console.log('Selected token: CAKE');
    } else if (tokenName === 'usdt') {
      tokenAddress = config.usdtAddress;
      console.log('Selected token: USDT');
    } else {
      tokenAddress = config.busdAddress;
      console.log('Selected token: BUSD (default)');
    }

    const totalAmount = amount
      ? ethers.utils.parseEther(amount)
      : ethers.utils.parseEther('0.001');

    console.log(`Total transaction amount: ${ethers.utils.formatEther(totalAmount)} BNB`);

    const nativeAmountForSwap = totalAmount.mul(2).div(3);
    const nativeAmountForLiquidity = totalAmount.sub(nativeAmountForSwap);

    console.log(`Amount for swap: ${ethers.utils.formatEther(nativeAmountForSwap)} BNB`);
    console.log(`Amount for liquidity: ${ethers.utils.formatEther(nativeAmountForLiquidity)} BNB`);

    const swapPath = [config.wbnbAddress, tokenAddress];
    const deadline = Math.floor(Date.now() / 1000) + (DEADLINE_MINUTES * 60);

    console.log('\nExecuting swapAndAddLiquidity...');
    console.log(`Transaction parameters:`);
    console.log(`- total amount: ${ethers.utils.formatEther(totalAmount)} BNB`);
    console.log(`- swap amount: ${ethers.utils.formatEther(nativeAmountForSwap)} BNB`);
    console.log(`- liquidity amount: ${ethers.utils.formatEther(nativeAmountForLiquidity)} BNB`);
    console.log(`- deadline: ${new Date(deadline * 1000).toLocaleTimeString()}`);

    try {
      const tx = await contract.swapAndAddLiquidity(
        nativeAmountForSwap,
        swapPath,
        wallet.address,
        deadline,
        {
          value: totalAmount,
        }
      );

      console.log(`Transaction hash: ${tx.hash}`);
      console.log('Waiting for transaction confirmation...');

      const receipt = await tx.wait();
      console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
      console.log(`Status: ${receipt.status === 1 ? 'Success ✅' : 'Failed ❌'}`);
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);

      console.log('\nTransaction events:');
      for (const log of receipt.logs) {
        try {
          const parsedLog = contract.interface.parseLog(log);
          if (parsedLog.name === 'SwappedAndLiquidityAdded') {
            console.log(`✅ SwappedAndLiquidityAdded event:`);
            console.log(`  - Token: ${parsedLog.args.token}`);
            console.log(`  - Native amount used for swap: ${ethers.utils.formatEther(parsedLog.args.nativeAmountUsedForSwap)} BNB`);
            console.log(`  - Tokens received: ${ethers.utils.formatEther(parsedLog.args.tokensReceived)}`);
            console.log(`  - Native amount added to LP: ${ethers.utils.formatEther(parsedLog.args.nativeAmountAddedToLP)} BNB`);
            console.log(`  - LP tokens minted: ${ethers.utils.formatEther(parsedLog.args.liquidityTokensMinted)}`);
          } else if (parsedLog.name === 'SwappedOnly') {
            console.log(`⚠️ SwappedOnly event (liquidity addition failed):`);
            console.log(`  - Token: ${parsedLog.args.token}`);
            console.log(`  - Native amount used for swap: ${ethers.utils.formatEther(parsedLog.args.nativeAmountUsedForSwap)} BNB`);
            console.log(`  - Tokens received: ${ethers.utils.formatEther(parsedLog.args.tokensReceived)}`);
          }
        } catch (e) {
        }
      }

      return {
        success: receipt.status === 1,
        transactionHash: tx.hash,
        blockNumber: receipt.blockNumber,
        network: networkName
      };
    } catch (error) {
      console.error(`\n❌ Transaction failed:`, error.message);

      if (error.message.includes('insufficient funds')) {
        console.error('Error: Insufficient funds for transaction. Please make sure you have enough BNB for gas fees.');
      } else if (error.message.includes('execution reverted')) {
        console.error('Error: Contract execution reverted. This could be due to slippage or other contract conditions not being met.');
      }

      return {
        success: false,
        error: error.message,
        network: networkName
      };
    }
  } catch (error) {
    console.error('Error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

main()
  .then((result) => {
    console.log('\nExecution completed!');
    if (result && result.transactionHash) {
      const network = result.network || 'testnet';
      if (networks[network]) {
        console.log(`View transaction: ${networks[network].explorerUrl}${result.transactionHash}`);
      }
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
