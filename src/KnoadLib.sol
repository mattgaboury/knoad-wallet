// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Packing and key-id helpers for KNOAD Wallet.
/// @dev The live hot signer occupies one storage slot:
///      bits [0, 160) address, [160, 168) key type, [168, 232) generation.
library KnoadLib {
    uint8 internal constant KEY_SECP256K1 = 1;
    uint8 internal constant KEY_P256 = 2;

    function pack(address signer_, uint8 keyType_, uint64 generation_) internal pure returns (uint256) {
        return uint256(uint160(signer_)) | (uint256(keyType_) << 160) | (uint256(generation_) << 168);
    }

    function signer(uint256 packed) internal pure returns (address) {
        return address(uint160(packed));
    }

    function keyType(uint256 packed) internal pure returns (uint8) {
        return uint8((packed >> 160) & 0xff);
    }

    function generation(uint256 packed) internal pure returns (uint64) {
        return uint64(packed >> 168);
    }

    /// @dev Address commitment for a P-256 public key. The raw key is not stored.
    function p256Signer(bytes32 qx, bytes32 qy) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(qx, qy)))));
    }

    function validKeyType(uint8 keyType_) internal pure returns (bool) {
        return keyType_ == KEY_SECP256K1 || keyType_ == KEY_P256;
    }

    /// @dev Transient slots that tie one validation to the EntryPoint's current operation.
    bytes32 internal constant VALIDATION_ARGS_TAG = keccak256("knoad.validation.args");
    bytes32 internal constant VALIDATION_EPOCH_TAG = keccak256("knoad.validation.epoch");

    function validationArgsSlot(bytes32 userOpHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(VALIDATION_ARGS_TAG, userOpHash));
    }

    function validationEpochSlot(bytes32 userOpHash) internal pure returns (bytes32) {
        return keccak256(abi.encode(VALIDATION_EPOCH_TAG, userOpHash));
    }

    function validationArgs(address nextSigner, uint8 nextKeyType) internal pure returns (bytes32) {
        return keccak256(abi.encode(nextSigner, nextKeyType));
    }
}
