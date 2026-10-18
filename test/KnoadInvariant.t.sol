// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {EntryPoint} from "@account-abstraction/core/EntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/interfaces/PackedUserOperation.sol";
import {
    ERC7579Utils,
    Mode,
    ModeSelector,
    ModePayload
} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {KnoadAccount} from "../src/KnoadAccount.sol";
import {KnoadFactory} from "../src/KnoadFactory.sol";
import {KnoadLib} from "../src/KnoadLib.sol";
import {EcdsaRecoveryVerifier} from "../src/EcdsaRecoveryVerifier.sol";
import {P256Shim} from "./P256Shim.sol";
import {OpenAccount} from "./OpenAccount.sol";

contract KnoadHandler is Test {
    uint256 internal constant SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    KnoadAccount public account;
    EntryPoint public entryPoint;
    address payable public bundler;
    bytes32 public mode;
    uint256 public hotKey;
    uint256 public recoveryKey;
    address public expectedRecovery;

    constructor(KnoadAccount account_, EntryPoint entryPoint_, address payable bundler_, uint256 hotKey_, uint256 recoveryKey_) {
        account = account_;
        entryPoint = entryPoint_;
        bundler = bundler_;
        hotKey = hotKey_;
        recoveryKey = recoveryKey_;
        expectedRecovery = vm.addr(recoveryKey_);
        mode = Mode.unwrap(
            ERC7579Utils.encodeMode(
                ERC7579Utils.CALLTYPE_BATCH, ERC7579Utils.EXECTYPE_DEFAULT, ModeSelector.wrap(0), ModePayload.wrap(0)
            )
        );
    }

    function hotRotate(uint96 salt) external {
        uint256 next = uint256(keccak256(abi.encode(hotKey, salt, "knoad-next")));
        next = bound(next, 1, SECP_N - 1);
        if (vm.addr(next) == account.hotSigner()) next = 2;
        bytes memory callData = abi.encodeCall(KnoadAccount.executeAndRotate, (mode, "", vm.addr(next), uint8(1)));
        _submit(callData, hotKey);
        hotKey = next;
    }

    function attackRecover(uint256 fakeKey) external {
        fakeKey = bound(fakeKey, 1, SECP_N - 1);
        if (fakeKey == recoveryKey) fakeKey = 3;
        KnoadAccount.RecoveryRequest memory request = KnoadAccount.RecoveryRequest({
            account: address(account),
            chainId: block.chainid,
            newHotSigner: vm.addr(0x1234),
            newHotKeyType: 1,
            nextRecoveryAuthority: vm.addr(fakeKey),
            recoveryEpoch: account.recoveryEpoch(),
            authorityNonce: account.authorityNonce(),
            deadline: uint64(block.timestamp + 1 days)
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(fakeKey, account.recoveryDigest(request));
        try account.recover(request, abi.encodePacked(r, s, v)) {} catch {}
    }

    function _submit(bytes memory callData, uint256 key) internal {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.nonce = entryPoint.getNonce(address(account), 0);
        op.callData = callData;
        op.accountGasLimits = bytes32(abi.encodePacked(uint128(1_000_000), uint128(500_000)));
        op.preVerificationGas = 100_000;
        op.gasFees = bytes32(abi.encodePacked(uint128(1 gwei), uint128(2 gwei)));
        bytes32 digest = entryPoint.getUserOpHash(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        op.signature = abi.encodePacked(r, s, v);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        entryPoint.handleOps(ops, bundler);
    }
}

contract KnoadInvariantTest is Test {
    KnoadHandler internal handler;
    KnoadAccount internal account;
    EntryPoint internal entryPoint;

    function setUp() public {
        P256Shim shim = new P256Shim();
        vm.etch(address(0x100), address(shim).code);
        EntryPoint deployed = new EntryPoint();
        vm.etch(0x433709009B8330FDa32311DF1C2AFA402eD8D009, address(deployed).code);
        entryPoint = EntryPoint(payable(0x433709009B8330FDa32311DF1C2AFA402eD8D009));

        EcdsaRecoveryVerifier verifier = new EcdsaRecoveryVerifier();
        KnoadFactory factory = new KnoadFactory(verifier);
        uint256 hotKey = 0xA11CE;
        uint256 recoveryKey = 0xBEEF;
        account = OpenAccount.open(factory, recoveryKey, vm.addr(hotKey), KnoadLib.KEY_SECP256K1, 1);
        vm.deal(address(account), 5 ether);
        entryPoint.depositTo{value: 5 ether}(address(account));

        handler = new KnoadHandler(account, entryPoint, payable(makeAddr("bundler")), hotKey, recoveryKey);
        bytes4[] memory selectors = new bytes4[](2);
        selectors[0] = handler.hotRotate.selector;
        selectors[1] = handler.attackRecover.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_recoveryAuthorityIsUnchangedByHotOrFakeKeys() public view {
        assertEq(account.recoveryAuthority(), handler.expectedRecovery());
        assertEq(account.recoveryEpoch(), 0);
    }

    function invariant_signerAndGenerationStayConsistent() public view {
        assertTrue(account.hotSigner() != address(0));
        assertEq(account.generation(), uint64(entryPoint.getNonce(address(account), 0)));
        assertEq(account.hotKeyType(), KnoadLib.KEY_SECP256K1);
    }
}
