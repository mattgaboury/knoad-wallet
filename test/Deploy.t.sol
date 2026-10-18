// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {EcdsaRecoveryVerifier} from "../src/EcdsaRecoveryVerifier.sol";
import {KnoadFactory} from "../src/KnoadFactory.sol";
import {DeterministicDeploy} from "../script/DeterministicDeploy.sol";

contract DeployTest is Test {
    /// @dev Runtime code of 0x4e59b44847b379578588920cA78FbF26c0B4956C.
    bytes internal constant DEPLOYER_CODE =
        hex"7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

    function setUp() public {
        vm.etch(DeterministicDeploy.DEPLOYER, DEPLOYER_CODE);
    }

    function test_create2AddressesMatchAcrossSenders() public {
        bytes memory verifierInit = type(EcdsaRecoveryVerifier).creationCode;
        bytes memory factoryInit = abi.encodePacked(
            type(KnoadFactory).creationCode,
            abi.encode(DeterministicDeploy.predict(verifierInit, DeterministicDeploy.VERIFIER_SALT))
        );

        address verifierPredicted =
            DeterministicDeploy.predict(verifierInit, DeterministicDeploy.VERIFIER_SALT);
        address factoryPredicted = DeterministicDeploy.predict(factoryInit, DeterministicDeploy.FACTORY_SALT);
        assertEq(
            verifierPredicted,
            vm.computeCreate2Address(DeterministicDeploy.VERIFIER_SALT, keccak256(verifierInit), DeterministicDeploy.DEPLOYER)
        );
        assertEq(
            factoryPredicted,
            vm.computeCreate2Address(DeterministicDeploy.FACTORY_SALT, keccak256(factoryInit), DeterministicDeploy.DEPLOYER)
        );

        address verifier = DeterministicDeploy.deploy(verifierInit, DeterministicDeploy.VERIFIER_SALT);
        address factory = DeterministicDeploy.deploy(factoryInit, DeterministicDeploy.FACTORY_SALT);
        address implementation = KnoadFactory(factory).implementation();

        assertEq(verifier, verifierPredicted);
        assertEq(factory, factoryPredicted);
        assertEq(implementation, DeterministicDeploy.predictCreate(factory, 1));
        assertEq(verifier, 0x39305881423DC27C6238bE3A343787772534e764);
        assertEq(factory, 0x640b63604581cC0b1326025a57C188BCc6160Dc9);
        assertEq(implementation, 0x70044945917051ce6DcCD244C4d4288FE14A9f28);
        assertEq(verifier, DeterministicDeploy.deploy(verifierInit, DeterministicDeploy.VERIFIER_SALT));
        assertEq(factory, DeterministicDeploy.deploy(factoryInit, DeterministicDeploy.FACTORY_SALT));

        string memory json = "deployments";
        vm.serializeAddress(json, "deterministicDeployer", DeterministicDeploy.DEPLOYER);
        vm.serializeBytes32(json, "verifierSalt", DeterministicDeploy.VERIFIER_SALT);
        vm.serializeBytes32(json, "factorySalt", DeterministicDeploy.FACTORY_SALT);
        vm.serializeAddress(json, "verifier", verifier);
        vm.serializeAddress(json, "factory", factory);
        vm.serializeAddress(json, "implementation", implementation);
        vm.serializeBytes32(json, "verifierInitCodeHash", keccak256(verifierInit));
        vm.serializeBytes32(json, "factoryInitCodeHash", keccak256(factoryInit));
        vm.serializeAddress(json, "entryPoint", 0x433709009B8330FDa32311DF1C2AFA402eD8D009);
        string memory out = vm.serializeBytes(json, "proxyCreationCode", type(ERC1967Proxy).creationCode);
        vm.writeFile("test-vectors/deployments.json", out);
    }
}
