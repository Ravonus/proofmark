/**
 * Document validation schemas — shared between create, edit, and API layers.
 *
 * Single source of truth for document structure validation.
 */

import { z } from "zod";
import { signerDefSchema } from "./signer";

// ── Document creation ────────────────────────────────────────────────────────

export const createDocumentSchema = z.object({
  title: z.string().min(1, "Title is required").max(500, "Title too long"),
  content: z.string().min(1, "Content is required"),
  signers: z.array(signerDefSchema).min(1, "At least one signer required"),
  proofMode: z.enum(["standard", "anchored", "inscribed"]).default("standard"),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  reminderDays: z.number().int().min(1).max(30).optional(),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

// ── Document status ──────────────────────────────────────────────────────────

export const documentStatusSchema = z.enum([
  "DRAFT",
  "PENDING",
  "COMPLETED",
  "EXPIRED",
  "VOIDED",
]);

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

export const proofModeSchema = z.enum(["standard", "anchored", "inscribed"]);

export const proofModeLabels: Record<z.infer<typeof proofModeSchema>, string> = {
  standard: "Standard (off-chain)",
  anchored: "Blockchain Anchored",
  inscribed: "Permanently Inscribed",
};
