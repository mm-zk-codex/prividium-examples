# My Secret (Prividium Example)

A minimal, explanation-first demo that shows how Prividium keeps note payloads private while still publishing public,
verifiable metadata on-chain.

## What this demo teaches

- **Public metadata vs private payload**: the chain exposes author + timestamp + visibility, but secret note text stays
  private.
- **No events needed**: the feed is built from contract storage using view methods.
- **Reveal on demand**: revealing flips the note to public so anyone can read the original content later.

## Setup

### 1) Install dependencies

```bash
cd examples/my-secret
npm install
```

### 2) Deploy the demo contract (once)

Deploy `contracts/NoteRegistry.sol` to your Prividium chain and configure method permissions in the admin panel.

Example using Foundry + the Prividium proxy:

```bash
npx prividium proxy \
  -r https://proxy.prividium.dev/ \
  -u https://user-panel.prividium.dev/

# in another terminal
forge create \
  --rpc-url http://127.0.0.1:24101/rpc \
  --private-key <YOUR_KEY> \
  contracts/NoteRegistry.sol:NoteRegistry \
  --broadcast
```

Copy the deployed contract address.

### 3) Configure environment variables

Create `examples/my-secret/.env.local`:

```bash
VITE_PRIVIDIUM_CLIENT_ID=your-client-id
VITE_PRIVIDIUM_RPC_URL=https://proxy.prividium.dev/rpc
VITE_PRIVIDIUM_AUTH_BASE_URL=https://user-panel.prividium.dev
VITE_PRIVIDIUM_PERMISSIONS_API_URL=https://permissions-api.prividium.dev
VITE_PRIVIDIUM_CHAIN_ID=8022834
VITE_PRIVIDIUM_CHAIN_NAME=Prividium
VITE_PRIVIDIUM_EXPLORER_URL=https://explorer.prividium.dev
VITE_NOTES_CONTRACT_ADDRESS=0xYourDeployedContract
```

> Note: `VITE_PRIVIDIUM_EXPLORER_URL` should be the base explorer URL; the app appends `/tx/<hash>`.

## Run

```bash
npm run dev
```

Open the URL printed by Vite.

## Why no events

Prividium chains restrict event visibility for privacy. This demo never queries events or past logs; the feed is built
entirely from contract storage view methods so it works in Prividium’s privacy model.

## Why no localStorage

Secret note content is stored in contract storage on Prividium (with privacy protection). Storing plaintext in
`localStorage` would defeat the privacy model, so this demo never saves secret content in the browser.

## How storage-based feed works

1. The UI calls `getNotesCount()` to learn how many notes exist.
2. It then calls `getRecentNotes(limit, offset)` to fetch recent note headers (noteId, author, createdAt, isPublic).
3. For any header with `isPublic == true`, the UI calls `getPublicNoteContent(noteId)` to display the note text.
4. Secret notes show a placeholder because the content is still private on-chain.

## How reveal works

When the author calls `makeNotePublic(noteId)`, the contract flips the note’s visibility to public without changing the
original `createdAt` timestamp. The next feed refresh shows the plaintext, and anyone can verify it was written at the
original timestamp.

## How to test the “secret then reveal” story

1. Click **Enable write access** to authenticate with Prividium (wallet + network scopes).
2. **Connect wallet** in the Write panel.
3. Type a note, keep **Secret** selected, and press **Save**.
4. In **Recent activity**, your new entry will show as SECRET with a hidden payload placeholder.
5. Click **Reveal my note** to make it public. The feed will show the plaintext with its original timestamp.

## Notes for operators

- The feed is built from contract storage via `getNotesCount()` + `getRecentNotes(limit, offset)` view calls.
- Method permissions must allow `createNote`, `makeNotePublic`, `getNotesCount`, `getRecentNotes`,
  `getPublicNoteContent`, and (optionally) `getMyNoteContent`.
- Secrets are **not** stored in localStorage. The content lives in contract storage and is made public only when
  `makeNotePublic` is called.
