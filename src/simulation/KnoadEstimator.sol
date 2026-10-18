// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PackedUserOperation} from "@openzeppelin/contracts/interfaces/IERC4337.sol";
import {ERC4337Utils} from "@openzeppelin/contracts/account/utils/ERC4337Utils.sol";
import {KnoadLib} from "../KnoadLib.sol";

/// @title KnoadEstimator
/// @notice Gas-estimation stand-in. Never deploy it and never point an account at it.
/// @dev Bundlers estimate with a dummy signature. KnoadAccount only rotates and
///      marks the operation validated when the signature is real, so its calls
///      revert under a dummy signature and no estimate comes back. The phone
///      sends this code as a state override at the implementation address and
///      moves the real implementation code to SHADOW. Validation here applies
///      the same rotation without checking the signature. Every other call runs
///      the real code by delegatecall. Storage slots must match KnoadAccount.
contract KnoadEstimator {
    address internal constant SHADOW = address(uint160(uint256(keccak256("knoad.wallet.estimator.shadow"))));
    uint256 private constant _HOT_SLOT = 2;
    bytes4 private constant _EXECUTE_AND_ROTATE = bytes4(keccak256("executeAndRotate(bytes32,bytes,address,uint8)"));
    bytes4 private constant _VETO_RECOVERY = bytes4(keccak256("vetoRecovery(address,uint8)"));

    function validateUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 missingAccountFunds)
        external
        returns (uint256)
    {
        if (msg.sender != address(ERC4337Utils.ENTRYPOINT_V09)) revert();
        uint256 hotSlot = _HOT_SLOT;
        uint256 hot;
        assembly ("memory-safe") {
            hot := sload(hotSlot)
        }
        if (uint192(userOp.nonce >> 64) != 0 || uint64(userOp.nonce) != KnoadLib.generation(hot)) {
            return ERC4337Utils.SIG_VALIDATION_FAILED;
        }
        (address nextSigner, uint8 nextKeyType) = _readNext(userOp.callData);
        if (!KnoadLib.validKeyType(nextKeyType) || nextSigner == address(0) || nextSigner == KnoadLib.signer(hot)) {
            return ERC4337Utils.SIG_VALIDATION_FAILED;
        }
        uint64 nextGeneration = uint64(userOp.nonce) + 1;
        uint256 next = KnoadLib.pack(nextSigner, nextKeyType, nextGeneration);
        uint256 epoch = _securityEpoch();
        bytes32 argsSlot = KnoadLib.validationArgsSlot(userOpHash);
        bytes32 epochSlot = KnoadLib.validationEpochSlot(userOpHash);
        uint256 args = uint256(KnoadLib.validationArgs(nextSigner, nextKeyType));
        assembly ("memory-safe") {
            sstore(hotSlot, next)
            tstore(argsSlot, args)
            tstore(epochSlot, epoch)
        }
        if (missingAccountFunds > 0) {
            (bool paid,) = payable(msg.sender).call{value: missingAccountFunds}("");
            paid;
        }
        return ERC4337Utils.SIG_VALIDATION_SUCCESS;
    }

    receive() external payable {
        _delegate();
    }

    fallback() external payable {
        _delegate();
    }

    /// @dev The real account stores the security epoch. Estimation reads it through the shadowed code.
    function _securityEpoch() private returns (uint256 epoch) {
        address shadow = SHADOW;
        bytes memory data = abi.encodeWithSignature("securityEpoch()");
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            let ok := delegatecall(gas(), shadow, add(data, 32), mload(data), ptr, 32)
            if iszero(ok) { revert(0, 0) }
            epoch := mload(ptr)
        }
    }

    function _delegate() private {
        address shadow = SHADOW;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            calldatacopy(ptr, 0, calldatasize())
            let ok := delegatecall(gas(), shadow, ptr, calldatasize(), 0, 0)
            returndatacopy(ptr, 0, returndatasize())
            if iszero(ok) { revert(ptr, returndatasize()) }
            return(ptr, returndatasize())
        }
    }

    function _readNext(bytes calldata callData) private pure returns (address nextSigner, uint8 nextKeyType) {
        if (callData.length < 4) return (address(0), 0);
        bytes4 selector = bytes4(callData[0:4]);
        if (selector == _EXECUTE_AND_ROTATE && callData.length >= 4 + 128) {
            nextSigner = address(bytes20(callData[4 + 64 + 12:4 + 96]));
            nextKeyType = uint8(callData[4 + 96 + 31]);
        } else if (selector == _VETO_RECOVERY && callData.length >= 4 + 64) {
            nextSigner = address(bytes20(callData[4 + 12:4 + 32]));
            nextKeyType = uint8(callData[4 + 32 + 31]);
        }
    }
}
