/**
 * Wallet store — global multi-chain wallet connection + auth state.
 *
 * Replaces the WalletContext + 6 useState + 5 useEffect pattern.
 * This store holds the reactive state only — wallet hook wiring
 * still lives in WalletProvider (it needs React context from
 * LaserEyes/Wagmi/Solana), but the state is globally accessible
 * without prop drilling or context consumption.
 */

import { create } from "zustand";
import type { WalletChain } from "~/lib/crypto/chains";

// ── Session cookie helpers (pure functions, no React) ────────────────────────

const SESSION_COOKIE = "w3s_session";

export function getSessionCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]*)`).exec(document.cookie);
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

export function setSessionCookie(token: string, expiresAt: string) {
  const expires = new Date(expiresAt).toUTCString();
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; path=/; expires=${expires}; SameSite=Lax`;
}

export function clearSessionCookie() {
  document.cookie = `${SESSION_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

// ── Error message helper ─────────────────────────────────────────────────────

export function getWalletAuthErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Wallet verification failed.";
  const msg = error.message.trim();
  if (/user rejected|user denied|rejected the request|cancelled|canceled/i.test(msg))
    return "Wallet signature was cancelled.";
  if (/challenge expired or invalid/i.test(msg)) return "The wallet challenge expired. Try again.";
  if (/signature verification failed/i.test(msg)) return "The wallet signature could not be verified.";
  return msg || "Wallet verification failed.";
}

// ── Types ────────────────────────────────────────────────────────────────────

export type WalletOption = {
  id: string;
  chain: WalletChain;
  label: string;
  available: boolean;
  iconUrl?: string | null;
};

type WalletState = {
  address: string | null;
  chain: WalletChain | null;
  connected: boolean;
  authenticated: boolean;
  authenticating: boolean;
  authError: string | null;
  availableWallets: WalletOption[];
};

type WalletActions = {
  /** Set the full wallet state (used by WalletProvider on wallet hook changes). */
  setState: (patch: Partial<WalletState>) => void;
  /** Reset to disconnected state. */
  reset: () => void;
  /** Mark authentication started. */
  startAuth: () => void;
  /** Mark authentication succeeded. */
  authSuccess: (address: string, chain: WalletChain) => void;
  /** Mark authentication failed. */
  authFail: (error: string) => void;
  /** Set available wallets list. */
  setAvailableWallets: (wallets: WalletOption[]) => void;
};

const INITIAL_STATE: WalletState = {
  address: null,
  chain: null,
  connected: false,
  authenticated: false,
  authenticating: !!getSessionCookie(), // block auto-sign-in until restore
  authError: null,
  availableWallets: [],
};

// ── Store ────────────────────────────────────────────────────────────────────

export const useWalletStore = create<WalletState & WalletActions>()((set) => ({
  ...INITIAL_STATE,

  setState: (patch) => set((s) => ({ ...s, ...patch })),

  reset: () =>
    set({
      address: null,
      chain: null,
      connected: false,
      authenticated: false,
      authenticating: false,
      authError: null,
    }),

  startAuth: () => set({ authenticated: false, authenticating: true, authError: null }),

  authSuccess: (address, chain) =>
    set({
      address,
      chain,
      connected: true,
      authenticated: true,
      authenticating: false,
      authError: null,
    }),

  authFail: (error) => set({ authenticated: false, authenticating: false, authError: error }),

  setAvailableWallets: (wallets) => set({ availableWallets: wallets }),
}));
