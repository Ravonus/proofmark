import { z } from "zod";

export const attachmentFieldValueSchema = z.object({
  kind: z.literal("attachment"),
  fieldId: z.string(),
  originalName: z.string(),
  storedName: z.string(),
  mimeType: z.string(),
  size: z.number().nonnegative(),
  uploadedAt: z.string(),
});
export type AttachmentFieldValue = z.infer<typeof attachmentFieldValueSchema>;

export const paymentFieldValueSchema = z.object({
  kind: z.literal("payment"),
  provider: z.string(),
  amount: z.number().positive(),
  currency: z.string(),
  status: z.literal("paid"),
  reference: z.string(),
  paidAt: z.string(),
});
export type PaymentFieldValue = z.infer<typeof paymentFieldValueSchema>;

export const identityVerificationCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  ok: z.boolean(),
  detail: z.string(),
  weight: z.number(),
});
export type IdentityVerificationCheck = z.infer<typeof identityVerificationCheckSchema>;

export const identityVerificationFieldValueSchema = z.object({
  kind: z.literal("id-verification"),
  status: z.enum(["verified", "needs_review"]),
  score: z.number(),
  threshold: z.number(),
  verifiedAt: z.string(),
  checks: z.array(identityVerificationCheckSchema),
});
export type IdentityVerificationFieldValue = z.infer<typeof identityVerificationFieldValueSchema>;

export const socialVerificationFieldValueSchema = z.object({
  kind: z.literal("social-verification"),
  provider: z.enum(["x", "github", "discord", "google"]),
  status: z.literal("verified"),
  username: z.string(),
  profileId: z.string(),
  verifiedAt: z.string(),
});
export type SocialVerificationFieldValue = z.infer<typeof socialVerificationFieldValueSchema>;

export const structuredFieldValueSchema = z.discriminatedUnion("kind", [
  attachmentFieldValueSchema,
  paymentFieldValueSchema,
  identityVerificationFieldValueSchema,
  socialVerificationFieldValueSchema,
]);
export type StructuredFieldValue = z.infer<typeof structuredFieldValueSchema>;

export function isImageDataUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value);
}

export function encodeStructuredFieldValue(
  value: AttachmentFieldValue | PaymentFieldValue | IdentityVerificationFieldValue | SocialVerificationFieldValue,
): string {
  return JSON.stringify(value);
}

export function decodeStructuredFieldValue<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed;
  } catch {
    return null;
  }
}
