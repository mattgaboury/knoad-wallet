// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice CREATE2 via the canonical deterministic deployer at
///         0x4e59b44847b379578588920cA78FbF26c0B4956C.
/// @dev The deployer is already on Ethereum, Base, Sepolia, and Base Sepolia.
///      The resulting address depends on the salt and the init code only.
library DeterministicDeploy {
    address internal constant DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant VERIFIER_SALT = keccak256("knoad.wallet.verifier.v1");
    bytes32 internal constant FACTORY_SALT = keccak256("knoad.wallet.factory.v1");

    function predict(bytes memory initCode, bytes32 salt) internal pure returns (address) {
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), DEPLOYER, salt, keccak256(initCode)))))
        );
    }

    /// @dev Nonce 1 is the first contract created inside a new contract's constructor.
    function predictCreate(address deployer, uint256 nonce) internal pure returns (address) {
        require(nonce > 0 && nonce <= 0x7f, "nonce out of range");
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, bytes1(uint8(nonce))))))
        );
    }

    /// @dev Skips the call when the address already has code, so a repeat broadcast is safe.
    function deploy(bytes memory initCode, bytes32 salt) internal returns (address deployed) {
        deployed = predict(initCode, salt);
        if (deployed.code.length > 0) return deployed;
        (bool ok, bytes memory ret) = DEPLOYER.call(abi.encodePacked(salt, initCode));
        require(ok && ret.length == 20, "deterministic deploy failed");
        require(address(bytes20(ret)) == deployed, "deployer returned a different address");
    }
}
