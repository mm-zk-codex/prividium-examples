import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bytesToHex, hexToBytes } from 'viem';

const PRIVATEPAY_INFO = new TextEncoder().encode('privatepay-inbox-key');
const DEPOSIT_ID_BYTES = 32;
const EPHEMERAL_PUB_BYTES = 32;
const NONCE_BYTES = 24;

export function generateKeyPair() {
  const privKey = x25519.utils.randomPrivateKey();
  const pubKey = x25519.getPublicKey(privKey);
  return {
    privKey: bytesToHex(privKey),
    pubKey: bytesToHex(pubKey)
  };
}

export function bundleCiphertext({ depositId, ephemeralPub, nonce, sealed }) {
  return bytesToHex(concatBytes(depositId, ephemeralPub, nonce, sealed));
}

export function parseCiphertextBundle(bundleHex) {
  const data = hexToBytes(bundleHex);
  const total = data.length;
  if (total < DEPOSIT_ID_BYTES + EPHEMERAL_PUB_BYTES + NONCE_BYTES + 1) {
    throw new Error('Ciphertext bundle too short');
  }
  const depositId = data.slice(0, DEPOSIT_ID_BYTES);
  const ephemeralPub = data.slice(DEPOSIT_ID_BYTES, DEPOSIT_ID_BYTES + EPHEMERAL_PUB_BYTES);
  const nonce = data.slice(
    DEPOSIT_ID_BYTES + EPHEMERAL_PUB_BYTES,
    DEPOSIT_ID_BYTES + EPHEMERAL_PUB_BYTES + NONCE_BYTES
  );
  const sealed = data.slice(DEPOSIT_ID_BYTES + EPHEMERAL_PUB_BYTES + NONCE_BYTES);
  return { depositId, ephemeralPub, nonce, sealed };
}

export function encryptPayload({ recipientPubKeyHex, plaintext, aad }) {
  const recipientPubKey = hexToBytes(recipientPubKeyHex);
  const ephemeralPriv = x25519.utils.randomPrivateKey();
  const ephemeralPub = x25519.getPublicKey(ephemeralPriv);
  const sharedSecret = x25519.getSharedSecret(ephemeralPriv, recipientPubKey);
  const key = hkdf(sha256, sharedSecret, sha256(aad), PRIVATEPAY_INFO, 32);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const aead = xchacha20poly1305(key, nonce, aad);
  const sealed = aead.encrypt(plaintext);
  return { ephemeralPub, nonce, sealed };
}

export function decryptPayload({ privKeyHex, bundleHex, aadBuilder }) {
  const privKey = hexToBytes(privKeyHex);
  const { depositId, ephemeralPub, nonce, sealed } = parseCiphertextBundle(bundleHex);
  const depositIdHex = bytesToHex(depositId);
  const aad = aadBuilder(depositIdHex);
  const sharedSecret = x25519.getSharedSecret(privKey, ephemeralPub);
  const key = hkdf(sha256, sharedSecret, sha256(aad), PRIVATEPAY_INFO, 32);
  const aead = xchacha20poly1305(key, nonce, aad);
  const plaintext = aead.decrypt(sealed);
  return { plaintext, depositIdHex };
}

export function concatBytes(...arrays) {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((arr) => {
    output.set(arr, offset);
    offset += arr.length;
  });
  return output;
}
