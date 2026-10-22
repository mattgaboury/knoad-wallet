// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {EntryPoint} from "@account-abstraction/core/EntryPoint.sol";
import {SenderCreator} from "@account-abstraction/core/SenderCreator.sol";
import {IEntryPoint} from "@account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/interfaces/PackedUserOperation.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ERC7739Utils} from "@openzeppelin/contracts/utils/cryptography/draft-ERC7739Utils.sol";
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
import {P256Shim} from "./P256Shim.sol";
import {Sink, Mock20, Mock721, Reenter} from "./mocks/Targets.sol";
import {OpenAccount} from "./OpenAccount.sol";

/// @dev External so the ERC-7739 helper can take its type strings as calldata.
contract Erc7739Harness is Test {
    bytes32 public digest;
    bytes32 public appHash;
    bytes public rawSig;
    bytes public encoded;

    function check(
        KnoadAccount account,
        uint256 hotKey,
        bytes32 appSeparator,
        bytes32 contentsHash,
        string calldata contentsName,
        string calldata contentsType,
        string calldata contentsDescr
    ) external {
        digest = MessageHashUtils.toTypedDataHash(appSeparator, _structHash(account, contentsHash, contentsName, contentsType));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(hotKey, digest);
        rawSig = abi.encodePacked(r, s, v);
        encoded = ERC7739Utils.encodeTypedDataSig(rawSig, appSeparator, contentsHash, contentsDescr);
        appHash = MessageHashUtils.toTypedDataHash(appSeparator, contentsHash);
        assertEq(account.isValidSignature(appHash, encoded), bytes4(0x1626ba7e));
        assertTrue(account.isValidSignature(appHash, rawSig) != bytes4(0x1626ba7e));
    }

    function _structHash(
        KnoadAccount account,
        bytes32 contentsHash,
        string calldata contentsName,
        string calldata contentsType
    ) private view returns (bytes32) {
        return ERC7739Utils.typedDataSignStructHash(
            contentsName,
            contentsType,
            contentsHash,
            abi.encode(keccak256(bytes("KNOAD Wallet")), keccak256(bytes("1")), block.chainid, address(account), bytes32(0))
        );
    }
}

/// @dev Runtime code carries the hash, so etching it onto the EntryPoint makes getCurrentUserOpHash return it.
contract CurrentOpHash {
    bytes32 private immutable value;

    constructor(bytes32 value_) {
        value = value_;
    }

    function getCurrentUserOpHash() external view returns (bytes32) {
        return value;
    }
}

contract PayableReceiver {
    receive() external payable {}
}

