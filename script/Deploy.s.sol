// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {EcdsaRecoveryVerifier} from "../src/EcdsaRecoveryVerifier.sol";
import {KnoadFactory} from "../src/KnoadFactory.sol";
import {DeterministicDeploy} from "./DeterministicDeploy.sol";

/// @notice Deploys the verifier and factory at the same addresses on every chain.
/// @dev Dry run prints the addresses. Broadcast sends them through the deterministic
///      deployer and requires DEPLOYER_PRIVATE_KEY. Ethereum and Base stay blocked
///      until an audit, unless KNOAD_ALLOW_MAINNET=1.
///      BNB, Arbitrum, Robinhood Chain, Monad, and ApeChain revert unless
///      KNOAD_ALLOW_CHAIN equals that chain id.
///      forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast
contract Deploy is Script {
    error MainnetBlocked();
    error ChainBlocked();
    error MissingDeployerKey();

    function run() external {
        (bytes memory verifierInit, bytes memory factoryInit, address verifier, address factory, address implementation)
        = _predict();

        console2.log("deterministicDeployer", DeterministicDeploy.DEPLOYER);
        console2.log("verifier", verifier);
        console2.log("factory", factory);
        console2.log("implementation", implementation);
        console2.log("verifierSalt");
        console2.logBytes32(DeterministicDeploy.VERIFIER_SALT);
        console2.log("factorySalt");
        console2.logBytes32(DeterministicDeploy.FACTORY_SALT);
        console2.log("verifierInitCodeHash");
        console2.logBytes32(keccak256(verifierInit));
        console2.log("factoryInitCodeHash");
        console2.logBytes32(keccak256(factoryInit));

        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) return;

        if (block.chainid == 1 || block.chainid == 8453) {
            if (!vm.envOr("KNOAD_ALLOW_MAINNET", false)) revert MainnetBlocked();
        }
        if (
            block.chainid == 56 || block.chainid == 42161 || block.chainid == 4663 || block.chainid == 143
                || block.chainid == 33139
        ) {
            if (vm.envOr("KNOAD_ALLOW_CHAIN", uint256(0)) != block.chainid) revert ChainBlocked();
        }

        uint256 key = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        if (key == 0) revert MissingDeployerKey();

        vm.startBroadcast(key);
        DeterministicDeploy.deploy(verifierInit, DeterministicDeploy.VERIFIER_SALT);
        DeterministicDeploy.deploy(factoryInit, DeterministicDeploy.FACTORY_SALT);
        vm.stopBroadcast();
    }

    function _predict()
        internal
        pure
        returns (
            bytes memory verifierInit,
            bytes memory factoryInit,
            address verifier,
            address factory,
            address implementation
        )
    {
        verifierInit = type(EcdsaRecoveryVerifier).creationCode;
        verifier = DeterministicDeploy.predict(verifierInit, DeterministicDeploy.VERIFIER_SALT);
        factoryInit = abi.encodePacked(type(KnoadFactory).creationCode, abi.encode(verifier));
        factory = DeterministicDeploy.predict(factoryInit, DeterministicDeploy.FACTORY_SALT);
        implementation = DeterministicDeploy.predictCreate(factory, 1);
    }
}
