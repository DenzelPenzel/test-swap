const ethers = require('ethers');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const PancakeSwapInteractorArtifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../out/PancakeSwapInteractor.sol/PancakeSwapInteractor.json'), 'utf8')
);

const networks = {
  // 0x60be936d3b8912cA84c049A659b4cFD3F37150b4
  testnet: {
    name: 'BSC Testnet',
    rpcUrl: 'https://data-seed-prebsc-1-s1.binance.org:8545/',
    chainId: 97,
    pancakeRouterAddress: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
    universalRouterAddress: '0x4Dae2f939ACf50408e13d58534Ff8c2776d45265', // Universal Router address for BSC Testnet
    permit2Address: '0x000000000022D473030F116dDEE9F6B43aC78BA3', // Permit2 address for BSC Testnet
    explorerUrl: 'https://testnet.bscscan.com/address/',
    gasLimit: 3000000,
    gasPrice: ethers.utils.parseUnits('5', 'gwei')
  },
  mainnet: {
    name: 'BSC Mainnet',
    rpcUrl: 'https://bsc-dataseed.binance.org/',
    chainId: 56,
    pancakeRouterAddress: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
    universalRouterAddress: '0x4Dae2f939ACf50408e13d58534Ff8c2776d45265', // Universal Router address for BSC Mainnet
    permit2Address: '0x000000000022D473030F116dDEE9F6B43aC78BA3', // Permit2 address for BSC Mainnet
    explorerUrl: 'https://bscscan.com/address/',
    gasLimit: 3000000,
    gasPrice: ethers.utils.parseUnits('5', 'gwei')
  }
};

function saveDeploymentInfo(network, contractAddress, deploymentTimestamp) {
  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId,
    contractAddress,
    deploymentTimestamp,
    deployedAt: new Date(deploymentTimestamp).toLocaleString()
  };

  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const filename = `${network.name.replace(/\s+/g, '-').toLowerCase()}-${deploymentTimestamp}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(`Deployment info saved to: deployments/${filename}`);
}

async function main() {
  const networkArg = process.argv[2]?.toLowerCase();
  if (!networkArg || (networkArg !== 'testnet' && networkArg !== 'mainnet')) {
    console.error('Please specify network: node deployContract.js <testnet|mainnet>');
    process.exit(1);
  }

  const network = networks[networkArg];
  console.log(`Deploying PancakeSwapInteractor to ${network.name}...`);

  if (networkArg === 'mainnet') {
    console.log('\n⚠️  WARNING: You are deploying to MAINNET! Real funds will be used! ⚠️');
    console.log('Press Ctrl+C within 5 seconds to abort...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log('Proceeding with mainnet deployment...\n');
  }

  const provider = new ethers.providers.JsonRpcProvider(network.rpcUrl);
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    throw new Error('Private key not found in .env file');
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`Using wallet address: ${wallet.address}`);

  const balance = await wallet.getBalance();
  console.log(`Wallet balance: ${ethers.utils.formatEther(balance)} BNB`);

  if (balance.lt(ethers.utils.parseEther('0.05'))) {
    console.warn(`⚠️  Warning: Low balance! You might not have enough BNB for deployment and gas fees.`);
    if (networkArg === 'testnet') {
      console.log('Tip: Get testnet BNB from https://testnet.binance.org/faucet-smart');
    }
  }

  const networkInfo = await provider.getNetwork();
  if (networkInfo.chainId !== network.chainId) {
    throw new Error(`Expected chain ID ${network.chainId}, but connected to ${networkInfo.chainId}`);
  }
  console.log(`Connected to network with chain ID: ${networkInfo.chainId}`);

  const factory = new ethers.ContractFactory(
    PancakeSwapInteractorArtifact.abi,
    PancakeSwapInteractorArtifact.bytecode,
    wallet
  );

  console.log(`Verifying PancakeSwap Router at: ${network.pancakeRouterAddress}`);
  const routerAbi = [
    "function WETH() external pure returns (address)",
    "function factory() external pure returns (address)"
  ];

  try {
    const router = new ethers.Contract(network.pancakeRouterAddress, routerAbi, provider);
    const wethAddress = await router.WETH();
    const factoryAddress = await router.factory();
    console.log(`Router WETH address: ${wethAddress}`);
    console.log(`Router factory address: ${factoryAddress}`);
    console.log(`Router verification successful ✅`);
  } catch (error) {
    console.error(`Router verification failed: ${error.message}`);
    console.error(`The router contract at ${network.pancakeRouterAddress} may not be a valid PancakeSwap Router.`);
    console.error(`Please verify the router address and try again.`);
    return {success: false, error: 'Router verification failed'};
  }

  console.log(`\nDeploying PancakeSwapInteractor with the following parameters:`);
  console.log(`- PancakeSwap Router: ${network.pancakeRouterAddress}`);
  console.log(`- Universal Router: ${network.universalRouterAddress}`);
  console.log(`- Permit2: ${network.permit2Address}`);
  console.log(`Gas limit: ${network.gasLimit}, Gas price: ${ethers.utils.formatUnits(network.gasPrice, 'gwei')} gwei`);

  try {
    const deployTx = await factory.deploy(
      network.pancakeRouterAddress,
      network.universalRouterAddress,
      network.permit2Address,
      {
        gasLimit: network.gasLimit,
        gasPrice: network.gasPrice
      }
    );

    console.log(`Transaction hash: ${deployTx.deployTransaction.hash}`);
    console.log('Waiting for deployment confirmation...');

    const contract = await deployTx.deployed();
    console.log(`\n✅ Contract deployed successfully!`);
    console.log(`Contract address: ${contract.address}`);
    console.log(`Explorer URL: ${network.explorerUrl}${contract.address}`);

    const timestamp = Math.floor(Date.now() / 1000);
    saveDeploymentInfo(network, contract.address, timestamp);

    return {
      success: true,
      contractAddress: contract.address,
      network: network.name
    };
  } catch (error) {
    console.error(`\n❌ Deployment failed:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

main()
  .then((result) => {
    console.log('\nExecution completed!');
    if (result.success) {
      console.log(`Contract deployed to ${result.network} at: ${result.contractAddress}`);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
