/**
 * Document encryption at rest using AES-256-GCM.
 *
 * Each document gets its own random encryption key (DEK).
 * The DEK is wrapped (encrypted) with a server master key (KEK).
 * This allows future key rotation without re-encrypting documents.
 *
 * Master key: derived from ENCRYPTION_MASTER_KEY env var via HKDF.
 * If not set, encryption at rest is disabled and documents are stored plaintext.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * Derive the master key from the env var using HKDF.
 * Returns null if no master key is configured.
 */
function getMasterKey(): Buffer | null {
  const masterSecret = process.env.ENCRYPTION_MASTER_KEY;
  if (!masterSecret) return null;

  return Buffer.from(hkdfSync("sha256", masterSecret, "proofmark-at-rest", "encryption-key", 32));
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns base64-encoded blob: [12 bytes IV][ciphertext][16 bytes tag]
 */
function aesEncrypt(key: Buffer, plaintext: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

/**
 * Decrypt AES-256-GCM ciphertext.
 */
function aesDecrypt(key: Buffer, ciphertextBase64: string): Buffer {
  const blob = Buffer.from(ciphertextBase64, "base64");
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const encrypted = blob.subarray(IV_LEN, blob.length - TAG_LEN);

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Check if encryption at rest is available.
 */
export function isEncryptionAvailable(): boolean {
  return getMasterKey() !== null;
}

/**
 * Encrypt a document's content for storage.
 * Returns the encrypted content and the wrapped DEK.
 */
export function encryptDocument(content: string): {
  encryptedContent: string;
  wrappedKey: string;
} | null {
  const masterKey = getMasterKey();
  if (!masterKey) return null;

  // Generate a random document encryption key (DEK)
  const dek = randomBytes(32);

  // Encrypt the content with the DEK
  const encryptedContent = aesEncrypt(dek, Buffer.from(content, "utf-8"));

  // Wrap (encrypt) the DEK with the master key
  const wrappedKey = aesEncrypt(masterKey, dek);

  return { encryptedContent, wrappedKey };
}

/**
 * Decrypt a document's content.
 */
export function decryptDocument(encryptedContent: string, wrappedKey: string): string {
  const masterKey = getMasterKey();
  if (!masterKey) throw new Error("Encryption master key not configured");

  // Unwrap the DEK
  const dek = aesDecrypt(masterKey, wrappedKey);

  // Decrypt the content
  return aesDecrypt(dek, encryptedContent).toString("utf-8");
}
