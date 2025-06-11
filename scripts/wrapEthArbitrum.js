const ethers = require('ethers');
require('dotenv').config();

const WETH_ABI = [
  "function deposit() external payable",
  "function withdraw(uint256) external",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const networks = {
  testnet: {
    name: 'Arbitrum Goerli',
    chainId: 421613,
    rpcUrl: 'https://goerli-rollup.arbitrum.io/rpc',
    wethAddress: '0xEe01c0CD76354C383B8c7B4e65EA88D00B06f36f',
    explorerUrl: 'https://goerli.arbiscan.io/tx/'
  },
  mainnet: {
    name: 'Arbitrum One',
    chainId: 42161,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    wethAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    explorerUrl: 'https://arbiscan.io/tx/'
  }
};

async function main() {
    const networkName = process.argv[2] || 'mainnet';
    if (!networks[networkName]) {
        console.error(`Network ${networkName} not supported. Use 'testnet' or 'mainnet'`);
        process.exit(1);
    }

    const amountToWrap = process.argv[3] ? 
        ethers.utils.parseEther(process.argv[3]) : 
        ethers.utils.parseEther("0.005");

    const config = networks[networkName];
    console.log(`Wrapping ETH to WETH on ${config.name}...`);

    const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    const privateKey = process.env.PRIVATE_KEY;
    
    if (!privateKey) {
        console.error("PRIVATE_KEY not found in .env file");
        process.exit(1);
    }
    
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`Using wallet address: ${wallet.address}`);
    
    const ethBalance = await wallet.getBalance();
    console.log(`Wallet ETH balance: ${ethers.utils.formatEther(ethBalance)} ETH`);
    
    const network = await provider.getNetwork();
    console.log(`Connected to network with chain ID: ${network.chainId}`);
    
    if (network.chainId !== config.chainId) {
        console.error(`Wrong network! Expected chain ID ${config.chainId}, got ${network.chainId}`);
        process.exit(1);
    }
    
    const wethContract = new ethers.Contract(
        config.wethAddress,
        WETH_ABI,
        wallet
    );
    
    const wethBalanceBefore = await wethContract.balanceOf(wallet.address);
    const wethDecimals = await wethContract.decimals();
    const wethSymbol = await wethContract.symbol();
    
    console.log(`Current ${wethSymbol} balance: ${ethers.utils.formatUnits(wethBalanceBefore, wethDecimals)} ${wethSymbol}`);
    
    const gasLimit = 100000;
    const gasPrice = await provider.getGasPrice();
    const gasCost = gasLimit * gasPrice;
    const totalCost = amountToWrap.add(gasCost);
    
    if (ethBalance.lt(totalCost)) {
        console.error(`Insufficient ETH balance. Need at least ${ethers.utils.formatEther(totalCost)} ETH for transaction.`);
        process.exit(1);
    }
    
    console.log(`\nWrapping ${ethers.utils.formatEther(amountToWrap)} ETH to ${wethSymbol}...`);
    
    try {
        const tx = await wethContract.deposit({
            value: amountToWrap,
            gasLimit: gasLimit
        });
        
        console.log(`Transaction hash: ${tx.hash}`);
        console.log(`Explorer URL: ${config.explorerUrl}${tx.hash}`);
        console.log("Waiting for transaction confirmation...");
        
        const receipt = await tx.wait();
        console.log(`Transaction confirmed! Gas used: ${receipt.gasUsed.toString()}`);
        
        const wethBalanceAfter = await wethContract.balanceOf(wallet.address);
        console.log(`\nNew ${wethSymbol} balance: ${ethers.utils.formatUnits(wethBalanceAfter, wethDecimals)} ${wethSymbol}`);
        
        const wethDiff = wethBalanceAfter.sub(wethBalanceBefore);
        console.log(`Amount wrapped: ${ethers.utils.formatUnits(wethDiff, wethDecimals)} ${wethSymbol}`);
        
        console.log("\n✅ ETH successfully wrapped to WETH!");
        
    } catch (error) {
        console.error("\n❌ Error wrapping ETH:", error.message);
        
        if (error.error && error.error.message) {
            console.error("Error details:", error.error.message);
        }
        
        if (error.transaction) {
            const txHash = error.transactionHash || (error.transaction ? error.transaction.hash : null);
            if (txHash) {
                console.log(`Failed transaction hash: ${txHash}`);
                console.log(`Explorer URL: ${config.explorerUrl}${txHash}`);
            }
        }
    }
}

main().catch(console.error);
