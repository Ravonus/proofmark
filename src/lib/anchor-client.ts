/**
 * @deprecated — Premium features are now loaded directly via ~/lib/premium.ts
 * This file is kept for backwards compatibility but all functions are no-ops.
 * Use the premium module loader instead.
 */

export type AnchorChain = "ETH" | "SOL" | "BTC" | "BASE";

export async function getDocumentAnchors(_documentId: string) {
  return null;
}
