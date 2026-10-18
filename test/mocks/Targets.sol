// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KnoadAccount} from "../../src/KnoadAccount.sol";

contract Sink {
    uint256 public received;
    event Paid(uint256 value);

    function take() external payable {
        received += msg.value;
        emit Paid(msg.value);
    }

    function fail() external payable {
        revert("nope");
    }
}

contract GiftToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] = amount;
    }
}

contract Mock20 {
    mapping(address => mapping(address => uint256)) public allowance;
    bool public approvedMax;

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        if (amount == type(uint256).max) approvedMax = true;
        return true;
    }
}

contract Mock721 {
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;

    function mint(address to, uint256 id) external {
        ownerOf[id] = to;
    }

    function approve(address to, uint256 id) external {
        require(msg.sender == ownerOf[id], "owner");
        getApproved[id] = to;
    }

    function setApprovalForAll(address operator, bool ok) external {
        isApprovedForAll[msg.sender][operator] = ok;
    }
}

/// @notice Tries to seize recovery while the account is executing a call.
contract Reenter {
    bool public entered;
    bool public changedRecovery;

    function attack(KnoadAccount account, address expectedRecovery) external {
        entered = true;
        KnoadAccount.RecoveryRequest memory request = KnoadAccount.RecoveryRequest({
            account: address(account),
            chainId: block.chainid,
            newHotSigner: address(0x1234),
            newHotKeyType: 1,
            nextRecoveryAuthority: address(0xBEEF),
            recoveryEpoch: 0,
            authorityNonce: 0,
            deadline: uint64(block.timestamp + 1)
        });
        try account.recover(request, hex"11") {
            changedRecovery = account.recoveryAuthority() != expectedRecovery;
        } catch {
            changedRecovery = false;
        }
        try account.executeUpgrade() {} catch {}
    }
}
