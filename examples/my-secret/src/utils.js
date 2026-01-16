export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function formatAddress(address) {
  if (!address) return 'Unknown';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatTimestamp(seconds) {
  if (!seconds) return 'Unknown time';
  return new Date(Number(seconds) * 1000).toLocaleString();
}

export function timeAgo(seconds) {
  if (!seconds) return '';
  const diffMs = Date.now() - Number(seconds) * 1000;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function explorerTxUrl(chain, hash) {
  const baseUrl = chain?.blockExplorers?.default?.url;
  if (!baseUrl) return '';
  return `${baseUrl.replace(/\/$/, '')}/tx/${hash}`;
}
