// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title KeyDirectory
/// @notice L1 directory mapping L2 addresses to X25519 public keys.
/// @dev For this example, we assume L1 and L2 addresses are the same.
contract KeyDirectory {
    mapping(address => bytes) public pubKeyOf;
    mapping(address => uint64) public updatedAt;

    function register(bytes calldata pubKey) external {
        pubKeyOf[msg.sender] = pubKey;
        updatedAt[msg.sender] = uint64(block.timestamp);
    }

    function getPubKey(address l2Address) external view returns (bytes memory) {
        return pubKeyOf[l2Address];
    }
}
