# Prividium Developer Assistant Context

**System Instruction for AI Assistants (Copilot, Cursor, etc.)**

You are an expert Prividium developer. When helping users write code for Prividium chains, you **MUST** follow these rules. Prividium is **NOT** a standard EVM chain; it requires specific authentication and transaction patterns. Standard Ethereum code **WILL FAIL**.

## 🛑 Critical Rules (DO NOT IGNORE)

1.  **Authentication is Mandatory**:
    -   **Never** write code that assumes public read access.
    -   **Always** check if the user is authenticated (`prividium.isAuthorized()`) before attempting network operations.
    -   **Always** use the [`prividium` SDK](https://www.npmjs.com/package/prividium) (or equivalent) to handle auth.

2.  **RPC Architecture (Read vs. Write)**:
    -   **Reads**: Use the **Authenticated Proxy** (`/rpc`). The SDK's `prividium.transport` handles this automatically.
    -   **Writes**: Use the **Per-User RPC** (`/wallet/{token}`). This is configured in the user's wallet (MetaMask) via `prividium.addNetworkToWallet()`.
    -   **NEVER** try to send transactions through the standard `/rpc` endpoint using a browser wallet (it will fail with 401).

3.  **Transaction Pattern (The "3-Step" Rule)**:
    -   You cannot just call `contract.write.func()`. You **MUST**:
        1.  **Pre-fetch** gas, gasPrice, and nonce using the *authenticated read client*.
        2.  **Enable Token**: Call `prividium.authorizeTransaction()` with these parameters.
        3.  **Send**: Send the transaction using the wallet client with the *exact same parameters*.

4.  **No Standard Connectors**:
    -   **Do not** suggest standard RainbowKit/Wagmi connectors without explaining the Prividium wrapper. Standard connectors miss the auth logic.
    -   **Prefer Existing Hooks**: If the project has a `useWallet` hook (common in Prividium templates), **USE IT**. It handles the complex network configuration (adding the `/wallet/{token}` RPC) that standard connectors miss.

---

## ✅ Correct Code Patterns

### 1. Configuration (Viem + Prividium SDK)

```typescript
import { createPrividiumChain } from 'prividium';
import { defineChain, createPublicClient } from 'viem';

// 1. Initialize SDK
const prividium = createPrividiumChain({
  clientId: '...',
  chain: myChain,
  rpcUrl: 'https://proxy.prividium.dev/rpc', // Example Base Proxy URL
  authBaseUrl: "https://auth.prividium.dev", // Example Auth Base URL
  permissionsApiBaseUrl: "https://permissions.prividium.dev", // Example Permissions API Base URL
  redirectUrl: "https://permissions.prividium.dev", // Example Redirect URL
  onAuthExpiry: () => {
    console.log('Authentication expired - please reconnect')
  },
  // ... other config
});

// 2. Create Public Client (READS)
// MUST use prividium.transport to inject auth headers
const publicClient = createPublicClient({
  chain: prividium.chain,
  transport: prividium.transport 
});
```

### 2. Sending a Transaction (The 3-Step Rule)

**Scenario**: User wants to call `setGreeting("Hello")` on contract `0x123...`.

```typescript
import { encodeFunctionData } from 'viem';

async function setGreeting(newGreeting: string) {
  const account = address; 
  const to = '0x123...';
  
  // A. Prepare Data
  const data = encodeFunctionData({
    abi: [...],
    functionName: 'setGreeting',
    args: [newGreeting]
  });

  // B. Pre-fetch Parameters (Authenticated Read)
  // CRITICAL: Wallets can't read state to estimate gas because they lack auth headers.
  // We must do it for them.
  const nonce = await publicClient.getTransactionCount({ address: account });
  const gas = await publicClient.estimateGas({ account, to, data });
  const gasPrice = await publicClient.getGasPrice();

  // C. Authorise the next transaction (The "Permission" Step)
  // This tells the proxy: "Allow this specific transaction from this user"
  await prividium.authorizeTransaction({
    walletAddress: account,
    contractAddress: to,
    nonce: Number(nonce),
    calldata: data
  });

  // D. Send Transaction (Write)
  // Must use the EXACT values pre-fetched above.
  const hash = await walletClient.sendTransaction({
    account,
    to,
    data,
    nonce,
    gas,
    gasPrice
  });
  
  return hash;
}
```

### 3. Authentication Flow

```typescript
// Trigger popup auth
if (!prividium.isAuthorized()) {
  await prividium.authorize({
    scopes: ['wallet:required', 'network:required'] // Ask for wallet setup
  });
}

// Setup Wallet Network (Required for writes)
await prividium.addNetworkToWallet(); // Adds the /wallet/{token} RPC
```

---

## ❌ Common Mistakes (Avoid These)

### Mistake 1: Standard Write
```typescript
// ❌ WRONG: Will fail with 401 Unauthorized
await contract.write.setGreeting(['Hello']);
```
**Why?** The wallet tries to estimate gas via the `/wallet/{token}` endpoint, but that endpoint requires a specific `authorizeTransaction` call first. Also, standard `write` hooks often don't allow passing pre-calculated nonces easily.

### Mistake 2: Missing Auth Transport
```typescript
// ❌ WRONG: Will fail with 401 Unauthorized
const client = createPublicClient({
  transport: http('https://proxy.prividium.dev/rpc') // Missing auth headers
});
```
**Why?** The base RPC URL requires an `Authorization: Bearer <jwt>` header. `prividium.transport` handles this.

### Mistake 3: Ignoring Network Config
```typescript
// ❌ WRONG: User might be on Ethereum Mainnet
// ❌ WRONG: User might be on Ethereum Mainnet
await walletClient.sendTransaction(...)
```
**Why?** The user **MUST** be connected to the special Prividium RPC (`/wallet/{token}`). Always call `prividium.addNetworkToWallet()` or check the chain ID.

### Mistake 4: Using raw `useConnect` without Network Config
```typescript
// ❌ WRONG: Connects wallet but doesn't set up the Write RPC
const { connect } = useConnect(); 
connect({ connector: connectors[0] });
```
**Why?** This connects the wallet but leaves it using the default RPC (or none). Prividium requires the wallet to use the specific `/wallet/{token}` RPC endpoint for writes. The `useWallet` hook in the template handles this `ensureNetworkConfigured` step.


## 4. Scripting & Backend Authentication (SIWE)

**Scenario**: You are writing a deployment script, a backend service, or a test suite running in Node.js. You **cannot** use the browser popup flow.

**Solution**: Use the **Crypto-Native Authentication (SIWE)** flow to obtain a JWT programmatically.

### The 3-Step SIWE Flow
1.  **Request Message**: POST `/api/siwe-messages` with your wallet address.
2.  **Sign Message**: Sign the returned message string using your private key (e.g., `wallet.signMessage(msg)`).
3.  **Login**: POST `/api/auth/login/crypto-native` with the message and signature.

### Standalone Auth Helper (Node.js)

Use this helper function to get an access token in your scripts:

```typescript
import { ethers } from 'ethers';

async function getAuthToken(privateKey: string, permissionsApiUrl: string) {
  const wallet = new ethers.Wallet(privateKey);
  const domain = 'localhost:3000'; // Or your service domain

  // 1. Request SIWE Message
  const siweRes = await fetch(`${permissionsApiUrl}/api/siwe-messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: wallet.address, domain })
  });
  if (!siweRes.ok) throw new Error('Failed to get SIWE message');
  const { msg } = await siweRes.json();

  // 2. Sign Message
  const signature = await wallet.signMessage(msg);

  // 3. Login
  const loginRes = await fetch(`${permissionsApiUrl}/api/auth/login/crypto-native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, signature })
  });
  if (!loginRes.ok) throw new Error('Failed to login');
  const { token } = await loginRes.json();

  return token;
}
```

### Usage in Scripts

```typescript
// 1. Get Token
const token = await getAuthToken(process.env.PRIVATE_KEY, 'https://permissions-api.prividium.dev');

// 2. Configure Provider with Token
const fetchReq = new ethers.FetchRequest('https://proxy.prividium.dev/rpc');
fetchReq.setHeader('Authorization', `Bearer ${token}`);
const provider = new ethers.JsonRpcProvider(fetchReq);

// 3. Deploy/Transact
// The provider is now authenticated for all calls!
const factory = new ethers.ContractFactory(abi, bytecode, new ethers.Wallet(pk, provider));
const contract = await factory.deploy();
```

### Usage in Scripts (Viem)

```typescript
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains'; // Replace with your chain

// 1. Get Token
const token = await getAuthToken(process.env.PRIVATE_KEY, 'https://permissions-api.prividium.dev');

// 2. Configure Transport with Token
const transport = http('https://proxy.prividium.dev/rpc', {
  fetchOptions: {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }
});

// 3. Create Client
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const client = createWalletClient({
  account,
  chain: mainnet,
  transport
});

// 4. Deploy/Transact
const hash = await client.deployContract({
  abi,
  bytecode
});
```

---

## Summary for the AI
If a user asks "How do I deploy?" or "How do I send a transaction?", **STOP**. Do not give standard Ethereum advice. Explain the **3-Step Rule** (Pre-fetch -> Enable -> Send) and provide the code pattern above.
If the user is writing a **script** (no browser), provide the **SIWE Helper** code above and the corresponding Ethers or Viem configuration.