/**
 * Document search index manager.
 *
 * Maintains a plaintext index of non-sensitive document metadata
 * so users can search, filter, and organize their documents even
 * when content is encrypted at rest.
 *
 * Rules:
 * - NEVER store full sensitive content (emails, addresses, signatures)
 * - Only store: titles, labels, domains (not full emails), counts,
 *   partial hashes, tags, categories, dates, status
 * - Index is scoped per owner — users can only search their own docs
 */

import { z } from "zod";
import { eq, and, or, ilike, desc, asc, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { documentIndex, documents, signers } from "~/server/db/schema";
import { createId } from "~/server/db/utils";

/* ---------- Index population ---------- */

/**
 * Create or update the search index entry for a document.
 * Called after document creation and after signing events.
 */
export async function indexDocument(documentId: string): Promise<void> {
  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
  if (!doc) return;

  const allSigners = await db.query.signers.findMany({
    where: eq(signers.documentId, documentId),
  });

  const signerLabels = allSigners.map((s) => s.label).join(", ");
  const signerDomains = [...new Set(allSigners.map((s) => s.email?.split("@")[1]).filter(Boolean))].join(", ");

  const signedCount = allSigners.filter((s) => s.status === "SIGNED").length;

  // Snippet: first ~100 chars, but only if NOT encrypted
  let snippet = "";
  if (!doc.encryptedAtRest) {
    snippet = doc.content.slice(0, 100).replace(/\s+/g, " ").trim();
    if (doc.content.length > 100) snippet += "...";
  }

  // Detect category from title heuristics
  const category = detectCategory(doc.title);

  const entry = {
    documentId,
    ownerId: doc.createdBy.toLowerCase(),
    title: doc.title,
    snippet,
    status: doc.status,
    proofMode: doc.proofMode,
    signerCount: allSigners.length,
    signedCount,
    signerLabels,
    signerDomains,
    category,
    hashPrefix: doc.contentHash.slice(0, 8),
    cidPrefix: doc.ipfsCid?.slice(0, 12) ?? null,
    createdAt: doc.createdAt,
    completedAt: doc.status === "COMPLETED" ? new Date() : null,
    expiresAt: doc.expiresAt,
  };

  // Upsert
  const [existing] = await db
    .select({ id: documentIndex.id })
    .from(documentIndex)
    .where(eq(documentIndex.documentId, documentId))
    .limit(1);

  if (existing) {
    await db.update(documentIndex).set(entry).where(eq(documentIndex.id, existing.id));
  } else {
    await db.insert(documentIndex).values({ id: createId(), ...entry });
  }
}

/**
 * Update anchoring status in the index.
 */
export async function updateAnchorStatus(documentId: string, chain: "BASE" | "SOL" | "BTC"): Promise<void> {
  const field =
    chain === "BASE" ? { anchoredOnBase: true } : chain === "SOL" ? { anchoredOnSol: true } : { anchoredOnBtc: true };

  await db.update(documentIndex).set(field).where(eq(documentIndex.documentId, documentId));
}

/**
 * Add or remove tags on a document.
 */
export async function updateTags(documentId: string, tags: string[]): Promise<void> {
  await db.update(documentIndex).set({ tags }).where(eq(documentIndex.documentId, documentId));
}

/**
 * Update the category of a document.
 */
export async function updateCategory(documentId: string, category: string): Promise<void> {
  await db.update(documentIndex).set({ category }).where(eq(documentIndex.documentId, documentId));
}

/* ---------- Search ---------- */

export const searchFiltersSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  proofMode: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  anchored: z.boolean().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
  sortBy: z.enum(["created", "title", "status", "completed"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type SearchFilters = z.infer<typeof searchFiltersSchema>;

export const searchResultSchema = z.object({
  documentId: z.string(),
  title: z.string(),
  snippet: z.string(),
  status: z.string(),
  proofMode: z.string(),
  signerCount: z.number().int(),
  signedCount: z.number().int(),
  signerLabels: z.string(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  hashPrefix: z.string().nullable(),
  anchoredOnBase: z.boolean(),
  anchoredOnSol: z.boolean(),
  anchoredOnBtc: z.boolean(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

/**
 * Search documents for a specific owner.
 */
export async function searchDocuments(
  ownerId: string,
  filters: SearchFilters = {},
): Promise<{ results: SearchResult[]; total: number }> {
  const conditions = [eq(documentIndex.ownerId, ownerId.toLowerCase())];

  // Text search across title, snippet, signer labels
  if (filters.query) {
    const q = `%${filters.query}%`;
    conditions.push(
      or(
        ilike(documentIndex.title, q),
        ilike(documentIndex.snippet, q),
        ilike(documentIndex.signerLabels, q),
        ilike(documentIndex.signerDomains, q),
        // Also match partial hash
        ilike(documentIndex.hashPrefix, `${filters.query}%`),
      )!,
    );
  }

  if (filters.status) {
    conditions.push(eq(documentIndex.status, filters.status));
  }

  if (filters.proofMode) {
    conditions.push(eq(documentIndex.proofMode, filters.proofMode));
  }

  if (filters.category) {
    conditions.push(eq(documentIndex.category, filters.category));
  }

  if (filters.anchored !== undefined) {
    if (filters.anchored) {
      conditions.push(
        or(
          eq(documentIndex.anchoredOnBase, true),
          eq(documentIndex.anchoredOnSol, true),
          eq(documentIndex.anchoredOnBtc, true),
        )!,
      );
    }
  }

  if (filters.dateFrom) {
    conditions.push(sql`${documentIndex.createdAt} >= ${filters.dateFrom}`);
  }

  if (filters.dateTo) {
    conditions.push(sql`${documentIndex.createdAt} <= ${filters.dateTo}`);
  }

  // Tags filter: check if any of the specified tags match
  if (filters.tags && filters.tags.length > 0) {
    // Use JSON containment: tags @> any of the filter tags
    for (const tag of filters.tags) {
      conditions.push(sql`${documentIndex.tags}::jsonb @> ${JSON.stringify([tag])}::jsonb`);
    }
  }

  const where = and(...conditions);

  // Count total
  const [countRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(documentIndex)
    .where(where);
  const total = Number(countRow?.count ?? 0);

  // Sort
  const sortField = {
    created: documentIndex.createdAt,
    title: documentIndex.title,
    status: documentIndex.status,
    completed: documentIndex.completedAt,
  }[filters.sortBy ?? "created"];

  const orderFn = filters.sortOrder === "asc" ? asc : desc;

  // Query
  const rows = await db
    .select({
      documentId: documentIndex.documentId,
      title: documentIndex.title,
      snippet: documentIndex.snippet,
      status: documentIndex.status,
      proofMode: documentIndex.proofMode,
      signerCount: documentIndex.signerCount,
      signedCount: documentIndex.signedCount,
      signerLabels: documentIndex.signerLabels,
      category: documentIndex.category,
      tags: documentIndex.tags,
      hashPrefix: documentIndex.hashPrefix,
      anchoredOnBase: documentIndex.anchoredOnBase,
      anchoredOnSol: documentIndex.anchoredOnSol,
      anchoredOnBtc: documentIndex.anchoredOnBtc,
      createdAt: documentIndex.createdAt,
      completedAt: documentIndex.completedAt,
      expiresAt: documentIndex.expiresAt,
    })
    .from(documentIndex)
    .where(where)
    .orderBy(orderFn(sortField))
    .limit(filters.limit ?? 50)
    .offset(filters.offset ?? 0);

  return {
    results: rows as SearchResult[],
    total,
  };
}

/**
 * Get all unique tags for an owner (for autocomplete).
 */
export async function getOwnerTags(ownerId: string): Promise<string[]> {
  const rows = await db
    .select({ tags: documentIndex.tags })
    .from(documentIndex)
    .where(eq(documentIndex.ownerId, ownerId.toLowerCase()));

  const tagSet = new Set<string>();
  for (const row of rows) {
    const tags = row.tags;
    if (tags) {
      for (const tag of tags) tagSet.add(tag);
    }
  }

  return [...tagSet].sort();
}

/**
 * Get category counts for an owner (for sidebar filters).
 */
export async function getCategoryCounts(ownerId: string): Promise<Array<{ category: string; count: number }>> {
  const rows = await db
    .select({
      category: documentIndex.category,
      count: sql<number>`count(*)`,
    })
    .from(documentIndex)
    .where(eq(documentIndex.ownerId, ownerId.toLowerCase()))
    .groupBy(documentIndex.category);

  return rows.map((r) => ({
    category: r.category ?? "Uncategorized",
    count: Number(r.count),
  }));
}

/* ---------- Category detection ---------- */

const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  [/\b(nda|non[- ]?disclosure|confidentiality)\b/i, "NDA"],
  [/\b(service agreement|sow|statement of work)\b/i, "SERVICE_AGREEMENT"],
  [/\b(employment|offer letter|employment agreement)\b/i, "EMPLOYMENT"],
  [/\b(lease|rental|tenancy)\b/i, "LEASE"],
  [/\b(invoice|billing|payment)\b/i, "INVOICE"],
  [/\b(purchase order|po)\b/i, "PURCHASE_ORDER"],
  [/\b(terms of service|tos|terms and conditions)\b/i, "TERMS_OF_SERVICE"],
  [/\b(privacy policy|gdpr|data processing)\b/i, "PRIVACY"],
  [/\b(partnership|joint venture)\b/i, "PARTNERSHIP"],
  [/\b(loan|promissory note|credit)\b/i, "LOAN"],
  [/\b(amendment|addendum|modification)\b/i, "AMENDMENT"],
  [/\b(release|waiver|indemnity)\b/i, "WAIVER"],
  [/\b(power of attorney|poa)\b/i, "POWER_OF_ATTORNEY"],
  [/\b(consent|authorization|approval)\b/i, "CONSENT"],
];

function detectCategory(title: string): string | null {
  for (const [pattern, category] of CATEGORY_PATTERNS) {
    if (pattern.test(title)) return category;
  }
  return null;
}
