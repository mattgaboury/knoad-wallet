// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Swappable verifier for the long-lived recovery authority.
/// @dev V1 ships an ECDSA (and ERC-1271) implementation. A post-quantum
///      one-time-signature verifier is a new contract plus an account upgrade,
///      not a hot-key configuration change.
interface IKnoadRecoveryVerifier {
    /// @param authority The current recovery authority address.
    /// @param digest EIP-712 digest over the recovery-authorized request.
    /// @param signature Verifier-specific signature bytes.
    function verify(address authority, bytes32 digest, bytes calldata signature) external view returns (bool);
}
