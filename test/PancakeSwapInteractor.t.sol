// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "../src/PancakeSwapInteractor.sol";
import "../src/mocks/MockERC20.sol";
import "../src/mocks/MockWETH.sol";
import "../src/mocks/MockPancakeRouter.sol";

contract PancakeSwapInteractorTest is Test {
    PancakeSwapInteractor public interactor;
    MockPancakeRouter public router;
    MockWETH public weth;
    MockERC20 public token;
    
    address public deployer = address(1);
    address public user = address(2);
    address public liquidityProvider = address(3);
    
    uint256 public constant INITIAL_TOKEN_SUPPLY = 1_000_000 ether;
    uint256 public constant INITIAL_ETH_BALANCE = 100 ether;
    uint256 public constant SWAP_AMOUNT = 1 ether;
    uint256 constant MIN_TOKENS_OUT = 1 ether;
    uint256 constant LIQUIDITY_TOKEN_AMOUNT = 100 ether;
    uint256 constant LIQUIDITY_ETH_AMOUNT = 1 ether;
    uint256 constant DEFAULT_SLIPPAGE_BPS = 100;
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
        weth = new MockWETH();
        router = new MockPancakeRouter(address(weth));
        token = new MockERC20("Test Token", "TEST", 18, INITIAL_TOKEN_SUPPLY);
        
        token.transfer(liquidityProvider, INITIAL_TOKEN_SUPPLY / 2);
        
        vm.prank(deployer);
        interactor = new PancakeSwapInteractor(address(router));
        
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

        assertEq(token.balanceOf(user), SWAP_AMOUNT * 100);
        
        vm.stopPrank();
    }
    
    function testPurchaseTokensWithNativeInvalidPath() public {
        vm.startPrank(user);

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
        
        token.approve(address(interactor), LIQUIDITY_TOKEN_AMOUNT);
        interactor.depositTokens(address(token), LIQUIDITY_TOKEN_AMOUNT);
        
        uint256 interactorBalance = token.balanceOf(address(interactor));
        assertEq(interactorBalance, LIQUIDITY_TOKEN_AMOUNT);
        
        vm.expectEmit(true, true, false, false);
        emit LiquidityAdded(
            liquidityProvider,
            address(token),
            LIQUIDITY_TOKEN_AMOUNT,
            LIQUIDITY_ETH_AMOUNT,
            (LIQUIDITY_TOKEN_AMOUNT + LIQUIDITY_ETH_AMOUNT) / 2
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
        vm.startPrank(user);
        
        address[] memory slippagePath = new address[](2);
        slippagePath[0] = address(weth);
        slippagePath[1] = address(token);

        interactor.swapAndAddLiquidity{value: 1 ether}(
            0.5 ether,
            slippagePath,
            user,
            DEADLINE
        );
        
        // Verify operation succeeded
        (uint tokenAmount1, uint ethAmount1, uint lpTokens1) = router.liquidityPositions(
            user,
            address(token)
        );
        assertGt(lpTokens1, 0, "No LP tokens received");
        
        vm.stopPrank();

        vm.startPrank(user);
        
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        
        uint256 ethForSwap = 0.5 ether;
        uint256 ethForLiquidity = 0.5 ether;
        uint256 totalEth = ethForSwap + ethForLiquidity;
        
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
        
        vm.expectRevert("Insufficient native currency for swap");
        interactor.swapAndAddLiquidity{value: 0.5 ether}(
            1 ether, // More than total value
            path,
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

        interactor.swapAndAddLiquidity{value: 1 ether}(
            0.5 ether,
            path,
            address(0),
            DEADLINE
        );
        
        (uint tokenAmount2, uint ethAmount2, uint lpTokens2) = router.liquidityPositions(
            user,
            address(token)
        );
        assertGt(lpTokens2, 0, "No LP tokens received");
        
        vm.stopPrank();
    }
    
    function testSwapAndAddLiquidityPastDeadline() public {
        vm.startPrank(user);
        
        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);

        interactor.swapAndAddLiquidity{value: 1 ether}(
            0.5 ether,
            path,
            user,
            block.timestamp - 1 // Past deadline
        );
        
        (uint tokenAmount3, uint ethAmount3, uint lpTokens3) = router.liquidityPositions(
            user,
            address(token)
        );
        assertGt(lpTokens3, 0, "No LP tokens received");
        
        vm.stopPrank();
    }
    
    function testSwapAndAddLiquiditySuccess() public {
        vm.startPrank(user);

        address[] memory path = new address[](2);
        path[0] = address(weth);
        path[1] = address(token);
        

        uint256 ethForSwap = 0.5 ether;
        uint256 ethForLiquidity = 0.5 ether;
        uint256 totalEth = ethForSwap + ethForLiquidity;

        uint256 initialUserEthBalance = user.balance;

        uint256 expectedTokensFromSwap = ethForSwap * 100;

        interactor.swapAndAddLiquidity{value: totalEth}(
            ethForSwap,
            path,
            user,
            DEADLINE
        );

        assertEq(user.balance, initialUserEthBalance - totalEth, "User ETH balance incorrect");

        (uint amountToken, uint amountETH, uint liquidity) = router.liquidityPositions(
            user,
            address(token)
        );

        assertEq(amountToken, expectedTokensFromSwap);
        assertEq(amountETH, ethForLiquidity);
        assertEq(liquidity, (expectedTokensFromSwap + ethForLiquidity) / 2);
        
        vm.stopPrank();
    }
}