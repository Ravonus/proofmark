/**
 * Shared constants and types for the signing system.
 * Single source of truth — used by both client and server.
 */

/** Field input types that require verification (OAuth, IDV) before accepting values. */
export const VERIFY_FIELD_TYPES = new Set(["social-verify", "idv"]);

/** Group signer roles. */
export const GROUP_ROLE = {
  DISCLOSER: "discloser",
  RECIPIENT: "recipient",
} as const;

export type GroupRole = (typeof GROUP_ROLE)[keyof typeof GROUP_ROLE];

/** Canonical base URL — avoids repeating `process.env.NEXTAUTH_URL ?? "http://localhost:3100"` everywhere. */
export function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3100";
}

/** Data propagated when a signer completes signing. */
export interface SignData {
  address: string | null;
  chain: "ETH" | "SOL" | "BTC" | null;
  signature: string | null;
  signedAt: Date;
  scheme: string | null;
  email: string | null;
  handSignatureData: string | null;
  handSignatureHash: string | null;
  fieldValues: Record<string, string> | null;
  lastIp: string | null;
  ipUpdatedAt: Date | null;
  userAgent: string | null;
  identityLevel: string;
  forensicEvidence: unknown;
  forensicHash: string | null;
  documentStateHash?: string | null;
  consentText?: string | null;
  consentAt?: Date | null;
}
