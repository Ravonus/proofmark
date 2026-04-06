/**
 * Document validation schemas shared by client flows and API routers.
 *
 * These schemas are the canonical source of truth for create/save payloads.
 */

import { z } from "zod";
import { documentAutomationPolicySchema } from "~/lib/forensic/premium";
import { optionalSignerTokenGateSchema } from "~/lib/token-gates";
import { signMethodSchema, signerRoleSchema } from "./signer";

export const deliveryMethodSchema = z.enum(["EMAIL", "SMS"]);
export type DeliveryMethod = z.infer<typeof deliveryMethodSchema>;

export const documentFieldSchema = z.object({
  id: z.string().optional(),
  type: z.string().min(1),
  label: z.string().min(1),
  value: z.string().nullable().optional(),
  required: z.boolean().default(true),
  options: z.array(z.string().min(1)).optional(),
  settings: z.record(z.unknown()).optional(),
});
export type DocumentFieldInput = z.infer<typeof documentFieldSchema>;

export const documentSignerSchema = z.object({
  label: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  fields: z.array(documentFieldSchema).optional(),
  tokenGates: optionalSignerTokenGateSchema,
  signMethod: signMethodSchema.default("WALLET"),
  role: signerRoleSchema.default("SIGNER"),
  deliveryMethods: z.array(deliveryMethodSchema).optional(),
});
export type DocumentSignerInput = z.infer<typeof documentSignerSchema>;

export const documentTemplateSignerSchema = documentSignerSchema.omit({ signMethod: true }).extend({
  deliveryMethods: z.array(deliveryMethodSchema).default(["EMAIL"]),
  fields: z.array(documentFieldSchema).default([]),
});
export type DocumentTemplateSignerInput = z.infer<typeof documentTemplateSignerSchema>;

export const documentReminderSchema = z.object({
  cadence: z.enum(["NONE", "DAILY", "EVERY_2_DAYS", "EVERY_3_DAYS", "WEEKLY"]).default("NONE"),
  channels: z.array(deliveryMethodSchema).default(["EMAIL"]),
});
export type DocumentReminderInput = z.infer<typeof documentReminderSchema>;

export const proofModeSchema = z.enum(["PRIVATE", "HYBRID", "CRYPTO_NATIVE"]);
export type ProofMode = z.infer<typeof proofModeSchema>;

export const securityModeSchema = z.enum(["HASH_ONLY", "ENCRYPTED_PRIVATE", "ENCRYPTED_IPFS"]);
export type SecurityModeInput = z.infer<typeof securityModeSchema>;

export const signingOrderSchema = z.enum(["parallel", "sequential"]);
export type SigningOrderInput = z.infer<typeof signingOrderSchema>;

export const gazeTrackingSchema = z.enum(["off", "full", "signing_only"]);
export type GazeTrackingInput = z.infer<typeof gazeTrackingSchema>;

export const postSignRevealSchema = z.object({
  enabled: z.boolean(),
  summary: z.string().optional(),
  sections: z
    .array(
      z.object({
        title: z.string(),
        content: z.string(),
        icon: z.string().optional(),
      }),
    )
    .optional(),
  downloads: z
    .array(
      z.object({
        label: z.string(),
        filename: z.string(),
        description: z.string().optional(),
        icon: z.string().optional(),
        uploadedByAddress: z.string().optional(),
        uploadedByLabel: z.string().optional(),
        uploadedAt: z.string().optional(),
      }),
    )
    .optional(),
  testbedAccess: z
    .object({
      enabled: z.boolean(),
      description: z.string().optional(),
      proxyEndpoint: z.string().optional(),
    })
    .optional(),
});
export type PostSignRevealInput = z.infer<typeof postSignRevealSchema>;

export const createDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  createdByEmail: z.string().email().optional().or(z.literal("")),
  signers: z.array(documentSignerSchema).min(1).max(20),
  proofMode: proofModeSchema.default("HYBRID"),
  securityMode: securityModeSchema.default("HASH_ONLY"),
  signingOrder: signingOrderSchema.default("parallel"),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  brandingProfileId: z.string().optional(),
  templateId: z.string().optional(),
  pdfStyleTemplateId: z.string().optional(),
  reminder: documentReminderSchema.optional(),
  gazeTracking: gazeTrackingSchema.default("off"),
  automationPolicy: documentAutomationPolicySchema.optional(),
  postSignReveal: postSignRevealSchema.optional(),
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const documentTemplateDefaultsSchema = z.object({
  proofMode: proofModeSchema.default("HYBRID").optional(),
  signingOrder: signingOrderSchema.default("parallel").optional(),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  reminder: documentReminderSchema.optional(),
});
export type DocumentTemplateDefaults = z.infer<typeof documentTemplateDefaultsSchema>;

export const saveTemplateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(100),
  description: z.string().max(240).optional(),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  signers: z.array(documentTemplateSignerSchema).min(1).max(20),
  defaults: documentTemplateDefaultsSchema.optional(),
});
export type SaveTemplateInput = z.infer<typeof saveTemplateSchema>;

// ── Document status ──────────────────────────────────────────────────────────

export const documentStatusSchema = z.enum(["DRAFT", "PENDING", "COMPLETED", "EXPIRED", "VOIDED"]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

// ── Search / filter ──────────────────────────────────────────────────────────

export const documentFilterSchema = z.object({
  status: z.enum(["ALL", "PENDING", "COMPLETED", "EXPIRED", "VOIDED"]).default("ALL"),
  query: z.string().default(""),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(100).default(10),
});
export type DocumentFilter = z.infer<typeof documentFilterSchema>;

// ── Proof mode metadata ──────────────────────────────────────────────────────

export const proofModeLabels: Record<ProofMode, string> = {
  PRIVATE: "Private (Web2)",
  HYBRID: "Hybrid",
  CRYPTO_NATIVE: "Crypto Native",
};
