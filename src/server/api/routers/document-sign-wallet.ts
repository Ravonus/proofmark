// @ts-nocheck -- tRPC context types break type inference across router files
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * Wallet signing procedures: saveFieldValues, getSigningMessage, sign.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { VERIFY_FIELD_TYPES } from "~/lib/signing/signing-constants";
import { tokenGateWalletProofListSchema } from "~/lib/token-gates";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { buildSigningMessage, hashHandSignature } from "~/server/crypto/rust-engine";
import { issueCanvasChallenge, issueLivenessChallenge, issueTimingToken } from "~/server/crypto/signing-challenges";
import { findDocumentById, findSignersByDocumentId } from "~/server/db/compat";
import { signers } from "~/server/db/schema";
import {
  computeDocumentStateHash,
  getSignerFieldContext,
  handlePostSignCompletion,
  safeLogAudit,
} from "./document-helpers";
import {
  mergeMobileForensics,
  prepareWalletSign,
  runPostSignSideEffects,
  validateWalletSigner,
} from "./document-sign-wallet-helpers";
import { forensicInputSchema } from "./document-utils";

export const documentSignWalletRouter = createTRPCRouter({
  saveFieldValues: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        fieldValues: z.record(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (doc?.status !== "PENDING") return { saved: false };

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((s) => s.claimToken === input.claimToken);
      if (!signer || signer.status === "SIGNED") return { saved: false };

      // Sanitize — only allow fields this signer can edit
      const { editableFields } = await getSignerFieldContext({
        doc,
        docSigners,
        signer,
      });
      const allowedIds = new Set(editableFields.map((f) => f.id));

      // Identify verification-type fields for this signer
      const verifyFields = editableFields.filter((f) => VERIFY_FIELD_TYPES.has(f.type));

      // If this signer has verification fields, ALL saves are blocked until
      // at least one verification is completed. We need to know who they are
      // before accepting any data.
      if (verifyFields.length > 0) {
        const existing = signer.fieldValues ?? {};
        const hasAnyVerification = verifyFields.some((f) => {
          const val = existing[f.id];
          return val?.includes('"status":"verified"');
        });
        // Also check socialVerifications on the signer record
        const socialVerifs = (signer.socialVerifications ?? []) as Array<{
          verifiedAt?: string;
        }>;
        if (!hasAnyVerification && socialVerifs.length === 0) {
          return { saved: false, reason: "verification_required" };
        }
      }

      const verifyFieldIds = new Set(verifyFields.map((f) => f.id));

      const sanitized: Record<string, string> = {};
      for (const [key, value] of Object.entries(input.fieldValues)) {
        if (!allowedIds.has(key)) continue;
        if (verifyFieldIds.has(key)) continue; // skip — only set via verification flow
        sanitized[key] = value;
      }

      if (Object.keys(sanitized).length === 0) return { saved: false };

      // Merge with existing values (don't overwrite verified fields)
      const existing = signer.fieldValues ?? {};
      const merged = { ...existing, ...sanitized };

      await ctx.db.update(signers).set({ fieldValues: merged }).where(eq(signers.id, signer.id));

      return { saved: true };
    }),

  // ── Get signing message: uses claim token to identify signer slot ──
  getSigningMessage: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        signerAddress: z.string(),
        chain: z.enum(["ETH", "SOL", "BTC"]),
        handSignatureData: z.string().optional(),
        tokenGateProofs: tokenGateWalletProofListSchema.optional(),
        fieldValues: z.record(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((s) => s.claimToken === input.claimToken);
      await validateWalletSigner(signer, doc, {
        signerAddress: input.signerAddress,
        chain: input.chain,
        claimToken: input.claimToken,
        tokenGateProofs: input.tokenGateProofs,
        documentId: input.documentId,
      } as any);

      // Hash the hand signature data server-side with SHA-256
      const inkHash = input.handSignatureData ? await hashHandSignature(input.handSignatureData) : undefined;

      // Issue server-side signing challenges
      const gazeEnabled = doc.gazeTracking !== "off";
      const timingToken = issueTimingToken(input.documentId, input.claimToken);
      const livenessChallenge = gazeEnabled ? issueLivenessChallenge(input.documentId, input.claimToken) : null;
      const canvasChallenge = issueCanvasChallenge(input.documentId, input.claimToken);

      // Sanitize field values the same way the sign mutation does, so the
      // documentStateHash computed here matches what sign recomputes.
      const { editableFields: msgEditableFields } = await getSignerFieldContext({ doc, docSigners, signer });
      const msgAllowedIds = new Set(msgEditableFields.map((f) => f.id));
      let sanitizedMsgFieldValues = input.fieldValues
        ? Object.fromEntries(Object.entries(input.fieldValues).filter(([key]) => msgAllowedIds.has(key)))
        : null;
      if (sanitizedMsgFieldValues && Object.keys(sanitizedMsgFieldValues).length === 0) {
        sanitizedMsgFieldValues = null;
      }

      // Compute state hash covering template + all current field values
      const signerIdx = docSigners.findIndex((s) => s.id === signer.id);
      const documentStateHash = await computeDocumentStateHash({
        contentHash: doc.contentHash,
        docSigners,
        currentSignerFieldValues: sanitizedMsgFieldValues,
        currentSignerIndex: signerIdx >= 0 ? signerIdx : undefined,
      });

      return {
        message: await buildSigningMessage({
          documentTitle: doc.title,
          contentHash: documentStateHash,
          signerLabel: signer.label,
          signerAddress: input.signerAddress,
          chain: input.chain,
          handSignatureHash: inkHash,
        }),
        signerLabel: signer.label,
        handSignatureHash: inkHash,
        documentStateHash,
        // Server-issued challenges — client must solve and return with sign request
        challenges: {
          timingToken: timingToken.token,
          livenessChallenge,
          canvasChallenge: {
            token: canvasChallenge.token,
            seed: canvasChallenge.seed,
            instructions: canvasChallenge.instructions,
          },
        },
      };
    }),

  // ── Sign: claims slot + records signature ──
  sign: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        signerAddress: z.string(),
        chain: z.enum(["ETH", "SOL", "BTC"]),
        signature: z.string(),
        tokenGateProofs: tokenGateWalletProofListSchema.optional(),
        email: z.string().email().optional(),
        handSignatureData: z.string().optional(),
        handSignatureHash: z.string().optional(),
        fieldValues: z.record(z.string()).optional(),
        forensic: forensicInputSchema,
        // Server-issued challenge responses
        challengeResponses: z
          .object({
            timingToken: z.string().optional(),
            livenessResponse: z
              .object({
                challengeToken: z.string(),
                steps: z.array(
                  z.object({
                    nonce: z.string(),
                    passed: z.boolean(),
                    reactionMs: z.number(),
                    observedX: z.number().optional(),
                    observedY: z.number().optional(),
                    confidence: z.number().optional(),
                  }),
                ),
              })
              .optional(),
            canvasHash: z.string().optional(),
            canvasToken: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");
      if (doc.status !== "PENDING") throw new Error("Document is no longer pending");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((s) => s.claimToken === input.claimToken);
      await validateWalletSigner(signer, doc, {
        signerAddress: input.signerAddress,
        chain: input.chain,
        claimToken: input.claimToken,
        tokenGateProofs: input.tokenGateProofs,
        documentId: input.documentId,
      } as any);

      const p = await prepareWalletSign(ctx, input, doc, docSigners, signer!);

      await ctx.db
        .update(signers)
        .set({
          address: p.address,
          chain: input.chain,
          status: "SIGNED",
          signature: input.signature,
          signedAt: p.signedAt,
          scheme: p.scheme,
          email: p.signerEmail,
          handSignatureData: input.handSignatureData ?? null,
          handSignatureHash: p.inkHash ?? null,
          fieldValues: p.sanitizedFieldValues,
          lastIp: p.signerIp,
          ipUpdatedAt: p.signerIp ? p.signedAt : undefined,
          userAgent: p.userAgentStr,
          identityLevel: p.idResult.identityLevel,
          forensicEvidence: p.mergedForensicEvidence,
          forensicHash: p.forensic.hash,
          documentStateHash: p.documentStateHash,
        })
        .where(eq(signers.id, signer!.id));

      await mergeMobileForensics(ctx.db, doc.id, signer!, p.mergedForensicEvidence);

      void safeLogAudit({
        documentId: doc.id,
        eventType: "SIGNER_SIGNED",
        actor: p.address,
        actorType: "wallet",
        ipAddress: p.signerIp,
        userAgent: p.userAgentStr,
        metadata: {
          signMethod: "WALLET",
          chain: input.chain,
          scheme: p.scheme,
          signerLabel: signer!.label,
          hasHandSignature: !!input.handSignatureData,
          forensicHash: p.forensic.hash,
          forensicFlags: p.forensic.data?.flags?.map((f: any) => f.code) ?? [],
          automationAction: p.forensic.outcome?.action ?? "ALLOW",
        },
      });

      await runPostSignSideEffects({
        ctx,
        doc,
        docSigners,
        signer: signer!,
        signerIp: p.signerIp,
        signerEmail: p.signerEmail,
        forensic: p.forensic,
        mergedForensicEvidence: p.mergedForensicEvidence,
        idResult: p.idResult,
        signData: {
          address: p.address,
          chain: input.chain,
          signature: input.signature,
          signedAt: p.signedAt,
          scheme: p.scheme,
          email: p.signerEmail,
          handSignatureData: input.handSignatureData ?? null,
          handSignatureHash: p.inkHash ?? null,
          fieldValues: p.sanitizedFieldValues,
          lastIp: p.signerIp,
          ipUpdatedAt: p.signerIp ? p.signedAt : null,
          userAgent: p.userAgentStr,
          identityLevel: p.idResult.identityLevel,
          forensicEvidence: p.mergedForensicEvidence,
          forensicHash: p.forensic.hash,
          documentStateHash: p.documentStateHash,
        },
      });

      const { allSigned } = await handlePostSignCompletion({
        db: ctx.db,
        doc,
        docSigners,
        justSignedId: signer!.id,
        justSignedOrder: signer!.signerOrder ?? 0,
      });

      return { ok: true, allSigned };
    }),
});
