require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ethers = require('ethers');
const PancakeSwapInteractorArtifact = require('../out/PancakeSwapInteractor.sol/PancakeSwapInteractor.json');
const UniswapV4Artifact = require('../out/UniswapV4.sol/UniswapV4.json');

const networks = {
  testnet: {
    name: 'Arbitrum Goerli Testnet',
    rpcUrl: 'https://arb-goerli.g.alchemy.com/v2/demo',
    chainId: 421613,
    pancakeRouterAddress: '0x6Bc3B8A94B871E31c2A8816e19aA4553E042fB51', // PancakeSwap router on Arbitrum Goerli
    universalRouterAddress: '0x4Dae2f939ACf50408e13d58534Ff8c2776d45265',
    wethAddress: '0xEe01c0CD76354C383B8c7B4e65EA88D00B06f36f', // WETH on Arbitrum Goerli
    uniAddress: '0x049251a7175071316e089d0616d8b6aacd2c93b8', // UNI token on Arbitrum Goerli (mock)
    explorerUrl: 'https://goerli.arbiscan.io/address/',
    gasLimit: 5000000,
    gasPrice: ethers.utils.parseUnits('0.1', 'gwei')
  },
  mainnet: {
    name: 'Arbitrum One',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    chainId: 42161,
    pancakeRouterAddress: '0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb', // PancakeSwap router on Arbitrum One
    universalRouterAddress: '0xa51afafe0263b40edaef0df8781ea9aa03e381a3', // Universal Router on Arbitrum One
    wethAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH on Arbitrum One
    uniAddress: '0x8f187aA05619a017077f5308904739877ce9eA21', // UNI token on Arbitrum One
    explorerUrl: 'https://arbiscan.io/address/',
    gasLimit: 5000000,
    gasPrice: ethers.utils.parseUnits('0.1', 'gwei')
  }
};

function saveDeploymentInfo(network, contractAddress, timestamp, isUniswapV4 = false) {
  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId,
    contractAddress,
    contractType: isUniswapV4 ? 'UniswapV4' : 'PancakeSwapInteractor',
    deployedAt: new Date(timestamp * 1000).toISOString(),
    timestamp
  };
  
  if (isUniswapV4) {
    deploymentInfo.universalRouterAddress = network.universalRouterAddress;
    deploymentInfo.wethAddress = network.wethAddress;
  } else {
    deploymentInfo.pancakeRouterAddress = network.pancakeRouterAddress;
  }

  const deploymentsDir = path.join(__dirname, '../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const contractPrefix = isUniswapV4 ? 'uniswapv4' : 'pancakeswap';
  const filename = `arbitrum-${contractPrefix}-${network.chainId === 42161 ? 'mainnet' : 'testnet'}-${timestamp}.json`;
  const filePath = path.join(deploymentsDir, filename);
  
  fs.writeFileSync(filePath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`Deployment info saved to: ${filePath}`);
}

async function main() {
  const networkArg = process.argv[2]?.toLowerCase();
  if (!networkArg || (networkArg !== 'testnet' && networkArg !== 'mainnet')) {
    console.error('Please specify network: node deployContractArbitrum.js <testnet|mainnet> <pancakeswap|uniswapv4>');
    process.exit(1);
  }

  const network = networks[networkArg];
  // Get contract type from command line arguments
  const contractType = process.argv[3]?.toLowerCase() || 'pancakeswap';
  const contractName = contractType === 'uniswapv4' ? 'UniswapV4' : 'PancakeSwapInteractor';
  console.log(`Deploying ${contractName} to ${network.name}...`);

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
  console.log(`Wallet balance: ${ethers.utils.formatEther(balance)} ETH`);

  if (balance.lt(ethers.utils.parseEther('0.01'))) {
    console.warn(`⚠️  Warning: Low balance! You might not have enough ETH for deployment and gas fees.`);
    if (networkArg === 'testnet') {
      console.log('Tip: Get Arbitrum Goerli ETH from https://goerlifaucet.com/');
    }
  }

  const networkInfo = await provider.getNetwork();
  if (networkInfo.chainId !== network.chainId) {
    throw new Error(`Expected chain ID ${network.chainId}, but connected to ${networkInfo.chainId}`);
  }
  console.log(`Connected to network with chain ID: ${networkInfo.chainId}`);

  // Validate contract type
  if (contractType !== 'pancakeswap' && contractType !== 'uniswapv4') {
    console.error('Please specify contract type: node deployContractArbitrum.js <testnet|mainnet> <pancakeswap|uniswapv4>');
    process.exit(1);
  }
  
  const isUniswapV4 = contractType === 'uniswapv4';
  const artifact = isUniswapV4 ? UniswapV4Artifact : PancakeSwapInteractorArtifact;
  
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet
  );
  
  console.log(`\nDeploying ${contractName} with the following parameters:`);
  
  if (isUniswapV4) {
    console.log(`- Universal Router: ${network.universalRouterAddress}`);
    console.log(`- WETH Address: ${network.wethAddress}`);
  } else {
    console.log(`- PancakeSwap Router: ${network.pancakeRouterAddress}`);
  }
  
  console.log(`Gas limit: ${network.gasLimit}, Gas price: ${ethers.utils.formatUnits(network.gasPrice, 'gwei')} gwei`);

  try {
    let deployTx;
    
    if (isUniswapV4) {
      const token0 = network.wethAddress; // WETH
      const token1 = network.uniAddress; // UNI
      const poolFee = 3000; // 0.3% fee tier
      const tickSpacing = 60; // Standard tick spacing for 0.3% pools
      
      console.log(`- Token0 (WETH): ${token0}`);  
      console.log(`- Token1 (UNI): ${token1}`);
      console.log(`- Pool Fee: ${poolFee}`);  
      console.log(`- Tick Spacing: ${tickSpacing}`);
      
      deployTx = await factory.deploy(
        token0,
        token1,
        network.universalRouterAddress,
        poolFee,
        tickSpacing,
        { gasLimit: network.gasLimit, gasPrice: network.gasPrice }
      );
    } else {
      deployTx = await factory.deploy(
        network.pancakeRouterAddress,
        {
          gasLimit: network.gasLimit,
          gasPrice: network.gasPrice
        }
      );
    }

    console.log(`Transaction hash: ${deployTx.deployTransaction.hash}`);
    console.log('Waiting for deployment confirmation...');

    const contract = await deployTx.deployed();
    console.log(`\n✅ Contract deployed successfully!`);
    console.log(`Contract address: ${contract.address}`);
    console.log(`Explorer URL: ${network.explorerUrl}${contract.address}`);

    const timestamp = Math.floor(Date.now() / 1000);
    saveDeploymentInfo(network, contract.address, timestamp, isUniswapV4);

    return {
      success: true,
      contractAddress: contract.address,
      transactionHash: deployTx.deployTransaction.hash
    };
  } catch (error) {
    console.error(`\n❌ Deployment failed: ${error}`);
    return {success: false, error};
  } finally {
    console.log('\nExecution completed!');
  }
}

main()
  .then(result => {
    if (result.success) {
      console.log(`Contract deployed to ${networks[process.argv[2]?.toLowerCase()].name} at: ${result.contractAddress}`);
    }
  })
  .catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
