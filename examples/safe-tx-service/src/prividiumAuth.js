import { config } from './config.js';
import { privateKeyToAccount } from 'viem/accounts';

let cached = { token: null, expiresAt: 0 };

function getDomainFromUrl(url) {
  return new URL(url).host;
}

export async function getServiceToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;

  const account = privateKeyToAccount(config.servicePrivateKey);
  const domain = getDomainFromUrl(config.permissionsApiBaseUrl);
  const msgRes = await fetch(`${config.permissionsApiBaseUrl}/api/siwe-messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account.address, domain })
  });
  if (!msgRes.ok) throw new Error('Failed to request SIWE message for service auth');
  const { msg } = await msgRes.json();

  const signature = await account.signMessage({ message: msg });

  const loginRes = await fetch(`${config.permissionsApiBaseUrl}/api/auth/login/crypto-native`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, signature })
  });
  if (!loginRes.ok) throw new Error('Failed to login service account');
  const { token } = await loginRes.json();
  cached = { token, expiresAt: Date.now() + 55 * 60 * 1000 };
  return token;
}

let tenantCache = { token: null, expiresAt: 0 };
async function getTenantToken() {
  if (config.tenantAuthMode !== 'siwe') return null;
  if (!config.tenantWalletPrivateKey) throw new Error('TENANT_WALLET_PRIVATE_KEY is required for TENANT_AUTH_MODE=siwe');
  if (tenantCache.token && Date.now() < tenantCache.expiresAt) return tenantCache.token;

  const account = privateKeyToAccount(config.tenantWalletPrivateKey);
  const domain = getDomainFromUrl(config.permissionsApiBaseUrl);
  const msgRes = await fetch(`${config.permissionsApiBaseUrl}/api/siwe-messages/tenants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: account.address, domain })
  });
  if (!msgRes.ok) throw new Error('Failed to request SIWE tenant message');
  const { msg } = await msgRes.json();

  const signature = await account.signMessage({ message: msg });
  const loginRes = await fetch(`${config.permissionsApiBaseUrl}/api/jwt/from-siwe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, signature })
  });
  if (!loginRes.ok) throw new Error('Failed to get tenant JWT');
  const { token } = await loginRes.json();
  tenantCache = { token, expiresAt: Date.now() + 55 * 60 * 1000 };
  return token;
}

function methodFromBody(init) {
  try {
    const body = JSON.parse(init?.body || '{}');
    return body?.method || null;
  } catch (_error) {
    return null;
  }
}

function shouldUseTenantAuth(method) {
  return method === 'eth_getBlockReceipts';
}

async function applyTenantHeaders(headers, method) {
  if (!shouldUseTenantAuth(method)) return headers;

  if (config.tenantAuthMode === 'api_key') {
    if (!config.tenantApiKey) throw new Error('TENANT_API_KEY is required for TENANT_AUTH_MODE=api_key');
    return { ...headers, 'x-api-key': config.tenantApiKey };
  }

  if (config.tenantAuthMode === 'siwe') {
    const token = await getTenantToken();
    return { ...headers, Authorization: `Bearer ${token}` };
  }

  return headers;
}

export async function authFetch(url, init = {}) {
  const serviceToken = await getServiceToken();
  const method = methodFromBody(init);
  let headers = {
    ...(init.headers || {}),
    Authorization: `Bearer ${serviceToken}`
  };

  headers = await applyTenantHeaders(headers, method);
  return fetch(url, { ...init, headers });
}
