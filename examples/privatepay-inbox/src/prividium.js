import { createPrividiumChain } from 'prividium';
import { defineChain } from 'viem';
import { L2_CHAIN_ID } from './config.js';

const chainName = import.meta.env.VITE_PRIVIDIUM_CHAIN_NAME || 'Prividium';
const rpcUrl = import.meta.env.VITE_PRIVIDIUM_RPC_URL || 'https://proxy.prividium.dev/rpc';
const authBaseUrl =
  import.meta.env.VITE_PRIVIDIUM_AUTH_BASE_URL || 'https://user-panel.prividium.dev';
const prividiumApiBaseUrl =
  import.meta.env.VITE_PRIVIDIUM_PERMISSIONS_API_URL || 'https://permissions-api.prividium.dev';
const explorerUrl = import.meta.env.VITE_PRIVIDIUM_EXPLORER_URL;

const chain = defineChain({
  id: L2_CHAIN_ID,
  name: chainName,
  nativeCurrency: {
    name: import.meta.env.VITE_PRIVIDIUM_NATIVE_NAME || 'ETH',
    symbol: import.meta.env.VITE_PRIVIDIUM_NATIVE_SYMBOL || 'ETH',
    decimals: Number(import.meta.env.VITE_PRIVIDIUM_NATIVE_DECIMALS || '18')
  },
  rpcUrls: {
    default: {
      http: [rpcUrl]
    }
  },
  blockExplorers: explorerUrl
    ? {
      default: {
        name: 'Explorer',
        url: explorerUrl
      }
    }
    : undefined
});

const redirectUrl =
  import.meta.env.VITE_PRIVIDIUM_REDIRECT_URL || `${window.location.origin}/auth/callback.html`;

export const prividium = createPrividiumChain({
  clientId: import.meta.env.VITE_PRIVIDIUM_CLIENT_ID,
  chain,
  rpcUrl,
  authBaseUrl,
  prividiumApiBaseUrl,
  redirectUrl,
  onAuthExpiry: () => {
    window.alert('Your Prividium session expired. Please reconnect.');
  }
});
