import { keccak256, toHex } from 'viem';

export const L2_CHAIN_ID = Number(import.meta.env.VITE_L2_CHAIN_ID || '270');
export const L1_CHAIN_ID = Number(import.meta.env.VITE_L1_CHAIN_ID || '1');
export const L1_CHAIN_NAME = import.meta.env.VITE_L1_CHAIN_NAME || 'Ethereum';
export const L1_EXPLORER_URL = import.meta.env.VITE_L1_EXPLORER_URL || 'https://etherscan.io';

export const BRIDGEHUB_ADDRESS =
  import.meta.env.VITE_BRIDGEHUB_ADDRESS || '0x0000000000000000000000000000000000000000';
export const PRIVATE_PAY_L2_ADDRESS =
  import.meta.env.VITE_PRIVATE_PAY_L2_ADDRESS || '0x0000000000000000000000000000000000000000';

export const PUBLIC_KEY =
  import.meta.env.VITE_PRIVATE_PAY_PUBLIC_KEY ||
  '0x02c51b1d5d8b6f8a4d9e0751f94ee0483c02a43f5230b2a190d7c1d28196d7e79a';

export const L2_GAS_LIMIT_DEFAULT = BigInt(import.meta.env.VITE_L2_GAS_LIMIT || '300000');
export const L2_GAS_PER_PUBDATA_DEFAULT = BigInt(import.meta.env.VITE_L2_GAS_PER_PUBDATA || '800');
export const MINT_VALUE_DEFAULT = BigInt(
  import.meta.env.VITE_MINT_VALUE_DEFAULT || '82500523200050'
);
export const REFUND_RECIPIENT_DEFAULT =
  import.meta.env.VITE_REFUND_RECIPIENT_DEFAULT || '0x0000000000000000000000000000000000000000';

export const CONTEXT = keccak256(toHex('private-pay:v1'));
