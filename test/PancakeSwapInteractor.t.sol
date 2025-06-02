// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/PancakeSwapInteractor.sol";
import "../src/mocks/MockERC20.sol";
import "../src/mocks/MockWETH.sol";
import "../src/mocks/MockPancakeRouter.sol";

contract PancakeSwapInteractorTest is Test {
    // contracts
    PancakeSwapInteractor public interactor;
    MockPancakeRouter public router;
    MockWETH public weth;
    MockERC20 public token;
    
    // test addresses
    address public deployer = address(1);
    address public user = address(2);
    address public liquidityProvider = address(3);
    
    uint256 public constant INITIAL_TOKEN_SUPPLY = 1_000_000 ether;
    uint256 public constant INITIAL_ETH_BALANCE = 100 ether;
    uint256 public constant SWAP_AMOUNT = 1 ether;
    uint256 constant MIN_TOKENS_OUT = 1 ether;
    uint256 constant LIQUIDITY_TOKEN_AMOUNT = 100 ether;
    uint256 constant LIQUIDITY_ETH_AMOUNT = 1 ether;
    uint256 constant DEFAULT_SLIPPAGE_BPS = 100; // 1% slippage
    uint256 DEADLINE;
    
    event TokensPurchased(
        address indexed buyer,
        address indexed tokenOut,
        uint amountNativeIn,
        uint amountTokenOutMin,
        uint actualAmountTokenOut
    );
    
    event LiquidityAdded(
        address indexed provider,
        address indexed token,
        uint amountToken,
        uint amountNative,
        uint liquidityTokensMinted
    );
    
    event SwappedAndLiquidityAdded(
        address indexed initiator,
        address indexed token,
        uint nativeAmountUsedForSwap,
        uint tokensReceived,
        uint nativeAmountAddedToLP,
        uint liquidityTokensMinted
    );
    
    function setUp() public {
        // deploy mock contracts
        weth = new MockWETH();
        router = new MockPancakeRouter(address(weth));
        token = new MockERC20("Test Token", "TEST", 18, INITIAL_TOKEN_SUPPLY);
        
        // transfer tokens to test accounts
        token.transfer(liquidityProvider, INITIAL_TOKEN_SUPPLY / 2);
        
        vm.prank(deployer);
        interactor = new PancakeSwapInteractor(address(router));
        
        // set up test accounts
        vm.deal(user, INITIAL_ETH_BALANCE);
        vm.deal(liquidityProvider, INITIAL_ETH_BALANCE);
        
        DEADLINE = block.timestamp + 1 hours;
    }
    
    function testConstructor() public {
        assertEq(interactor.pancakeRouterAddress(), address(router));
        assertEq(interactor.wNativeAddress(), address(weth));
    }
    
    function testConstructorZeroAddress() public {
        vm.expectRevert("PancakeSwapInteractor: zero router address");
        new PancakeSwapInteractor(address(0));
    }
    
    function testPurchaseTokensWithNative() public {
        vm.startPrank(user);
        
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        
        vm.expectEmit(true, true, false, false);
        emit TokensPurchased(user, address(token), SWAP_AMOUNT, MIN_TOKENS_OUT, SWAP_AMOUNT * 100);
        
        interactor.purchaseTokensWithNative{value: SWAP_AMOUNT}(
            path,
            MIN_TOKENS_OUT,
            user,
            DEADLINE
        );
        
        // berify user received tokens (gives 100x ETH amount)
        assertEq(token.balanceOf(user), SWAP_AMOUNT * 100);
        
        vm.stopPrank();
    }
    
    function testPurchaseTokensWithNativeInvalidPath() public {
        vm.startPrank(user);
        
        // invalid path (too short)
        address[] memory path = new address[](1);
        path[0] = address(weth);
        
        vm.expectRevert("Path must have at least 2 tokens");
        interactor.purchaseTokensWithNative{value: SWAP_AMOUNT}(
            path,
            MIN_TOKENS_OUT,
            user,
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testPurchaseTokensWithNativeInvalidFirstToken() public {
        vm.startPrank(user);
        
        // invalid path (doesn't start with WETH)
        address[] memory path = new address[](2);
        path[0] = address(token); // Should be WETH
        path[1] = address(weth);
        
        vm.expectRevert("Path must start with WNATIVE address");
        interactor.purchaseTokensWithNative{value: SWAP_AMOUNT}(
            path,
            MIN_TOKENS_OUT,
            user,
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testPurchaseTokensWithNativeZeroRecipient() public {
        vm.startPrank(user);
        
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        
        vm.expectRevert("Recipient address cannot be zero");
        interactor.purchaseTokensWithNative{value: SWAP_AMOUNT}(
            path,
            MIN_TOKENS_OUT,
            address(0),
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testPurchaseTokensWithNativePastDeadline() public {
        vm.startPrank(user);
        
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        
        vm.expectRevert("Deadline has passed");
        interactor.purchaseTokensWithNative{value: SWAP_AMOUNT}(
            path,
            MIN_TOKENS_OUT,
            user,
            block.timestamp - 1 // Past deadline
        );
        
        vm.stopPrank();
    }
    
    function testPurchaseTokensWithNativeZeroValue() public {
        vm.startPrank(user);
        
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        
        vm.expectRevert("Native currency amount must be > 0");
        interactor.purchaseTokensWithNative{value: 0}(
            path,
            MIN_TOKENS_OUT,
            user,
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testAddLiquidityNative() public {
        vm.startPrank(liquidityProvider);
        
        // deposit tokens to the interactor
        token.approve(address(interactor), LIQUIDITY_TOKEN_AMOUNT);
        interactor.depositTokens(address(token), LIQUIDITY_TOKEN_AMOUNT);
        
        // approve router to spend tokens from interactor
        uint256 interactorBalance = token.balanceOf(address(interactor));
        assertEq(interactorBalance, LIQUIDITY_TOKEN_AMOUNT);
        
        vm.expectEmit(true, true, false, false);
        emit LiquidityAdded(
            liquidityProvider,
            address(token),
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_ETH_AMOUNT,
            (LIQUIDITY_TOKEN_AMOUNT + LIQUIDITY_ETH_AMOUNT) / 2 // Mock router's liquidity calculation
        );
        
        interactor.addLiquidityNative{value: LIQUIDITY_ETH_AMOUNT}(
            address(token),
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_ETH_AMOUNT,
            liquidityProvider,
            DEADLINE
        );
        
        (uint amountToken, uint amountETH, uint liquidity) = router.liquidityPositions(
            liquidityProvider,
            address(token)
        );
        
        assertEq(amountToken, LIQUIDITY_TOKEN_AMOUNT);
        assertEq(amountETH, LIQUIDITY_ETH_AMOUNT);
        assertEq(liquidity, (LIQUIDITY_TOKEN_AMOUNT + LIQUIDITY_ETH_AMOUNT) / 2);
        
        vm.stopPrank();
    }
    
    function testAddLiquidityNativeZeroToken() public {
        vm.startPrank(liquidityProvider);
        
        vm.expectRevert("Token address cannot be zero");
        interactor.addLiquidityNative{value: LIQUIDITY_ETH_AMOUNT}(
            address(0),
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_ETH_AMOUNT,
            liquidityProvider,
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testAddLiquidityNativeZeroRecipient() public {
        vm.startPrank(liquidityProvider);
        
        vm.expectRevert("LP recipient address cannot be zero");
        interactor.addLiquidityNative{value: LIQUIDITY_ETH_AMOUNT}(
            address(token),
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_ETH_AMOUNT,
            address(0),
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testAddLiquidityNativePastDeadline() public {
        vm.startPrank(liquidityProvider);
        
        vm.expectRevert("Deadline has passed");
        interactor.addLiquidityNative{value: LIQUIDITY_ETH_AMOUNT}(
            address(token),
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_ETH_AMOUNT,
            liquidityProvider,
            block.timestamp - 1 // Past deadline
        );
        
        vm.stopPrank();
    }
    
    function testAddLiquidityNativeZeroValue() public {
        vm.startPrank(liquidityProvider);
        
        vm.expectRevert("Native currency amount must be > 0");
        interactor.addLiquidityNative{value: 0}(
            address(token),
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_ETH_AMOUNT,
            liquidityProvider,
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testAddLiquidityNativeZeroTokenAmount() public {
        vm.startPrank(liquidityProvider);
        
        vm.expectRevert("Token amount desired must be > 0");
        interactor.addLiquidityNative{value: LIQUIDITY_ETH_AMOUNT}(
            address(token),
            0,
            0,
            LIQUIDITY_ETH_AMOUNT,
            liquidityProvider,
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testAddLiquidityNativeInsufficientTokens() public {
        vm.startPrank(liquidityProvider);
        
        // no tokens deposited to interactor    
        vm.expectRevert("Insufficient token balance in contract");
        interactor.addLiquidityNative{value: LIQUIDITY_ETH_AMOUNT}(
            address(token),
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_ETH_AMOUNT,
            liquidityProvider,
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testSwapAndAddLiquidity() public {
        // Test slippage validation
        vm.startPrank(user);
        
        address[] memory slippagePath = new address[](2);
        slippagePath[0] = address(weth);
        slippagePath[1] = address(token);
        
        // Test with invalid slippage values
        vm.expectRevert("Swap slippage exceeds 100%");
        interactor.swapAndAddLiquidity{value: 1 ether}(
            0.5 ether,
            slippagePath,
            10001, // > 100%
            DEFAULT_SLIPPAGE_BPS,
            user,
            DEADLINE
        );
        
        vm.expectRevert("Liquidity slippage exceeds 100%");
        interactor.swapAndAddLiquidity{value: 1 ether}(
            0.5 ether,
            slippagePath,
            DEFAULT_SLIPPAGE_BPS,
            10001, // > 100%
            user,
            DEADLINE
        );
        
        vm.expectRevert("Swap slippage must be > 0");
        interactor.swapAndAddLiquidity{value: 1 ether}(
            0.5 ether,
            slippagePath,
            0, // 0 slippage not allowed
            DEFAULT_SLIPPAGE_BPS,
            user,
            DEADLINE
        );
        
        vm.expectRevert("Liquidity slippage must be > 0");
        interactor.swapAndAddLiquidity{value: 1 ether}(
            0.5 ether,
            slippagePath,
            DEFAULT_SLIPPAGE_BPS,
            0, // 0 slippage not allowed
            user,
            DEADLINE
        );
        
        vm.stopPrank();

        vm.startPrank(user);
        
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        
        uint256 ethForSwap = 0.5 ether;
        uint256 ethForLiquidity = 0.5 ether;
        uint256 totalEth = ethForSwap + ethForLiquidity;
        
        // gives 100x ETH amount
        uint256 expectedTokens = ethForSwap * 100;
        
        vm.expectEmit(true, true, false, false);
        emit SwappedAndLiquidityAdded(
            user,
            address(token),
            ethForSwap,
            expectedTokens,
            ethForLiquidity,
            (expectedTokens + ethForLiquidity) / 2
        );
        
        interactor.swapAndAddLiquidity{value: totalEth}(
            ethForSwap,
            path,
            DEFAULT_SLIPPAGE_BPS,
            DEFAULT_SLIPPAGE_BPS,
            user,
            DEADLINE
        );
        
        (uint amountToken, uint amountETH, uint liquidity) = router.liquidityPositions(
            user,
            address(token)
        );
        
        assertEq(amountToken, expectedTokens);
        assertEq(amountETH, ethForLiquidity);
        assertEq(liquidity, (expectedTokens + ethForLiquidity) / 2);
        
        vm.stopPrank();
    }
    
    function testSwapAndAddLiquidityZeroSwapAmount() public {
        vm.startPrank(user);
        
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        
        vm.expectRevert("Native currency for swap must be > 0");
        interactor.swapAndAddLiquidity{value: 1 ether}(
            0,
            path,
            DEFAULT_SLIPPAGE_BPS,
            DEFAULT_SLIPPAGE_BPS,
            user,
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testSwapAndAddLiquidityInsufficientTotalValue() public {
        vm.startPrank(user);
        
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        
        vm.expectRevert("Total native currency must be greater than amount for swap");
        interactor.swapAndAddLiquidity{value: 0.5 ether}(
            1 ether, // More than total value
            path,
            DEFAULT_SLIPPAGE_BPS,
            DEFAULT_SLIPPAGE_BPS,
            user,
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testSwapAndAddLiquidityInvalidPath() public {
        vm.startPrank(user);
        
        address[] memory invalidPath = new address[](1);
        invalidPath[0] = address(weth);
        
        vm.expectRevert("Swap path must have at least 2 tokens");
        interactor.swapAndAddLiquidity{value: 1 ether}(
            0.5 ether,
            invalidPath,
            DEFAULT_SLIPPAGE_BPS,
            DEFAULT_SLIPPAGE_BPS,
            user,
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testSwapAndAddLiquidityInvalidFirstToken() public {
        vm.startPrank(user);
        
        address[] memory invalidPath = new address[](2);
        invalidPath[0] = address(token); // Should be WETH
        invalidPath[1] = address(weth);
        
        vm.expectRevert("Swap path must start with WNATIVE");
        interactor.swapAndAddLiquidity{value: 1 ether}(
            0.5 ether,
            invalidPath,
            DEFAULT_SLIPPAGE_BPS,
            DEFAULT_SLIPPAGE_BPS,
            user,
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testSwapAndAddLiquidityZeroRecipient() public {
        vm.startPrank(user);
        
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        
        vm.expectRevert("LP recipient address cannot be zero");
        interactor.swapAndAddLiquidity{value: 1 ether}(
            0.5 ether,
            path,
            DEFAULT_SLIPPAGE_BPS,
            DEFAULT_SLIPPAGE_BPS,
            address(0),
            DEADLINE
        );
        
        vm.stopPrank();
    }
    
    function testSwapAndAddLiquidityPastDeadline() public {
        vm.startPrank(user);
        
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        
        vm.expectRevert("Deadline has passed");
        interactor.swapAndAddLiquidity{value: 1 ether}(
            0.5 ether,
            path,
            DEFAULT_SLIPPAGE_BPS,
            DEFAULT_SLIPPAGE_BPS,
            user,
            block.timestamp - 1 // Past deadline
        );
        
        vm.stopPrank();
    }
    
    function testDepositTokens() public {
        vm.startPrank(liquidityProvider);
        
        uint256 depositAmount = 50 ether;
        token.approve(address(interactor), depositAmount);
        
        interactor.depositTokens(address(token), depositAmount);
        
        assertEq(token.balanceOf(address(interactor)), depositAmount);
        
        vm.stopPrank();
    }
    
    function testDepositTokensZeroAddress() public {
        vm.startPrank(liquidityProvider);
        
        vm.expectRevert("Token address cannot be zero");
        interactor.depositTokens(address(0), 1 ether);
        
        vm.stopPrank();
    }
    
    function testDepositTokensZeroAmount() public {
        vm.startPrank(liquidityProvider);
        
        vm.expectRevert("Amount must be greater than 0");
        interactor.depositTokens(address(token), 0);
        
        vm.stopPrank();
    }
    
    function testWithdrawTokens() public {
        // deposit tokens
        vm.startPrank(liquidityProvider);
        uint256 depositAmount = 50 ether;
        token.approve(address(interactor), depositAmount);
        interactor.depositTokens(address(token), depositAmount);
        vm.stopPrank();
        
        // withdraw as owner
        vm.startPrank(deployer);
        uint256 withdrawAmount = 30 ether;
        
        interactor.withdrawTokens(address(token), withdrawAmount, deployer);
        
        assertEq(token.balanceOf(address(interactor)), depositAmount - withdrawAmount);
        assertEq(token.balanceOf(deployer), withdrawAmount);
        
        vm.stopPrank();
    }
    
    function testWithdrawTokensNonOwner() public {
        vm.startPrank(liquidityProvider);
        uint256 depositAmount = 50 ether;
        token.approve(address(interactor), depositAmount);
        interactor.depositTokens(address(token), depositAmount);
        
        // withdraw as non-owner
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", liquidityProvider));
        interactor.withdrawTokens(address(token), depositAmount, liquidityProvider);
        
        vm.stopPrank();
    }
    
    function testWithdrawTokensZeroAddress() public {
        vm.startPrank(deployer);
        
        vm.expectRevert("Token address cannot be zero");
        interactor.withdrawTokens(address(0), 1 ether, deployer);
        
        vm.stopPrank();
    }
    
    function testWithdrawTokensZeroAmount() public {
        vm.startPrank(deployer);
        
        vm.expectRevert("Amount must be greater than 0");
        interactor.withdrawTokens(address(token), 0, deployer);
        
        vm.stopPrank();
    }
    
    function testWithdrawTokensZeroRecipient() public {
        vm.startPrank(deployer);
        
        vm.expectRevert("Recipient address cannot be zero");
        interactor.withdrawTokens(address(token), 1 ether, address(0));
        
        vm.stopPrank();
    }
    
    function testWithdrawTokensInsufficientBalance() public {
        vm.startPrank(deployer);
        
        vm.expectRevert("Insufficient token balance");
        interactor.withdrawTokens(address(token), 1 ether, deployer);
        
        vm.stopPrank();
    }
    
    function testReceiveFunction() public {
        // send ETH to contract
        vm.deal(address(this), 1 ether);
        (bool success, ) = address(interactor).call{value: 1 ether}("");
        assertTrue(success);
        
        assertEq(address(interactor).balance, 1 ether);
    }
}