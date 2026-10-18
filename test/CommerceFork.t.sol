// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {EntryPoint} from "@account-abstraction/core/EntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/interfaces/PackedUserOperation.sol";
import {
    ERC7579Utils,
    Execution,
    Mode,
    ModeSelector,
    ModePayload
} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {KnoadAccount} from "../src/KnoadAccount.sol";
import {KnoadFactory} from "../src/KnoadFactory.sol";
import {KnoadLib} from "../src/KnoadLib.sol";
import {EcdsaRecoveryVerifier} from "../src/EcdsaRecoveryVerifier.sol";
import {OpenAccount} from "./OpenAccount.sol";

interface IAllowanceHolder {
    function exec(address operator, address token, uint256 amount, address payable target, bytes calldata data)
        external
        payable
        returns (bytes memory);
    function transferFrom(address token, address owner, address recipient, uint256 amount) external returns (bool);
}

/// @dev Stands in for a settler: pulls the sold token through AllowanceHolder and pays the buy token back.
contract Rebate {
    address internal constant HOLDER = 0x0000000000001fF3684f28c67538d4D072C22734;

    function pay(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut) external {
        address owner = address(bytes20(msg.data[msg.data.length - 20:]));
        require(IAllowanceHolder(HOLDER).transferFrom(tokenIn, owner, address(this), amountIn), "pull");
        require(IERC20(tokenOut).transfer(owner, amountOut), "payout");
    }
}

/// @notice Fork test. Skipped unless ETH_FORK_URL or BASE_FORK_URL is set.
contract CommerceForkTest is Test {
    address internal constant HOLDER = 0x0000000000001fF3684f28c67538d4D072C22734;
    address internal constant ENTRY = 0x433709009B8330FDa32311DF1C2AFA402eD8D009;
    KnoadAccount internal account;
    address internal nextSigner;
    uint256 internal minimum;

    function test_allowanceHolderSwapRotatesAndPays() public {
        string memory ethUrl = vm.envOr("ETH_FORK_URL", string(""));
        string memory baseUrl = vm.envOr("BASE_FORK_URL", string(""));
        if (bytes(ethUrl).length == 0 && bytes(baseUrl).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(bytes(ethUrl).length > 0 ? ethUrl : baseUrl);
        _trade();
    }

    function _trade() internal {
        require(block.chainid == 1 || block.chainid == 8453, "fork Ethereum or Base");
        require(HOLDER.code.length > 0, "AllowanceHolder missing");
        require(ENTRY.code.length > 0, "EntryPoint missing");
        (address usdc, address weth) = _tokens();
        uint256 amountIn = 1_000_000;
        minimum = 0.001 ether;
        uint256 hotKey = 0xA11CE;
        nextSigner = vm.addr(0x333);

        KnoadFactory factory = new KnoadFactory(new EcdsaRecoveryVerifier());
        account = OpenAccount.open(factory, 0xBEEF, vm.addr(hotKey), KnoadLib.KEY_SECP256K1, 0);
        Rebate rebate = new Rebate();
        deal(usdc, address(account), amountIn);
        deal(weth, address(rebate), minimum);
        vm.deal(address(account), 2 ether);
        EntryPoint(payable(ENTRY)).depositTo{value: 1 ether}(address(account));
        _submit(hotKey, _swapData(usdc, weth, address(rebate), amountIn));
        _check(usdc, weth);
    }

    function _swapData(address usdc, address weth, address rebate, uint256 amountIn) internal view returns (bytes memory) {
        Execution[] memory calls = new Execution[](2);
        calls[0] = Execution({target: usdc, value: 0, callData: abi.encodeCall(IERC20.approve, (HOLDER, amountIn))});
        calls[1] = Execution({
            target: HOLDER,
            value: 0,
            callData: abi.encodeCall(
                IAllowanceHolder.exec,
                (rebate, usdc, amountIn, payable(rebate), abi.encodeCall(Rebate.pay, (usdc, weth, amountIn, minimum)))
            )
        });
        return abi.encodeCall(
            KnoadAccount.executeAndRotate,
            (
                Mode.unwrap(
                    ERC7579Utils.encodeMode(
                        ERC7579Utils.CALLTYPE_BATCH, ERC7579Utils.EXECTYPE_DEFAULT, ModeSelector.wrap(0), ModePayload.wrap(0)
                    )
                ),
                abi.encode(calls),
                nextSigner,
                uint8(1)
            )
        );
    }

    function _submit(uint256 hotKey, bytes memory callData) internal {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.nonce = 0;
        op.callData = callData;
        op.accountGasLimits = bytes32(abi.encodePacked(uint128(1_000_000), uint128(3_000_000)));
        op.preVerificationGas = 100_000;
        op.gasFees = bytes32(abi.encodePacked(uint128(1 gwei), uint128(block.basefee * 2 + 2 gwei)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(hotKey, EntryPoint(payable(ENTRY)).getUserOpHash(op));
        op.signature = abi.encodePacked(r, s, v);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        address payable bundler = payable(makeAddr("bundler"));
        vm.prank(bundler, bundler);
        EntryPoint(payable(ENTRY)).handleOps(ops, bundler);
    }

    function _check(address usdc, address weth) internal view {
        assertEq(account.hotSigner(), nextSigner);
        assertEq(account.generation(), 1);
        assertEq(IERC20(usdc).allowance(address(account), HOLDER), 0);
        assertGe(IERC20(weth).balanceOf(address(account)), minimum);
    }

    function _tokens() internal view returns (address usdc, address weth) {
        if (block.chainid == 1) {
            return (0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48, 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
        }
        return (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, 0x4200000000000000000000000000000000000006);
    }
}
