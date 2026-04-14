/**
 * Client-side storage for signatures and initials.
 * Allows reuse across contracts on the same device.
 * Stored in localStorage keyed by wallet address or email.
 */

const STORAGE_KEY = "pm-saved-signatures";
const MAX_STORED = 5; // Keep last 5 signatures per type

export type SavedSignature = {
  type: "signature" | "initials";
  dataUrl: string;
  /** When this was last used */
  usedAt: number;
  /** Which document it was first drawn for */
  firstDocId?: string;
};

type StoredData = {
  version: 1;
  /** Keyed by signer identity (address or email) */
  signers: Record<string, SavedSignature[]>;
};

function getStore(): StoredData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: 1, signers: {} };
    const parsed = JSON.parse(raw) as StoredData;
    if (parsed.version !== 1) return { version: 1, signers: {} };
    return parsed;
  } catch {
    return { version: 1, signers: {} };
  }
}

function setStore(data: StoredData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

function signerKey(identity: string): string {
  return identity.toLowerCase().trim();
}

/**
 * Save a drawn signature or initials for later reuse.
 */
export function saveSignature(identity: string, type: "signature" | "initials", dataUrl: string, documentId?: string) {
  if (!dataUrl || typeof window === "undefined") return;

  const store = getStore();
  const key = signerKey(identity);
  const existing = store.signers[key] ?? [];

  // Remove old entries of the same type, keep other types
  const filtered = existing.filter((s) => s.type !== type);

  // Add new entry
  filtered.push({
    type,
    dataUrl,
    usedAt: Date.now(),
    firstDocId: documentId,
  });

  // Keep only the last MAX_STORED per type
  const byType = new Map<string, SavedSignature[]>();
  for (const s of filtered) {
    const list = byType.get(s.type) ?? [];
    list.push(s);
    byType.set(s.type, list);
  }
  const trimmed: SavedSignature[] = [];
  for (const [, list] of byType) {
    trimmed.push(...list.slice(-MAX_STORED));
  }

  store.signers[key] = trimmed;
  setStore(store);
}

/**
 * Get the most recent saved signature or initials for a signer.
 */
export function getSavedSignature(identity: string, type: "signature" | "initials"): SavedSignature | null {
  if (typeof window === "undefined") return null;
  const store = getStore();
  const key = signerKey(identity);
  const entries = store.signers[key] ?? [];
  const matching = entries.filter((s) => s.type === type);
  return matching.length > 0 ? matching[matching.length - 1]! : null;
}

/**
 * Get all saved signatures/initials for a signer.
 */
export function getAllSavedSignatures(identity: string): SavedSignature[] {
  if (typeof window === "undefined") return [];
  const store = getStore();
  const key = signerKey(identity);
  return store.signers[key] ?? [];
}

/**
 * Clear all saved signatures for a signer.
 */
export function clearSavedSignatures(identity: string) {
  const store = getStore();
  const key = signerKey(identity);
  delete store.signers[key];
  setStore(store);
}
