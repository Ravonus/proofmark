// Admin custodial wallet — backend signing for any signer whose
// address matches the org's system wallet. The keypair was generated
// once and the private key is sealed at /storage/system-wallets/admin.json
// with AES-256-GCM using ENCRYPTION_MASTER_KEY. Loading it requires that
// same env var to be present, so this module is a no-op in environments
// that don't have the master key wired in (dev laptops without secrets).
//
// Semantics:
//   - loadAdminWallet() reads + decrypts the sealed file. Cached per
//     process so repeated signs don't repeat disk reads. The cache is
//     intentionally never invalidated — rotating the wallet means
//     restarting the container.
//   - signMessageAsAdmin(message) signs via personalSign (the same
//     scheme browser wallets use), so the resulting signature
//     verifies through the existing recoverAddress paths without any
//     special-case code on the verifier side.
//   - isAdminWalletAddress(addr) is the gate for the "this signer
//     happens to be the org wallet, so the server signs instead of
//     waiting on the browser" branch in createDocumentPacket / finalize.
//
// Storage shape (admin.json):
//   {
//     "userId":        "<users.id of admin@agorix.io>",
//     "email":         "admin@agorix.io",
//     "chain":         "ETH",
//     "address":       "0x...",
//     "encryptedKey":  "<base64(iv(12) || tag(16) || ciphertext)>",
//     "encryption":    "aes-256-gcm",
//     "format":        "base64(iv(12) || tag(16) || ciphertext)",
//     "createdAt":     "<ISO8601>"
//   }
import { createDecipheriv } from "crypto";
import { readFile } from "fs/promises";
import { Wallet } from "ethers";

const ADMIN_WALLET_PATH = process.env.SYSTEM_ADMIN_WALLET_PATH ?? "/storage/system-wallets/admin.json";

type AdminWalletFile = {
  userId: string;
  email?: string;
  chain: string;
  address: string;
  encryptedKey: string;
  encryption?: string;
};

type LoadedAdminWallet = {
  address: string;
  chain: string;
  userId: string;
  wallet: Wallet;
};

let cached: LoadedAdminWallet | null = null;
let cacheError: Error | null = null;

function decryptPrivateKey(sealedB64: string, masterHex: string): string {
  const sealed = Buffer.from(sealedB64, "base64");
  if (sealed.length < 12 + 16 + 1) {
    throw new Error("admin-signer: sealed key too short");
  }
  const iv = sealed.subarray(0, 12);
  const tag = sealed.subarray(12, 28);
  const ciphertext = sealed.subarray(28);
  const key = Buffer.from(masterHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export async function loadAdminWallet(): Promise<LoadedAdminWallet | null> {
  if (cached) return cached;
  if (cacheError) return null;
  const masterHex = process.env.ENCRYPTION_MASTER_KEY;
  if (!masterHex) {
    cacheError = new Error("admin-signer: ENCRYPTION_MASTER_KEY not set");
    console.warn("[admin-signer]", cacheError.message);
    return null;
  }
  let raw: string;
  try {
    raw = await readFile(ADMIN_WALLET_PATH, "utf8");
  } catch (err) {
    cacheError = err as Error;
    console.warn(`[admin-signer] no sealed key at ${ADMIN_WALLET_PATH}: ${(err as Error).message}`);
    return null;
  }
  let parsed: AdminWalletFile;
  try {
    parsed = JSON.parse(raw) as AdminWalletFile;
  } catch (err) {
    cacheError = err as Error;
    console.warn("[admin-signer] sealed key file is not valid JSON:", (err as Error).message);
    return null;
  }
  let pkHex: string;
  try {
    pkHex = decryptPrivateKey(parsed.encryptedKey, masterHex);
  } catch (err) {
    cacheError = err as Error;
    console.warn("[admin-signer] decrypt failed:", (err as Error).message);
    return null;
  }
  const wallet = new Wallet(pkHex.startsWith("0x") ? pkHex : `0x${pkHex}`);
  if (wallet.address.toLowerCase() !== parsed.address.toLowerCase()) {
    cacheError = new Error(`admin-signer: decrypted key derives ${wallet.address} but file claims ${parsed.address}`);
    console.error("[admin-signer]", cacheError.message);
    return null;
  }
  cached = {
    address: parsed.address,
    chain: parsed.chain,
    userId: parsed.userId,
    wallet,
  };
  return cached;
}

/** Sign a plaintext message using the admin custodial wallet via the
 *  same personalSign scheme browser wallets use. Returns null when the
 *  sealed key isn't available so callers can fall back to the regular
 *  browser-sign path without crashing. */
export async function signMessageAsAdmin(
  message: string,
): Promise<{ address: string; signature: string; chain: string } | null> {
  const loaded = await loadAdminWallet();
  if (!loaded) return null;
  const signature = await loaded.wallet.signMessage(message);
  return { address: loaded.address, signature, chain: loaded.chain };
}

/** True when the given address is the org's custodial wallet — the
 *  trigger for server-side auto-signing on contract creation and
 *  finalization. Case-insensitive ETH compare. */
export async function isAdminWalletAddress(address: string | null | undefined): Promise<boolean> {
  if (!address) return false;
  const loaded = await loadAdminWallet();
  if (!loaded) return false;
  return loaded.address.toLowerCase() === address.toLowerCase();
}

/** Public accessor for the admin address — synchronous when the
 *  cache is warm, otherwise loads first. Used by callers that want to
 *  know "is signer.address admin?" without doing the lookup themselves. */
export async function getAdminWalletAddress(): Promise<string | null> {
  const loaded = await loadAdminWallet();
  return loaded?.address ?? null;
}
