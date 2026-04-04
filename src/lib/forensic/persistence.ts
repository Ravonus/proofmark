/**
 * Multi-layer persistent ID storage.
 *
 * Writes to cookie + localStorage + sessionStorage + IndexedDB simultaneously.
 * Reads from whichever layer still has data, surviving partial storage clears.
 */

import { generateId } from "./hash";

const STORAGE_KEY = "__w3s_fid";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // 1 year
const IDB_NAME = "w3s_forensic";
const IDB_STORE = "ids";

export interface StoredId {
  id: string;
  firstSeen: string;
  visitCount: number;
}

/* ── Cookie helpers ─────────────────────────────────────────── */

function setCookie(name: string, value: string, maxAge: number) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${maxAge};SameSite=Lax;Secure`;
}

function getCookie(name: string): string | null {
  const match = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(document.cookie);
  return match ? decodeURIComponent(match[1]!) : null;
}

/* ── Sync layer read ────────────────────────────────────────── */

function readFromSyncLayers(): StoredId | null {
  const readers = [
    () => getCookie(STORAGE_KEY),
    () => localStorage.getItem(STORAGE_KEY),
    () => sessionStorage.getItem(STORAGE_KEY),
  ];
  for (const read of readers) {
    try {
      const raw = read();
      if (raw) return JSON.parse(raw) as StoredId;
    } catch {
      /* layer unavailable or corrupt */
    }
  }
  return null;
}

/* ── IndexedDB helpers ──────────────────────────────────────── */

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function readFromIndexedDB(): Promise<StoredId | null> {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(STORAGE_KEY);
      req.onsuccess = () => {
        const r = req.result as (StoredId & { key: string }) | undefined;
        resolve(r ? { id: r.id, firstSeen: r.firstSeen, visitCount: r.visitCount } : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/* ── Write to all layers ────────────────────────────────────── */

function writeToAllLayers(data: StoredId) {
  const json = JSON.stringify(data);
  try {
    setCookie(STORAGE_KEY, json, COOKIE_MAX_AGE);
  } catch {
    /* blocked */
  }
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* blocked */
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* blocked */
  }
  // IndexedDB is async — fire-and-forget
  openIdb()
    .then((db) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ key: STORAGE_KEY, ...data });
    })
    .catch(() => {
      /* write failed — non-critical */
    });
}

/* ── Public API ─────────────────────────────────────────────── */

export async function getOrCreatePersistentId(): Promise<StoredId> {
  const stored = readFromSyncLayers() ?? (await readFromIndexedDB());

  if (stored) {
    stored.visitCount += 1;
    writeToAllLayers(stored);
    return stored;
  }

  const fresh: StoredId = {
    id: generateId(),
    firstSeen: new Date().toISOString(),
    visitCount: 1,
  };
  writeToAllLayers(fresh);
  return fresh;
}
