import { normalizeAddress, type WalletChain } from "~/lib/crypto/chains";
import { type DocToken as SharedDocToken, type InlineField as SharedInlineField } from "~/lib/document/document-tokens";
import { resolveFieldInputType, resolveFieldPlaceholder, validateFieldValue } from "~/lib/document/field-runtime";
import {
  type AttachmentFieldValue,
  decodeStructuredFieldValue,
  type IdentityVerificationFieldValue,
  isImageDataUrl,
  type PaymentFieldValue,
  type SocialVerificationFieldValue,
} from "~/lib/document/field-values";
import type { SignerTokenGate, TokenGateEvaluation } from "~/lib/token-gates";
import type { SignerField } from "~/server/db/schema";
import { getField } from "../fields";

// ─── Types ───────────────────────────────────────────────────────────────────

export type SignerInfo = {
  id: string;
  label: string;
  address: string | null;
  chain: string | null;
  status: string;
  signedAt: Date | null;
  scheme: string | null;
  isYou: boolean;
  isClaimed: boolean;
  email?: string | null;
  claimToken?: string | null;
  fields?: SignerField[];
  fieldValues?: Record<string, string> | null;
  tokenGates?: SignerTokenGate | null;
  tokenGateEvaluation?: TokenGateEvaluation | null;
  role?: "SIGNER" | "APPROVER" | "CC" | "WITNESS" | "OBSERVER";
  canSign?: boolean;
  groupRole?: string | null;
  finalizationSignature?: string | null;
};

export type InlineField = SharedInlineField;
export type DocToken = SharedDocToken;

// ─── Client-side crypto ──────────────────────────────────────────────────────

export async function hashHandSignatureClient(dataUrl: string): Promise<string> {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildSigningMessageClient(p: {
  contentHash: string;
  signerAddress: string;
  chain: WalletChain;
  signerLabel: string;
  handSignatureHash?: string;
}): string {
  const addr = normalizeAddress(p.chain, p.signerAddress);
  const parts = [`proofmark:${p.contentHash}`, addr, p.signerLabel];
  if (p.handSignatureHash) parts.push(p.handSignatureHash);
  return parts.join(":");
}

// ─── Field visual styles ─────────────────────────────────────────────────────

export const FIELD_STYLES: Record<string, { border: string; bg: string; text: string; glow: string }> = {
  name: {
    border: "border-blue-400/50",
    bg: "bg-blue-400/10",
    text: "text-blue-400",
    glow: "shadow-[0_0_16px_rgba(96,165,250,0.2)]",
  },
  date: {
    border: "border-orange-400/50",
    bg: "bg-orange-400/10",
    text: "text-orange-400",
    glow: "shadow-[0_0_16px_rgba(251,146,60,0.2)]",
  },
  address: {
    border: "border-purple-400/50",
    bg: "bg-purple-400/10",
    text: "text-purple-400",
    glow: "shadow-[0_0_16px_rgba(192,132,252,0.2)]",
  },
  email: {
    border: "border-cyan-400/50",
    bg: "bg-cyan-400/10",
    text: "text-cyan-400",
    glow: "shadow-[0_0_16px_rgba(34,211,238,0.2)]",
  },
  title: {
    border: "border-pink-400/50",
    bg: "bg-pink-400/10",
    text: "text-pink-400",
    glow: "shadow-[0_0_16px_rgba(244,114,182,0.2)]",
  },
  company: {
    border: "border-amber-400/50",
    bg: "bg-amber-400/10",
    text: "text-amber-400",
    glow: "shadow-[0_0_16px_rgba(251,191,36,0.2)]",
  },
  signature: {
    border: "border-emerald-400/50",
    bg: "bg-emerald-400/10",
    text: "text-emerald-400",
    glow: "shadow-[0_0_16px_rgba(52,211,153,0.2)]",
  },
  other: {
    border: "border-gray-400/50",
    bg: "bg-gray-400/10",
    text: "text-gray-400",
    glow: "shadow-[0_0_16px_rgba(156,163,175,0.2)]",
  },
};

export function getFieldVisualStyle(field: InlineField) {
  const config = getField(field.type);
  return config?.color ?? FIELD_STYLES[field.type] ?? FIELD_STYLES.other!;
}

export function getFieldMinWidth(field: InlineField): string {
  const inputType = resolveFieldInputType(field);
  if (inputType === "textarea" || field.type.includes("address")) return "240px";
  if (["date", "time", "datetime-local"].includes(inputType)) return "160px";
  if (inputType === "checkbox") return "180px";
  return "170px";
}

// ─── Field validation & display ──────────────────────────────────────────────

export function validateField(
  field: InlineField,
  value: string | undefined,
  options: {
    signatureReady?: boolean;
    allValues?: Record<string, string>;
  } = {},
): string | null {
  return validateFieldValue(field, value, options);
}

export function formatCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  }
}

function getStructuredDisplayText(inputType: string, value: string, placeholder: string): string | null {
  if (inputType === "file") {
    const attachment = decodeStructuredFieldValue<AttachmentFieldValue>(value);
    return attachment?.kind === "attachment" ? attachment.originalName : placeholder;
  }
  if (inputType === "payment") {
    const payment = decodeStructuredFieldValue<PaymentFieldValue>(value);
    return payment?.kind === "payment" ? `${formatCurrency(payment.amount, payment.currency)} paid` : placeholder;
  }
  if (inputType === "idv") {
    const verification = decodeStructuredFieldValue<IdentityVerificationFieldValue>(value);
    return verification?.kind === "id-verification"
      ? `Verified (${verification.score}/${verification.threshold})`
      : placeholder;
  }
  if (inputType === "social-verify") {
    const social = decodeStructuredFieldValue<SocialVerificationFieldValue>(value);
    return social?.kind === "social-verification" ? `@${social.username} (verified)` : placeholder;
  }
  return null;
}

export function getFieldDisplayText(field: InlineField, value: string | undefined) {
  const placeholder = resolveFieldPlaceholder(field);
  const inputType = resolveFieldInputType(field);

  if (!value) return placeholder;

  if (field.type === "signature") {
    return isImageDataUrl(value) ? "Handwritten signature" : value || "Signed";
  }
  if (inputType === "initials") return value || placeholder;
  if (inputType === "checkbox") return value === "true" ? "Checked" : placeholder;

  const structured = getStructuredDisplayText(inputType, value, placeholder);
  if (structured !== null) return structured;

  return value;
}
