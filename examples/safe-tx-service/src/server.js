import express from 'express';
import cors from 'cors';
import { authMiddleware } from './auth.js';
import { config } from './config.js';
import { initDb, pool } from './db.js';
import { loadContractsConfig } from './contractsConfig.js';
import {
  assertOwner,
  createProposal,
  createSafe,
  createWithdrawalProposal,
  createErc20WithdrawalProposal,
  executeProposal,
  getLatestBlockNumber,
  getProposalByHash,
  getTypedDataForProposal,
  listProposalsForSafe,
  listSafesForOwner,
  normalizeAddress,
  readSafeOnChain,
  syncExecutionsFromChain,
  upsertSafe,
  addConfirmation,
  getSafeBalances,
  listAddressBookEntries,
  createAddressBookEntry,
  updateAddressBookEntry,
  deleteAddressBookEntry,
  processPendingWithdrawals,
  retryWithdrawalFinalize
} from './safeService.js';
import { listSupportedTokens } from './tokens.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(authMiddleware(config.permissionsApiBaseUrl));

app.get('/v1/me', async (req, res) => {
  res.json({ address: req.auth.userAddress, userId: req.auth.userId || undefined });
});

app.get('/v1/safes', async (req, res) => {
  const safes = await listSafesForOwner(req.auth.userAddress);
  res.json({ results: safes });
});

app.get('/v1/safes/:safeAddress', async (req, res) => {
  await assertOwner(req.params.safeAddress, req.auth.userAddress);
  const safe = await readSafeOnChain(req.params.safeAddress);
  res.json({ safe });
});

app.post('/v1/safes', async (req, res) => {
  const { owners, threshold } = req.body;
  if (!Array.isArray(owners) || typeof threshold !== 'number') {
    return res.status(400).json({ error: 'owners[] and threshold are required' });
  }
  const uniqueOwners = [...new Set(owners.map((o) => normalizeAddress(o)))];
  if (!uniqueOwners.includes(req.auth.userAddress)) {
    return res.status(400).json({ error: 'creator must be one of the owners' });
  }
  const safe = await createSafe({ owners: uniqueOwners, threshold });
  res.status(201).json({ safe });
});

app.post('/v1/safes/:safeAddress/register', async (req, res) => {
  const safe = await readSafeOnChain(req.params.safeAddress);
  if (!safe.owners.includes(req.auth.userAddress)) {
    return res.status(403).json({ error: 'requester is not an owner on chain' });
  }
  await upsertSafe(safe);
  res.json({ safe });
});

app.get('/v1/safes/:safeAddress/transactions', async (req, res) => {
  await assertOwner(req.params.safeAddress, req.auth.userAddress);
  const results = await listProposalsForSafe(req.params.safeAddress);
  res.json({ results });
});

app.get('/v1/tokens', async (_req, res) => {
  const tokens = await listSupportedTokens();
  res.json({ tokens });
});

app.get('/v1/runtime-config', (_req, res) => {
  res.json({
    allowAdvancedCalldata: config.allowAdvancedCalldata,
    allowDelegatecall: config.allowDelegatecall,
    allowCustomTargets: config.allowCustomTargets
  });
});


app.get('/v1/safes/:safeAddress/balances', async (req, res) => {
  await assertOwner(req.params.safeAddress, req.auth.userAddress);
  const balances = await getSafeBalances(req.params.safeAddress);
  res.json(balances);
});

app.get('/v1/safes/:safeAddress/address-book', async (req, res) => {
  await assertOwner(req.params.safeAddress, req.auth.userAddress);
  const entries = await listAddressBookEntries(req.params.safeAddress);
  res.json({ entries });
});

app.post('/v1/safes/:safeAddress/address-book', async (req, res) => {
  await assertOwner(req.params.safeAddress, req.auth.userAddress);
  const { label, address } = req.body || {};
  const entry = await createAddressBookEntry({
    safeAddress: req.params.safeAddress,
    label,
    address,
    changedBy: req.auth.userAddress
  });
  res.status(201).json(entry);
});

app.put('/v1/safes/:safeAddress/address-book/:id', async (req, res) => {
  await assertOwner(req.params.safeAddress, req.auth.userAddress);
  const entry = await updateAddressBookEntry({
    safeAddress: req.params.safeAddress,
    entryId: req.params.id,
    label: req.body?.label,
    address: req.body?.address,
    changedBy: req.auth.userAddress
  });
  res.json(entry);
});

app.delete('/v1/safes/:safeAddress/address-book/:id', async (req, res) => {
  await assertOwner(req.params.safeAddress, req.auth.userAddress);
  const deleted = await deleteAddressBookEntry({
    safeAddress: req.params.safeAddress,
    entryId: req.params.id,
    changedBy: req.auth.userAddress
  });
  res.json(deleted);
});

