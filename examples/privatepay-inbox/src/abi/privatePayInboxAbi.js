export const privatePayInboxAbi = [
  {
    type: 'function',
    name: 'setMyPrivKey',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'privKey', type: 'bytes' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'hasMyPrivKey',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'exists', type: 'bool' }]
  },
  {
    type: 'function',
    name: 'getMyPrivKey',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'privKey', type: 'bytes' }]
  },
  {
    type: 'function',
    name: 'onL1Deposit',
    stateMutability: 'payable',
    inputs: [
      { name: 'depositId', type: 'bytes32' },
      { name: 'commitment', type: 'bytes32' },
      { name: 'ciphertext', type: 'bytes' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'getDepositsCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'count', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'getRecentDeposits',
    stateMutability: 'view',
    inputs: [
      { name: 'limit', type: 'uint256' },
      { name: 'offset', type: 'uint256' }
    ],
    outputs: [
      {
        name: 'headers',
        type: 'tuple[]',
        components: [
          { name: 'index', type: 'uint256' },
          { name: 'amount', type: 'uint256' },
          { name: 'createdAt', type: 'uint64' },
          { name: 'claimed', type: 'bool' },
          { name: 'commitment', type: 'bytes32' },
          { name: 'ciphertextSize', type: 'uint256' }
        ]
      }
    ]
  },
  {
    type: 'function',
    name: 'getCiphertext',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ name: 'ciphertext', type: 'bytes' }]
  },
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'index', type: 'uint256' },
      { name: 'secret', type: 'bytes32' },
      { name: 'to', type: 'address' }
    ],
    outputs: []
  }
];
