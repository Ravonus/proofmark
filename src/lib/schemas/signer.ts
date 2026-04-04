/**
 * Signer validation schemas — used in both editor and signing flows.
 *
 * Zod schemas provide runtime validation + TypeScript types in one place.
 * All field rules are defined here (DRY) and reused across components.
 */

import { z } from "zod";
import type { WalletChain } from "~/lib/chains";

// ── Chain ────────────────────────────────────────────────────────────────────
// Re-export the canonical WalletChain type from ~/lib/chains.
// The Zod schema validates the same values at runtime.

export const walletChainSchema = z.enum(["ETH", "BTC", "SOL"]);
export type { WalletChain };

// ── Signer definition (editor side) ──────────────────────────────────────────

export const signerDefSchema = z.object({
  label: z.string().min(1, "Signer name is required"),
  address: z.string().default(""),
  chain: z.string().default("ETH"),
  email: z.string().email("Invalid email").or(z.literal("")).default(""),
  phone: z.string().default(""),
  role: z.string().default("signer"),
  signMethod: z.enum(["WALLET", "EMAIL_OTP"]).default("WALLET"),
  deliveryMethod: z.enum(["link", "email", "sms"]).default("link"),
});

export type SignerDef = z.infer<typeof signerDefSchema>;

// ── Signer input for signing flow ────────────────────────────────────────────

export const signerInputSchema = z.object({
  email: z.string().email("Valid email required").or(z.literal("")),
  fieldValues: z.record(z.string(), z.string()),
});

// ── Field value validation ───────────────────────────────────────────────────

export const fieldValueSchema = z.object({
  fieldId: z.string(),
  value: z.string(),
  fieldType: z.string(),
});

/** Validate a field value based on its type. Returns error message or null. */
export function validateFieldValue(
  value: string,
  fieldType: string,
  required: boolean,
): string | null {
  if (required && !value.trim()) return "This field is required";

  if (!value) return null;

  switch (fieldType) {
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "Invalid email address";
    case "phone":
      return /^[+\d\s()-]{7,20}$/.test(value) ? null : "Invalid phone number";
    case "date":
    case "effective-date":
      return isNaN(Date.parse(value)) ? "Invalid date" : null;
    case "amount":
      return isNaN(Number(value)) || Number(value) < 0 ? "Invalid amount" : null;
    default:
      return null;
  }
}

/** Validate all field values for a signer. Returns map of fieldId → error. */
export function validateAllFields(
  values: Record<string, string>,
  requiredFields: Set<string>,
  fieldTypes: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [fieldId, type] of Object.entries(fieldTypes)) {
    const value = values[fieldId] ?? "";
    const required = requiredFields.has(fieldId);
    const error = validateFieldValue(value, type, required);
    if (error) errors[fieldId] = error;
  }
  return errors;
}
