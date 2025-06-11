const ethers = require('ethers');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const PancakeSwapInteractorArtifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../out/PancakeSwapInteractor.sol/PancakeSwapInteractor.json'), 'utf8')
);

const UniswapV4Artifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../out/UniswapV4.sol/UniswapV4.json'), 'utf8')
);

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)"
];

const networks = {
  testnet: {
    name: 'Arbitrum Goerli',
    chainId: 421613,
    rpcUrl: 'https://arb-goerli.g.alchemy.com/v2/demo',
    pancakeRouterAddress: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
    universalRouterAddress: '0x4Dae2f939ACf50408e13d58534Ff8c2776d45265',
    permit2Address: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    wethAddress: '0xEe01c0CD76354C383B8c7B4e65EA88D00B06f36f', 
    uniAddress: '0x049251a7175071316e089d0616d8b6aacd2c93b8', // UNI token on Arbitrum Goerli (mock)
    contractAddress: '0x60be936d3b8912cA84c049A659b4cFD3F37150b4',
    explorerUrl: 'https://goerli.arbiscan.io/tx/'
  },
  mainnet: {
    name: 'Arbitrum One',
    chainId: 42161,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    pancakeRouterAddress: '0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb',
    universalRouterAddress: '0xa51afafe0263b40edaef0df8781ea9aa03e381a3',
    permit2Address: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
    wethAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 
    uniAddress: '0x8f187aA05619a017077f5308904739877ce9eA21', // UNI token on Arbitrum One
    arbAddress: '0x912CE59144191C1204E64559FE8253a0e49E6548', 
    contractAddress: '0x72f3b837cAb289A4e886A4E5263f04656ac7d257', 
    explorerUrl: 'https://arbiscan.io/tx/',
    gasLimit: 5000000,
    gasPrice: ethers.utils.parseUnits('0.1', 'gwei')
  }
};

