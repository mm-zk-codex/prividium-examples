export const L1_CHAIN_ID = Number(import.meta.env.VITE_L1_CHAIN_ID || '1');
export const L2_CHAIN_ID = Number(import.meta.env.VITE_L2_CHAIN_ID || '270');

export const L1_RPC_URL =
  import.meta.env.VITE_L1_RPC_URL || 'http://localhost:8545';

export const BRIDGEHUB_ADDRESS =
  import.meta.env.VITE_BRIDGEHUB_ADDRESS || '0x0000000000000000000000000000000000000000';

export const KEY_DIRECTORY_L1_ADDRESS =
  import.meta.env.VITE_KEY_DIRECTORY_L1_ADDRESS ||
  '0x0000000000000000000000000000000000000000';

export const PRIVATEPAY_INBOX_L2_ADDRESS =
  import.meta.env.VITE_PRIVATEPAY_INBOX_L2_ADDRESS ||
  '0x0000000000000000000000000000000000000000';

export const L2_GAS_LIMIT = BigInt(import.meta.env.VITE_L2_GAS_LIMIT || '300000');
export const L2_GAS_PER_PUBDATA = BigInt(
  import.meta.env.VITE_L2_GAS_PER_PUBDATA || '800'
);

export const CONTEXT_STRING = 'PRIVATEPAY_INBOX_V1';
