// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal event-only registry for the My Secret demo.
/// @dev Public notes are emitted in clear text; secret notes emit only a commitment hash.
contract NoteRegistry {
    event NotePublic(address indexed author, string note, uint256 timestamp);
    event NoteSecret(address indexed author, bytes32 commitment, uint256 timestamp);
    event NoteReveal(address indexed author, bytes32 commitment, string note, uint256 timestamp);

    function setPublic(string calldata note) external {
        emit NotePublic(msg.sender, note, block.timestamp);
    }

    function setSecret(bytes32 commitment) external {
        emit NoteSecret(msg.sender, commitment, block.timestamp);
    }

    function reveal(bytes32 commitment, string calldata note, bytes32 salt) external {
        require(commitment == keccak256(abi.encodePacked(note, salt, msg.sender)), "Bad commitment");
        emit NoteReveal(msg.sender, commitment, note, block.timestamp);
    }
}