async function main() {
    const networkName = process.argv[2] || 'mainnet';
    if (!networks[networkName]) {
        console.error(`Network ${networkName} not supported. Use 'testnet' or 'mainnet'`);
        process.exit(1);
    }
    
    const contractType = process.argv[3]?.toLowerCase() || 'pancakeswap';
    if (contractType !== 'pancakeswap' && contractType !== 'uniswapv4') {
        console.error(`Contract type ${contractType} not supported. Use 'pancakeswap' or 'uniswapv4'`);
        process.exit(1);
    }
    
    const isUniswapV4 = contractType === 'uniswapv4';

    const config = networks[networkName];
    console.log(`Testing ${isUniswapV4 ? 'UniswapV4' : 'PancakeSwapInteractor'} on ${config.name}...`);

    const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    const privateKey = process.env.PRIVATE_KEY;
    
    if (!privateKey) {
        console.error("PRIVATE_KEY not found in .env file");
        process.exit(1);
    }
    
    const wallet = new ethers.Wallet(privateKey, provider);
    console.log(`Using wallet address: ${wallet.address}`);
    
    const ethBalance = await wallet.getBalance();
    console.log(`Wallet balance: ${ethers.utils.formatEther(ethBalance)} ETH`);
    
    const network = await provider.getNetwork();
    console.log(`Connected to network with chain ID: ${network.chainId}`);
    
    if (network.chainId !== config.chainId) {
        console.error(`Wrong network! Expected chain ID ${config.chainId}, got ${network.chainId}`);
        process.exit(1);
    }
    
    let contractAddress = process.argv[4] || config.contractAddress;
    
    console.log(`Using contract address: ${contractAddress}`);
    
    const contract = new ethers.Contract(
        contractAddress,
        isUniswapV4 ? UniswapV4Artifact.abi : PancakeSwapInteractorArtifact.abi,
        wallet
    );
    
    const token0 = config.wethAddress; // WETH
    const token1 = config.uniAddress; // UNI
    
    const token0Contract = new ethers.Contract(token0, ERC20_ABI, wallet);
    const token1Contract = new ethers.Contract(token1, ERC20_ABI, wallet);
    
    try {
        const [token0Name, token0Symbol, token0Decimals, token1Name, token1Symbol, token1Decimals] = await Promise.all([
            token0Contract.name().catch(() => "Unknown"),
            token0Contract.symbol().catch(() => "???"),
            token0Contract.decimals().catch(() => 18),
            token1Contract.name().catch(() => "Unknown"),
            token1Contract.symbol().catch(() => "???"),
            token1Contract.decimals().catch(() => 6)
        ]);
        
        console.log("\nToken Information:");
        console.log(`Token0: ${token0Name} (${token0Symbol}) - Decimals: ${token0Decimals}`);
        console.log(`Token1: ${token1Name} (${token1Symbol}) - Decimals: ${token1Decimals}`);
        
        const wethBalance = await token0Contract.balanceOf(wallet.address);
        console.log(`\nCurrent ${token0Symbol} balance: ${ethers.utils.formatUnits(wethBalance, token0Decimals)}`);
        
        if (wethBalance.eq(0)) {
            console.log("\nNo WETH found. You need to wrap some ETH to WETH first.");
            console.log("You can do this by interacting with the WETH contract directly.");
            console.log(`WETH contract address: ${token0}`);
            process.exit(1);
        }
        
        const swapToken0ForToken1 = true;
        const amountIn = ethers.utils.parseUnits("0.0001", token0Decimals); // Swap 0.0001 WETH
        const amountOutMinimum = 0;
        
        console.log(`\nPreparing to swap ${ethers.utils.formatUnits(amountIn, token0Decimals)} ${token0Symbol} to ${token1Symbol}`);
        console.log(`Minimum output amount: ${amountOutMinimum} ${token1Symbol}`);
        
        const allowance = await token0Contract.allowance(wallet.address, config.contractAddress);
        console.log(`Current allowance: ${ethers.utils.formatUnits(allowance, token0Decimals)} ${token0Symbol}`);
        
        if (allowance.lt(amountIn)) {
            console.log(`\nApproving ${ethers.utils.formatUnits(amountIn, token0Decimals)} ${token0Symbol} to contract...`);
            
            const gasLimit = ethers.BigNumber.from(300000);
            const gasPrice = ethers.utils.parseUnits('6', 'gwei');
            
            const approveTx = await token0Contract.approve(
                contractAddress, 
                ethers.constants.MaxUint256,
                { 
                    gasLimit: gasLimit,
                    gasPrice: gasPrice
                }
            );
            
            console.log(`Approval transaction hash: ${approveTx.hash}`);
            console.log(`Explorer URL: ${config.explorerUrl}${approveTx.hash}`);
            console.log("Waiting for approval confirmation...");
            
            await approveTx.wait();
            console.log("Approval confirmed!");
        } else {
            console.log("Sufficient allowance already exists.");
        }
        
        const token0BalanceBefore = await token0Contract.balanceOf(wallet.address);
        const token1BalanceBefore = await token1Contract.balanceOf(wallet.address);
        
        console.log(`\nBalances before swap:`);
        console.log(`${token0Symbol}: ${ethers.utils.formatUnits(token0BalanceBefore, token0Decimals)}`);
        console.log(`${token1Symbol}: ${ethers.utils.formatUnits(token1BalanceBefore, token1Decimals)}`);
        
        // Define gas parameters for all transactions
        const gasLimit = ethers.BigNumber.from(1000000); // Much higher gas limit for complex token
        const gasPrice = ethers.utils.parseUnits('6', 'gwei'); // Slightly higher gas price
        
        console.log("\nExecuting swap...");
        let swapTx;

        if (isUniswapV4) {
                swapTx = await contract.swapTestV4(
                    wallet.address,  // safe address
                    amountIn,        // wethAmount
                    {
                        gasLimit: gasLimit,
                        gasPrice: gasPrice
                    }
                );
        } else {
            const path = [token0, token1];
            const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
            
            swapTx = await contract.purchaseTokensWithNative(
                path,
                amountOutMinimum,
                wallet.address,
                deadline,
                { value: amountIn, gasLimit: 1000000 }
            );
        }
        
        console.log(`Swap transaction hash: ${swapTx.hash}`);
        console.log(`Explorer URL: ${config.explorerUrl}${swapTx.hash}`);
        console.log("Waiting for swap confirmation...");
        
        const receipt = await swapTx.wait();
        console.log(`Transaction confirmed! Gas used: ${receipt.gasUsed.toString()}`);
        
        const token0BalanceAfter = await token0Contract.balanceOf(wallet.address);
        const token1BalanceAfter = await token1Contract.balanceOf(wallet.address);
        
        console.log(`\nBalances after swap:`);
        console.log(`${token0Symbol}: ${ethers.utils.formatUnits(token0BalanceAfter, token0Decimals)}`);
        console.log(`${token1Symbol}: ${ethers.utils.formatUnits(token1BalanceAfter, token1Decimals)}`);
        
        const token0Diff = token0BalanceBefore.sub(token0BalanceAfter);
        const token1Diff = token1BalanceAfter.sub(token1BalanceBefore);
        
        console.log(`\nSwap summary:`);
        console.log(`Sent: ${ethers.utils.formatUnits(token0Diff, token0Decimals)} ${token0Symbol}`);
        console.log(`Received: ${ethers.utils.formatUnits(token1Diff, token1Decimals)} ${token1Symbol}`);
        
        if (token1Diff.gt(0)) {
            console.log("\n✅ Swap successful!");
        } else {
            console.log("\n❌ Swap may have failed - no tokens received.");
        }
        
    } catch (error) {
        console.error("\n❌ Error during swap process:", error.message);
        
        if (error.error && error.error.message) {
            console.error("Error details:", error.error.message);
        }
        
        if (error.transaction) {
            const txHash = error.transactionHash || (error.transaction ? error.transaction.hash : null);
            if (txHash) {
                console.log(`Failed transaction hash: ${txHash}`);
                console.log(`Explorer URL: ${config.explorerUrl}${txHash}`);
                
                try {
                    // Try to get the transaction receipt to see what happened
                    const receipt = await provider.getTransactionReceipt(txHash);
                    if (receipt) {
                        console.log("Transaction receipt:", {
                            status: receipt.status,
                            gasUsed: receipt.gasUsed.toString(),
                            blockNumber: receipt.blockNumber
                        });
                    }
                } catch (receiptError) {
                    console.log("Could not get transaction receipt:", receiptError.message);
                }
            }
        }
    }
}

main().catch(console.error);