abstract contract KnoadHarness is Test {
    uint256 internal constant SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    uint256 internal constant P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    EntryPoint internal entryPoint;
    EcdsaRecoveryVerifier internal verifier;
    KnoadFactory internal factory;
    KnoadAccount internal account;
    Sink internal sink;

    uint256 internal hotKey = 0xA11CE;
    uint8 internal hotType = 1;
    uint256 internal recoveryKey = 0xBEEF;
    address payable internal bundler;
    bytes32 internal mode;
    bytes internal nextRevert;

    function setUp() public virtual {
        P256Shim shim = new P256Shim();
        vm.etch(address(0x100), address(shim).code);

        EntryPoint deployedEntryPoint = new EntryPoint();
        address canonical = 0x433709009B8330FDa32311DF1C2AFA402eD8D009;
        vm.prank(canonical);
        SenderCreator trusted = new SenderCreator();
        vm.etch(canonical, _retarget(address(deployedEntryPoint).code, address(deployedEntryPoint.senderCreator()), address(trusted)));
        entryPoint = EntryPoint(payable(canonical));
        assertEq(address(entryPoint.senderCreator()), address(trusted));
        verifier = new EcdsaRecoveryVerifier();
        factory = new KnoadFactory(verifier);
        account = OpenAccount.open(factory, recoveryKey, vm.addr(hotKey), KnoadLib.KEY_SECP256K1, 0);
        sink = new Sink();
        bundler = payable(makeAddr("bundler"));
        mode = _mode();

        vm.deal(address(account), 20 ether);
        entryPoint.depositTo{value: 5 ether}(address(account));

        assertEq(account.hotSigner(), vm.addr(hotKey));
        assertEq(account.generation(), 0);
        assertEq(account.recoveryAuthority(), vm.addr(recoveryKey));
        assertEq(address(account.entryPoint()), 0x433709009B8330FDa32311DF1C2AFA402eD8D009);
    }

    function _minimumPaymentGas(address receiver) internal returns (uint256 minimum) {
        uint256 low = 20_000;
        uint256 high = 400_000;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (_paymentLands(receiver, mid)) high = mid;
            else low = mid + 1;
        }
        return low;
    }

    function _paymentLands(address receiver, uint256 callGas) internal returns (bool landed) {
        uint256 snap = vm.snapshotState();
        bytes memory callData = _rotateCallData(_batch(receiver, 0.0001 ether, ""), 0x111, 1);
        PackedUserOperation memory op = _op(callData, hotKey, hotType, 0);
        op.accountGasLimits = bytes32(abi.encodePacked(uint128(1_000_000), uint128(callGas)));
        op.signature = _sign(hotKey, hotType, entryPoint.getUserOpHash(op));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        try entryPoint.handleOps(ops, bundler) {
            landed = receiver.balance == 0.0001 ether;
        } catch {
            landed = false;
        }
        vm.revertToState(snap);
    }

    function _directPaymentGas(address receiver) internal returns (uint256 used) {
        uint256 snap = vm.snapshotState();
        vm.deal(address(this), 1 ether);
        uint256 before = gasleft();
        (bool ok,) = receiver.call{value: 0.0001 ether}("");
        used = before - gasleft();
        assertTrue(ok);
        vm.revertToState(snap);
    }

    function _etchCurrentOp(bytes32 hash) internal returns (bytes memory original) {
        original = address(entryPoint).code;
        vm.etch(address(entryPoint), address(new CurrentOpHash(hash)).code);
    }

    function _restoreEntryPoint(bytes memory original) internal {
        vm.etch(address(entryPoint), original);
    }

    function _rotate(bytes memory executionData, uint256 nextKey, uint8 nextType) internal {
        _submit(_rotateCallData(executionData, nextKey, nextType), hotKey, hotType);
        hotKey = nextKey;
        hotType = nextType;
    }

    function _rotateCallData(bytes memory executionData, uint256 nextKey, uint8 nextType) internal returns (bytes memory) {
        return abi.encodeCall(KnoadAccount.executeAndRotate, (mode, executionData, _keyAddress(nextKey, nextType), nextType));
    }

    function _submit(bytes memory callData, uint256 key, uint8 keyType) internal {
        _submitAtNonce(callData, key, keyType, entryPoint.getNonce(address(account), 0));
    }

    function _submitAtNonce(bytes memory callData, uint256 key, uint8 keyType, uint256 nonce) internal {
        PackedUserOperation memory op;
        op.sender = address(account);
        op.nonce = nonce;
        op.callData = callData;
        uint128 verifyGas = keyType == KnoadLib.KEY_P256 || hotType == KnoadLib.KEY_P256 ? uint128(8_000_000) : uint128(1_000_000);
        op.accountGasLimits = bytes32(abi.encodePacked(verifyGas, uint128(1_000_000)));
        op.preVerificationGas = 100_000;
        op.gasFees = bytes32(abi.encodePacked(uint128(1 gwei), uint128(2 gwei)));
        op.signature = _sign(key, keyType, entryPoint.getUserOpHash(op));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        if (nextRevert.length > 0) {
            bytes memory expected = nextRevert;
            nextRevert = "";
            vm.expectRevert(expected);
        }
        vm.prank(bundler, bundler);
        entryPoint.handleOps(ops, bundler);
    }

    function _sign(uint256 key, uint8 keyType, bytes32 digest) internal returns (bytes memory) {
        if (keyType == KnoadLib.KEY_SECP256K1) return _signSecp(key, digest);
        return _signP256(key, digest);
    }

    function _signSecp(uint256 key, bytes32 digest) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signP256(uint256 key, bytes32 digest) internal returns (bytes memory) {
        (bytes32 r, bytes32 s) = vm.signP256(key, digest);
        uint256 ss = uint256(s);
        if (ss > P256_N / 2) ss = P256_N - ss;
        (uint256 qx, uint256 qy) = vm.publicKeyP256(key);
        return abi.encodePacked(r, bytes32(ss), bytes32(qx), bytes32(qy));
    }

    function _batch(address target, uint256 value, bytes memory data) internal pure returns (bytes memory) {
        Execution[] memory calls = new Execution[](1);
        calls[0] = Execution({target: target, value: value, callData: data});
        return abi.encode(calls);
    }

    function _retarget(bytes memory code, address from, address to) internal pure returns (bytes memory) {
        bytes20 current = bytes20(from);
        bytes20 next = bytes20(to);
        for (uint256 i = 0; i + 20 <= code.length; i++) {
            bool found = true;
            for (uint256 j = 0; j < 20; j++) {
                if (code[i + j] != current[j]) {
                    found = false;
                    break;
                }
            }
            if (found) {
                for (uint256 j = 0; j < 20; j++) code[i + j] = next[j];
            }
        }
        return code;
    }

    function _activation(address signer, bytes memory signature)
        internal
        pure
        returns (KnoadFactory.Activation memory)
    {
        return KnoadFactory.Activation({initialSigner: signer, keyType: 1, signature: signature});
    }

    function _activationInit(uint256 recoveryKey_, address recovery, address hot, uint256 index)
        internal
        returns (bytes memory)
    {
        address predicted = factory.predict(recovery, index);
        bytes32 digest = factory.activationDigest(predicted, hot, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(recoveryKey_, digest);
        return abi.encodePacked(
            address(factory),
            abi.encodeCall(
                KnoadFactory.createAccount,
                (recovery, index, KnoadFactory.Activation({initialSigner: hot, keyType: 1, signature: abi.encodePacked(r, s, v)}))
            )
        );
    }

    function _op(bytes memory callData, uint256 key, uint8 keyType, uint256 nonce)
        internal
        returns (PackedUserOperation memory)
    {
        return _opFor(address(account), callData, key, keyType, nonce);
    }

    function _opFor(address sender, bytes memory callData, uint256 key, uint8 keyType, uint256 nonce)
        internal
        returns (PackedUserOperation memory op)
    {
        op.sender = sender;
        op.nonce = nonce;
        op.callData = callData;
        uint128 verifyGas = keyType == KnoadLib.KEY_P256 ? uint128(8_000_000) : uint128(1_000_000);
        op.accountGasLimits = bytes32(abi.encodePacked(verifyGas, uint128(1_000_000)));
        op.preVerificationGas = 100_000;
        op.gasFees = bytes32(abi.encodePacked(uint128(1 gwei), uint128(2 gwei)));
        op.signature = _sign(key, keyType, entryPoint.getUserOpHash(op));
    }

    function _mode() internal pure returns (bytes32) {
        return Mode.unwrap(
            ERC7579Utils.encodeMode(
                ERC7579Utils.CALLTYPE_BATCH, ERC7579Utils.EXECTYPE_DEFAULT, ModeSelector.wrap(0), ModePayload.wrap(0)
            )
        );
    }

    function _keyAddress(uint256 key, uint8 keyType) internal returns (address) {
        if (keyType == KnoadLib.KEY_P256) return _p256Address(key);
        return vm.addr(key);
    }

    function _p256Address(uint256 key) internal returns (address) {
        (uint256 qx, uint256 qy) = vm.publicKeyP256(key);
        return KnoadLib.p256Signer(bytes32(qx), bytes32(qy));
    }

    function _recover(uint256 newHot, uint8 newType, address nextRecovery) internal {
        (KnoadAccount.RecoveryRequest memory request, bytes memory sig) =
            _signedRecovery(_keyAddress(newHot, newType), newType, nextRecovery);
        account.recover(request, sig);
        if (account.recoveryDelay() == 0) {
            hotKey = newHot;
            hotType = newType;
        }
    }

    function _request(address newHot, uint8 newType, address nextRecovery)
        internal
        view
        returns (KnoadAccount.RecoveryRequest memory)
    {
        return KnoadAccount.RecoveryRequest({
            account: address(account),
            chainId: block.chainid,
            newHotSigner: newHot,
            newHotKeyType: newType,
            nextRecoveryAuthority: nextRecovery,
            recoveryEpoch: account.recoveryEpoch(),
            authorityNonce: account.authorityNonce(),
            deadline: uint64(block.timestamp + 1 days)
        });
    }

    function _signedRecovery(address newHot, uint8 newType, address nextRecovery)
        internal
        view
        returns (KnoadAccount.RecoveryRequest memory request, bytes memory sig)
    {
        request = _request(newHot, newType, nextRecovery);
        bytes32 digest = account.recoveryDigest(request);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(recoveryKey, digest);
        sig = abi.encodePacked(r, s, v);
    }

    function _setPolicy(KnoadAccount.Policy memory policy) internal {
        uint64 nonce = account.authorityNonce();
        uint64 deadline = uint64(block.timestamp + 1 days);
        bytes32 digest = keccak256(
            abi.encode(
                keccak256(
                    "Policy(uint128 periodLimit,uint64 windowSeconds,uint64 delaySeconds,uint128 delayThreshold,bool rejectUnlimitedApprovals,uint64 recoveryDelay,address account,uint256 chainId,uint64 authorityNonce,uint64 deadline)"
                ),
                policy.periodLimit,
                policy.windowSeconds,
                policy.delaySeconds,
                policy.delayThreshold,
                policy.rejectUnlimitedApprovals,
                policy.recoveryDelay,
                address(account),
                block.chainid,
                nonce,
                deadline
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KNOAD Wallet"),
                keccak256("1"),
                block.chainid,
                address(account)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(recoveryKey, MessageHashUtils.toTypedDataHash(domain, digest));
        account.setPolicy(policy, nonce, deadline, abi.encodePacked(r, s, v));
    }

    function _upgradeDigest(address impl, bytes32 codehash, uint64 readyAt, uint64 nonce, uint64 deadline)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "ScheduleUpgrade(address account,uint256 chainId,address newImplementation,bytes32 codehash,uint64 readyAt,uint64 authorityNonce,uint64 deadline)"
                ),
                address(account),
                block.chainid,
                impl,
                codehash,
                readyAt,
                nonce,
                deadline
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KNOAD Wallet"),
                keccak256("1"),
                block.chainid,
                address(account)
            )
        );
        return MessageHashUtils.toTypedDataHash(domain, structHash);
    }

    function _personalSign(bytes32 contents) internal returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encodePacked(keccak256("PersonalSign(bytes prefixed)"), contents));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KNOAD Wallet"),
                keccak256("1"),
                block.chainid,
                address(account)
            )
        );
        return _sign(hotKey, hotType, MessageHashUtils.toTypedDataHash(domain, structHash));
    }
}

