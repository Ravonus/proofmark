/**
 * Client-side zero-knowledge key vault.
 *
 * The DEK (Data Encryption Key) is generated and managed entirely
 * in the browser. The server ONLY stores encrypted blobs — it can
 * never decrypt user data.
 *
 * Supported unlock methods:
 * - PASSWORD: Argon2id(password, salt) → KEK → wraps DEK
 * - DEVICE_PASSCODE: WebAuthn PRF extension → KEK → wraps DEK
 * - HARDWARE_KEY: FIDO2 hardware key PRF → KEK → wraps DEK
 * - TOTP_2FA: HKDF(totp_secret + recovery_key) → KEK → wraps DEK
 *
 * All crypto operations use Web Crypto API (SubtleCrypto).
 */

const ALGO = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT_LENGTH = 32;
const TAG_LENGTH = 128; // bits

/* ---------- DEK generation ---------- */

/** Generate a new random DEK. Returns raw key bytes. */
export async function generateDek(): Promise<ArrayBuffer> {
  const key = await crypto.subtle.generateKey({ name: ALGO, length: KEY_LENGTH }, true, ["encrypt", "decrypt"]);
  return crypto.subtle.exportKey("raw", key);
}

/* ---------- KEK derivation ---------- */

/** Derive a KEK from a password using PBKDF2 (Argon2id would be ideal but
 *  isn't available in Web Crypto — use PBKDF2 with high iterations as fallback.
 *  For production, use argon2-browser WASM module). */
export async function deriveKekFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 600_000, // OWASP recommendation for PBKDF2-SHA256
      hash: "SHA-256",
    },
    keyMaterial,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/** Derive a KEK from WebAuthn PRF output (device passcode / hardware key). */
export async function deriveKekFromPrf(prfOutput: ArrayBuffer, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: new TextEncoder().encode("proofmark-vault-kek"),
    },
    keyMaterial,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/** Derive a KEK from a TOTP secret + recovery key combination. */
export async function deriveKekFromTotp(totpSecret: string, recoveryKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const combined = new TextEncoder().encode(totpSecret + ":" + recoveryKey);
  const keyMaterial = await crypto.subtle.importKey("raw", combined, "HKDF", false, ["deriveKey"]);

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: new TextEncoder().encode("proofmark-vault-totp-kek"),
    },
    keyMaterial,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/* ---------- DEK wrap / unwrap ---------- */

/** Wrap (encrypt) the DEK with a KEK. Returns base64 string: [iv][wrapped][tag]. */
export async function wrapDek(dekRaw: ArrayBuffer, kek: CryptoKey): Promise<string> {
  const dek = await crypto.subtle.importKey("raw", dekRaw, { name: ALGO, length: KEY_LENGTH }, true, [
    "encrypt",
    "decrypt",
  ]);

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const wrapped = await crypto.subtle.wrapKey("raw", dek, kek, {
    name: ALGO,
    iv,
    tagLength: TAG_LENGTH,
  });

  // Concat: [12 bytes iv][wrapped key bytes]
  const result = new Uint8Array(iv.length + wrapped.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(wrapped), iv.length);

  return bufferToBase64(result);
}

/** Unwrap (decrypt) the DEK using a KEK. Returns raw DEK bytes. */
export async function unwrapDek(wrappedBase64: string, kek: CryptoKey): Promise<ArrayBuffer> {
  const data = base64ToBuffer(wrappedBase64);
  const iv = data.slice(0, IV_LENGTH);
  const wrapped = data.slice(IV_LENGTH);

  const dek = await crypto.subtle.unwrapKey(
    "raw",
    wrapped,
    kek,
    { name: ALGO, iv, tagLength: TAG_LENGTH },
    { name: ALGO, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );

  return crypto.subtle.exportKey("raw", dek);
}

/* ---------- Data encryption with DEK ---------- */

/** Encrypt arbitrary data with the DEK. */
export async function encryptWithDek(data: ArrayBuffer, dekRaw: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey("raw", dekRaw, { name: ALGO, length: KEY_LENGTH }, false, ["encrypt"]);

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encrypted = await crypto.subtle.encrypt({ name: ALGO, iv, tagLength: TAG_LENGTH }, key, data);

  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);

  return bufferToBase64(result);
}

/** Decrypt data with the DEK. */
export async function decryptWithDek(encryptedBase64: string, dekRaw: ArrayBuffer): Promise<ArrayBuffer> {
  const data = base64ToBuffer(encryptedBase64);
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);

  const key = await crypto.subtle.importKey("raw", dekRaw, { name: ALGO, length: KEY_LENGTH }, false, ["decrypt"]);

  return crypto.subtle.decrypt({ name: ALGO, iv, tagLength: TAG_LENGTH }, key, ciphertext);
}

/* ---------- Wallet generation ---------- */