app.post('/v1/safes/:safeAddress/transactions', async (req, res) => {
  await assertOwner(req.params.safeAddress, req.auth.userAddress);
  if (!req.body?.tx) {
    return res.status(400).json({ error: 'tx payload is required' });
  }
  const proposal = await createProposal({ safeAddress: req.params.safeAddress, createdBy: req.auth.userAddress, tx: req.body.tx });
  res.status(201).json(proposal);
});

app.post('/v1/safes/:safeAddress/withdrawals', async (req, res) => {
  await assertOwner(req.params.safeAddress, req.auth.userAddress);
  const proposal = await createWithdrawalProposal({
    safeAddress: req.params.safeAddress,
    createdBy: req.auth.userAddress,
    recipient: req.body?.recipient,
    amount: req.body?.amount
  });
  res.status(201).json(proposal);
});

app.post('/v1/safes/:safeAddress/withdrawals/erc20', async (req, res) => {
  await assertOwner(req.params.safeAddress, req.auth.userAddress);
  const proposal = await createErc20WithdrawalProposal({
    safeAddress: req.params.safeAddress,
    createdBy: req.auth.userAddress,
    tokenAddress: req.body?.tokenAddress,
    recipient: req.body?.recipient,
    amount: req.body?.amount
  });
  res.status(201).json(proposal);
});

app.post('/v1/transactions/:safeTxHash/confirmations', async (req, res) => {
  const { signature } = req.body;
  if (!signature) return res.status(400).json({ error: 'signature is required' });
  const proposal = await getProposalByHash(req.params.safeTxHash.toLowerCase());
  if (!proposal) return res.status(404).json({ error: 'proposal not found' });
  await assertOwner(proposal.safeAddress, req.auth.userAddress);
  const updated = await addConfirmation({ safeTxHash: proposal.safeTxHash, ownerAddress: req.auth.userAddress, signature });
  res.json(updated);
});

app.get('/v1/transactions/:safeTxHash/typed-data', async (req, res) => {
  const proposal = await getProposalByHash(req.params.safeTxHash.toLowerCase());
  if (!proposal) return res.status(404).json({ error: 'proposal not found' });
  await assertOwner(proposal.safeAddress, req.auth.userAddress);
  const typedData = await getTypedDataForProposal(proposal.safeTxHash);
  res.json(typedData);
});

app.post('/v1/transactions/:safeTxHash/execute', async (req, res) => {
  const proposal = await getProposalByHash(req.params.safeTxHash.toLowerCase());
  if (!proposal) return res.status(404).json({ error: 'proposal not found' });
  await assertOwner(proposal.safeAddress, req.auth.userAddress);
  const result = await executeProposal(proposal.safeTxHash);
  res.json(result);
});

app.post('/v1/withdrawals/:proposalId/retry', async (req, res) => {
  const proposal = await pool.query('SELECT id, safe_address FROM proposals WHERE id = $1', [req.params.proposalId]);
  if (!proposal.rowCount) return res.status(404).json({ error: 'proposal not found' });
  await assertOwner(proposal.rows[0].safe_address, req.auth.userAddress);
  await retryWithdrawalFinalize({ proposalId: req.params.proposalId });
  await processPendingWithdrawals();
  res.json({ ok: true });
});

app.post('/v1/admin/sync', async (req, res) => {
  if (!config.allowAdminSync) return res.status(403).json({ error: 'sync endpoint disabled' });
  const state = await pool.query('SELECT value FROM sync_state WHERE key = $1', ['last_synced_block']);
  const fromBlock = Number(state.rows[0]?.value || 0);
  const syncResult = await syncExecutionsFromChain(fromBlock);
  const latest = await getLatestBlockNumber();
  await pool.query(
    'INSERT INTO sync_state (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    ['last_synced_block', String(latest)]
  );
  res.json({ fromBlock, latest, syncResult });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Internal error' });
});

await initDb();
await loadContractsConfig();
const server = app.listen(config.port, () => {
  console.log(`safe-tx-service listening on :${config.port}`);
});

if (config.syncPollMs > 0) {
  setInterval(async () => {
    try {
      if (!config.allowAdminSync) return;
      const latest = await getLatestBlockNumber();
      const state = await pool.query('SELECT value FROM sync_state WHERE key = $1', ['last_synced_block']);
      const fromBlock = Number(state.rows[0]?.value || Math.max(latest - 500, 0));
      await syncExecutionsFromChain(fromBlock);
      await pool.query(
        'INSERT INTO sync_state (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        ['last_synced_block', String(latest)]
      );
    } catch (error) {
      console.error('Sync loop error', error);
    }
  }, config.syncPollMs);
}

if (config.withdrawalPollMs > 0) {
  setInterval(async () => {
    try {
      await processPendingWithdrawals();
    } catch (error) {
      console.error('Withdrawal loop error', error);
    }
  }, config.withdrawalPollMs);
}

process.on('SIGINT', async () => {
  server.close();
  await pool.end();
  process.exit(0);
});
