/**
 * Signer validation schemas — used in both editor and signing flows.
 *
 * Zod schemas provide runtime validation + TypeScript types in one place.
 * All field rules are defined here (DRY) and reused across components.
 */

import { z } from "zod";
import type { WalletChain } from "~/lib/crypto/chains";
import type { SignerTokenGate } from "~/lib/token-gates";

// ── Chain ────────────────────────────────────────────────────────────────────

export const walletChainSchema = z.enum(["ETH", "BTC", "SOL"]);
export type { WalletChain };

// ── Signer roles ────────────────────────────────────────────────────────────

export const signerRoleSchema = z.enum(["SIGNER", "APPROVER", "CC", "WITNESS", "OBSERVER"]);
export type SignerRole = z.infer<typeof signerRoleSchema>;

export const signMethodSchema = z.enum(["WALLET", "EMAIL_OTP"]);
export type SignMethod = z.infer<typeof signMethodSchema>;

// ── Signer definition (editor side) ──────────────────────────────────────────

export const signerDefSchema = z.object({
  label: z.string().min(1, "Signer name is required"),
  email: z.string().email("Invalid email").or(z.literal("")).default(""),
  phone: z.string().optional(),
  role: signerRoleSchema.optional(),
  signMethod: signMethodSchema.optional(),
  tokenGates: z.custom<SignerTokenGate | null>().optional().nullable(),
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
