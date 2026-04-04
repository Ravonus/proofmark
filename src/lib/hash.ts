import { createHash } from "crypto";
import { normalizeAddress } from "./chains";
import type { WalletChain } from "./chains";

export function hashDocument(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function hashHandSignature(dataUrl: string): string {
  // Hash the raw base64 image data from the data URL
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
  return createHash("sha256").update(base64, "base64").digest("hex");
}

export function buildSigningMessage(params: {
  documentTitle: string;
  contentHash: string;
  signerLabel: string;
  signerAddress: string;
  chain: WalletChain;
  handSignatureHash?: string;
}): string {
  const addr = normalizeAddress(params.chain, params.signerAddress);
  // Keep it simple — the signer signs the document hash + their identity
  const lines = [`proofmark:${params.contentHash}`, addr, params.signerLabel];
  if (params.handSignatureHash) {
    lines.push(params.handSignatureHash);
  }
  return lines.join(":");
}
