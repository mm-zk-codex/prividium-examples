import { bytesToHex, hexToBytes, keccak256 } from 'viem';

function concatBytes(...arrays) {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((arr) => {
    result.set(arr, offset);
    offset += arr.length;
  });
  return result;
}

export function encryptRecipient({ recipientHex, aadHex, publicKeyHex, plaintextHex }) {
  const keyBytes = hexToBytes(publicKeyHex);
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const aadBytes = hexToBytes(aadHex);
  const plaintextBytes = hexToBytes(plaintextHex);
  const maskHex = keccak256(concatBytes(keyBytes, aadBytes, nonce));
  const maskBytes = hexToBytes(maskHex);
  const ciphertext = new Uint8Array(plaintextBytes.length);
  for (let i = 0; i < plaintextBytes.length; i += 1) {
    ciphertext[i] = plaintextBytes[i] ^ maskBytes[i];
  }
  const payload = concatBytes(nonce, ciphertext);
  return {
    ciphertextHex: bytesToHex(payload),
    recipientHex,
    nonceHex: bytesToHex(nonce)
  };
}
