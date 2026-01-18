export const keyDirectoryAbi = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'pubKey', type: 'bytes' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'getPubKey',
    stateMutability: 'view',
    inputs: [{ name: 'l2Address', type: 'address' }],
    outputs: [{ name: 'pubKey', type: 'bytes' }]
  }
];
