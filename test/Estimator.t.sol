// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, Vm} from "forge-std/Test.sol";
import {EntryPoint} from "@account-abstraction/core/EntryPoint.sol";
import {EntryPointSimulations} from "@account-abstraction/core/EntryPointSimulations.sol";
import {SenderCreator} from "@account-abstraction/core/SenderCreator.sol";
import {PackedUserOperation} from "@account-abstraction/interfaces/PackedUserOperation.sol";
import {
    ERC7579Utils,
    Execution,
    Mode,
    ModeSelector,
    ModePayload
} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {KnoadAccount} from "../src/KnoadAccount.sol";
import {KnoadFactory} from "../src/KnoadFactory.sol";
import {KnoadLib} from "../src/KnoadLib.sol";
import {EcdsaRecoveryVerifier} from "../src/EcdsaRecoveryVerifier.sol";
import {KnoadEstimator} from "../src/simulation/KnoadEstimator.sol";
import {OpenAccount} from "./OpenAccount.sol";

/// @dev A bundler estimates with a dummy signature. These tests show that the
///      account alone cannot be estimated, and that the estimator override can,
///      for a deployed account and for a first-use operation with initCode.
contract EstimatorTest is Test {
    address internal constant ENTRY = 0x433709009B8330FDa32311DF1C2AFA402eD8D009;
    address internal constant SHADOW = address(uint160(uint256(keccak256("knoad.wallet.estimator.shadow"))));
    bytes32 internal constant OP_EVENT = keccak256("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)");

    KnoadFactory internal factory;
    KnoadAccount internal account;
    address internal sink = address(0x5151);

    function setUp() public {
        vm.etch(ENTRY, address(new EntryPoint()).code);
        factory = new KnoadFactory(new EcdsaRecoveryVerifier());
        account = OpenAccount.open(factory, 0xBEEF, vm.addr(0xA11CE), KnoadLib.KEY_SECP256K1, 0);
        vm.deal(address(account), 1 ether);
        vm.etch(ENTRY, address(new EntryPointSimulations()).code);
        vm.prank(ENTRY);
        SenderCreator creator = new SenderCreator();
        vm.etch(vm.computeCreateAddress(ENTRY, 1), address(creator).code);
    }

    function test_writeEstimatorFixture() public {
        string memory json = string.concat(
            '{"shadow":"', vm.toString(SHADOW), '","runtimeCode":"', vm.toString(type(KnoadEstimator).runtimeCode), '"}'
        );
        vm.writeFile("test-vectors/estimator.json", json);
    }

    function test_dummySignatureCannotEstimateTheAccount() public {
        (bool success, address signer) = _simulate(address(account), "", false);
        assertFalse(success);
        assertEq(signer, vm.addr(0xA11CE));
        assertEq(sink.balance, 0);
    }

    function test_estimatorRunsTheCallsOfADeployedAccount() public {
        (bool success, address signer) = _simulate(address(account), "", true);
        assertTrue(success);
        assertEq(signer, address(0x333));
        assertEq(sink.balance, 1);
    }

    function test_estimatorRunsAFirstUseOperation() public {
        address hot = vm.addr(0xB0B);
        address recovery = vm.addr(0xBEEF);
        address predicted = factory.predict(recovery, 7);
        bytes32 digest = factory.activationDigest(predicted, hot, KnoadLib.KEY_SECP256K1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBEEF, digest);
        vm.deal(predicted, 1 ether);
        bytes memory initCode = abi.encodePacked(
            address(factory),
            abi.encodeCall(
                KnoadFactory.createAccount,
                (
                    recovery,
                    7,
                    KnoadFactory.Activation({
                        initialSigner: hot,
                        keyType: KnoadLib.KEY_SECP256K1,
                        signature: abi.encodePacked(r, s, v)
                    })
                )
            )
        );
        (bool success, address signer) = _simulate(predicted, initCode, true);
        assertTrue(success);
        assertEq(signer, address(0x333));
        assertEq(KnoadAccount(payable(predicted)).recoveryAuthority(), vm.addr(0xBEEF));
        assertEq(sink.balance, 1);
    }

    function _simulate(address sender, bytes memory initCode, bool estimator)
        internal
        returns (bool success, address signer)
    {
        if (estimator) {
            vm.etch(SHADOW, factory.implementation().code);
            vm.etch(factory.implementation(), type(KnoadEstimator).runtimeCode);
        }
        PackedUserOperation memory op;
        op.sender = sender;
        op.nonce = 0;
        op.initCode = initCode;
        op.callData = _callData();
        op.accountGasLimits = bytes32(abi.encodePacked(uint128(2_000_000), uint128(1_000_000)));
        op.preVerificationGas = 100_000;
        op.gasFees = bytes32(abi.encodePacked(uint128(1 gwei), uint128(2 gwei)));
        op.signature = abi.encodePacked(bytes32(type(uint256).max / 255), bytes32(type(uint256).max / 255), uint8(1));
        vm.recordLogs();
        vm.prank(address(0xB0), address(0xB0));
        EntryPointSimulations(payable(ENTRY)).simulateHandleOp(op, address(0), "");
        success = _opSucceeded();
        signer = KnoadAccount(payable(sender)).hotSigner();
    }

    function _callData() internal view returns (bytes memory) {
        Execution[] memory calls = new Execution[](1);
        calls[0] = Execution({target: sink, value: 1, callData: ""});
        bytes32 mode = Mode.unwrap(
            ERC7579Utils.encodeMode(ERC7579Utils.CALLTYPE_BATCH, ERC7579Utils.EXECTYPE_DEFAULT, ModeSelector.wrap(0), ModePayload.wrap(0))
        );
        return abi.encodeCall(KnoadAccount.executeAndRotate, (mode, abi.encode(calls), address(0x333), uint8(1)));
    }

    function _opSucceeded() internal view returns (bool) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == OP_EVENT) {
                (, bool success,,) = abi.decode(logs[i].data, (uint256, bool, uint256, uint256));
                return success;
            }
        }
        revert("no UserOperationEvent");
    }
}
