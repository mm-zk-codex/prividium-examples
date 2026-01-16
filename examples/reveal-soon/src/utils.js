export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function formatAddress(address) {
  if (!address) return 'Unknown';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatTimestamp(seconds) {
  if (!seconds) return 'Unknown time';
  return new Date(Number(seconds) * 1000).toLocaleString();
}

export function timeAgo(seconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!seconds) return '';
  const diffMs = (nowSeconds - Number(seconds)) * 1000;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function formatCountdown(targetSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  const remaining = Number(targetSeconds) - Number(nowSeconds);
  if (Number.isNaN(remaining)) return '';
  if (remaining <= 0) return 'revealed';
  const minutes = Math.floor(remaining / 60);
  const secs = remaining % 60;
  if (minutes < 1) return `${secs}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return `${minutes}m ${secs}s`;
  const days = Math.floor(hours / 24);
  if (days < 1) return `${hours}h ${minutes % 60}m`;
  return `${days}d ${hours % 24}h`;
}

export function formatRelative(targetSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  const diff = Number(targetSeconds) - Number(nowSeconds);
  if (Number.isNaN(diff)) return '';
  const abs = Math.abs(diff);
  const minutes = Math.floor(abs / 60);
  if (minutes < 1) return diff >= 0 ? 'in seconds' : 'moments ago';
  if (minutes < 60) return diff >= 0 ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return diff >= 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return diff >= 0 ? `in ${days}d` : `${days}d ago`;
}

export function explorerTxUrl(chain, hash) {
  const baseUrl = chain?.blockExplorers?.default?.url;
  if (!baseUrl) return '';
  return `${baseUrl.replace(/\/$/, '')}/tx/${hash}`;
}

export function truncateMiddle(value, left = 6, right = 4) {
  if (!value) return '';
  if (value.length <= left + right + 1) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

export async function copyToClipboard(value) {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (error) {
    console.error('Copy failed', error);
    return false;
  }
}
