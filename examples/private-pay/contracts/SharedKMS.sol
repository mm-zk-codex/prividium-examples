// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Shared KMS stub that verifies AAD and gates decryption to allowlisted consumers.
/// @dev In a real Prividium deployment, `decrypt` would call the confidential KMS precompile.
contract SharedKMS {
    error NotAllowed();
    error InvalidAad();

    address public owner;
    bytes public publicKey;
    mapping(address => bool) public allowlist;

    constructor(bytes memory publicKey_) {
        owner = msg.sender;
        publicKey = publicKey_;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    function setConsumer(address consumer, bool allowed) external onlyOwner {
        allowlist[consumer] = allowed;
    }

    /// @notice Decrypts ciphertext and returns plaintext bytes.
    /// @dev This stub expects the ciphertext to already be the plaintext.
    function decrypt(bytes32 context, bytes calldata aad, bytes calldata ciphertext) external view returns (bytes memory) {
        if (!allowlist[msg.sender]) revert NotAllowed();
        (uint256 chainId, address consumer, bytes32 aadContext, ) = _parseAAD(aad);
        if (chainId != block.chainid || consumer != msg.sender || aadContext != context) revert InvalidAad();
        return ciphertext;
    }

    function _parseAAD(bytes calldata aad)
        internal
        pure
        returns (uint256 chainId, address consumer, bytes32 context, bytes32 depositId)
    {
        if (aad.length != 116) revert InvalidAad();
        assembly {
            chainId := calldataload(aad.offset)
            let word := calldataload(add(aad.offset, 32))
            consumer := shr(96, word)
            context := calldataload(add(aad.offset, 52))
            depositId := calldataload(add(aad.offset, 84))
        }
    }
}
