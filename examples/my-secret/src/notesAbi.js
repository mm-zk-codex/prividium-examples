export const NOTES_ABI = [
  {
    type: 'function',
    name: 'setPublic',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'note', type: 'string' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'setSecret',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'commitment', type: 'bytes32' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'reveal',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'commitment', type: 'bytes32' },
      { name: 'note', type: 'string' },
      { name: 'salt', type: 'bytes32' }
    ],
    outputs: []
  }
];

export const NOTE_EVENTS = {
  public: 'event NotePublic(address indexed author, string note, uint256 timestamp)',
  secret: 'event NoteSecret(address indexed author, bytes32 commitment, uint256 timestamp)',
  reveal: 'event NoteReveal(address indexed author, bytes32 commitment, string note, uint256 timestamp)'
};
