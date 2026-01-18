export function formatAddress(address) {
  if (!address) return 'Unknown';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatNumber(value) {
  if (!value) return '0';
  return new Intl.NumberFormat().format(value);
}

export function formatTimestamp(seconds) {
  if (!seconds) return 'Unknown';
  return new Date(Number(seconds) * 1000).toLocaleString();
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