contract KnoadTest is KnoadHarness {
    function test_writeCreate2Fixture() public {
        address recovery = address(0x1111);
        address predicted = factory.predict(recovery, 0);
        string memory json = string.concat(
            '{"factory":"',
            vm.toString(address(factory)),
            '","implementation":"',
            vm.toString(factory.implementation()),
            '","recovery":"',
            vm.toString(recovery),
            '","index":"0","predicted":"',
            vm.toString(predicted),
            '"}'
        );
        vm.writeFile("test-vectors/create2-fixture.json", json);
        assertEq(predicted.code.length, 0);
        assertEq(address(OpenAccount.open(factory, recoveryKey, vm.addr(hotKey), 1, 2)), factory.predict(vm.addr(recoveryKey), 2));
    }

    function test_writeUserOpHashFixture() public {
        bytes memory callData = hex"010203";
        PackedUserOperation memory op;
        op.sender = address(account);
        op.nonce = 0;
        op.callData = callData;
        op.accountGasLimits = bytes32(abi.encodePacked(uint128(1_000_000), uint128(1_000_000)));
        op.preVerificationGas = 100_000;
        op.gasFees = bytes32(abi.encodePacked(uint128(1 gwei), uint128(2 gwei)));
        bytes32 digest = entryPoint.getUserOpHash(op);
        string memory json = string.concat(
            '{"chainId":"',
            vm.toString(block.chainid),
            '","entryPoint":"',
            vm.toString(address(entryPoint)),
            '","sender":"',
            vm.toString(op.sender),
            '","nonce":"0","callData":"',
            vm.toString(callData),
            '","accountGasLimits":"',
            vm.toString(uint256(op.accountGasLimits)),
            '","preVerificationGas":"100000","gasFees":"',
            vm.toString(uint256(op.gasFees)),
            '","userOpHash":"',
            vm.toString(uint256(digest)),
            '"}'
        );
        vm.writeFile("test-vectors/userop-hash-fixture.json", json);
    }

    function test_writeRecoveryDigestFixture() public {
        KnoadAccount.RecoveryRequest memory req = KnoadAccount.RecoveryRequest({
            account: address(account),
            chainId: block.chainid,
            newHotSigner: address(0x3333),
            newHotKeyType: 2,
            nextRecoveryAuthority: address(0),
            recoveryEpoch: 0,
            authorityNonce: 0,
            deadline: 1_900_000_000
        });
        bytes32 digest = account.recoveryDigest(req);
        string memory json = string.concat(
            '{"account":"',
            vm.toString(req.account),
            '","chainId":"',
            vm.toString(req.chainId),
            '","newHotSigner":"',
            vm.toString(req.newHotSigner),
            '","newHotKeyType":2,"nextRecoveryAuthority":"',
            vm.toString(req.nextRecoveryAuthority),
            '","recoveryEpoch":"0","authorityNonce":"0","deadline":"1900000000","digest":"',
            vm.toString(uint256(digest)),
            '"}'
        );
        vm.writeFile("test-vectors/recovery-digest-fixture.json", json);
    }

    function test_writeTypedDataFixture() public {
        bytes32 appSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("MailApp")),
                keccak256(bytes("1")),
                block.chainid,
                address(0xBEEF)
            )
        );
        bytes32 personHash = keccak256(
            abi.encode(
                keccak256("Person(string name,address wallet)"), keccak256(bytes("Alice")), address(0x1111)
            )
        );
        bytes32 contentsHash = keccak256(
            abi.encode(
                keccak256("Mail(Person from,string contents)Person(string name,address wallet)"),
                personHash,
                keccak256(bytes("hello"))
            )
        );
        string memory contentsType = "Mail(Person from,string contents)Person(string name,address wallet)";
        Erc7739Harness harness = new Erc7739Harness();
        harness.check(account, hotKey, appSeparator, contentsHash, "Mail", contentsType, contentsType);

        string memory json = string.concat(
            '{"account":"',
            vm.toString(address(account)),
            '","chainId":"',
            vm.toString(block.chainid),
            '","appName":"MailApp","appVersion":"1","appVerifier":"',
            vm.toString(address(0xBEEF)),
            '","contentsName":"Mail","contentsType":"',
            contentsType,
            '","contentsDescr":"',
            contentsType,
            '","fromName":"Alice","fromWallet":"',
            vm.toString(address(0x1111)),
            '","contents":"hello","digest":"',
            vm.toString(harness.digest()),
            '","appHash":"',
            vm.toString(harness.appHash()),
            '","rawSignature":"',
            vm.toString(harness.rawSig()),
            '","encodedSignature":"',
            vm.toString(harness.encoded()),
            '"}'
        );
        vm.writeFile("test-vectors/typed-data-fixture.json", json);
    }

    function test_selectorsMatchCalldataLayout() public pure {
        assertEq(
            bytes4(keccak256("executeAndRotate(bytes32,bytes,address,uint8)")), KnoadAccount.executeAndRotate.selector
        );
        assertEq(bytes4(keccak256("vetoRecovery(address,uint8)")), KnoadAccount.vetoRecovery.selector);
    }

    function test_A01_wrongSignerRejected() public {
        address before = account.hotSigner();
        uint256 sinkBefore = sink.received();
        bytes memory callData = _rotateCallData(_batch(address(sink), 1 ether, abi.encodeCall(Sink.take, ())), 0x1234, 1);
        nextRevert = abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA24 signature error");
        _submit(callData, 0x999, 1);
        assertEq(account.hotSigner(), before);
        assertEq(sink.received(), sinkBefore);
    }

    function test_A02_zeroNextKeyRejectedAndRecoveryStillWorks() public {
        bytes memory callData =
            abi.encodeCall(KnoadAccount.executeAndRotate, (mode, "", address(0), uint8(1)));
        nextRevert = abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA24 signature error");
        _submit(callData, hotKey, hotType);
        _recover(0xC0FFEE, 1, vm.addr(0xCAFE));
        assertEq(account.hotSigner(), vm.addr(0xC0FFEE));
        assertEq(account.recoveryAuthority(), vm.addr(0xCAFE));
    }

    function test_A03_retiredSignerCannotSpend() public {
        uint256 next = 0x111;
        _rotate("", next, 1);
        bytes memory callData = _rotateCallData("", 0x222, 1);
        nextRevert = abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA24 signature error");
        _submit(callData, 0xA11CE, 1);
        assertEq(account.hotSigner(), vm.addr(next));
    }

    function test_A04_onlyOneOperationOfAGenerationLands() public {
        uint256 firstNext = 0x111;
        uint256 secondNext = 0x222;
        _rotate("", firstNext, 1);
        bytes memory stale = _rotateCallData("", secondNext, 1);
        nextRevert = abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA24 signature error");
        _submit(stale, 0xA11CE, 1);
        assertEq(account.hotSigner(), vm.addr(firstNext));
        assertEq(account.generation(), 1);
    }

    function test_A05_consumedNonceCannotBeReplayed() public {
        _rotate("", 0x111, 1);
        uint256 nonce = entryPoint.getNonce(address(account), 0);
        assertEq(uint64(nonce), 1);
        bytes memory again = _rotateCallData("", 0x333, 1);
        nextRevert = abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA25 invalid account nonce");
        _submitAtNonce(again, hotKey, hotType, nonce - 1);
        assertEq(account.generation(), 1);
    }

    function test_A06_innerRevertRotatesAndDoesNotMoveAssets() public {
        uint256 sinkBefore = address(sink).balance;
        address previous = account.hotSigner();
        _rotate(_batch(address(sink), 1 ether, abi.encodeCall(Sink.fail, ())), 0x111, 1);
        assertTrue(account.hotSigner() != previous);
        assertEq(address(sink).balance, sinkBefore);
        assertEq(sink.received(), 0);
        assertEq(account.generation(), 1);
    }

    function test_A07_validationRevertDoesNotRotate() public {
        address previous = account.hotSigner();
        uint64 gen = account.generation();
        bytes memory callData = _rotateCallData("", 0x111, 1);
        nextRevert = abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA24 signature error");
        _submit(callData, 0x999, 1);
        assertEq(account.hotSigner(), previous);
        assertEq(account.generation(), gen);
    }

    function test_A08_revertedBundleRestoresSigner() public {
        address previous = account.hotSigner();
        uint256 snap = vm.snapshotState();
        _rotate("", 0x111, 1);
        assertTrue(account.hotSigner() != previous);
        vm.revertToState(snap);
        assertEq(account.hotSigner(), previous);
        assertEq(account.generation(), 0);
    }

    function test_A09_recoveryWithoutDepositOrKnoad() public {
        KnoadAccount bare = OpenAccount.open(factory, recoveryKey, vm.addr(0x777), 1, 9);
        assertEq(address(bare).balance, 0);
        assertEq(entryPoint.balanceOf(address(bare)), 0);
        uint256 freshHot = 0x888;
        KnoadAccount.RecoveryRequest memory request = KnoadAccount.RecoveryRequest({
            account: address(bare),
            chainId: block.chainid,
            newHotSigner: vm.addr(freshHot),
            newHotKeyType: 1,
            nextRecoveryAuthority: vm.addr(0x999),
            recoveryEpoch: 0,
            authorityNonce: 0,
            deadline: uint64(block.timestamp + 1 days)
        });
        bytes32 digest = bare.recoveryDigest(request);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(recoveryKey, digest);
        address payer = makeAddr("anyone");
        vm.prank(payer);
        bare.recover(request, abi.encodePacked(r, s, v));
        assertEq(bare.hotSigner(), vm.addr(freshHot));
        assertEq(bare.recoveryAuthority(), vm.addr(0x999));
        assertEq(bare.recoveryEpoch(), 1);
        assertEq(bare.securityEpoch(), 2);
    }

    function test_A10_wrongRecoveryKeyRejected() public {
        address before = account.hotSigner();
        KnoadAccount.RecoveryRequest memory request = _request(vm.addr(0x1234), 1, address(0));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, account.recoveryDigest(request));
        vm.expectRevert(KnoadAccount.BadRecoverySignature.selector);
        account.recover(request, abi.encodePacked(r, s, v));
        assertEq(account.hotSigner(), before);
    }

    function test_A11_hotSignerCannotEditRecovery() public {
        address recovery = account.recoveryAuthority();
        uint64 epoch = account.recoveryEpoch();
        Reenter reenter = new Reenter();
        _rotate(_batch(address(reenter), 0, abi.encodeCall(Reenter.attack, (account, recovery))), 0x111, 1);
        assertTrue(reenter.entered());
        assertFalse(reenter.changedRecovery());
        assertEq(account.recoveryAuthority(), recovery);
        assertEq(account.recoveryEpoch(), epoch);

        bytes memory self = _batch(address(account), 0, abi.encodeCall(KnoadAccount.executeUpgrade, ()));
        _rotate(self, 0x222, 1);
        assertEq(account.recoveryAuthority(), recovery);
    }

    function test_A12_recoveryReplayRejected() public {
        (KnoadAccount.RecoveryRequest memory request, bytes memory sig) = _signedRecovery(vm.addr(0x1234), 1, vm.addr(0x222));
        account.recover(request, sig);
        vm.expectRevert(KnoadAccount.StaleAuthority.selector);
        account.recover(request, sig);
    }

    function test_A13_factoryFrontRunCannotSubstituteAuthority() public {
        address recovery = vm.addr(0x10);
        address hot = vm.addr(0x11);
        address predicted = factory.predict(recovery, 4);
        address other = address(OpenAccount.open(factory, 0x12, hot, 1, 4));
        assertTrue(other != predicted);
        KnoadAccount created = OpenAccount.open(factory, 0x10, hot, 1, 4);
        assertEq(address(created), predicted);
        assertEq(created.recoveryAuthority(), recovery);
        assertEq(created.hotSigner(), hot);
        assertEq(address(OpenAccount.open(factory, 0x10, vm.addr(0x99), 1, 4)), predicted);
        assertEq(created.hotSigner(), hot);

        KnoadAccount impl = KnoadAccount(payable(factory.implementation()));
        KnoadAccount.Policy memory policy;
        vm.expectRevert();
        impl.initialize(recovery, 4, policy);
    }

    function test_activationRejectsADifferentSignerAndAnotherChain() public {
        uint256 key = 0x5151;
        address recovery = vm.addr(key);
        address hot = vm.addr(0x6161);
        address otherHot = vm.addr(0x6162);
        address predicted = factory.predict(recovery, 8);
        uint256 origin = block.chainid;
        bytes32 digest = factory.activationDigest(predicted, hot, 1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        vm.expectRevert(KnoadAccount.BadRecoverySignature.selector);
        factory.createAccount(recovery, 8, _activation(otherHot, signature));
        assertEq(predicted.code.length, 0);

        vm.chainId(origin == 8453 ? 1 : 8453);
        vm.expectRevert(KnoadAccount.BadRecoverySignature.selector);
        factory.createAccount(recovery, 8, _activation(hot, signature));
        assertEq(predicted.code.length, 0);

        vm.chainId(origin);
        KnoadAccount created = factory.createAccount(recovery, 8, _activation(hot, signature));
        assertEq(address(created), predicted);
        assertEq(created.hotSigner(), hot);
        assertEq(factory.predict(recovery, 8), factory.predict(recovery, 8));
        assertTrue(factory.predict(recovery, 8) != factory.predict(recovery, 9));
    }

    function test_writeActivationDigestFixture() public {
        address signer = address(0x4444);
        bytes32 digest = account.activationDigest(signer, 1);
        string memory json = string.concat(
            '{"account":"',
            vm.toString(address(account)),
            '","chainId":"',
            vm.toString(block.chainid),
            '","initialSigner":"',
            vm.toString(signer),
            '","keyType":1,"digest":"',
            vm.toString(uint256(digest)),
            '"}'
        );
        vm.writeFile("test-vectors/activation-digest-fixture.json", json);
        assertEq(digest, factory.activationDigest(address(account), signer, 1));
    }

    function test_twoOpsInOneBundleBothExecute() public {
        uint256 before = sink.received();
        bytes memory first = _rotateCallData(_batch(address(sink), 1, abi.encodeCall(Sink.take, ())), 0x111, 1);
        bytes memory second = _rotateCallData(_batch(address(sink), 2, abi.encodeCall(Sink.take, ())), 0x222, 1);
        PackedUserOperation[] memory ops = new PackedUserOperation[](2);
        ops[0] = _op(first, hotKey, hotType, 0);
        ops[1] = _op(second, 0x111, 1, 1);
        vm.prank(bundler, bundler);
        entryPoint.handleOps(ops, bundler);
        assertEq(sink.received(), before + 3);
        assertEq(account.hotSigner(), vm.addr(0x222));
        assertEq(account.generation(), 2);
    }

    function test_recoveryBetweenValidationAndExecutionBlocksTheCalls() public {
        uint256 before = sink.received();
        bytes memory callData = _rotateCallData(_batch(address(sink), 1 ether, abi.encodeCall(Sink.take, ())), 0x111, 1);
        PackedUserOperation memory op = _op(callData, hotKey, hotType, 0);
        bytes32 userOpHash = entryPoint.getUserOpHash(op);
        vm.prank(address(entryPoint));
        (bool ok, bytes memory ret) = address(account).call(
            abi.encodeWithSelector(account.validateUserOp.selector, op, userOpHash, uint256(0))
        );
        assertTrue(ok);
        assertEq(abi.decode(ret, (uint256)), 0);
        assertEq(account.hotSigner(), vm.addr(0x111));
        _recover(0xC0FFEE, 1, vm.addr(0xCAFE));
        bytes memory original = _etchCurrentOp(userOpHash);
        vm.prank(address(entryPoint));
        vm.expectRevert(KnoadAccount.ValidationRequired.selector);
        account.executeAndRotate(mode, _batch(address(sink), 1 ether, abi.encodeCall(Sink.take, ())), vm.addr(0x111), 1);
        _restoreEntryPoint(original);
        assertEq(sink.received(), before);
        assertEq(account.hotSigner(), vm.addr(0xC0FFEE));
    }

    function test_repeatedNextKeyInOneBundleAllExecute() public {
        uint256 before = sink.received();
        bytes memory first = _rotateCallData(_batch(address(sink), 1, abi.encodeCall(Sink.take, ())), 0x111, 1);
        bytes memory second = _rotateCallData(_batch(address(sink), 2, abi.encodeCall(Sink.take, ())), 0x222, 1);
        bytes memory third = _rotateCallData(_batch(address(sink), 4, abi.encodeCall(Sink.take, ())), 0x111, 1);
        PackedUserOperation[] memory ops = new PackedUserOperation[](3);
        ops[0] = _op(first, hotKey, hotType, 0);
        ops[1] = _op(second, 0x111, 1, 1);
        ops[2] = _op(third, 0x222, 1, 2);
        vm.prank(bundler, bundler);
        entryPoint.handleOps(ops, bundler);
        assertEq(sink.received(), before + 7);
        assertEq(account.hotSigner(), vm.addr(0x111));
        assertEq(account.generation(), 3);
    }

    function test_bindingSlotsAreZeroAfterExecution() public {
        bytes memory callData = _rotateCallData(_batch(address(sink), 1, abi.encodeCall(Sink.take, ())), 0x111, 1);
        PackedUserOperation memory op = _op(callData, hotKey, hotType, 0);
        bytes32 hash = entryPoint.getUserOpHash(op);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        entryPoint.handleOps(ops, bundler);
        assertEq(sink.received(), 1);
        bytes memory original = _etchCurrentOp(hash);
        vm.prank(address(entryPoint));
        vm.expectRevert(KnoadAccount.ValidationRequired.selector);
        account.executeAndRotate(mode, _batch(address(sink), 1, abi.encodeCall(Sink.take, ())), vm.addr(0x111), 1);
        _restoreEntryPoint(original);
        assertEq(sink.received(), 1);
    }

    function test_leftoverBindingCannotServeAnotherOp() public {
        uint256 before = sink.received();
        bytes memory callData = _rotateCallData(_batch(address(sink), 1, abi.encodeCall(Sink.fail, ())), 0x111, 1);
        PackedUserOperation memory op = _op(callData, hotKey, hotType, 0);
        bytes32 hash = entryPoint.getUserOpHash(op);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        entryPoint.handleOps(ops, bundler);
        assertEq(account.hotSigner(), vm.addr(0x111));
        assertEq(sink.received(), before);

        bytes memory original = _etchCurrentOp(keccak256("other-op"));
        vm.prank(address(entryPoint));
        vm.expectRevert(KnoadAccount.ValidationRequired.selector);
        account.executeAndRotate(mode, _batch(address(sink), 1, abi.encodeCall(Sink.take, ())), vm.addr(0x111), 1);
        assertEq(sink.received(), before);
        _restoreEntryPoint(original);

        original = _etchCurrentOp(hash);
        vm.prank(address(entryPoint));
        account.executeAndRotate(mode, _batch(address(sink), 1, abi.encodeCall(Sink.take, ())), vm.addr(0x111), 1);
        assertEq(sink.received(), before + 1);
        _restoreEntryPoint(original);
    }

    function test_mismatchedNextSignerArgsRevert() public {
        bytes memory callData = _rotateCallData("", 0x111, 1);
        PackedUserOperation memory op = _op(callData, hotKey, hotType, 0);
        bytes32 hash = entryPoint.getUserOpHash(op);
        vm.prank(address(entryPoint));
        (bool ok,) = address(account).call(
            abi.encodeWithSelector(account.validateUserOp.selector, op, hash, uint256(0))
        );
        assertTrue(ok);
        bytes memory original = _etchCurrentOp(hash);
        vm.prank(address(entryPoint));
        vm.expectRevert(KnoadAccount.ValidationRequired.selector);
        account.executeAndRotate(mode, "", vm.addr(0x222), 1);
        vm.prank(address(entryPoint));
        account.executeAndRotate(mode, "", vm.addr(0x111), 1);
        _restoreEntryPoint(original);
        assertEq(account.hotSigner(), vm.addr(0x111));
        assertEq(account.generation(), 1);
    }

    function test_vetoRecoveryUsesItsOwnBinding() public {
        KnoadAccount.Policy memory tight = KnoadAccount.Policy({
            periodLimit: 0,
            windowSeconds: 0,
            delaySeconds: 0,
            delayThreshold: 0,
            rejectUnlimitedApprovals: false,
            recoveryDelay: 1 days
        });
        KnoadAccount guarded = OpenAccount.openWithPolicy(factory, recoveryKey, vm.addr(hotKey), 1, 21, tight);
        vm.deal(address(guarded), 2 ether);
        entryPoint.depositTo{value: 1 ether}(address(guarded));
        KnoadAccount saved = account;
        account = guarded;

        (KnoadAccount.RecoveryRequest memory request, bytes memory sig) = _signedRecovery(vm.addr(0x99), 1, address(0));
        account.recover(request, sig);
        (uint8 kind,) = account.pendingAuthority();
        assertEq(kind, 1);

        bytes memory veto = abi.encodeCall(KnoadAccount.vetoRecovery, (vm.addr(0x46), uint8(1)));
        PackedUserOperation memory op = _op(veto, hotKey, hotType, 0);
        bytes32 hash = entryPoint.getUserOpHash(op);
        vm.prank(address(entryPoint));
        (bool ok,) = address(account).call(
            abi.encodeWithSelector(account.validateUserOp.selector, op, hash, uint256(0))
        );
        assertTrue(ok);
        bytes memory original = _etchCurrentOp(hash);
        vm.prank(address(entryPoint));
        vm.expectRevert(KnoadAccount.ValidationRequired.selector);
        account.vetoRecovery(vm.addr(0x47), 1);
        (kind,) = account.pendingAuthority();
        assertEq(kind, 1);
        vm.prank(address(entryPoint));
        account.vetoRecovery(vm.addr(0x46), 1);
        (kind,) = account.pendingAuthority();
        assertEq(kind, 0);
        assertEq(account.hotSigner(), vm.addr(0x46));
        vm.prank(address(entryPoint));
        vm.expectRevert(KnoadAccount.ValidationRequired.selector);
        account.vetoRecovery(vm.addr(0x46), 1);
        _restoreEntryPoint(original);

        account = saved;
    }

    function test_hotStorageSlotStaysTwo() public {
        bytes32 slot = vm.load(address(account), bytes32(uint256(2)));
        assertEq(address(uint160(uint256(slot))), account.hotSigner());
        assertEq(uint8(uint256(slot) >> 160), account.hotKeyType());
        assertEq(uint64(uint256(slot) >> 168), account.generation());
    }

    function test_firstUseHandleOpsInstallsTheSignedKey() public {
        uint256 rec = 0x8181;
        uint256 initial = 0x8182;
        address recovery = vm.addr(rec);
        address hot = vm.addr(initial);
        address predicted = factory.predict(recovery, 12);
        bytes memory initCode = _activationInit(rec, recovery, hot, 12);
        uint256 before = sink.received();
        bytes memory callData = _rotateCallData(_batch(address(sink), 1, abi.encodeCall(Sink.take, ())), 0x8183, 1);
        vm.deal(predicted, 2 ether);
        entryPoint.depositTo{value: 1 ether}(predicted);
        PackedUserOperation memory op = _opFor(predicted, callData, initial, 1, 0);
        op.initCode = initCode;
        op.signature = _sign(initial, 1, entryPoint.getUserOpHash(op));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        entryPoint.handleOps(ops, bundler);
        KnoadAccount created = KnoadAccount(payable(predicted));
        assertGt(predicted.code.length, 0);
        assertEq(created.hotSigner(), vm.addr(0x8183));
        assertEq(created.generation(), 1);
        assertEq(created.recoveryAuthority(), recovery);
        assertEq(sink.received(), before + 1);
    }

    function test_firstUseAfterFrontRunLeavesTheInstalledKey() public {
        uint256 key = 0x7171;
        address recovery = vm.addr(key);
        address hot = vm.addr(0x7172);
        address other = vm.addr(0x7173);
        KnoadAccount created = OpenAccount.open(factory, key, hot, 1, 11);
        bytes memory initCode = _activationInit(key, recovery, other, 11);
        bytes memory callData = _rotateCallData("", 0x7174, 1);
        vm.deal(address(created), 1 ether);
        entryPoint.depositTo{value: 1 ether}(address(created));
        PackedUserOperation memory op = _opFor(address(created), callData, 0x7173, 1, 0);
        op.initCode = initCode;
        op.signature = _sign(0x7173, 1, entryPoint.getUserOpHash(op));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.expectRevert(abi.encodeWithSignature("FailedOp(uint256,string)", 0, "AA24 signature error"));
        vm.prank(bundler, bundler);
        entryPoint.handleOps(ops, bundler);
        assertEq(created.hotSigner(), hot);
        assertEq(created.generation(), 0);
    }

    function test_A14_exactOrderSurvivesRotation() public {
        bytes32 digest = keccak256("seaport-order");
        address seaport = makeAddr("seaport");
        bytes memory data = _batch(
            address(account),
            0,
            abi.encodeCall(KnoadAccount.approveOrderDigest, (digest, seaport, uint64(block.timestamp + 7 days)))
        );
        _rotate(data, 0x111, 1);
        vm.prank(seaport);
        assertEq(account.isValidSignature(digest, ""), ERC1271_MAGIC);
        _rotate("", 0x222, 1);
        vm.prank(seaport);
        assertEq(account.isValidSignature(digest, ""), ERC1271_MAGIC);
        assertEq(account.hotSigner(), vm.addr(0x222));
    }

    function test_A15_orderAndPersonalSignDoNotReplayAcrossAccounts() public {
        bytes32 digest = keccak256("seaport-order");
        address seaport = makeAddr("seaport");
        _rotate(
            _batch(
                address(account),
                0,
                abi.encodeCall(KnoadAccount.approveOrderDigest, (digest, seaport, uint64(block.timestamp + 1 days)))
            ),
            0x111,
            1
        );
        KnoadAccount other = OpenAccount.open(factory, recoveryKey, vm.addr(0x333), 1, 5);
        vm.prank(seaport);
        assertEq(other.isValidSignature(digest, ""), bytes4(0xffffffff));

        bytes32 contents = MessageHashUtils.toEthSignedMessageHash(bytes("link-me"));
        bytes memory sig = _personalSign(contents);
        assertEq(account.isValidSignature(contents, sig), ERC1271_MAGIC);
        assertEq(other.isValidSignature(contents, sig), bytes4(0xffffffff));
        _rotate("", 0x444, 1);
        assertEq(account.isValidSignature(contents, sig), bytes4(0xffffffff));
    }

    function test_A16_nftApprovalCanBeRevoked() public {
        Mock721 nft = new Mock721();
        nft.mint(address(account), 1);
        address operator = makeAddr("operator");
        _rotate(_batch(address(nft), 0, abi.encodeWithSignature("setApprovalForAll(address,bool)", operator, true)), 0x111, 1);
        assertTrue(nft.isApprovedForAll(address(account), operator));
        _rotate(
            _batch(address(nft), 0, abi.encodeWithSignature("setApprovalForAll(address,bool)", operator, false)), 0x222, 1
        );
        assertFalse(nft.isApprovedForAll(address(account), operator));
    }

    function test_A17_standingAllowanceSurvivesRotation() public {
        Mock20 token = new Mock20();
        address spender = makeAddr("spender");
        _rotate(_batch(address(token), 0, abi.encodeWithSignature("approve(address,uint256)", spender, 5)), 0x111, 1);
        assertEq(token.allowance(address(account), spender), 5);
        _rotate("", 0x222, 1);
        assertEq(token.allowance(address(account), spender), 5);
    }

    function test_A18_callbackCannotBypassRecovery() public {
        address recovery = account.recoveryAuthority();
        Reenter reenter = new Reenter();
        _rotate(_batch(address(reenter), 0, abi.encodeCall(Reenter.attack, (account, recovery))), 0x111, 1);
        assertEq(account.recoveryAuthority(), recovery);
        assertFalse(reenter.changedRecovery());
    }

    function test_A19_strangerCanSubmitRecovery() public {
        address stranger = makeAddr("stranger");
        (KnoadAccount.RecoveryRequest memory request, bytes memory sig) = _signedRecovery(vm.addr(0x555), 1, address(0));
        vm.prank(stranger);
        account.recover(request, sig);
        assertEq(account.hotSigner(), vm.addr(0x555));
        assertEq(account.recoveryAuthority(), vm.addr(recoveryKey));
        assertEq(account.recoveryEpoch(), 0);
        assertEq(account.securityEpoch(), 2);
    }

    function test_p256HotKeyRotates() public {
        uint256 p256Key = 0x5150;
        _rotate("", p256Key, KnoadLib.KEY_P256);
        assertEq(account.hotKeyType(), KnoadLib.KEY_P256);
        assertEq(account.hotSigner(), _p256Address(p256Key));
        _rotate("", 0x6160, KnoadLib.KEY_P256);
        assertEq(account.hotSigner(), _p256Address(0x6160));
    }

    function test_spendLimitAndDelayAndVeto() public {
        KnoadAccount.Policy memory tight = KnoadAccount.Policy({
            periodLimit: 0,
            windowSeconds: 0,
            delaySeconds: 1 hours,
            delayThreshold: 1 ether,
            rejectUnlimitedApprovals: true,
            recoveryDelay: 1 days
        });
        KnoadAccount guarded = OpenAccount.openWithPolicy(factory, recoveryKey, vm.addr(0x42), 1, 3, tight);
        vm.deal(address(guarded), 20 ether);
        entryPoint.depositTo{value: 2 ether}(address(guarded));

        KnoadAccount saved = account;
        uint256 savedHot = hotKey;
        uint8 savedType = hotType;
        account = guarded;
        hotKey = 0x42;
        hotType = 1;

        _rotate(_batch(address(sink), 2 ether, abi.encodeCall(Sink.take, ())), 0x43, 1);
        assertEq(sink.received(), 0);
        (, uint64 readyAt) = account.pendingCalls();
        assertGt(readyAt, block.timestamp);
        vm.warp(readyAt);
        uint256 before = sink.received();
        _rotate(_batch(address(sink), 2 ether, abi.encodeCall(Sink.take, ())), 0x44, 1);
        assertEq(sink.received(), before + 2 ether);

        Mock20 token = new Mock20();
        _rotate(
            _batch(address(token), 0, abi.encodeWithSignature("approve(address,uint256)", address(sink), type(uint256).max)),
            0x45,
            1
        );
        assertFalse(token.approvedMax());

        (KnoadAccount.RecoveryRequest memory request, bytes memory sig) = _signedRecovery(vm.addr(0x99), 1, address(0));
        account.recover(request, sig);
        assertEq(account.hotSigner(), vm.addr(0x45));
        vm.expectRevert(KnoadAccount.NothingPending.selector);
        account.applyPendingAuthority();

        bytes memory veto = abi.encodeCall(KnoadAccount.vetoRecovery, (vm.addr(0x46), uint8(1)));
        _submit(veto, hotKey, hotType);
        hotKey = 0x46;
        hotType = 1;
        vm.expectRevert(KnoadAccount.NothingPending.selector);
        account.applyPendingAuthority();

        (request, sig) = _signedRecovery(vm.addr(0x99), 1, address(0));
        account.recover(request, sig);
        vm.warp(block.timestamp + 1 days);
        account.applyPendingAuthority();
        assertEq(account.hotSigner(), vm.addr(0x99));

        account = saved;
        hotKey = savedHot;
        hotType = savedType;
    }

    function test_upgradeIsRecoveryTimelocked() public {
        KnoadAccount nextImpl = new KnoadAccount(address(factory), verifier);
        uint64 readyAt = uint64(block.timestamp + 7 days);
        bytes32 codehash = address(nextImpl).codehash;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            recoveryKey,
            _upgradeDigest(address(nextImpl), codehash, readyAt, account.authorityNonce(), uint64(block.timestamp + 8 days))
        );
        account.scheduleUpgrade(
            address(nextImpl), codehash, readyAt, account.authorityNonce(), uint64(block.timestamp + 8 days), abi.encodePacked(r, s, v)
        );
        vm.expectRevert(KnoadAccount.UpgradeNotReady.selector);
        account.executeUpgrade();
        vm.warp(readyAt);
        account.executeUpgrade();
        address impl = address(uint160(uint256(vm.load(address(account), IMPL_SLOT))));
        assertEq(impl, address(nextImpl));

        vm.expectRevert();
        account.upgradeToAndCall(address(nextImpl), "");
    }

    function test_hotKeyCannotScheduleUpgrade() public {
        KnoadAccount nextImpl = new KnoadAccount(address(factory), verifier);
        uint64 readyAt = uint64(block.timestamp + 7 days);
        uint64 nonce = account.authorityNonce();
        uint64 deadline = uint64(block.timestamp + 8 days);
        bytes32 codehash = address(nextImpl).codehash;
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(hotKey, _upgradeDigest(address(nextImpl), codehash, readyAt, nonce, deadline));
        vm.expectRevert(KnoadAccount.BadRecoverySignature.selector);
        account.scheduleUpgrade(address(nextImpl), codehash, readyAt, nonce, deadline, abi.encodePacked(r, s, v));
    }

    function test_weakenPolicyIsDelayedAndTighteningIsImmediate() public {
        KnoadAccount.Policy memory delayed = KnoadAccount.Policy({
            periodLimit: 0,
            windowSeconds: 0,
            delaySeconds: 0,
            delayThreshold: 0,
            rejectUnlimitedApprovals: false,
            recoveryDelay: 2 days
        });
        _setPolicy(delayed);
        assertEq(account.recoveryDelay(), 2 days);

        KnoadAccount.Policy memory open = KnoadAccount.Policy({
            periodLimit: 0,
            windowSeconds: 0,
            delaySeconds: 0,
            delayThreshold: 0,
            rejectUnlimitedApprovals: false,
            recoveryDelay: 0
        });
        _setPolicy(open);
        assertEq(account.recoveryDelay(), 2 days);
        (uint8 kind,) = account.pendingAuthority();
        assertEq(kind, 2);
        vm.warp(block.timestamp + 2 days);
        account.applyPendingAuthority();
        assertEq(account.recoveryDelay(), 0);
    }

    function test_gas_transferAndRecovery() public {
        uint256 createGas = 0;
        uint256 g0 = gasleft();
        OpenAccount.open(factory, 1, vm.addr(0x2), 1, 77);
        createGas = g0 - gasleft();

        bytes memory callData = _rotateCallData(_batch(address(sink), 0.01 ether, abi.encodeCall(Sink.take, ())), 0x333, 1);
        uint256 g1 = gasleft();
        _submit(callData, hotKey, hotType);
        uint256 rotateGas = g1 - gasleft();

        (KnoadAccount.RecoveryRequest memory request, bytes memory sig) = _signedRecovery(vm.addr(0x444), 1, vm.addr(0x445));
        uint256 g2 = gasleft();
        account.recover(request, sig);
        uint256 recoverGas = g2 - gasleft();

        string memory body = string.concat(
            "# Gas measurements (Forge, local EVM)\n\n",
            "These figures include Forge call overhead around the measured call. They are not a mainnet fee quote. ",
            "Contract commit is this source tree. EntryPoint is v0.9, compiled with solc 0.8.28, optimizer 200.\n\n",
            "| Action | Gas |\n| --- | ---: |\n",
            "| createAccount | ",
            vm.toString(createGas),
            " |\n| ETH transfer + rotation (handleOps) | ",
            vm.toString(rotateGas),
            " |\n| direct recover | ",
            vm.toString(recoverGas),
            " |\n"
        );
        vm.writeFile("docs/gas-report.md", body);
        console2.log("create", createGas);
        console2.log("rotate", rotateGas);
        console2.log("recover", recoverGas);
    }

    /// @dev The smallest callGasLimit that lets one ETH payment finish, minus the payment itself.
    function test_executeOverheadLeavesRoomForThePayment() public {
        PayableReceiver deployed = new PayableReceiver();
        address receiver = makeAddr("payable-receiver");
        vm.etch(receiver, address(deployed).code);

        uint256 minimum = _minimumPaymentGas(receiver);
        uint256 direct = _directPaymentGas(receiver);
        uint256 overhead = minimum > direct ? minimum - direct : minimum;
        console2.log("payment-minimum", minimum);
        console2.log("payment-direct", direct);
        console2.log("payment-overhead", overhead);

        assertGt(minimum, direct, "the account work is larger than the payment");
        assertLe(overhead, 50_000, "raise EXECUTE_OVERHEAD");
    }

}
