# PrivatePay Inbox (Example #5)

PrivatePay Inbox demonstrates **recipient privacy on L1** using a public L1 key directory and Prividium private storage on L2. An L1 sender can pay an L2 recipient **without revealing the recipient address on L1**. The ciphertext is public, but only the recipient can decrypt it locally using their private key stored in Prividium private storage.

> **Key point:** the L1 calldata does **not** include the recipient address. It only contains the deposit metadata and ciphertext.

## What is private vs. public?

**Private on L1:**
- Recipient L2 address (hidden inside ciphertext).

**Public on L1:**
- Sender address, amount, timing, ciphertext size, depositId, commitment, and destination contract.

**Revealed on L2:**
- Recipient address is revealed only when they claim (by presenting the secret).

## Architecture

### L1: `KeyDirectory`
- `mapping(address => bytes) public pubKeyOf;`
- L1 senders fetch the recipient’s X25519 public key from this mapping.
- **Assumption for this example:** L1 address == L2 address.

### L2: `PrivatePayInbox`
- Stores **recipient private keys** in Prividium private storage (`privKeyOf`).
- Receives deposits from L1 via `requestL2TransactionDirect`, storing `amount`, `commitment`, and `ciphertext` in a public array.
- Does **not** decrypt on-chain.
- Recipients claim by revealing a secret that matches `commitment = keccak256(secret)`.

## Cryptography (client-side only)

- **Key agreement:** X25519 (Curve25519)
- **Symmetric encryption:** XChaCha20-Poly1305 (AEAD)
- **Plaintext:** `abi.encodePacked(recipientL2Address, secret)`
- **Commitment:** `keccak256(secret)`

**AAD binding (anti-replay / context binding):**

```
AAD = abi.encodePacked(
  L2_CHAIN_ID,
  PRIVATEPAY_INBOX_L2_ADDRESS,
  depositId,
  keccak256("PRIVATEPAY_INBOX_V1")
)
```

**Ciphertext bundle format** (stored on L2):

```
| depositId (32) | ephemeralPub (32) | nonce (24) | sealedCiphertext (variable) |
```

This example includes `depositId` in the bundle so recipients can rebuild AAD during decryption. L1 already sees `depositId` anyway.

## Setup

```bash
cd examples/privatepay-inbox
npm install
npm run dev
```

### Environment variables

Create a `.env` file if you want to override defaults:

```
VITE_L1_RPC_URL=
VITE_L1_CHAIN_ID=
VITE_L2_CHAIN_ID=
VITE_BRIDGEHUB_ADDRESS=
VITE_KEY_DIRECTORY_L1_ADDRESS=
VITE_PRIVATEPAY_INBOX_L2_ADDRESS=
VITE_L2_GAS_LIMIT=300000
VITE_L2_GAS_PER_PUBDATA=800

VITE_PRIVIDIUM_CLIENT_ID=
VITE_PRIVIDIUM_RPC_URL=
VITE_PRIVIDIUM_AUTH_BASE_URL=
VITE_PRIVIDIUM_PERMISSIONS_API_URL=
```

## End-to-end flow

### 1) Recipient registers keys

**On L2 (Prividium private storage):**
- Generate an X25519 keypair in the UI.
- Store the private key on L2 by calling `setMyPrivKey` (using the L2 wallet flow).

**On L1 (public directory):**

```bash
cast send $KEY_DIRECTORY_L1_ADDRESS "register(bytes)" $PUBKEY_HEX \
  --private-key $PRIVATE_KEY
```

> The L1 address used above is assumed to match the L2 address in this example.

### 2) Sender creates an encrypted deposit

In the **Send (L1)** tab, provide:
- recipient L2 address
- amount (wei)
- mintValue (amount + gas buffer)

The UI generates:
- `depositId`
- `secret`
- `commitment = keccak256(secret)`
- `ciphertext` (X25519 + XChaCha20-Poly1305)

### 3) Sender bridges via Bridgehub

The UI prints a ready-to-run `cast send` command, e.g.:

```bash
cast send $BRIDGEHUB_ADDRESS \
  "requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))" \
  "($L2_CHAIN_ID,$MINT_VALUE,$PRIVATEPAY_INBOX_L2_ADDRESS,$AMOUNT,$L2_CALLDATA,$L2_GAS_LIMIT,800,[],$REFUND_RECIPIENT)" \
  --value $MINT_VALUE --private-key $PRIVATE_KEY
```

### 4) Recipient scans and claims

- Connect the L2 wallet (Prividium auth required).
- Fetch the private key from Prividium private storage.
- The UI decrypts stored ciphertexts locally.
- Claim matching deposits by submitting `claim(index, secret, to)` on L2.

### 5) Claim from the CLI (optional)

```bash
cast send $PRIVATEPAY_INBOX_L2_ADDRESS \
  "claim(uint256,bytes32,address)" \
  $INDEX $SECRET $RECIPIENT \
  --private-key $PRIVATE_KEY --rpc-url $L2_RPC
```

## Faucet

If your L2 balance is 0, you will need gas to claim. In local dev setups, you can transfer test ETH to your L2 address, for example:

```bash
cast send $L2_RICH_ADDRESS $RECIPIENT "transfer(address,uint256)" $RECIPIENT 1000000000000000000 \
  --private-key $L2_RICH_PRIVATE_KEY --rpc-url $L2_RPC
```

## Notes

- The ciphertext is publicly readable on L2; it is encrypted end-to-end in the frontend.
- `PrivatePayInbox` only verifies commitments. It does **not** enforce a recipient address on-chain.
- `setMyPrivKey` **allows rotation**; it overwrites any previously stored key.
- The L2 inbox constructor takes a `l2Messenger` address used to validate L1 deposits.

## Acceptance checklist

- ✅ L1 KeyDirectory stores public keys.
- ✅ L2 PrivatePayInbox stores private keys in Prividium private storage.
- ✅ L1 deposit calldata does not include recipient address.
- ✅ Recipient decrypts locally and claims with secret.
- ✅ Uses `prividium@0.1.8`.
- ✅ Storage-based feed (no events dependency).


## Deployment instructions

```shell

forge create -r http://localhost:5010 examples/privatepay-inbox/contracts/l1/KeyDirectory.sol:KeyDirectory --private-key 0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110 --broadcast


```