/**
 * Generate wallet keypairs for all 3 chains, encrypted with the user's DEK.
 * Returns public info (address, pubkey) + encrypted private keys.
 */
export async function generateManagedWallets(dekRaw: ArrayBuffer): Promise<{
  base: { address: string; publicKey: string; encryptedPrivateKey: string };
  sol: { address: string; publicKey: string; encryptedPrivateKey: string };
  btc: { address: string; publicKey: string; encryptedPrivateKey: string };
}> {
  // These use dynamic imports so the vault module stays small
  // and only loads chain-specific libs when needed
  const [baseWallet, solWallet, btcWallet] = await Promise.all([
    generateEvmWallet(dekRaw),
    generateSolWallet(dekRaw),
    generateBtcWallet(dekRaw),
  ]);

  return { base: baseWallet, sol: solWallet, btc: btcWallet };
}

async function generateEvmWallet(dekRaw: ArrayBuffer) {
  // Generate a random 32-byte private key
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));

  // Derive public key and address using Web Crypto (secp256k1 not in SubtleCrypto,
  // so we use ethers for address derivation)
  const { ethers } = await import("ethers");
  const wallet = new ethers.Wallet(bufferToHex(privateKeyBytes));

  const encryptedPrivateKey = await encryptWithDek(privateKeyBytes.buffer, dekRaw);

  return {
    address: wallet.address,
    publicKey: wallet.signingKey.publicKey,
    encryptedPrivateKey,
  };
}

async function generateSolWallet(dekRaw: ArrayBuffer) {
  // Solana uses Ed25519 — generate 64-byte keypair
  const { Keypair } = await import("@solana/web3.js");
  const keypair = Keypair.generate();

  const encryptedPrivateKey = await encryptWithDek(new Uint8Array(keypair.secretKey).buffer, dekRaw);

  return {
    address: keypair.publicKey.toBase58(),
    publicKey: bufferToBase64(keypair.publicKey.toBytes()),
    encryptedPrivateKey,
  };
}

async function generateBtcWallet(dekRaw: ArrayBuffer) {
  // Generate taproot (P2TR) keypair using @scure/btc-signer
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));

  // We'll compute the address server-side or use a minimal derivation here
  // For now, store the raw private key encrypted and derive address from pubkey
  const { schnorr } = await import("@noble/curves/secp256k1");
  const pubKey = schnorr.getPublicKey(privateKeyBytes);

  const encryptedPrivateKey = await encryptWithDek(privateKeyBytes.buffer, dekRaw);

  return {
    address: "", // Derived server-side from pubkey (needs network param)
    publicKey: bufferToHex(pubKey),
    encryptedPrivateKey,
  };
}

/* ---------- Document key sharing ---------- */

/**
 * Encrypt a document DEK for a specific recipient's public key.
 * Uses ECDH key agreement to create a shared secret, then AES-wraps the doc DEK.
 *
 * For Base/SOL: the encrypted key is stored on-chain in a contract
 * that only the recipient can call to retrieve it.
 *
 * For BTC: stored as an ordinal child inscription under the recipient's parent.
 */
export async function encryptDocumentKeyForRecipient(params: {
  documentDek: ArrayBuffer;
  recipientPublicKey: string;
  chain: "BASE" | "SOL" | "BTC";
}): Promise<string> {
  // Generate an ephemeral keypair for ECDH
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);

  // Import recipient's public key
  const recipientKeyData = base64ToBuffer(params.recipientPublicKey);
  const recipientKey = await crypto.subtle.importKey(
    "raw",
    recipientKeyData as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // Derive shared secret
  const sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: recipientKey },
    ephemeral.privateKey,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ["wrapKey"],
  );

  // Wrap the document DEK
  const docKey = await crypto.subtle.importKey("raw", params.documentDek, { name: ALGO, length: KEY_LENGTH }, true, [
    "encrypt",
    "decrypt",
  ]);

  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const wrapped = await crypto.subtle.wrapKey("raw", docKey, sharedKey, {
    name: ALGO,
    iv,
    tagLength: TAG_LENGTH,
  });

  // Export ephemeral public key
  const ephemeralPub = await crypto.subtle.exportKey("raw", ephemeral.publicKey);

  // Package: [ephemeral_pubkey_len][ephemeral_pubkey][iv][wrapped_key]
  const pubBytes = new Uint8Array(ephemeralPub);
  const result = new Uint8Array(2 + pubBytes.length + iv.length + wrapped.byteLength);
  const view = new DataView(result.buffer);
  view.setUint16(0, pubBytes.length);
  result.set(pubBytes, 2);
  result.set(iv, 2 + pubBytes.length);
  result.set(new Uint8Array(wrapped), 2 + pubBytes.length + iv.length);

  return bufferToBase64(result);
}

/* ---------- Utility ---------- */

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

function bufferToBase64(buffer: Uint8Array | ArrayBuffer): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
