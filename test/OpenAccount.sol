// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {KnoadAccount} from "../src/KnoadAccount.sol";
import {KnoadFactory} from "../src/KnoadFactory.sol";

/// @dev Deploys through the real factory with a recovery signature over this chain's first key.
library OpenAccount {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function open(KnoadFactory factory, uint256 recoveryKey, address hot, uint8 keyType, uint256 index)
        internal
        returns (KnoadAccount)
    {
        KnoadAccount.Policy memory policy;
        return openWithPolicy(factory, recoveryKey, hot, keyType, index, policy);
    }

    function openWithPolicy(
        KnoadFactory factory,
        uint256 recoveryKey,
        address hot,
        uint8 keyType,
        uint256 index,
        KnoadAccount.Policy memory policy
    ) internal returns (KnoadAccount) {
        return factory.createAccountWithPolicy(
            vm.addr(recoveryKey), index, policy, _activation(factory, recoveryKey, index, policy, hot, keyType)
        );
    }

    function _activation(
        KnoadFactory factory,
        uint256 recoveryKey,
        uint256 index,
        KnoadAccount.Policy memory policy,
        address hot,
        uint8 keyType
    ) private returns (KnoadFactory.Activation memory activation) {
        address predicted = factory.predictWithPolicy(vm.addr(recoveryKey), index, policy);
        activation.initialSigner = hot;
        activation.keyType = keyType;
        bytes32 digest = factory.activationDigest(predicted, hot, keyType);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(recoveryKey, digest);
        activation.signature = abi.encodePacked(r, s, v);
    }
}
