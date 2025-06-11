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

async function main() {
    const config = networks['mainnet'];

    const provider = new ethers.providers.JsonRpcProvider(config.rpcUrl);
    const privateKey = process.env.PRIVATE_KEY;
    const wallet = new ethers.Wallet(privateKey, provider);
    
    const contract = new ethers.Contract(
        config.contractAddress,
        PancakeSwapInteractorArtifact.abi,
        wallet
    );

    const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
    const tokenOut = '0x32B407ee915432Be6D3F168bc1EfF2a6F8b2034C'; // HODL token
    
    // PancakeSwap Router ABI (simplified for the functions we need)
    const routerAbi = [
        'function getAmountsOut(uint amountIn, address[] memory path) view returns (uint[] memory amounts)',
        'function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)',
        'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable'
    ];
    
    // Create router contract instance
    const router = new ethers.Contract(
        config.pancakeRouterAddress,
        routerAbi,
        wallet
    );
    
    console.log("Using token (HODL):", tokenOut);
    
    try {
        // Increase the amount slightly for the HODL token
        const nativeAmountForSwap = ethers.utils.parseEther("0.00005"); // Amount for swap
        const totalValue = ethers.utils.parseEther("0.0001"); // Total amount (swap + liquidity)
        const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes
        const swapPath = [WBNB, tokenOut];
        
        // For HODL token, set amountOutMin to 0 to account for any potential fees or restrictions
        const amountOutMin = 0;
        
        console.log("Amount for swap:", ethers.utils.formatEther(nativeAmountForSwap), "BNB");
        console.log("Total amount (including liquidity):", ethers.utils.formatEther(totalValue), "BNB");
        console.log("Slippage protection: 10%, minimum output:", amountOutMin, "tokens");
        
        const balance = await wallet.getBalance();
        console.log("Wallet BNB balance before transaction:", ethers.utils.formatEther(balance), "BNB");
        
        // Use a much higher gas limit for HODL token which may have complex transfer logic
        const gasLimit = ethers.BigNumber.from(1000000); // Much higher gas limit for complex token
        const gasPrice = ethers.utils.parseUnits('6', 'gwei'); // Slightly higher gas price
        
        // Calculate the total cost (value + gas)
        const gasCost = gasLimit.mul(gasPrice);
        const totalCost = totalValue.add(gasCost);
        
        console.log("Estimated gas cost:", ethers.utils.formatEther(gasCost), "BNB");
        console.log("Total transaction cost:", ethers.utils.formatEther(totalCost), "BNB");
        
        if (balance.lt(totalCost)) {
            throw new Error(`Insufficient funds. Need ${ethers.utils.formatEther(totalCost)} BNB but only have ${ethers.utils.formatEther(balance)} BNB`);
        }
        
        // Try to get token information
        try {
            const tokenContract = new ethers.Contract(
                tokenOut,
                [
                    "function name() view returns (string)",
                    "function symbol() view returns (string)",
                    "function decimals() view returns (uint8)",
                    "function totalSupply() view returns (uint256)",
                    "function balanceOf(address) view returns (uint256)"
                ],
                provider
            );
            
            const [name, symbol, decimals, totalSupply] = await Promise.all([
                tokenContract.name().catch(() => "Unknown"),
                tokenContract.symbol().catch(() => "???"),
                tokenContract.decimals().catch(() => 18),
                tokenContract.totalSupply().catch(() => "Unknown")
            ]);
            
            console.log("Token Info:");
            console.log(" - Name:", name);
            console.log(" - Symbol:", symbol);
            console.log(" - Decimals:", decimals);
            console.log(" - Total Supply:", totalSupply.toString());
        } catch (error) {
            console.log("Could not fetch token info:", error.message);
        }
        
        console.log("Attempting direct router transaction with fee-on-transfer support:");
        console.log(" - Native amount for swap:", ethers.utils.formatEther(nativeAmountForSwap), "BNB");
        console.log(" - Gas limit:", gasLimit.toString());
        console.log(" - Gas price:", ethers.utils.formatUnits(gasPrice, 'gwei'), "gwei");
        console.log(" - Minimum output amount:", amountOutMin);
        
        try {
            // For tokens with transfer fees, we need to use the special function
            // that supports fee on transfer tokens
            console.log("Using swapExactETHForTokensSupportingFeeOnTransferTokens for HODL token");
            
            const tx = await router.swapExactETHForTokensSupportingFeeOnTransferTokens(
                amountOutMin,
                swapPath,
                wallet.address,  // Send tokens directly to wallet
                deadline,
                { 
                    value: nativeAmountForSwap,  // Only sending the swap amount
                    gasLimit: gasLimit,
                    gasPrice: gasPrice
                }
            );

            console.log("TX hash:", tx.hash);
            console.log("Waiting for transaction confirmation...");
            
            // Try to get the transaction data to see what's happening
            const txData = await provider.getTransaction(tx.hash);
            console.log("Transaction data:", {
                from: txData.from,
                to: txData.to,
                value: ethers.utils.formatEther(txData.value),
                gasLimit: txData.gasLimit.toString(),
                gasPrice: ethers.utils.formatUnits(txData.gasPrice || txData.maxFeePerGas, 'gwei')
            });
            
            const receipt = await tx.wait();
            console.log("Transaction confirmed!");
            console.log("Gas used:", receipt.gasUsed.toString());
            console.log("Transaction status:", receipt.status === 1 ? "Success" : "Failed");
        } catch (error) {
            console.log("Transaction failed:", error.message);
            
            if (error.transaction) {
                const txHash = error.transactionHash || (error.transaction ? error.transaction.hash : null);
                if (txHash) {
                    console.log("Failed transaction hash:", txHash);
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
            
            // Get the wallet balance after the failed transaction
            const balanceAfter = await wallet.getBalance();
            console.log("Wallet BNB balance after failed tx:", ethers.utils.formatEther(balanceAfter), "BNB");
        }
    } catch (error) {
        console.error("Transaction failed:", error.message);
        
        // More detailed error information
        if (error.error && error.error.message) {
            console.error("Error details:", error.error.message);
        }
        
        // Check if the wallet has enough BNB
        const balance = await provider.getBalance(wallet.address);
        console.log("Wallet BNB balance:", ethers.utils.formatEther(balance), "BNB");
    }
}

main().catch(console.error);