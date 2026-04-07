export type WalletChain = "ETH" | "SOL" | "BTC";

export function isEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function isBitcoinAddress(value: string): boolean {
  const v = value.trim();
  return (
    /^(bc1|tb1|bcrt1)[a-z0-9]{20,}$/i.test(v) ||
    /^[13][a-km-zA-HJ-NP-Z1-9]{25,39}$/.test(v) ||
    /^[mn2][a-km-zA-HJ-NP-Z1-9]{25,39}$/.test(v)
  );
}

export function isSolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

export function detectChain(address: string): WalletChain | null {
  if (isEvmAddress(address)) return "ETH";
  if (isBitcoinAddress(address)) return "BTC";
  if (isSolanaAddress(address)) return "SOL";
  return null;
}

export function normalizeAddress(chain: WalletChain, value: string): string {
  const trimmed = value.trim();
  return chain === "SOL" ? trimmed : trimmed.toLowerCase();
}

export function addressPreview(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export const CHAIN_META: Record<WalletChain, { label: string; color: string; icon: string }> = {
  BTC: { label: "Bitcoin", color: "#f7931a", icon: "₿" },
  ETH: { label: "Ethereum", color: "#627eea", icon: "Ξ" },
  SOL: { label: "Solana", color: "#9945ff", icon: "◎" },
};
