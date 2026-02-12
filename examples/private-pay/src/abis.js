export const PRIVATE_PAY_ABI = [
  {
    type: 'function',
    name: 'onL1Deposit',
    stateMutability: 'payable',
    inputs: [
      { name: 'depositId', type: 'bytes32' },
      { name: 'aad', type: 'bytes' },
      { name: 'ciphertext', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'receivedTotal',
    stateMutability: 'view',
    inputs: [{ name: 'recipient', type: 'address' }],
    outputs: [{ name: 'total', type: 'uint256' }]
  }
];

export const BRIDGEHUB_ABI = [
  {
    type: 'function',
    name: 'requestL2TransactionDirect',
    stateMutability: 'payable',
    inputs: [
      {
        name: '_request',
        type: 'tuple',
        components: [
          { name: 'chainId', type: 'uint256' },
          { name: 'mintValue', type: 'uint256' },
          { name: 'l2Contract', type: 'address' },
          { name: 'l2Value', type: 'uint256' },
          { name: 'l2Calldata', type: 'bytes' },
          { name: 'l2GasLimit', type: 'uint256' },
          { name: 'l2GasPerPubdataByteLimit', type: 'uint256' },
          { name: 'factoryDeps', type: 'bytes[]' },
          { name: 'refundRecipient', type: 'address' }
        ]
      }
    ],
    outputs: []
  }
];
