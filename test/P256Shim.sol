// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";

/// @dev Test stand-in for the RIP-7212 precompile at 0x100.
///      Production chains in V1 must have the real precompile. The account calls
///      it through OpenZeppelin's P256.verifyNative and does not carry the
///      Solidity fallback.
contract P256Shim {
    fallback() external payable {
        if (msg.data.length != 160) return;
        bytes32 h;
        bytes32 r;
        bytes32 s;
        bytes32 qx;
        bytes32 qy;
        assembly ("memory-safe") {
            h := calldataload(0)
            r := calldataload(32)
            s := calldataload(64)
            qx := calldataload(96)
            qy := calldataload(128)
        }
        if (P256.verifySolidity(h, r, s, qx, qy)) {
            assembly ("memory-safe") {
                mstore(0, 1)
                return(0, 32)
            }
        }
    }
}
