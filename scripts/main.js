const { ethers } = require('ethers');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const PancakeSwapInteractorArtifact = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../out/PancakeSwapInteractor.sol/PancakeSwapInteractor.json'),
    'utf8'
  )
);

const ERC20ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)'
];

const config = {
  bscTestnet: {
    rpcUrl: process.env.RPC_BSC_TESTNET || 'https://data-seed-prebsc-1-s1.binance.org:8545/',
    pancakeRouterAddress: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1', // PancakeSwap Router on BSC Testnet
    wbnbAddress: '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', // WBNB on BSC Testnet
    busdAddress: '0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7', // BUSD on BSC Testnet
    gasLimit: 500000,
    gasPrice: ethers.utils.parseUnits('1', 'gwei'),
  },
  bscMainnet: {
    rpcUrl: process.env.RPC_BSC || 'https://bsc-dataseed.binance.org/',
    pancakeRouterAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap Router on BSC Mainnet
    wbnbAddress: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB on BSC Mainnet
    busdAddress: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD on BSC Mainnet
    gasLimit: 3000000,
    gasPrice: ethers.utils.parseUnits('5', 'gwei'),
  }
};

async function main() {
  try {
    console.log('Starting PancakeSwapInteractor test flow...');
    
    const network = 'bscTestnet';
    const provider = new ethers.providers.JsonRpcProvider(config[network].rpcUrl);
    
    if (!process.env.PRIVATE_KEY) {
      throw new Error('Private key not found in .env file');
    }
    
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    console.log(`Using wallet address: ${wallet.address}`);
    
    const balance = await provider.getBalance(wallet.address);
    console.log(`Wallet balance: ${ethers.utils.formatEther(balance)} BNB`);
    
    if (balance.eq(0)) {
      throw new Error('Wallet has zero balance. Please fund it with testnet BNB.');
    }
    
    console.log('\n1. Deploying PancakeSwapInteractor contract...');
    const PancakeSwapInteractorFactory = new ethers.ContractFactory(
      PancakeSwapInteractorArtifact.abi,
      PancakeSwapInteractorArtifact.bytecode.object,
      wallet
    );
    
    const interactor = await PancakeSwapInteractorFactory.deploy(
      config[network].pancakeRouterAddress,
      {
        gasLimit: config[network].gasLimit,
        gasPrice: config[network].gasPrice
      }
    );
    
    await interactor.deployed();
    console.log(`PancakeSwapInteractor deployed at: ${interactor.address}`);
    
    console.log('\n2. Testing purchaseTokensWithNative function...');
    const amountToBuy = balance.mul(10).div(100); // 10% of wallet balance
    console.log(`Using ${ethers.utils.formatEther(amountToBuy)} BNB (10% of wallet balance) to buy tokens`);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from now
    
    // path for swap (WBNB -> BUSD)
    const path = [config[network].wbnbAddress, config[network].busdAddress];
    const recipient = wallet.address;
    const amountOutMin = 0;

    const purchaseTx = await interactor.purchaseTokensWithNative(
      path,
      amountOutMin,
      recipient,
      deadline,
      {
        value: amountToBuy,
        gasLimit: config[network].gasLimit,
        gasPrice: config[network].gasPrice
      }
    );
    
    console.log(`Transaction hash: ${purchaseTx.hash}`);
    await purchaseTx.wait();
    console.log('Purchase transaction confirmed!');
    
    const busdToken = new ethers.Contract(
      config[network].busdAddress,
      ERC20ABI,
      wallet
    );
    
    const busdBalance = await busdToken.balanceOf(wallet.address);
    console.log(`BUSD balance after purchase: ${ethers.utils.formatUnits(busdBalance, 18)} BUSD`);
    
    console.log('\n3. Testing depositTokens function...');
    
    const depositAmount = busdBalance.div(2);
    
    if (depositAmount.gt(0)) {
      console.log(`Approving ${ethers.utils.formatUnits(depositAmount, 18)} BUSD for deposit...`);
      const approveTx = await busdToken.approve(interactor.address, depositAmount);
      await approveTx.wait();
      console.log('Approval transaction confirmed!');
      
      console.log(`Depositing ${ethers.utils.formatUnits(depositAmount, 18)} BUSD to the contract...`);
      const depositTx = await interactor.depositTokens(
        config[network].busdAddress,
        depositAmount,
        {
          gasLimit: config[network].gasLimit,
          gasPrice: config[network].gasPrice
        }
      );
      
      await depositTx.wait();
      console.log('Deposit transaction confirmed!');
      
      const contractBalance = await busdToken.balanceOf(interactor.address);
      console.log(`Contract BUSD balance: ${ethers.utils.formatUnits(contractBalance, 18)} BUSD`);
      
      console.log('\n4. Testing withdrawTokens function...');
      const withdrawAmount = depositAmount.div(2); // Withdraw half of the deposited amount
      
      console.log(`Withdrawing ${ethers.utils.formatUnits(withdrawAmount, 18)} BUSD from the contract...`);
      const withdrawTx = await interactor.withdrawTokens(
        config[network].busdAddress,
        withdrawAmount,
        wallet.address,
        {
          gasLimit: config[network].gasLimit,
          gasPrice: config[network].gasPrice
        }
      );
      
      await withdrawTx.wait();
      console.log('Withdraw transaction confirmed!');
      
      // Check updated balances
      const updatedContractBalance = await busdToken.balanceOf(interactor.address);
      const updatedWalletBalance = await busdToken.balanceOf(wallet.address);
      
      console.log(`Updated contract BUSD balance: ${ethers.utils.formatUnits(updatedContractBalance, 18)} BUSD`);
      console.log(`Updated wallet BUSD balance: ${ethers.utils.formatUnits(updatedWalletBalance, 18)} BUSD`);
    } else {
      console.log('Skipping deposit test as BUSD balance is too low');
    }
    
    if (busdBalance.gt(ethers.utils.parseUnits('1', 18))) {
      console.log('\n5. Testing addLiquidityNative function...');
      
      const liquidityTokenAmount = ethers.utils.parseUnits('1', 18); // 1 BUSD
      const liquidityBnbAmount = balance.mul(5).div(1000); // 0.5% of wallet balance
      console.log(`Using ${ethers.utils.formatEther(liquidityBnbAmount)} BNB (0.5% of wallet balance) for liquidity`);
      
      console.log(`Approving ${ethers.utils.formatUnits(liquidityTokenAmount, 18)} BUSD for liquidity...`);
      const approveForLiquidityTx = await busdToken.approve(interactor.address, liquidityTokenAmount);
      await approveForLiquidityTx.wait();
      
      console.log(`Depositing ${ethers.utils.formatUnits(liquidityTokenAmount, 18)} BUSD to the contract...`);
      const depositForLiquidityTx = await interactor.depositTokens(
        config[network].busdAddress,
        liquidityTokenAmount,
        {
          gasLimit: config[network].gasLimit,
          gasPrice: config[network].gasPrice
        }
      );
      await depositForLiquidityTx.wait();
      
      console.log('Adding liquidity...');
      
      const recipient = wallet.address;
      const amountTokenMin = 0;
      const amountETHMin = 0;
      
      const addLiquidityTx = await interactor.addLiquidityNative(
        config[network].busdAddress,
        liquidityTokenAmount,
        amountTokenMin,
        amountETHMin,
        recipient,
        deadline,
        {
          value: liquidityBnbAmount,
          gasLimit: config[network].gasLimit,
          gasPrice: config[network].gasPrice
        }
      );
      
      await addLiquidityTx.wait();
      console.log('Add liquidity transaction confirmed!');
      
      console.log('\n6. Testing swapAndAddLiquidity function...');
      
      const nativeAmountForSwap = balance.mul(5).div(1000); // 0.5% of wallet balance for swap
      const nativeAmountForLiquidity = balance.mul(3).div(1000); // 0.3% of wallet balance for liquidity
      const totalValue = nativeAmountForSwap.add(nativeAmountForLiquidity); // Total BNB to send
      console.log(`Using ${ethers.utils.formatEther(nativeAmountForSwap)} BNB for swap and ${ethers.utils.formatEther(nativeAmountForLiquidity)} BNB for liquidity (total: ${ethers.utils.formatEther(totalValue)} BNB)`);
      
      // swap (WBNB -> BUSD)
      const swapPath = [config[network].wbnbAddress, config[network].busdAddress];
      const swapAmountOutMin = 0;
      const addLiquidityAmountTokenMin = 0;
      const addLiquidityAmountNativeMin = 0;
      const lpTokensTo = wallet.address;
      
      console.log(`Executing swapAndAddLiquidity with ${ethers.utils.formatEther(nativeAmountForSwap)} BNB for swap and ${ethers.utils.formatEther(nativeAmountForLiquidity)} BNB for liquidity...`);
      
      const swapAndAddLiquidityTx = await interactor.swapAndAddLiquidity(
        nativeAmountForSwap,
        swapPath,
        swapAmountOutMin,
        addLiquidityAmountTokenMin,
        addLiquidityAmountNativeMin,
        lpTokensTo,
        deadline,
        {
          value: totalValue,
          gasLimit: config[network].gasLimit,
          gasPrice: config[network].gasPrice
        }
      );
      
      console.log(`Transaction hash: ${swapAndAddLiquidityTx.hash}`);
      const swapAndAddLiquidityReceipt = await swapAndAddLiquidityTx.wait();
      console.log('Swap and add liquidity transaction confirmed!');

      const swapAndAddLiquidityEvent = swapAndAddLiquidityReceipt.events.find(
        event => event.event === 'SwappedAndLiquidityAdded'
      );
      
      if (swapAndAddLiquidityEvent) {
        const { tokensReceived, liquidityTokensMinted } = swapAndAddLiquidityEvent.args;
        console.log(`Tokens received from swap: ${ethers.utils.formatUnits(tokensReceived, 18)} BUSD`);
        console.log(`Liquidity tokens minted: ${ethers.utils.formatUnits(liquidityTokensMinted, 18)} LP tokens`);
      } else {
        console.log('SwappedAndLiquidityAdded event not found in transaction receipt');
      }
    } else {
      console.log('Skipping liquidity tests as BUSD balance is too low');
    }
    
    console.log('\nTest completed successfully!');
    
  } catch (error) {
    console.error('Error in test flow:', error);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
