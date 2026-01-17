// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IKmsPrecompile {
    function getPublicKey(bytes calldata privateKey) external view returns (bytes memory);

    function decrypt(bytes calldata privateKey, bytes calldata aad, bytes calldata ciphertext)
        external
        view
        returns (bytes memory);
}

/// @notice Shared KMS that verifies AAD and gates decryption to allowlisted consumers.
contract SharedKMS {
    error NotAllowed();
    error InvalidAad();
    error DecryptFailed();

    address public owner;
    address public kmsPrecompile;
    bytes public privateKey;
    bytes public publicKey;
    mapping(address => bool) public allowlist;

    constructor(address kmsPrecompile_, bytes memory privateKey_) {
        owner = msg.sender;
        kmsPrecompile = kmsPrecompile_;
        privateKey = privateKey_;
        publicKey = IKmsPrecompile(kmsPrecompile_).getPublicKey(privateKey_);
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
        try IKmsPrecompile(kmsPrecompile).decrypt(privateKey, aad, ciphertext) returns (bytes memory plaintext) {
            return plaintext;
        } catch {
            revert DecryptFailed();
        }
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
