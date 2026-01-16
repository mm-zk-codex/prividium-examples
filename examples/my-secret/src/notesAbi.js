export const NOTES_ABI = [
  {
    type: 'function',
    name: 'createNote',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'content', type: 'string' },
      { name: 'makePublicInitially', type: 'bool' }
    ],
    outputs: [{ name: 'noteId', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'makeNotePublic',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'noteId', type: 'uint256' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'getNotesCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'getRecentNotes',
    stateMutability: 'view',
    inputs: [
      { name: 'limit', type: 'uint256' },
      { name: 'offset', type: 'uint256' }
    ],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'noteId', type: 'uint256' },
          { name: 'author', type: 'address' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'isPublic', type: 'bool' }
        ]
      }
    ]
  },
  {
    type: 'function',
    name: 'getPublicNoteContent',
    stateMutability: 'view',
    inputs: [{ name: 'noteId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }]
  },
  {
    type: 'function',
    name: 'getMyNoteContent',
    stateMutability: 'view',
    inputs: [{ name: 'noteId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }]
  }
];
