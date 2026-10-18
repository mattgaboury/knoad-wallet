// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IKnoadRecoveryVerifier} from "./IKnoadRecoveryVerifier.sol";

/// @notice V1 recovery verifier. EOAs and hardware wallets sign the digest
///         directly. A contract authority is checked with ERC-1271 via staticcall.
contract EcdsaRecoveryVerifier is IKnoadRecoveryVerifier {
    function verify(address authority, bytes32 digest, bytes calldata signature) external view returns (bool) {
        if (authority == address(0) || signature.length == 0) return false;
        // Recover first. A matching signature never reads the authority's code.
        // Validation runs inside the factory, and a bundler forbids touching an
        // address that has no code. Contract authorities fall through to ERC-1271.
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == authority) return true;
        if (authority.code.length == 0) return false;
        try IERC1271(authority).isValidSignature(digest, signature) returns (bytes4 magic) {
            return magic == IERC1271.isValidSignature.selector;
        } catch {
            return false;
        }
    }
}
