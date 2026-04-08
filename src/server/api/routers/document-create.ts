// @ts-nocheck -- tRPC context types break type inference across router files
/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Document creation procedures: create, createGroup, bulkCreate, evaluateTokenGateWallets.
 */
import { randomBytes } from "crypto";
import { z } from "zod";
import { GROUP_ROLE, getBaseUrl } from "~/lib/signing/signing-constants";
import { normalizeSignerTokenGate, tokenGateWalletProofListSchema } from "~/lib/token-gates";
import { authedProcedure, createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { evaluateSignerTokenGateWithProofs } from "~/server/crypto/token-gates";
import { findDocumentById, findSignersByDocumentId } from "~/server/db/compat";
import { createDocumentInput, generateToken, safeIndexDocument, safeLogAudit } from "./document-helpers";
import { createDocumentPacket, requiresTokenGateWalletProofs } from "./document-packets";

export const documentCreateRouter = createTRPCRouter({
  create: authedProcedure.input(createDocumentInput).mutation(async ({ ctx, input }) => {
    const baseUrl = getBaseUrl();
    const { doc, contentHash, accessToken, insertedSigners } = await createDocumentPacket(ctx, input);

    return {
      id: doc.id,
      contentHash,
      accessToken,
      proofMode: input.proofMode,
      securityMode: input.securityMode,
      reminderConfig: doc.reminderConfig,
      signerLinks: insertedSigners.map((s: (typeof insertedSigners)[number]) => ({
        label: s.label,
        claimToken: s.claimToken,
        signUrl: `${baseUrl}/sign/${doc.id}?claim=${s.claimToken}`,
        embedUrl: `${baseUrl}/sign/${doc.id}?claim=${s.claimToken}&embed=1`,
        signMethod: s.signMethod,
      })),
    };
  }),

  createGroup: authedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        content: z.string().min(1),
        createdByEmail: z.string().email().optional().or(z.literal("")),
        proofMode: z.enum(["PRIVATE", "HYBRID", "CRYPTO_NATIVE"]).default("HYBRID"),
        securityMode: z.enum(["HASH_ONLY", "ENCRYPTED_PRIVATE", "ENCRYPTED_IPFS"]).default("HASH_ONLY"),
        signingOrder: z.enum(["parallel", "sequential"]).default("parallel"),
        expiresInDays: z.number().int().min(1).max(365).optional(),
        brandingProfileId: z.string().optional(),
        templateId: z.string().optional(),
        pdfStyleTemplateId: z.string().optional(),
        gazeTracking: z.enum(["off", "full", "signing_only"]).default("off"),
        postSignReveal: createDocumentInput.shape.postSignReveal,
        discloser: z.object({
          label: z.string().min(1).max(100),
          email: z.string().email().optional().or(z.literal("")),
          fields: createDocumentInput.shape.signers.element.shape.fields,
          signMethod: z.enum(["WALLET", "EMAIL_OTP"]).default("WALLET"),
        }),
        recipients: z
          .array(
            createDocumentInput.shape.signers.element.extend({
              content: z.string().min(1).optional(),
            }),
          )
          .min(1)
          .max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const baseUrl = getBaseUrl();
      const groupId = randomBytes(12).toString("base64url");

      const results: Array<{
        documentId: string;
        contentHash: string;
        recipientLabel: string;
        signerLinks: Array<{
          label: string;
          claimToken: string;
          signUrl: string;
          signMethod: string;
        }>;
      }> = [];

      for (const recipient of input.recipients) {
        const { content: recipientContent, ...recipientSigner } = recipient;
        const createInput: z.infer<typeof createDocumentInput> = {
          title: input.title,
          content: recipientContent ?? input.content,
          createdByEmail: input.createdByEmail,
          proofMode: input.proofMode,
          securityMode: input.securityMode,
          signingOrder: "parallel",
          expiresInDays: input.expiresInDays,
          brandingProfileId: input.brandingProfileId,
          templateId: input.templateId,
          pdfStyleTemplateId: input.pdfStyleTemplateId,
          gazeTracking: input.gazeTracking,
          postSignReveal: input.postSignReveal,
          signers: [
            recipientSigner,
            {
              label: input.discloser.label,
              email: input.discloser.email,
              fields: input.discloser.fields,
              signMethod: input.discloser.signMethod,
              role: "SIGNER",
            },
          ],
        };

        const { doc, contentHash, insertedSigners } = await createDocumentPacket(ctx, createInput, {
          groupId,
          signerGroupRoles: [GROUP_ROLE.RECIPIENT, GROUP_ROLE.DISCLOSER],
        });

        results.push({
          documentId: doc.id,
          contentHash,
          recipientLabel: recipient.label,
          signerLinks: insertedSigners.map((s) => ({
            label: s.label,
            claimToken: s.claimToken,
            signUrl: `${baseUrl}/sign/${doc.id}?claim=${s.claimToken}`,
            signMethod: s.signMethod,
          })),
        });
      }

      return { groupId, documents: results };
    }),

  bulkCreate: authedProcedure
    .input(
      z.object({
        documents: z.array(createDocumentInput).min(1).max(25),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const baseUrl = getBaseUrl();
      const created = [];
      for (const payload of input.documents) {
        const { doc, insertedSigners } = await createDocumentPacket(ctx, payload);
        created.push({
          id: doc.id,
          title: doc.title,
          status: doc.status,
          signerLinks: insertedSigners.map((s: (typeof insertedSigners)[number]) => ({
            label: s.label,
            signUrl: `${baseUrl}/sign/${doc.id}?claim=${s.claimToken}`,
            embedUrl: `${baseUrl}/sign/${doc.id}?claim=${s.claimToken}&embed=1`,
          })),
        });
      }
      return {
        count: created.length,
        created,
      };
    }),

  evaluateTokenGateWallets: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        proofs: tokenGateWalletProofListSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((s) => s.claimToken === input.claimToken);
      if (!signer) throw new Error("Invalid signing link");
      if (!signer.tokenGates) {
        throw new Error("This signer does not have a token gate.");
      }

      const evaluation = await evaluateSignerTokenGateWithProofs({
        gate: signer.tokenGates,
        documentId: input.documentId,
        claimToken: input.claimToken,
        proofs: input.proofs,
      });

      if (!evaluation) {
        throw new Error("This signer does not have a token gate.");
      }

      return evaluation;
    }),
});
