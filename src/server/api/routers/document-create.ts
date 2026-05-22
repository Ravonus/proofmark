// @ts-nocheck -- tRPC context types break type inference across router files
/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Document creation procedures: create, createGroup, addRecipientToGroup,
 * bulkCreate, evaluateTokenGateWallets.
 */
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { GROUP_ROLE, getBaseUrl } from "~/lib/signing/signing-constants";
import { normalizeSignerTokenGate, tokenGateWalletProofListSchema } from "~/lib/token-gates";
import { authedProcedure, createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { evaluateSignerTokenGateWithProofs } from "~/server/crypto/token-gates";
import {
  findDocumentById,
  findDocumentsByCreator,
  findDocumentsByGroupId,
  findSignersByDocumentId,
} from "~/server/db/compat";
import { signers as signersTable } from "~/server/db/schema";
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

  /**
   * Add a single new recipient to an existing document group from the
   * dashboard. The discloser's already-collected signature, field values
   * and forensic evidence are copied from any signed sibling onto the
   * new sibling so the host doesn't have to sign a third time — matches
   * the agorix admin "+ Add recipient" series UX.
   */
  addRecipientToGroup: authedProcedure
    .input(
      z.object({
        groupId: z.string().min(1),
        recipient: createDocumentInput.shape.signers.element,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const baseUrl = getBaseUrl();

      // Confirm caller owns at least one sibling in the group, and use
      // it as the template for content/branding/discloser shape.
      const callerDocs = await findDocumentsByCreator(ctx.db, ctx.session.address);
      const sibling = callerDocs.find((d) => d.groupId === input.groupId);
      if (!sibling) {
        throw new Error("Group not found or not owned by caller");
      }

      const siblingSigners = await findSignersByDocumentId(ctx.db, sibling.id);
      const existingDiscloser = siblingSigners.find((s) => s.groupRole === GROUP_ROLE.DISCLOSER);
      if (!existingDiscloser) {
        throw new Error("Group's first document has no discloser signer");
      }

      const securityMode = sibling.encryptedAtRest
        ? sibling.ipfsCid
          ? "ENCRYPTED_IPFS"
          : "ENCRYPTED_PRIVATE"
        : "HASH_ONLY";

      const createInput = {
        title: sibling.title,
        content: sibling.content,
        createdByEmail: sibling.createdByEmail || undefined,
        proofMode: sibling.proofMode,
        securityMode,
        signingOrder: "parallel",
        gazeTracking: sibling.gazeTracking ?? "off",
        brandingProfileId: sibling.brandingProfileId ?? undefined,
        templateId: sibling.templateId ?? undefined,
        pdfStyleTemplateId: sibling.pdfStyleTemplateId ?? undefined,
        postSignReveal: sibling.postSignReveal ?? undefined,
        signers: [
          input.recipient,
          {
            label: existingDiscloser.label,
            email: existingDiscloser.email ?? undefined,
            fields: existingDiscloser.fields ?? [],
            signMethod: existingDiscloser.signMethod ?? "WALLET",
            role: "SIGNER",
          },
        ],
        // Fire invite email to the new recipient when they have an
        // address. The existing discloser slot is already SIGNED on
        // sibling docs (backfilled below) so no invite goes out for it.
        sendInvites: true,
      };

      const { doc, contentHash, insertedSigners } = await createDocumentPacket(ctx, createInput, {
        groupId: input.groupId,
        signerGroupRoles: [GROUP_ROLE.RECIPIENT, GROUP_ROLE.DISCLOSER],
      });

      // Backfill the new sibling's discloser from any already-signed
      // sibling. The wallet signature is content-bound (contentHash
      // includes the creation timestamp — see document-packets.ts
      // line 56) so identical content still produces distinct hashes
      // across siblings. Mirror what propagateGroupSignature does:
      //   - same hash: full copy including signature → status SIGNED
      //   - different hash: partial prefill (label/address/fields/email)
      //     so the recipient can SEE who the discloser is and what
      //     they've filled in, but status stays PENDING since the
      //     wallet sig can't be reused on a different contentHash.
      // Either way the recipient opens the contract and sees the
      // host's identity + filled fields, not an empty placeholder.
      const allSiblings = await findDocumentsByGroupId(ctx.db, input.groupId);
      let backfilled = false;
      let backfillKind = null;
      for (const sib of allSiblings) {
        if (sib.id === doc.id) continue;
        const sibSigners = await findSignersByDocumentId(ctx.db, sib.id);
        const signedDiscloser = sibSigners.find((s) => s.groupRole === GROUP_ROLE.DISCLOSER && s.status === "SIGNED");
        if (!signedDiscloser) continue;

        const newSigners = await findSignersByDocumentId(ctx.db, doc.id);
        const newDiscloser = newSigners.find((s) => s.groupRole === GROUP_ROLE.DISCLOSER);
        if (!newDiscloser) break;

        const sameContent = sib.contentHash === contentHash;
        if (sameContent) {
          await ctx.db
            .update(signersTable)
            .set({
              address: signedDiscloser.address,
              chain: signedDiscloser.chain,
              status: "SIGNED",
              signature: signedDiscloser.signature,
              signedAt: signedDiscloser.signedAt,
              scheme: signedDiscloser.scheme,
              email: signedDiscloser.email,
              handSignatureData: signedDiscloser.handSignatureData,
              handSignatureHash: signedDiscloser.handSignatureHash,
              fieldValues: signedDiscloser.fieldValues,
              identityLevel: signedDiscloser.identityLevel,
              forensicEvidence: signedDiscloser.forensicEvidence,
              forensicHash: signedDiscloser.forensicHash,
              documentStateHash: signedDiscloser.documentStateHash,
              consentText: signedDiscloser.consentText,
              consentAt: signedDiscloser.consentAt,
            })
            .where(eq(signersTable.id, newDiscloser.id));
          backfillKind = "full";
        } else {
          await ctx.db
            .update(signersTable)
            .set({
              address: signedDiscloser.address,
              chain: signedDiscloser.chain,
              email: signedDiscloser.email,
              fieldValues: signedDiscloser.fieldValues,
              handSignatureData: signedDiscloser.handSignatureData,
              handSignatureHash: signedDiscloser.handSignatureHash,
            })
            .where(eq(signersTable.id, newDiscloser.id));
          backfillKind = "prefill";
        }
        backfilled = true;

        void safeLogAudit({
          documentId: doc.id,
          eventType: sameContent ? "SIGNER_SIGNED" : "SIGNER_VIEWED",
          actor: signedDiscloser.address ?? signedDiscloser.email ?? "system",
          actorType: signedDiscloser.address ? "wallet" : "email",
          metadata: {
            propagatedFrom: sib.id,
            groupId: input.groupId,
            signerLabel: signedDiscloser.label,
            reason: "add-recipient-backfill",
            kind: backfillKind,
          },
        });
        break;
      }

      return {
        documentId: doc.id,
        contentHash,
        backfilled,
        backfillKind,
        signerLinks: insertedSigners.map((s) => ({
          label: s.label,
          claimToken: s.claimToken,
          signUrl: `${baseUrl}/sign/${doc.id}?claim=${s.claimToken}`,
          signMethod: s.signMethod,
          groupRole: s.groupRole ?? null,
        })),
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
