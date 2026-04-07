export type StoredWalletChain = "ETH" | "SOL" | "BTC" | "BASE";

export function normalizeStoredWalletAddress(chain: StoredWalletChain, address: string): string {
  const trimmed = address.trim();
  return chain === "SOL" ? trimmed : trimmed.toLowerCase();
}
