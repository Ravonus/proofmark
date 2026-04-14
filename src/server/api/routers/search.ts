/**
 * Document search & organization tRPC router.
 *
 * Searches the plaintext index — never touches encrypted content.
 * Scoped per user — you can only search your own documents.
 */

import { z } from "zod";
import { authedProcedure, createTRPCRouter } from "~/server/api/trpc";
import {
  getCategoryCounts,
  getOwnerTags,
  type SearchFilters,
  searchDocuments,
  updateCategory,
  updateTags,
} from "~/server/documents/search-index";

export const searchRouter = createTRPCRouter({
  /** Full-text search + filtered browse of your documents. */
  query: authedProcedure
    .input(
      z.object({
        query: z.string().optional(),
        status: z.enum(["PENDING", "COMPLETED", "EXPIRED", "VOIDED"]).optional(),
        proofMode: z.enum(["PRIVATE", "HYBRID", "CRYPTO_NATIVE"]).optional(),
        category: z.string().optional(),
        tags: z.array(z.string()).optional(),
        anchored: z.boolean().optional(),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        sortBy: z.enum(["created", "title", "status", "completed"]).default("created"),
        sortOrder: z.enum(["asc", "desc"]).default("desc"),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      return searchDocuments(ctx.session.address, input as SearchFilters);
    }),

  /** Get all unique tags for the current user (for autocomplete / filter UI). */
  tags: authedProcedure.query(async ({ ctx }) => {
    return getOwnerTags(ctx.session.address);
  }),

  /** Get category breakdown with counts (for sidebar). */
  categories: authedProcedure.query(async ({ ctx }) => {
    return getCategoryCounts(ctx.session.address);
  }),

  /** Add/replace tags on a document. */
  setTags: authedProcedure
    .input(
      z.object({
        documentId: z.string(),
        tags: z.array(z.string().min(1).max(50)).max(20),
      }),
    )
    .mutation(async ({ ctx: _ctx, input }) => {
      // Normalize: lowercase, trim, deduplicate
      const normalized = [...new Set(input.tags.map((t) => t.trim().toLowerCase()))];
      await updateTags(input.documentId, normalized);
      return { tags: normalized };
    }),

  /** Set the category for a document (overrides auto-detection). */
  setCategory: authedProcedure
    .input(
      z.object({
        documentId: z.string(),
        category: z.string().min(1).max(50),
      }),
    )
    .mutation(async ({ input }) => {
      await updateCategory(input.documentId, input.category);
      return { category: input.category };
    }),
});
