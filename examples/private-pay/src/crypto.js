import { secp256k1 } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes } from 'viem';

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

export async function encryptRecipient({ recipientHex, aadHex, publicKeyHex, plaintextHex }) {
  const publicKeyBytes = hexToBytes(publicKeyHex);
  const ephemeralPrivateKey = secp256k1.utils.randomPrivateKey();
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralPrivateKey, true);
  const sharedSecret = secp256k1.getSharedSecret(ephemeralPrivateKey, publicKeyBytes, false);
  const sharedKeyMaterial = sharedSecret.slice(1, 33);
  const hashed = await crypto.subtle.digest('SHA-256', sharedKeyMaterial);
  const keyBytes = new Uint8Array(hashed);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
  const plaintextBytes = hexToBytes(plaintextHex);
  const aadBytes = hexToBytes(aadHex);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadBytes },
    aesKey,
    plaintextBytes
  );
  const ciphertext = new Uint8Array(encrypted);
  const payload = concatBytes(ephemeralPublicKey, iv, ciphertext);
  return {
    ciphertextHex: bytesToHex(payload),
    ephemeralPublicKey: bytesToHex(ephemeralPublicKey),
    recipientHex,
    ivHex: bytesToHex(iv)
  };
}
