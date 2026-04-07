/**
 * Blockchain anchoring tRPC router.
 *
 * In the FREE version: all procedures return { available: false } or throw
 * SERVICE_UNAVAILABLE — no blockchain features.
 *
 * In the PREMIUM version: premium modules live in proofmark/premium/
 * (gitignored) and this router loads them at runtime.
 */

import { z } from "zod";
import { createTRPCRouter, publicProcedure, authedProcedure } from "~/server/api/trpc";
import { resolveUnifiedRequestIdentity } from "~/server/auth/auth-identity";
import { loadPremiumChains, getPremiumFeatures } from "~/lib/platform/premium";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { documents } from "~/server/db/schema";
import { requireFeatureForWallet, resolveWalletIdentity } from "~/server/crypto/operator-access";

export const anchorRouter = createTRPCRouter({
  /** Check premium feature availability. */
  capabilities: publicProcedure.query(async () => {
    return getPremiumFeatures();
  }),

  /** Anchor a document hash to all 3 chains (Base + SOL + BTC). */
  requestHash: publicProcedure.input(z.object({ documentId: z.string() })).mutation(async ({ ctx, input }) => {
    const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
    if (!identity.authSession && !identity.walletSession) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Not signed in" });
    }

    const [doc] = await ctx.db
      .select({ contentHash: documents.contentHash, createdBy: documents.createdBy })
      .from(documents)
      .where(eq(documents.id, input.documentId))
      .limit(1);

    if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
    if (!identity.walletAddressSet.has(doc.createdBy.toLowerCase())) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the document creator can anchor" });
    }

    await requireFeatureForWallet(
      ctx.db,
      resolveWalletIdentity(doc.createdBy),
      "blockchain_anchoring",
      "Premium feature — upgrade to enable blockchain anchoring",
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- premium module type unresolvable in OSS build
    const chains = await loadPremiumChains();
    if (!chains) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Premium feature — upgrade to enable blockchain anchoring" });
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- premium module
    const result = await chains.autoAnchorToAllChains(doc.contentHash);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- premium module
    return result;
  }),

  /** Anchor the audit trail hash on-chain. */
  anchorAuditTrail: publicProcedure.input(z.object({ documentId: z.string() })).mutation(async ({ ctx, input }) => {
    const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
    if (!identity.authSession && !identity.walletSession) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Not signed in" });
    }

    const [doc] = await ctx.db
      .select({ createdBy: documents.createdBy })
      .from(documents)
      .where(eq(documents.id, input.documentId))
      .limit(1);

    if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
    if (!identity.walletAddressSet.has(doc.createdBy.toLowerCase())) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    await requireFeatureForWallet(
      ctx.db,
      resolveWalletIdentity(doc.createdBy),
      "blockchain_anchoring",
      "Premium feature — upgrade to enable blockchain anchoring",
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- premium module type unresolvable in OSS build
    const chains = await loadPremiumChains();
    if (!chains) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Premium feature" });
    }

    try {
      const { computeAuditTrailHash } = await import("~/server/audit/audit");
      const auditHash = await computeAuditTrailHash(input.documentId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- premium module
      const result = await chains.autoAnchorToAllChains(auditHash);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- premium module
      return { auditHash, ...result };
    } catch (e) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: (e as Error).message });
    }
  }),

  /** Store encrypted document key on Base contract (wallet-gated). */
  storeDocumentKey: authedProcedure
    .input(
      z.object({
        contentHash: z.string(),
        recipientAddress: z.string(),
        encryptedKey: z.string(),
      }),
    )
    .mutation(async ({ ctx: _ctx, input }) => {
      await requireFeatureForWallet(
        _ctx.db,
        resolveWalletIdentity(_ctx.session.address, _ctx.session.chain),
        "blockchain_anchoring",
        "Premium feature — upgrade to enable blockchain anchoring",
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- premium module type unresolvable in OSS build
      const chains = await loadPremiumChains();
      if (!chains) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Premium feature" });
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- premium module
      const result = await chains.storeDocumentKeyOnBase(input.contentHash, input.recipientAddress, input.encryptedKey);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- premium module
      return result;
    }),

  /** Verify a hash on Base. */
  verifyOnBase: publicProcedure.input(z.object({ contentHash: z.string() })).query(async ({ input }) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- premium module type unresolvable in OSS build
    const chains = await loadPremiumChains();
    if (!chains) return { anchored: false, timestamp: 0 };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- premium module
    return chains.verifyHashOnBase(input.contentHash);
  }),

  /** Verify a hash on Solana. */
  verifyOnSol: publicProcedure.input(z.object({ contentHash: z.string() })).query(async ({ input }) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- premium module type unresolvable in OSS build
    const chains = await loadPremiumChains();
    if (!chains) return { anchored: false };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- premium module
    return chains.verifyHashOnSol(input.contentHash);
  }),
});
