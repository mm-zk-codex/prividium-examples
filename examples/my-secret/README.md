# My Secret (Prividium Example)

A minimal, explanation-first demo that shows how Prividium keeps note payloads private while still publishing public,
verifiable metadata on-chain.

## What this demo teaches

- **Public metadata vs private payload**: the chain always exposes who/when/tx hash, but secret note text stays hidden.
- **Explorers see metadata, not secrets**: the activity feed links to the explorer, which only shows the public footprint.
- **Timestamped commitments**: a secret note is a hash commitment; revealing later proves you knew it earlier.

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
  contracts/NoteRegistry.sol:NoteRegistry
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
VITE_FEED_BLOCK_RANGE=5000
```

> Note: `VITE_PRIVIDIUM_EXPLORER_URL` should be the base explorer URL; the app appends `/tx/<hash>`.

## Run

```bash
npm run dev
```

Open the URL printed by Vite.

## How to test the “secret then reveal” story

1. Click **Enable write access** to authenticate with Prividium (wallet + network scopes).
2. **Connect wallet** in the Write panel.
3. Type a note, keep **Secret** selected, and press **Save**.
4. In **Recent activity**, your new entry will show as SECRET with a hidden payload placeholder.
5. Click **Reveal my note** to publish the plaintext. The feed will show a REVEAL item and the original timestamp.

## Notes for operators

- The feed is built by reading contract events via the authenticated Prividium transport.
- Method permissions must allow `setPublic`, `setSecret`, and `reveal` for your demo users.
- For demo purposes, the commitment preimage (note + salt) is stored in browser localStorage under `my-secret:*`.
