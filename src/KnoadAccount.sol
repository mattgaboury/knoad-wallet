// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEntryPoint, PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Account} from "@openzeppelin/contracts/account/Account.sol";
import {ERC7821} from "@openzeppelin/contracts/account/extensions/draft-ERC7821.sol";
import {ERC4337Utils} from "@openzeppelin/contracts/account/utils/ERC4337Utils.sol";
import {ERC7579Utils, Execution} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ERC7739} from "@openzeppelin/contracts/utils/cryptography/signers/draft-ERC7739.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {IKnoadRecoveryVerifier} from "./IKnoadRecoveryVerifier.sol";
import {KnoadLib} from "./KnoadLib.sol";

/// @title KnoadAccount
/// @notice ERC-4337 account. The address is stable. The hot signer rotates inside
///         validateUserOp, so a signature that is included retires that key even
///         when the business calls revert. Recovery is a separate direct call.
/// @dev EntryPoint v0.9 publishes the hash of the operation it is executing.
interface ICurrentUserOpHash {
    function getCurrentUserOpHash() external view returns (bytes32);
}

/// @dev Spec 1.4. EntryPoint is pinned to v0.9 (OpenZeppelin Account 5.7).
contract KnoadAccount is Initializable, Account, ERC7821, ERC7739, UUPSUpgradeable, ERC721Holder, ERC1155Holder {
    uint8 private constant _KIND_RECOVERY = 1;
    uint8 private constant _KIND_POLICY = 2;
    uint256 public constant MAX_CALLS = 8;
    uint64 public constant MIN_UPGRADE_DELAY = 7 days;
    bytes4 private constant _EXECUTE_AND_ROTATE = bytes4(keccak256("executeAndRotate(bytes32,bytes,address,uint8)"));
    bytes4 private constant _VETO_RECOVERY = bytes4(keccak256("vetoRecovery(address,uint8)"));
    bytes4 private constant _APPROVE_ORDER = bytes4(keccak256("approveOrderDigest(bytes32,address,uint64)"));
    bytes4 private constant _REVOKE_ORDER = bytes4(keccak256("revokeOrderDigest(bytes32)"));
    bytes4 private constant _ERC20_APPROVE = 0x095ea7b3;
    bytes32 private constant _RECOVERY_TYPEHASH = keccak256(
        "Recovery(address account,uint256 chainId,address newHotSigner,uint8 newHotKeyType,address nextRecoveryAuthority,uint64 recoveryEpoch,uint64 authorityNonce,uint64 deadline)"
    );
    bytes32 private constant _POLICY_TYPEHASH = keccak256(
        "Policy(uint128 periodLimit,uint64 windowSeconds,uint64 delaySeconds,uint128 delayThreshold,bool rejectUnlimitedApprovals,uint64 recoveryDelay,address account,uint256 chainId,uint64 authorityNonce,uint64 deadline)"
    );
    bytes32 private constant _UPGRADE_TYPEHASH = keccak256(
        "ScheduleUpgrade(address account,uint256 chainId,address newImplementation,bytes32 codehash,uint64 readyAt,uint64 authorityNonce,uint64 deadline)"
    );
    bytes32 private constant _CANCEL_UPGRADE_TYPEHASH = keccak256(
        "CancelUpgrade(address account,uint256 chainId,address pendingImplementation,uint64 authorityNonce,uint64 deadline)"
    );
    bytes32 private constant _ACTIVATE_TYPEHASH = keccak256(
        "Activate(address account,uint256 chainId,address initialSigner,uint8 keyType)"
    );

    struct Policy {
        uint128 periodLimit;
        uint64 windowSeconds;
        uint64 delaySeconds;
        uint128 delayThreshold;
        bool rejectUnlimitedApprovals;
        uint64 recoveryDelay;
    }

    struct RecoveryRequest {
        address account;
        uint256 chainId;
        address newHotSigner;
        uint8 newHotKeyType;
        address nextRecoveryAuthority;
        uint64 recoveryEpoch;
        uint64 authorityNonce;
        uint64 deadline;
    }

    struct OrderGrant {
        address verifier;
        uint64 expiry;
        uint64 securityEpoch;
    }

    address public immutable factory;
    IKnoadRecoveryVerifier public immutable recoveryVerifier;

    uint256 private _hot;
    address private _recoveryAuthority;
    uint64 private _recoveryEpoch;
    uint64 private _authorityNonce;
    uint64 private _securityEpoch;
    uint64 private _recoveryDelay;

    uint128 private _periodLimit;
    uint64 private _windowSeconds;
    uint64 private _delaySeconds;
    uint128 private _delayThreshold;
    bool private _rejectUnlimited;
    uint128 private _spent;
    uint64 private _windowStart;

    bytes32 private _pendingCallsHash;
    uint64 private _pendingCallsReadyAt;

    uint8 private _pendingKind;
    uint64 private _pendingReadyAt;
    address private _pendingHot;
    uint8 private _pendingHotType;
    address private _pendingRecovery;
    Policy private _pendingPolicy;

    address private _pendingImpl;
    bytes32 private _pendingCodehash;
    uint64 private _upgradeReadyAt;
    address private _authorizedImpl;
    uint256 private _locked;

    mapping(bytes32 digest => OrderGrant grant) private _grants;

    error ZeroAddress();
    error InvalidPolicy();
    error InvalidKey();
    error UnsupportedOperation();
    error ValidationRequired();
    error SelfCallForbidden();
    error TooManyCalls();
    error SpendLimitExceeded();
    error UnlimitedApprovalRejected();
    error BadRecoverySignature();
    error StaleAuthority();
    error Expired();
    error PendingAuth(uint8 kind);
    error NothingPending();
    error UpgradeNotReady();
    error UpgradeNotAuthorized();
    error ReentrancyGuard();
    error OnlyFactory();

    event RotationApplied(address indexed previousSigner, address indexed newSigner, uint8 keyType, uint64 generation);
    event CallsExecuted(bytes32 indexed callsHash, uint256 callCount, uint256 totalValue);
    event CallsDelayed(bytes32 indexed callsHash, uint64 readyAt);
    event Recovered(
        address indexed newHotSigner, address indexed recoveryAuthority, uint64 recoveryEpoch, uint64 securityEpoch
    );
    event AuthorityScheduled(uint8 indexed kind, uint64 readyAt);
    event AuthorityVetoed(uint64 generation);
    event PolicyUpdated(uint128 periodLimit, uint64 recoveryDelay, bool rejectUnlimitedApprovals);
    event OrderApproved(bytes32 indexed digest, address indexed verifier, uint64 expiry, uint64 securityEpoch);
    event OrderRevoked(bytes32 indexed digest);
    event UpgradeScheduled(address indexed newImplementation, bytes32 codehash, uint64 readyAt);
    event UpgradeCancelled(address indexed newImplementation);
    event AccountInitialized(address indexed recoveryAuthority, address indexed initialHotSigner, uint8 keyType);

    constructor(address factory_, IKnoadRecoveryVerifier verifier_) EIP712("KNOAD Wallet", "1") {
        if (factory_ == address(0) || address(verifier_) == address(0)) revert ZeroAddress();
        factory = factory_;
        recoveryVerifier = verifier_;
        _disableInitializers();
    }

    /// @dev The address commits to the recovery authority, the index, and the policy.
    ///      The chain's first spending key is installed in the same transaction.
    function initialize(address recoveryAuthority_, uint256, Policy calldata policy) external initializer {
        if (msg.sender != factory) revert OnlyFactory();
        if (recoveryAuthority_ == address(0)) revert ZeroAddress();
        _validatePolicy(policy);
        _recoveryAuthority = recoveryAuthority_;
        _securityEpoch = 1;
        _applyPolicy(policy);
    }

    /// @dev Factory only, and only while no spending key is set. A second call cannot replace it.
    ///      No timestamp: this runs inside validation, and the signature cannot be reused once a key is set.
    function installInitialSigner(address initialSigner, uint8 keyType, bytes calldata signature) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (hotSigner() != address(0)) revert InvalidKey();
        if (initialSigner == address(0)) revert ZeroAddress();
        if (!KnoadLib.validKeyType(keyType)) revert InvalidKey();
        if (!recoveryVerifier.verify(_recoveryAuthority, activationDigest(initialSigner, keyType), signature)) {
            revert BadRecoverySignature();
        }
        _hot = KnoadLib.pack(initialSigner, keyType, 0);
        emit AccountInitialized(_recoveryAuthority, initialSigner, keyType);
    }

    function activationDigest(address initialSigner, uint8 keyType) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(_ACTIVATE_TYPEHASH, address(this), block.chainid, initialSigner, keyType))
        );
    }

    function entryPoint() public view override returns (IEntryPoint) {
        return ERC4337Utils.ENTRYPOINT_V09;
    }

    function hotSigner() public view returns (address) {
        return KnoadLib.signer(_hot);
    }

    function hotKeyType() public view returns (uint8) {
        return KnoadLib.keyType(_hot);
    }

    function generation() public view returns (uint64) {
        return KnoadLib.generation(_hot);
    }

    function recoveryAuthority() public view returns (address) {
        return _recoveryAuthority;
    }

    function recoveryEpoch() public view returns (uint64) {
        return _recoveryEpoch;
    }

    function authorityNonce() public view returns (uint64) {
        return _authorityNonce;
    }

    function securityEpoch() public view returns (uint64) {
        return _securityEpoch;
    }

    function recoveryDelay() public view returns (uint64) {
        return _recoveryDelay;
    }

    function spendPolicy()
        public
        view
        returns (uint128 periodLimit, uint64 windowSeconds, uint64 delaySeconds, uint128 delayThreshold, bool rejectUnlimitedApprovals, uint128 spent)
    {
        return (_periodLimit, _windowSeconds, _delaySeconds, _delayThreshold, _rejectUnlimited, _spent);
    }

    function pendingCalls() public view returns (bytes32 callsHash, uint64 readyAt) {
        return (_pendingCallsHash, _pendingCallsReadyAt);
    }

    function pendingAuthority() public view returns (uint8 kind, uint64 readyAt) {
        return (_pendingKind, _pendingReadyAt);
    }

    function pendingUpgrade() public view returns (address implementation, uint64 readyAt) {
        return (_pendingImpl, _upgradeReadyAt);
    }

    function signerAddressForP256(bytes32 qx, bytes32 qy) external pure returns (address) {
        return KnoadLib.p256Signer(qx, qy);
    }

    function orderGrant(bytes32 digest) external view returns (OrderGrant memory) {
        return _grants[digest];
    }

    /// @dev Hot path. `nextSigner` is inside the signed calldata. Rotation itself
    ///      happens in {validateUserOp}, before these calls run.
    function executeAndRotate(bytes32 mode, bytes calldata executionData, address nextSigner, uint8 nextKeyType)
        external
        payable
        onlyEntryPoint
    {
        _consumeValidation(nextSigner, nextKeyType);
        _run(mode, executionData);
    }

    /// @dev Hot-key veto of a scheduled recovery or a scheduled weakening of policy.
    function vetoRecovery(address nextSigner, uint8 nextKeyType) external onlyEntryPoint {
        _consumeValidation(nextSigner, nextKeyType);
        _clearPendingAuthority();
        emit AuthorityVetoed(generation());
    }

    /// @inheritdoc ERC7821
    function execute(bytes32, bytes calldata) public payable override {
        revert UnsupportedOperation();
    }

    function _erc7821AuthorizedExecutor(address, bytes32, bytes calldata) internal pure override returns (bool) {
        return false;
    }

    function recover(RecoveryRequest calldata request, bytes calldata signature) external {
        _checkLock();
        _verifyRecovery(request, signature);
        _authorityNonce += 1;
        if (_recoveryDelay == 0) {
            _applyRecovery(request.newHotSigner, request.newHotKeyType, request.nextRecoveryAuthority);
            return;
        }
        if (_pendingKind != 0) revert PendingAuth(_pendingKind);
        _pendingKind = _KIND_RECOVERY;
        _pendingReadyAt = uint64(block.timestamp) + _recoveryDelay;
        _pendingHot = request.newHotSigner;
        _pendingHotType = request.newHotKeyType;
        _pendingRecovery = request.nextRecoveryAuthority;
        emit AuthorityScheduled(_KIND_RECOVERY, _pendingReadyAt);
    }

    function setPolicy(Policy calldata policy, uint64 nonce, uint64 deadline, bytes calldata signature) external {
        _checkLock();
        if (block.timestamp > deadline) revert Expired();
        if (nonce != _authorityNonce) revert StaleAuthority();
        _validatePolicy(policy);
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _POLICY_TYPEHASH,
                    policy.periodLimit,
                    policy.windowSeconds,
                    policy.delaySeconds,
                    policy.delayThreshold,
                    policy.rejectUnlimitedApprovals,
                    policy.recoveryDelay,
                    address(this),
                    block.chainid,
                    nonce,
                    deadline
                )
            )
        );
        if (!recoveryVerifier.verify(_recoveryAuthority, digest, signature)) revert BadRecoverySignature();
        _authorityNonce += 1;
        if (!_isWeaken(policy) || _recoveryDelay == 0) {
            _applyPolicy(policy);
            return;
        }
        if (_pendingKind != 0) revert PendingAuth(_pendingKind);
        _pendingKind = _KIND_POLICY;
        _pendingReadyAt = uint64(block.timestamp) + _recoveryDelay;
        _pendingPolicy = policy;
        emit AuthorityScheduled(_KIND_POLICY, _pendingReadyAt);
    }

    function applyPendingAuthority() external {
        _checkLock();
        if (_pendingKind == 0 || block.timestamp < _pendingReadyAt) revert NothingPending();
        uint8 kind = _pendingKind;
        if (kind == _KIND_RECOVERY) {
            address newHot = _pendingHot;
            uint8 newType = _pendingHotType;
            address nextRecovery = _pendingRecovery;
            _clearPendingAuthority();
            _applyRecovery(newHot, newType, nextRecovery);
        } else if (kind == _KIND_POLICY) {
            Policy memory policy = _pendingPolicy;
            _clearPendingAuthority();
            _applyPolicy(policy);
        } else {
            revert NothingPending();
        }
    }

    function scheduleUpgrade(
        address newImplementation,
        bytes32 codehash,
        uint64 readyAt,
        uint64 nonce,
        uint64 deadline,
        bytes calldata signature
    ) external {
        _checkLock();
        if (newImplementation == address(0)) revert ZeroAddress();
        if (newImplementation.codehash != codehash) revert UpgradeNotAuthorized();
        if (readyAt < block.timestamp + MIN_UPGRADE_DELAY) revert UpgradeNotReady();
        if (block.timestamp > deadline) revert Expired();
        if (nonce != _authorityNonce) revert StaleAuthority();
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _UPGRADE_TYPEHASH, address(this), block.chainid, newImplementation, codehash, readyAt, nonce, deadline
                )
            )
        );
        if (!recoveryVerifier.verify(_recoveryAuthority, digest, signature)) revert BadRecoverySignature();
        _authorityNonce += 1;
        _pendingImpl = newImplementation;
        _pendingCodehash = codehash;
        _upgradeReadyAt = readyAt;
        emit UpgradeScheduled(newImplementation, codehash, readyAt);
    }

    function cancelUpgrade(uint64 nonce, uint64 deadline, bytes calldata signature) external {
        _checkLock();
        if (_pendingImpl == address(0)) revert NothingPending();
        if (block.timestamp > deadline) revert Expired();
        if (nonce != _authorityNonce) revert StaleAuthority();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(_CANCEL_UPGRADE_TYPEHASH, address(this), block.chainid, _pendingImpl, nonce, deadline))
        );
        if (!recoveryVerifier.verify(_recoveryAuthority, digest, signature)) revert BadRecoverySignature();
        _authorityNonce += 1;
        address impl = _pendingImpl;
        _pendingImpl = address(0);
        _pendingCodehash = 0;
        _upgradeReadyAt = 0;
        emit UpgradeCancelled(impl);
    }

    function executeUpgrade() external {
        _checkLock();
        address impl = _pendingImpl;
        if (impl == address(0) || block.timestamp < _upgradeReadyAt) revert UpgradeNotReady();
        if (impl.codehash != _pendingCodehash) revert UpgradeNotAuthorized();
        _pendingImpl = address(0);
        _pendingCodehash = 0;
        _upgradeReadyAt = 0;
        _authorizedImpl = impl;
        upgradeToAndCall(impl, "");
        _authorizedImpl = address(0);
    }

    function approveOrderDigest(bytes32 digest, address verifier, uint64 expiry) external {
        if (msg.sender != address(this)) revert SelfCallForbidden();
        if (verifier == address(0) || expiry <= block.timestamp) revert InvalidPolicy();
        _grants[digest] = OrderGrant(verifier, expiry, _securityEpoch);
        emit OrderApproved(digest, verifier, expiry, _securityEpoch);
    }

    function revokeOrderDigest(bytes32 digest) external {
        if (msg.sender != address(this)) revert SelfCallForbidden();
        delete _grants[digest];
        emit OrderRevoked(digest);
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) public view override returns (bytes4) {
        OrderGrant memory grant = _grants[hash];
        if (
            grant.expiry != 0 && grant.securityEpoch == _securityEpoch && block.timestamp <= grant.expiry
                && msg.sender == grant.verifier
        ) {
            return IERC1271.isValidSignature.selector;
        }
        return super.isValidSignature(hash, signature);
    }

    function recoveryDigest(RecoveryRequest calldata request) external view returns (bytes32) {
        return _recoveryDigest(request);
    }

    function _validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, bytes calldata signature)
        internal
        override
        returns (uint256)
    {
        if (uint192(userOp.nonce >> 64) != 0 || uint64(userOp.nonce) != generation()) {
            return ERC4337Utils.SIG_VALIDATION_FAILED;
        }
        (address nextSigner, uint8 nextKeyType) = _readNext(userOp.callData);
        if (!KnoadLib.validKeyType(nextKeyType) || nextSigner == address(0) || nextSigner == hotSigner()) {
            return ERC4337Utils.SIG_VALIDATION_FAILED;
        }
        if (!_rawSignatureValidation(userOpHash, signature)) return ERC4337Utils.SIG_VALIDATION_FAILED;

        address previous = hotSigner();
        uint64 nextGeneration = uint64(userOp.nonce) + 1;
        _hot = KnoadLib.pack(nextSigner, nextKeyType, nextGeneration);
        _bindValidation(userOpHash, nextSigner, nextKeyType);
        emit RotationApplied(previous, nextSigner, nextKeyType, nextGeneration);
        return ERC4337Utils.SIG_VALIDATION_SUCCESS;
    }

    function _rawSignatureValidation(bytes32 hash, bytes calldata signature) internal view override returns (bool) {
        uint8 keyType = hotKeyType();
        address current = hotSigner();
        if (keyType == KnoadLib.KEY_SECP256K1) {
            if (signature.length != 65) return false;
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(hash, signature);
            return err == ECDSA.RecoverError.NoError && recovered == current;
        }
        if (keyType == KnoadLib.KEY_P256) {
            if (signature.length != 128) return false;
            bytes32 r = bytes32(signature[0:32]);
            bytes32 s = bytes32(signature[32:64]);
            bytes32 qx = bytes32(signature[64:96]);
            bytes32 qy = bytes32(signature[96:128]);
            if (KnoadLib.p256Signer(qx, qy) != current) return false;
            return P256.verifyNative(hash, r, s, qx, qy);
        }
        return false;
    }

    function _authorizeUpgrade(address newImplementation) internal view override {
        if (newImplementation == address(0) || newImplementation != _authorizedImpl) revert UpgradeNotAuthorized();
    }

    function _readNext(bytes calldata callData) internal pure returns (address nextSigner, uint8 nextKeyType) {
        if (callData.length < 4) revert UnsupportedOperation();
        bytes4 selector = bytes4(callData[0:4]);
        if (selector == _EXECUTE_AND_ROTATE) {
            if (callData.length < 4 + 128) revert UnsupportedOperation();
            nextSigner = address(bytes20(callData[4 + 64 + 12:4 + 96]));
            nextKeyType = uint8(callData[4 + 96 + 31]);
        } else if (selector == _VETO_RECOVERY) {
            if (callData.length < 4 + 64) revert UnsupportedOperation();
            nextSigner = address(bytes20(callData[4 + 12:4 + 32]));
            nextKeyType = uint8(callData[4 + 32 + 31]);
        } else {
            revert UnsupportedOperation();
        }
    }

    /// @dev One transient binding per operation, keyed by the userOp hash validation received.
    ///      The args slot commits to the next signer. The epoch slot holds the security epoch.
    ///      A later operation has a different hash, so it cannot clear or satisfy this one.
    function _bindValidation(bytes32 userOpHash, address nextSigner, uint8 nextKeyType) internal {
        bytes32 argsSlot = KnoadLib.validationArgsSlot(userOpHash);
        bytes32 epochSlot = KnoadLib.validationEpochSlot(userOpHash);
        uint256 args = uint256(KnoadLib.validationArgs(nextSigner, nextKeyType));
        uint256 epoch = _securityEpoch;
        assembly ("memory-safe") {
            tstore(argsSlot, args)
            tstore(epochSlot, epoch)
        }
    }

    /// @dev Consume the binding for the operation the EntryPoint is executing.
    ///      A recovery that landed after validation changed the security epoch, so the calls do not run.
    function _consumeValidation(address nextSigner, uint8 nextKeyType) internal {
        bytes32 userOpHash = ICurrentUserOpHash(address(entryPoint())).getCurrentUserOpHash();
        bytes32 argsSlot = KnoadLib.validationArgsSlot(userOpHash);
        bytes32 epochSlot = KnoadLib.validationEpochSlot(userOpHash);
        uint256 storedArgs;
        uint256 epoch;
        assembly ("memory-safe") {
            storedArgs := tload(argsSlot)
            tstore(argsSlot, 0)
            epoch := tload(epochSlot)
            tstore(epochSlot, 0)
        }
        if (
            storedArgs != uint256(KnoadLib.validationArgs(nextSigner, nextKeyType)) || epoch == 0
                || uint64(epoch) != _securityEpoch
        ) revert ValidationRequired();
    }

    function _run(bytes32 mode, bytes calldata executionData) internal {
        if (!supportsExecutionMode(mode)) revert ERC7821.UnsupportedExecutionMode();
        if (executionData.length == 0) {
            emit CallsExecuted(bytes32(0), 0, 0);
            return;
        }
        Execution[] calldata batch = ERC7579Utils.decodeBatch(executionData);
        uint256 length = batch.length;
        if (length == 0 || length > MAX_CALLS) revert TooManyCalls();
        uint256 totalValue;
        for (uint256 i; i < length; ++i) {
            totalValue += batch[i].value;
            _checkCall(batch[i].target, batch[i].callData);
        }
        bytes32 callsHash = keccak256(executionData);
        if (_delayThreshold > 0 && totalValue > _delayThreshold) {
            if (!(_pendingCallsHash == callsHash && block.timestamp >= _pendingCallsReadyAt)) {
                _pendingCallsHash = callsHash;
                _pendingCallsReadyAt = uint64(block.timestamp) + _delaySeconds;
                emit CallsDelayed(callsHash, _pendingCallsReadyAt);
                return;
            }
            _pendingCallsHash = 0;
            _pendingCallsReadyAt = 0;
        }
        _accountSpend(totalValue);
        _locked = 1;
        for (uint256 i; i < length; ++i) {
            _call(batch[i].target, batch[i].value, batch[i].callData);
        }
        _locked = 0;
        emit CallsExecuted(callsHash, length, totalValue);
    }

    function _checkCall(address target, bytes calldata data) internal view {
        if (target == address(0)) revert SelfCallForbidden();
        if (target == address(this)) {
            if (data.length < 4) revert SelfCallForbidden();
            bytes4 selector = bytes4(data[0:4]);
            if (selector != _APPROVE_ORDER && selector != _REVOKE_ORDER) revert SelfCallForbidden();
            return;
        }
        if (_rejectUnlimited && data.length >= 68 && bytes4(data[0:4]) == _ERC20_APPROVE) {
            uint256 amount = uint256(bytes32(data[36:68]));
            if (amount == type(uint256).max) revert UnlimitedApprovalRejected();
        }
    }

    function _accountSpend(uint256 totalValue) internal {
        if (_periodLimit == 0 || totalValue == 0) return;
        if (block.timestamp >= uint256(_windowStart) + _windowSeconds) {
            _windowStart = uint64(block.timestamp);
            _spent = 0;
        }
        if (totalValue > type(uint128).max || uint256(_spent) + totalValue > _periodLimit) revert SpendLimitExceeded();
        _spent += uint128(totalValue);
    }

    function _call(address target, uint256 value, bytes calldata data) internal {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            calldatacopy(ptr, data.offset, data.length)
            let ok := call(gas(), target, value, ptr, data.length, 0, 0)
            if iszero(ok) {
                let size := returndatasize()
                if gt(size, 256) { size := 256 }
                returndatacopy(ptr, 0, size)
                revert(ptr, size)
            }
        }
    }

    function _verifyRecovery(RecoveryRequest calldata request, bytes calldata signature) internal view {
        if (request.account != address(this) || request.chainId != block.chainid) revert StaleAuthority();
        if (request.recoveryEpoch != _recoveryEpoch || request.authorityNonce != _authorityNonce) revert StaleAuthority();
        if (block.timestamp > request.deadline) revert Expired();
        if (!KnoadLib.validKeyType(request.newHotKeyType) || request.newHotSigner == address(0)) revert InvalidKey();
        if (request.newHotSigner == hotSigner()) revert InvalidKey();
        if (!recoveryVerifier.verify(_recoveryAuthority, _recoveryDigest(request), signature)) revert BadRecoverySignature();
    }

    function _recoveryDigest(RecoveryRequest calldata request) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _RECOVERY_TYPEHASH,
                    request.account,
                    request.chainId,
                    request.newHotSigner,
                    request.newHotKeyType,
                    request.nextRecoveryAuthority,
                    request.recoveryEpoch,
                    request.authorityNonce,
                    request.deadline
                )
            )
        );
    }

    function _applyRecovery(address newHotSigner, uint8 newHotKeyType, address nextRecoveryAuthority) internal {
        uint64 seq = uint64(entryPoint().getNonce(address(this), 0));
        _hot = KnoadLib.pack(newHotSigner, newHotKeyType, seq);
        _pendingCallsHash = 0;
        _pendingCallsReadyAt = 0;
        _securityEpoch += 1;
        if (nextRecoveryAuthority != address(0)) {
            if (nextRecoveryAuthority == _recoveryAuthority) revert InvalidKey();
            _recoveryAuthority = nextRecoveryAuthority;
            _recoveryEpoch += 1;
        }
        emit Recovered(newHotSigner, _recoveryAuthority, _recoveryEpoch, _securityEpoch);
    }

    function _applyPolicy(Policy memory policy) internal {
        _periodLimit = policy.periodLimit;
        _windowSeconds = policy.windowSeconds;
        _delaySeconds = policy.delaySeconds;
        _delayThreshold = policy.delayThreshold;
        _rejectUnlimited = policy.rejectUnlimitedApprovals;
        _recoveryDelay = policy.recoveryDelay;
        emit PolicyUpdated(policy.periodLimit, policy.recoveryDelay, policy.rejectUnlimitedApprovals);
    }

    function _isWeaken(Policy memory next) internal view returns (bool) {
        if (next.recoveryDelay < _recoveryDelay) return true;
        if (_periodLimit != 0 && (next.periodLimit == 0 || next.periodLimit > _periodLimit)) return true;
        if (_periodLimit != 0 && next.windowSeconds > _windowSeconds) return true;
        if (_delayThreshold != 0 && (next.delayThreshold == 0 || next.delayThreshold > _delayThreshold)) return true;
        if (_delayThreshold != 0 && next.delaySeconds < _delaySeconds) return true;
        if (_rejectUnlimited && !next.rejectUnlimitedApprovals) return true;
        return false;
    }

    function _validatePolicy(Policy memory policy) internal pure {
        if (policy.periodLimit > 0 && policy.windowSeconds == 0) revert InvalidPolicy();
        if (policy.delayThreshold > 0 && policy.delaySeconds == 0) revert InvalidPolicy();
    }

    function _clearPendingAuthority() internal {
        _pendingKind = 0;
        _pendingReadyAt = 0;
        _pendingHot = address(0);
        _pendingHotType = 0;
        _pendingRecovery = address(0);
        delete _pendingPolicy;
    }

    function _checkLock() internal view {
        if (_locked == 1) revert ReentrancyGuard();
    }
}
