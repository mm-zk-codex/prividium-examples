import fs from 'node:fs/promises';
import path from 'node:path';
import { createWalletClient, getAddress, http, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { initDb, pool } from '../src/db.js';
import { getAllConfig, setConfig } from '../src/configStore.js';

const REQUIRED_KEYS = [
  'safe_factory_address',
  'safe_singleton_address',
  'safe_fallback_handler_address',
  'safe_multisend_address'
];

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function normalize(address) {
  return getAddress(address).toLowerCase();
}

async function waitForPostgres(maxAttempts = 30) {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (_error) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('Postgres did not become ready in time');
}

function readBytecode(name) {
  const value = process.env[name] || '';
  if (!/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error(`${name} must be provided as hex bytecode`);
  }
  return value;
}

async function deployContracts() {
  const deployerPk = required('DEPLOYER_PRIVATE_KEY');
  const rpcUrl = required('PRIVIDIUM_RPC_URL');

  const account = privateKeyToAccount(deployerPk);
  const client = createWalletClient({ account, transport: http(rpcUrl) });

  const singletonHash = await client.deployContract({ abi: [], bytecode: readBytecode('SAFE_SINGLETON_BYTECODE') });
  const singletonReceipt = await client.waitForTransactionReceipt({ hash: singletonHash });

  const factoryHash = await client.deployContract({ abi: [], bytecode: readBytecode('SAFE_FACTORY_BYTECODE') });
  const factoryReceipt = await client.waitForTransactionReceipt({ hash: factoryHash });

  const fallbackHash = await client.deployContract({ abi: [], bytecode: readBytecode('SAFE_FALLBACK_HANDLER_BYTECODE') });
  const fallbackReceipt = await client.waitForTransactionReceipt({ hash: fallbackHash });

  const multiSendHash = await client.deployContract({ abi: [], bytecode: readBytecode('SAFE_MULTISEND_BYTECODE') });
  const multiSendReceipt = await client.waitForTransactionReceipt({ hash: multiSendHash });

  const deployed = {
    safe_factory_address: normalize(factoryReceipt.contractAddress),
    safe_singleton_address: normalize(singletonReceipt.contractAddress),
    safe_fallback_handler_address: normalize(fallbackReceipt.contractAddress),
    safe_multisend_address: normalize(multiSendReceipt.contractAddress)
  };

  for (const [key, value] of Object.entries(deployed)) {
    if (!isAddress(value)) throw new Error(`Deployment failed for ${key}`);
  }
  return deployed;
}

async function writeSharedContracts(contracts) {
  const outPath = process.env.CONTRACTS_JSON_PATH || '/shared/contracts.json';
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(contracts, null, 2)}\n`, 'utf8');
}

async function main() {
  await waitForPostgres();
  await initDb();

  const existing = await getAllConfig();
  const complete = REQUIRED_KEYS.every((key) => existing[key]);
  if (complete) {
    console.log('already initialized');
    await writeSharedContracts(existing);
    return;
  }

  const deployed = await deployContracts();
  for (const [key, value] of Object.entries(deployed)) {
    await setConfig(key, value);
  }
  await writeSharedContracts(deployed);
  console.log('initialized safe contracts');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
