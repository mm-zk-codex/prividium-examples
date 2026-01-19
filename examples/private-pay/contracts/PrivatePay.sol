// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SharedKMS } from "./SharedKMS.sol";

/// @notice Receives L1 deposits, decrypts the recipient, and forwards funds on L2.
contract PrivatePay {
    error AlreadyUsed();
    error InvalidRecipient();
    error TransferFailed();

    bytes32 public constant CONTEXT = keccak256("private-pay:v1");

    SharedKMS public immutable kms;

    mapping(bytes32 => bool) public used;
    mapping(address => uint256) public receivedTotal;

    constructor(SharedKMS kms_) {
        kms = kms_;
    }

    function onL1Deposit(bytes32 depositId, bytes calldata aad, bytes calldata ciphertext) external payable {
        if (used[depositId]) revert AlreadyUsed();
        used[depositId] = true;

        bytes memory plaintext = kms.decrypt(CONTEXT, aad, ciphertext);
        address recipient = abi.decode(plaintext, (address));
        if (recipient == address(0)) revert InvalidRecipient();

        (bool ok, ) = recipient.call{ value: msg.value }("");
        if (!ok) revert TransferFailed();

        receivedTotal[recipient] += msg.value;
    }
}
