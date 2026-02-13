import fs from 'node:fs/promises';
import { getAddress } from 'viem';
import { config } from './config.js';
import { getAllConfig } from './configStore.js';

const REQUIRED_KEYS = [
  'safe_factory_address',
  'safe_singleton_address',
  'safe_fallback_handler_address',
  'safe_multisend_address'
];

function normalize(address) {
  return getAddress(address).toLowerCase();
}

async function readSharedContracts(path) {
  try {
    const raw = await fs.readFile(path, 'utf8');
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function mergeAndValidate({ fromDb, fromFile }) {
  const merged = {
    safe_factory_address: fromDb.safe_factory_address || fromFile?.safe_factory_address || config.safeFactoryAddress,
    safe_singleton_address: fromDb.safe_singleton_address || fromFile?.safe_singleton_address || config.safeSingletonAddress,
    safe_fallback_handler_address: fromDb.safe_fallback_handler_address || fromFile?.safe_fallback_handler_address || config.safeFallbackHandlerAddress,
    safe_multisend_address: fromDb.safe_multisend_address || fromFile?.safe_multisend_address || config.multisendAddress
  };

  const missing = REQUIRED_KEYS.filter((key) => !merged[key]);
  if (missing.length) {
    throw new Error(`Missing required Safe contract addresses: ${missing.join(', ')}. Run init container or set environment variables.`);
  }

  return {
    safeFactoryAddress: normalize(merged.safe_factory_address),
    safeSingletonAddress: normalize(merged.safe_singleton_address),
    safeFallbackHandlerAddress: normalize(merged.safe_fallback_handler_address),
    multisendAddress: normalize(merged.safe_multisend_address)
  };
}

export async function loadContractsConfig() {
  const dbConfig = await getAllConfig();
  const fileConfig = await readSharedContracts(config.sharedContractsPath);
  const resolved = mergeAndValidate({ fromDb: dbConfig, fromFile: fileConfig });

  config.safeFactoryAddress = resolved.safeFactoryAddress;
  config.safeSingletonAddress = resolved.safeSingletonAddress;
  config.safeFallbackHandlerAddress = resolved.safeFallbackHandlerAddress;
  config.multisendAddress = resolved.multisendAddress;

  return resolved;
}
