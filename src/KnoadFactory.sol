// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IKnoadRecoveryVerifier} from "./IKnoadRecoveryVerifier.sol";
import {KnoadAccount} from "./KnoadAccount.sol";

/// @notice Deterministic account factory.
/// @dev The salt and the proxy creation code commit to the epoch-0 recovery
///      authority, the account index, and the creation policy. They do not
///      commit to a spending key, so each chain can install its own first key
///      at the same address. The recovery authority signs that key for this
///      chain. A different key, or a signature from another chain, does not
///      deploy. An account that already exists is returned unchanged.
contract KnoadFactory {
    bytes32 private constant _DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant _ACTIVATE_TYPEHASH = keccak256(
        "Activate(address account,uint256 chainId,address initialSigner,uint8 keyType)"
    );
    bytes32 private constant _NAME_HASH = keccak256("KNOAD Wallet");
    bytes32 private constant _VERSION_HASH = keccak256("1");

    address public immutable implementation;

    event AccountCreated(
        address indexed recoveryAuthority, address indexed account, address initialHotSigner, uint256 index
    );

    struct Activation {
        address initialSigner;
        uint8 keyType;
        bytes signature;
    }

    error ZeroAddress();

    constructor(IKnoadRecoveryVerifier verifier) {
        if (address(verifier) == address(0)) revert ZeroAddress();
        implementation = address(new KnoadAccount(address(this), verifier));
    }

    function createAccount(address recoveryAuthority, uint256 index, Activation calldata activation)
        external
        returns (KnoadAccount)
    {
        KnoadAccount.Policy memory policy;
        return createAccountWithPolicy(recoveryAuthority, index, policy, activation);
    }

    function createAccountWithPolicy(
        address recoveryAuthority,
        uint256 index,
        KnoadAccount.Policy memory policy,
        Activation calldata activation
    ) public returns (KnoadAccount account) {
        bytes32 salt_ = salt(recoveryAuthority, index, policy);
        bytes memory initData = abi.encodeCall(KnoadAccount.initialize, (recoveryAuthority, index, policy));
        address predicted = Create2.computeAddress(salt_, keccak256(_proxyInitCode(initData)));
        if (predicted.code.length > 0) return KnoadAccount(payable(predicted));

        account = KnoadAccount(payable(address(new ERC1967Proxy{salt: salt_}(implementation, initData))));
        account.installInitialSigner(activation.initialSigner, activation.keyType, activation.signature);
        emit AccountCreated(recoveryAuthority, address(account), activation.initialSigner, index);
    }

    function predict(address recoveryAuthority, uint256 index) external view returns (address) {
        KnoadAccount.Policy memory policy;
        return predictWithPolicy(recoveryAuthority, index, policy);
    }

    function predictWithPolicy(address recoveryAuthority, uint256 index, KnoadAccount.Policy memory policy)
        public
        view
        returns (address)
    {
        bytes memory initData = abi.encodeCall(KnoadAccount.initialize, (recoveryAuthority, index, policy));
        return Create2.computeAddress(salt(recoveryAuthority, index, policy), keccak256(_proxyInitCode(initData)));
    }

    function salt(address recoveryAuthority, uint256 index, KnoadAccount.Policy memory policy)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(recoveryAuthority, index, keccak256(abi.encode(policy))));
    }

    /// @dev Same digest the account checks, computed for an address that may not exist yet.
    function activationDigest(address account, address initialSigner, uint8 keyType) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(_ACTIVATE_TYPEHASH, account, block.chainid, initialSigner, keyType));
        bytes32 domain =
            keccak256(abi.encode(_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, block.chainid, account));
        return MessageHashUtils.toTypedDataHash(domain, structHash);
    }

    function _proxyInitCode(bytes memory initData) internal view returns (bytes memory) {
        return abi.encodePacked(type(ERC1967Proxy).creationCode, abi.encode(implementation, initData));
    }
}
