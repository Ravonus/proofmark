// @ts-nocheck -- tRPC context types break type inference across router files
/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Document proof, mobile signing, finalization, and group status procedures.
 */
import { randomBytes } from "crypto";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { normalizeAddress } from "~/lib/crypto/chains";
import { deriveSecurityMode } from "~/lib/signing/document-security";
import { isActionableRecipientRole } from "~/lib/signing/recipient-roles";
import { GROUP_ROLE } from "~/lib/signing/signing-constants";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { resolveUnifiedRequestIdentity } from "~/server/auth/auth-identity";
import { buildSigningMessage, hashDocument, verifySignature } from "~/server/crypto/rust-engine";
import {
  findDocumentByContentHash,
  findDocumentById,
  findDocumentByIpfsCid,
  findDocumentsByGroupId,
  findSignersByDocumentId,
} from "~/server/db/compat";
import { mobileSignSessions, signers } from "~/server/db/schema";
import { resolveDocumentViewerAccess } from "~/server/documents/document-access";
import { computeDocumentStateHash, handlePostSignCompletion, safeLogAudit } from "./document-helpers";
import { getIdentityActor, requireUnifiedIdentity } from "./document-utils";

export const documentFinalizeRouter = createTRPCRouter({
  // ── Proof packet: generate complete evidence bundle ──
  generateProofPacket: publicProcedure.input(z.object({ documentId: z.string() })).mutation(async ({ ctx, input }) => {
    const identity = await requireUnifiedIdentity(ctx);
    const doc = await findDocumentById(ctx.db, input.documentId);
    if (!doc) throw new Error("Document not found");

    const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
    const viewerAccess = resolveDocumentViewerAccess({
      document: doc,
      signers: docSigners,
      identity,
    });
    if (!viewerAccess.canAccessDocument) {
      throw new Error("Access denied");
    }

    const { generateProofPacket } = await import("~/server/documents/proof-packet");
    const { manifest, pdf } = await generateProofPacket(input.documentId);
    const { actor, actorType } = getIdentityActor(identity);

    // Audit: proof packet generated
    void safeLogAudit({
      documentId: input.documentId,
      eventType: "PROOF_PACKET_GENERATED",
      actor,
      actorType,
      ipAddress: ctx.clientIp,
      metadata: { packetHash: manifest.packetHash },
    });

    return {
      manifest,
      // PDF as base64 for transport via tRPC
      pdfBase64: pdf.toString("base64"),
    };
  }),

  // ── Audit trail: get events for a document ──
  getAuditTrail: publicProcedure.input(z.object({ documentId: z.string() })).query(async ({ ctx, input }) => {
    const identity = await requireUnifiedIdentity(ctx);
    const doc = await findDocumentById(ctx.db, input.documentId);
    if (!doc) throw new Error("Document not found");

    const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
    const viewerAccess = resolveDocumentViewerAccess({
      document: doc,
      signers: docSigners,
      identity,
    });
    if (!viewerAccess.canAccessDocument) {
      throw new Error("Access denied");
    }

    const { getAuditTrail, verifyAuditChain } = await import("~/server/audit/audit");
    const events = await getAuditTrail(input.documentId);
    const chainValidity = await verifyAuditChain(input.documentId);

    return {
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        actor: e.actor,
        actorType: e.actorType,
        ipAddress: e.ipAddress,
        userAgent: e.userAgent,
        metadata: e.metadata,
        eventHash: e.eventHash,
        createdAt: e.createdAt.toISOString(),
      })),
      chainValid: chainValidity.valid,
    };
  }),

  // ── Public verification: look up by hash, CID, or ID ──
  verify: publicProcedure.input(z.object({ query: z.string().min(1) })).query(async ({ ctx, input }) => {
    const q = input.query.trim();

    // Try by content hash
    let doc = await findDocumentByContentHash(ctx.db, q);

    // Try by IPFS CID
    if (!doc) {
      doc = await findDocumentByIpfsCid(ctx.db, q);
    }

    // Try by document ID
    if (!doc) {
      doc = await findDocumentById(ctx.db, q);
    }

    if (!doc) return null;

    const docSigners = await findSignersByDocumentId(ctx.db, doc.id);

    let auditEvents: Array<{
      eventType: string;
      actor: string;
      actorType: string | null;
      ipAddress: string | null;
      createdAt: string;
      metadata: unknown;
    }> = [];
    let auditChainValid = false;
    try {
      const { getAuditTrail, verifyAuditChain } = await import("~/server/audit/audit");
      const events = await getAuditTrail(doc.id);
      auditEvents = events.map((e) => ({
        eventType: e.eventType,
        actor: e.actor,
        actorType: e.actorType,
        ipAddress: e.ipAddress,
        createdAt: e.createdAt.toISOString(),
        metadata: e.metadata,
      }));
      const chain = await verifyAuditChain(doc.id);
      auditChainValid = chain.valid;
    } catch {
      // audit table may not exist yet
    }

    return {
      id: doc.id,
      title: doc.title,
      contentHash: doc.contentHash,
      ipfsCid: doc.ipfsCid,
      encryptedAtRest: doc.encryptedAtRest,
      securityMode: deriveSecurityMode(doc),
      status: doc.status,
      createdBy: doc.createdBy,
      createdAt: doc.createdAt,
      proofMode: doc.proofMode,
      signers: docSigners.map((s) => ({
        label: s.label,
        address: s.address,
        chain: s.chain,
        status: s.status,
        signature: s.signature,
        scheme: s.scheme,
        signedAt: s.signedAt,
        handSignatureHash: s.handSignatureHash,
        identityLevel: s.identityLevel,
        signMethod: s.signMethod,
        // Hybrid signing: tells the verifier UI to render an "Imported (manual)"
        // badge instead of "Verified" for signatures that came from a scanned PDF.
        signatureSource: (s as { signatureSource?: string }).signatureSource ?? "DIGITAL",
        importedPdfHash: (s as { importedPdfHash?: string | null }).importedPdfHash ?? null,
      })),
      auditTrail: auditEvents,
      auditChainValid,
    };
  }),

  // ── Mobile signing: create session (desktop) — tied to specific signer ──
  createMobileSignSession: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        signerLabel: z.string(),
        mode: z.enum(["signature", "initials"]).optional().default("signature"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the claim token is valid for this document
      const signer = (await findSignersByDocumentId(ctx.db, input.documentId)).find(
        (entry) => entry.claimToken === input.claimToken,
      );
      if (!signer) throw new Error("Invalid signer");
      if (signer.status !== "PENDING") throw new Error("Already signed");

      const token = randomBytes(16).toString("base64url");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await ctx.db.insert(mobileSignSessions).values({
        token,
        documentId: input.documentId,
        signerLabel: signer.label,
        expiresAt,
      });
      const fwdHost = ctx.req?.headers.get("x-forwarded-host");
      const fwdProto = ctx.req?.headers.get("x-forwarded-proto") ?? "https";
      const host = ctx.req?.headers.get("host") ?? "localhost:3100";
      const baseUrl = fwdHost
        ? `${fwdProto}://${fwdHost}`
        : `${host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https"}://${host}`;
      const modeParam = input.mode === "initials" ? "?mode=initials" : "";
      return {
        token,
        url: `${baseUrl}/mobile-sign/${token}${modeParam}`,
        expiresAt: expiresAt.toISOString(),
      };
    }),

  // ── Mobile signing: poll for result (desktop) ──
  pollMobileSign: publicProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
    const [session] = await ctx.db
      .select()
      .from(mobileSignSessions)
      .where(eq(mobileSignSessions.token, input.token))
      .limit(1);
    if (!session) return { status: "expired" as const, signatureData: null };
    if (session.expiresAt < new Date()) return { status: "expired" as const, signatureData: null };
    return {
      status: session.status as "waiting" | "signed" | "expired",
      signatureData: session.signatureData,
    };
  }),

  // ── Mobile signing: submit signature (phone) ──
  submitMobileSignature: publicProcedure
    .input(
      z.object({
        token: z.string(),
        signatureData: z.string(),
        mobileForensic: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [session] = await ctx.db
        .select()
        .from(mobileSignSessions)
        .where(and(eq(mobileSignSessions.token, input.token), gt(mobileSignSessions.expiresAt, new Date())))
        .limit(1);
      if (!session) throw new Error("Session expired or invalid");
      if (session.status !== "waiting") throw new Error("Already submitted");
      await ctx.db
        .update(mobileSignSessions)
        .set({
          status: "signed",
          signatureData: input.signatureData,
          ...(input.mobileForensic ? { metadata: input.mobileForensic } : {}),
        })
        .where(eq(mobileSignSessions.id, session.id));
      return { ok: true };
    }),

  // ── Finalization: discloser's second wallet sig covering the complete document ──
  getFinalizationMessage: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        signerAddress: z.string(),
        chain: z.enum(["ETH", "SOL", "BTC"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((s) => s.claimToken === input.claimToken);
      if (!signer) throw new Error("Invalid signing link");
      if (signer.groupRole !== GROUP_ROLE.DISCLOSER) throw new Error("Only the discloser can finalize");
      if (signer.status !== "SIGNED") throw new Error("You must sign the document first");
      if (signer.finalizationSignature) throw new Error("Already finalized");

      const others = docSigners.filter((s) => s.id !== signer.id && isActionableRecipientRole(s.role));
      if (!others.every((s) => s.status === "SIGNED")) {
        throw new Error("All other parties must sign before finalization");
      }

      const signerIdx = docSigners.findIndex((s) => s.id === signer.id);
      const finalizationStateHash = await computeDocumentStateHash({
        contentHash: doc.contentHash,
        docSigners,
        currentSignerFieldValues: signer.fieldValues ?? null,
        currentSignerIndex: signerIdx >= 0 ? signerIdx : undefined,
      });

      const address = normalizeAddress(input.chain, input.signerAddress);
      const message = await buildSigningMessage({
        documentTitle: doc.title,
        contentHash: finalizationStateHash,
        signerLabel: signer.label,
        signerAddress: address,
        chain: input.chain,
      });

      return { message, finalizationStateHash };
    }),

  finalize: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        signerAddress: z.string(),
        chain: z.enum(["ETH", "SOL", "BTC"]),
        signature: z.string(),
        fieldValues: z.record(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((s) => s.claimToken === input.claimToken);
      if (!signer) throw new Error("Invalid signing link");
      if (signer.groupRole !== GROUP_ROLE.DISCLOSER) throw new Error("Only the discloser can finalize");
      if (signer.status !== "SIGNED") throw new Error("You must sign the document before finalizing");
      if (signer.finalizationSignature) throw new Error("Already finalized");

      // All non-discloser signers must be done
      const others = docSigners.filter((s) => s.id !== signer.id && isActionableRecipientRole(s.role));
      if (!others.every((s) => s.status === "SIGNED")) {
        throw new Error("All other parties must sign before finalization");
      }

      const address = normalizeAddress(input.chain, input.signerAddress);

      // Compute finalization state hash covering ALL field values
      const signerIdx = docSigners.findIndex((s) => s.id === signer.id);
      const finalizationStateHash = await computeDocumentStateHash({
        contentHash: doc.contentHash,
        docSigners,
        currentSignerFieldValues: input.fieldValues ?? signer.fieldValues ?? null,
        currentSignerIndex: signerIdx >= 0 ? signerIdx : undefined,
      });

      const message = await buildSigningMessage({
        documentTitle: doc.title,
        contentHash: finalizationStateHash,
        signerLabel: signer.label,
        signerAddress: address,
        chain: input.chain,
      });

      const verifyResult = await verifySignature({
        chain: input.chain,
        address,
        message,
        signature: input.signature,
      });

      if (!verifyResult.ok) {
        throw new Error(`Finalization signature verification failed (scheme=${verifyResult.scheme})`);
      }

      await ctx.db
        .update(signers)
        .set({
          finalizationSignature: input.signature,
          finalizationStateHash,
          finalizationSignedAt: new Date(),
          finalizationMessage: message,
        })
        .where(eq(signers.id, signer.id));

      void safeLogAudit({
        documentId: doc.id,
        eventType: "SIGNER_SIGNED",
        actor: address,
        actorType: "wallet",
        metadata: {
          signMethod: "WALLET",
          chain: input.chain,
          scheme: verifyResult.scheme,
          signerLabel: signer.label,
          finalization: true,
          finalizationStateHash,
        },
      });

      // Re-check completion now that finalization is recorded
      const updatedSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const { allSigned } = await handlePostSignCompletion({
        db: ctx.db,
        doc,
        docSigners: updatedSigners,
        justSignedId: signer.id,
        justSignedOrder: signer.signerOrder ?? 0,
      });

      return { ok: true, allSigned, finalizationStateHash };
    }),

  // ── Bulk finalization: sign once to finalize all contracts in a group ──
  getBulkFinalizationMessage: publicProcedure
    .input(
      z.object({
        groupId: z.string(),
        claimToken: z.string(),
        signerAddress: z.string(),
        chain: z.enum(["ETH", "SOL", "BTC"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const docs = await findDocumentsByGroupId(ctx.db, input.groupId);
      if (docs.length === 0) throw new Error("Group not found");

      const entries: Array<{
        documentId: string;
        stateHash: string;
        title: string;
      }> = [];

      for (const doc of docs) {
        const docSigners = await findSignersByDocumentId(ctx.db, doc.id);
        const discloser = docSigners.find(
          (s) => s.claimToken === input.claimToken || s.groupRole === GROUP_ROLE.DISCLOSER,
        );
        if (discloser?.status !== "SIGNED" || discloser.finalizationSignature) continue;

        // All non-discloser signers must be done
        const others = docSigners.filter((s) => s.id !== discloser.id && isActionableRecipientRole(s.role));
        if (!others.every((s) => s.status === "SIGNED")) continue;

        const idx = docSigners.findIndex((s) => s.id === discloser.id);
        const stateHash = await computeDocumentStateHash({
          contentHash: doc.contentHash,
          docSigners,
          currentSignerFieldValues: discloser.fieldValues ?? null,
          currentSignerIndex: idx >= 0 ? idx : undefined,
        });

        entries.push({ documentId: doc.id, stateHash, title: doc.title });
      }

      if (entries.length === 0) throw new Error("No contracts ready for finalization");

      // Build a message listing every individual state hash — each contract
      // is independently provable because the full message is stored on each.
      const sortedHashes = entries.map((e) => e.stateHash).sort();
      const bulkContentHash = await hashDocument(sortedHashes.join("|"));

      const address = normalizeAddress(input.chain, input.signerAddress);
      const message = await buildSigningMessage({
        documentTitle: `Bulk Finalization (${entries.length} contracts)`,
        contentHash: bulkContentHash,
        signerLabel: entries[0]!.title,
        signerAddress: address,
        chain: input.chain,
      });

      return {
        message,
        bulkContentHash,
        contracts: entries.map((e) => ({
          documentId: e.documentId,
          stateHash: e.stateHash,
          title: e.title,
        })),
      };
    }),

  bulkFinalize: publicProcedure
    .input(
      z.object({
        groupId: z.string(),
        claimToken: z.string(),
        signerAddress: z.string(),
        chain: z.enum(["ETH", "SOL", "BTC"]),
        signature: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const docs = await findDocumentsByGroupId(ctx.db, input.groupId);
      if (docs.length === 0) throw new Error("Group not found");

      const address = normalizeAddress(input.chain, input.signerAddress);
      const entries: Array<{
        documentId: string;
        stateHash: string;
        discloserId: string;
      }> = [];

      for (const doc of docs) {
        const docSigners = await findSignersByDocumentId(ctx.db, doc.id);
        const discloser = docSigners.find(
          (s) => s.claimToken === input.claimToken || s.groupRole === GROUP_ROLE.DISCLOSER,
        );
        if (discloser?.status !== "SIGNED" || discloser.finalizationSignature) continue;

        const others = docSigners.filter((s) => s.id !== discloser.id && isActionableRecipientRole(s.role));
        if (!others.every((s) => s.status === "SIGNED")) continue;

        const idx = docSigners.findIndex((s) => s.id === discloser.id);
        const stateHash = await computeDocumentStateHash({
          contentHash: doc.contentHash,
          docSigners,
          currentSignerFieldValues: discloser.fieldValues ?? null,
          currentSignerIndex: idx >= 0 ? idx : undefined,
        });

        entries.push({
          documentId: doc.id,
          stateHash,
          discloserId: discloser.id,
        });
      }

      if (entries.length === 0) throw new Error("No contracts ready for finalization");

      // Recompute and verify bulk signature
      const sortedHashes = entries.map((e) => e.stateHash).sort();
      const bulkContentHash = await hashDocument(sortedHashes.join("|"));

      const message = await buildSigningMessage({
        documentTitle: `Bulk Finalization (${entries.length} contracts)`,
        contentHash: bulkContentHash,
        signerLabel: docs[0]!.title,
        signerAddress: address,
        chain: input.chain,
      });

      const verifyResult = await verifySignature({
        chain: input.chain,
        address,
        message,
        signature: input.signature,
      });

      if (!verifyResult.ok) {
        throw new Error(`Bulk finalization signature verification failed (scheme=${verifyResult.scheme})`);
      }

      // Apply finalization to each contract — store the full message for
      // independent court verification of any single contract.
      const now = new Date();
      const finalized: string[] = [];

      for (const entry of entries) {
        await ctx.db
          .update(signers)
          .set({
            finalizationSignature: input.signature,
            finalizationStateHash: entry.stateHash,
            finalizationSignedAt: now,
            finalizationMessage: message,
          })
          .where(eq(signers.id, entry.discloserId));

        // Check completion
        const updatedSigners = await findSignersByDocumentId(ctx.db, entry.documentId);
        const doc = docs.find((d) => d.id === entry.documentId)!;
        const { allSigned } = await handlePostSignCompletion({
          db: ctx.db,
          doc,
          docSigners: updatedSigners,
          justSignedId: entry.discloserId,
          justSignedOrder: 0,
        });

        if (allSigned) finalized.push(entry.documentId);

        void safeLogAudit({
          documentId: entry.documentId,
          eventType: "SIGNER_SIGNED",
          actor: address,
          actorType: "wallet",
          metadata: {
            signMethod: "WALLET",
            chain: input.chain,
            scheme: verifyResult.scheme,
            finalization: true,
            bulkFinalization: true,
            bulkContentHash,
            groupId: input.groupId,
          },
        });
      }

      return {
        ok: true,
        finalizedCount: entries.length,
        completedDocIds: finalized,
      };
    }),

  // ── Document group status ──
  getGroupStatus: publicProcedure.input(z.object({ groupId: z.string() })).query(async ({ ctx, input }) => {
    const identity = await requireUnifiedIdentity(ctx);
    const docs = await findDocumentsByGroupId(ctx.db, input.groupId);
    if (docs.length === 0) throw new Error("Group not found");

    if (!identity.walletAddressSet.has(docs[0]!.createdBy.toLowerCase())) {
      throw new Error("Access denied");
    }

    const results = await Promise.all(
      docs.map(async (doc) => {
        const docSigners = await findSignersByDocumentId(ctx.db, doc.id);
        return {
          documentId: doc.id,
          title: doc.title,
          status: doc.status,
          signers: docSigners.map((s) => ({
            label: s.label,
            status: s.status,
            groupRole: s.groupRole,
            signedAt: s.signedAt,
          })),
        };
      }),
    );

    return { groupId: input.groupId, documents: results };
  }),
});
