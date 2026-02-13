import dotenv from 'dotenv';
import { getAddress } from 'viem';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function normalizeAddress(address) {
  return getAddress(address).toLowerCase();
}

function optionalAddress(name) {
  const value = process.env[name];
  return value ? normalizeAddress(value) : null;
}

export const config = {
  port: Number(process.env.PORT || 4010),
  databaseUrl: required('DATABASE_URL'),
  rpcUrl: required('PRIVIDIUM_RPC_URL'),
  l1RpcUrl: required('L1_RPC_URL'),
  bridgehubAddress: process.env.L1_BRIDGEHUB_ADDRESS || null,
  l1AssetRouterAddress: process.env.L1_ASSET_ROUTER_ADDRESS || null,
  l1NullifierAddress: process.env.L1_NULLIFIER_ADDRESS || null,
  l1RelayerPrivateKey: required('L1_RELAYER_PRIVATE_KEY'),
  permissionsApiBaseUrl: required('PRIVIDIUM_PERMISSIONS_API_BASE_URL'),
  chainId: Number(required('CHAIN_ID')),
  l2ChainId: Number(required('L2_CHAIN_ID')),
  servicePrivateKey: required('SERVICE_PRIVATE_KEY'),
  multisendAddress: optionalAddress('MULTISEND_ADDRESS'),
  safeFactoryAddress: optionalAddress('SAFE_FACTORY_ADDRESS'),
  safeSingletonAddress: optionalAddress('SAFE_SINGLETON_ADDRESS'),
  safeFallbackHandlerAddress: optionalAddress('SAFE_FALLBACK_HANDLER_ADDRESS'),
  allowAdminSync: process.env.ALLOW_ADMIN_SYNC === 'true',
  syncPollMs: Number(process.env.SYNC_POLL_MS || 0),
  nativeSymbol: process.env.NATIVE_SYMBOL || 'ETH',
  nativeDecimals: Number(process.env.NATIVE_DECIMALS || 18),
  withdrawalPollMs: Number(process.env.WITHDRAWAL_POLL_MS || 10000),
  sharedContractsPath: process.env.CONTRACTS_JSON_PATH || '/shared/contracts.json',
  tenantAuthMode: process.env.TENANT_AUTH_MODE || 'none',
  tenantApiKey: process.env.TENANT_API_KEY || null,
  tenantWalletPrivateKey: process.env.TENANT_WALLET_PRIVATE_KEY || null,
  allowAdvancedCalldata: process.env.ALLOW_ADVANCED_CALLDATA === 'true',
  allowDelegatecall: process.env.ALLOW_DELEGATECALL === 'true',
  allowCustomTargets: process.env.ALLOW_CUSTOM_TARGETS === 'true'
};

if (!config.l1NullifierAddress && !config.bridgehubAddress && !config.l1AssetRouterAddress) {
  throw new Error('Set L1_NULLIFIER_ADDRESS or provide L1_BRIDGEHUB_ADDRESS / L1_ASSET_ROUTER_ADDRESS for nullifier discovery');
}
