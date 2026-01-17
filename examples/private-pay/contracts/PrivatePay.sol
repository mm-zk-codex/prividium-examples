// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SharedKMS } from "./SharedKMS.sol";

interface IL2Messenger {
    function xDomainMessageSender() external view returns (address);
}

/// @notice Receives L1 deposits, decrypts the recipient, and forwards funds on L2.
contract PrivatePay {
    error NotMessenger();
    error InvalidSender();
    error AlreadyUsed();
    error InvalidRecipient();
    error TransferFailed();

    bytes32 public constant CONTEXT = keccak256("private-pay:v1");

    SharedKMS public immutable kms;
    address public immutable messenger;
    address public immutable l1Bridgehub;

    mapping(bytes32 => bool) public used;
    mapping(address => uint256) public receivedTotal;

    constructor(address messenger_, address l1Bridgehub_, SharedKMS kms_) {
        messenger = messenger_;
        l1Bridgehub = l1Bridgehub_;
        kms = kms_;
    }

    modifier onlyMessenger() {
        if (msg.sender != messenger) revert NotMessenger();
        address sender = IL2Messenger(messenger).xDomainMessageSender();
        if (sender != l1Bridgehub) revert InvalidSender();
        _;
    }

    function onL1Deposit(bytes32 depositId, bytes calldata aad, bytes calldata ciphertext) external payable onlyMessenger {
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
