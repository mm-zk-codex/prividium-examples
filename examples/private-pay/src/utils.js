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

export function explorerTxUrl(baseUrl, hash) {
  if (!baseUrl || !hash) return '';
  return `${baseUrl.replace(/\/$/, '')}/tx/${hash}`;
}

export function formatUnitsDisplay(value, decimals = 18) {
  if (value === null || value === undefined) return '—';
  const asString = value.toString();
  if (decimals === 0) return asString;
  const padded = asString.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
