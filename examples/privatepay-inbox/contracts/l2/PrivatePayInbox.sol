// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title PrivatePayInbox
/// @notice Receives encrypted L1->L2 deposits and stores private keys in Prividium private storage.
contract PrivatePayInbox {
    struct Deposit {
        uint256 amount;
        bytes32 commitment;
        bytes ciphertext;
        uint64 createdAt;
        bool claimed;
    }

    struct DepositHeader {
        uint256 index;
        uint256 amount;
        uint64 createdAt;
        bool claimed;
        bytes32 commitment;
        uint256 ciphertextSize;
    }

    //address public immutable l2Messenger;

    mapping(address => bytes) private privKeyOf;
    Deposit[] public deposits;
    mapping(bytes32 => bool) public usedDepositId;

    error OnlyMessenger();
    error PrivateKeyMissing();
    error DepositAlreadyClaimed();
    error InvalidCommitment();
    error InvalidRecipient();
    error DepositAlreadyUsed();

    constructor() {
        //l2Messenger = _l2Messenger;
    }

    /// @notice Store or rotate the caller's private key in Prividium private storage.
    function setMyPrivKey(bytes calldata privKey) external {
        privKeyOf[msg.sender] = privKey;
    }

    function hasMyPrivKey() external view returns (bool) {
        return privKeyOf[msg.sender].length > 0;
    }

    function getMyPrivKey() external view returns (bytes memory) {
        bytes memory key = privKeyOf[msg.sender];
        if (key.length == 0) {
            revert PrivateKeyMissing();
        }
        return key;
    }

    function onL1Deposit(
        bytes32 depositId,
        bytes32 commitment,
        bytes calldata ciphertext
    ) external payable {
        // TODO: detect that this tx came from L1.
        /*if (msg.sender != l2Messenger) {
            revert OnlyMessenger();
        }*/
        if (usedDepositId[depositId]) {
            revert DepositAlreadyUsed();
        }
        usedDepositId[depositId] = true;

        deposits.push(
            Deposit({
                amount: msg.value,
                commitment: commitment,
                ciphertext: ciphertext,
                createdAt: uint64(block.timestamp),
                claimed: false
            })
        );
    }

    function getDepositsCount() external view returns (uint256) {
        return deposits.length;
    }

    function getRecentDeposits(
        uint256 limit,
        uint256 offset
    ) external view returns (DepositHeader[] memory) {
        uint256 total = deposits.length;
        if (offset >= total || limit == 0) {
            return new DepositHeader[](0);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        uint256 size = end - offset;
        DepositHeader[] memory headers = new DepositHeader[](size);
        for (uint256 i = 0; i < size; i++) {
            uint256 idx = offset + i;
            Deposit storage dep = deposits[idx];
            headers[i] = DepositHeader({
                index: idx,
                amount: dep.amount,
                createdAt: dep.createdAt,
                claimed: dep.claimed,
                commitment: dep.commitment,
                ciphertextSize: dep.ciphertext.length
            });
        }
        return headers;
    }

    function getCiphertext(uint256 index) external view returns (bytes memory) {
        return deposits[index].ciphertext;
    }

    function claim(uint256 index, bytes32 secret, address to) external {
        if (to == address(0)) {
            revert InvalidRecipient();
        }
        Deposit storage dep = deposits[index];
        if (dep.claimed) {
            revert DepositAlreadyClaimed();
        }
        if (keccak256(abi.encodePacked(secret)) != dep.commitment) {
            revert InvalidCommitment();
        }
        dep.claimed = true;
        (bool success, ) = to.call{value: dep.amount}("");
        require(success, "Transfer failed");
    }
}
