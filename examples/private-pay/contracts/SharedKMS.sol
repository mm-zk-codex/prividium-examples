// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Shared KMS that verifies AAD and gates decryption to allowlisted consumers.
contract SharedKMS {
    error NotAllowed();
    error InvalidAad();
    error InvalidCiphertext();

    address public owner;
    bytes public privateKey;
    bytes public publicKey;
    mapping(address => bool) public allowlist;

    constructor(bytes memory privateKey_) {
        owner = msg.sender;
        privateKey = privateKey_;
        publicKey = privateKey_;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    function setConsumer(address consumer, bool allowed) external onlyOwner {
        allowlist[consumer] = allowed;
    }

    /// @notice Decrypts ciphertext and returns plaintext bytes.
    function decrypt(bytes32 context, bytes calldata aad, bytes calldata ciphertext) external view returns (bytes memory) {
        if (!allowlist[msg.sender]) revert NotAllowed();
        (uint256 chainId, address consumer, bytes32 aadContext, ) = _parseAAD(aad);
        if (chainId != block.chainid || consumer != msg.sender || aadContext != context) revert InvalidAad();
        if (ciphertext.length != 64) revert InvalidCiphertext();

        bytes32 nonce;
        bytes32 masked;
        assembly {
            nonce := calldataload(ciphertext.offset)
            masked := calldataload(add(ciphertext.offset, 32))
        }

        bytes32 mask = keccak256(bytes.concat(privateKey, aad, nonce));
        bytes32 plaintext = masked ^ mask;
        return abi.encodePacked(plaintext);
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
