# PrivatePay (Example #4)

PrivatePay demonstrates how a sender on L1 can pay a recipient on L2 **without revealing the recipient address on L1**.
The L1 calldata only contains ciphertext, AAD, and a random `depositId`. The L2 contract decrypts the recipient and
immediately transfers the minted `msg.value` to them.

## Privacy model

**Hidden on L1**

- Recipient address (only ciphertext + AAD appear in calldata)

**Still public**

- Sender address (when the L1 transaction is signed)
- Amount (`l2Value` and `mintValue`)
- Ciphertext size and AAD

## How it works

1. The sender generates a random `depositId` and builds the AAD:

   ```text
   AAD = abi.encodePacked(
     uint256(L2_CHAIN_ID),
     address(PRIVATE_PAY_L2_ADDRESS),
     bytes32(CONTEXT),
     bytes32(depositId)
   )
   ```

2. The recipient address is encrypted with the SharedKMS key.
3. The L1 sender submits `Bridgehub.requestL2TransactionDirect` with:
   - `l2Contract = PRIVATE_PAY_L2_ADDRESS`
   - `l2Value = amount`
   - `l2Calldata = abi.encodeCall(PrivatePay.onL1Deposit, (depositId, aad, ciphertext))`
4. On L2, `PrivatePay` decrypts the recipient via `SharedKMS` and forwards the funds, while updating
   `receivedTotal[recipient]` in storage.

## Running the app

```bash
cd examples/private-pay
npm install
npm run dev
```

### Required environment variables

Set these in a `.env` file or your shell:

- `VITE_L2_CHAIN_ID`
- `VITE_BRIDGEHUB_ADDRESS`
- `VITE_PRIVATE_PAY_L2_ADDRESS`
- `VITE_PRIVATE_PAY_PUBLIC_KEY` (must match the key configured in `SharedKMS`)
- `VITE_L2_GAS_LIMIT` (optional)
- `VITE_L2_GAS_PER_PUBDATA` (optional, defaults to 800)
- `VITE_MINT_VALUE_DEFAULT` (optional)
- `VITE_REFUND_RECIPIENT_DEFAULT` (optional)

Receiver tab (Prividium auth) also needs the standard Prividium env vars (`VITE_PRIVIDIUM_*`) as in other examples.

## Generating a KMS key

`SharedKMS` expects a raw 32-byte key. You can generate one with:

```bash
openssl rand -hex 32
```

## Deploying SharedKMS + configuring consumers

1. Deploy the KMS with your private key:

   ```bash
   export KMS_PRIVATE_KEY=0x<hex>

   cast deploy ./contracts/SharedKMS.sol \
     --constructor-args $KMS_PRIVATE_KEY
   ```

2. Allowlist the deployed `PrivatePay` contract to decrypt:

   ```bash
   cast send <SHARED_KMS_ADDRESS> "setConsumer(address,bool)" <PRIVATE_PAY_L2_ADDRESS> true
   ```

> **Note:** This example uses a keccak256-based XOR stream with the key stored in `SharedKMS` for on-chain decryption.
> It is intentionally minimal to keep the demo self-contained and does **not** provide production-grade privacy.

## Generating the cast command

1. Fill in the recipient and amount.
2. Click **Generate encrypted payload**.
3. Copy the **Cast command** block. It includes the L2 calldata and the `--value` mint amount.

This follows the `Bridgehub.requestL2TransactionDirect((...))` structure from the deposits guide.

## Verifying receipt on L2

After the L1 deposit is executed and bridged:

1. Open the **My received (L2)** tab.
2. Connect your L2 wallet (Prividium auth required).
3. Click **Refresh** to read `PrivatePay.receivedTotal(address)` from storage.

No events are used for this example; totals are stored in contract state and read directly.

## Why no events?

The demo intentionally avoids reliance on L2 events. Storage-based indexing ensures recipients can always derive totals
without event indexing infrastructure, keeping the contract compatible with Prividium’s privacy model.
