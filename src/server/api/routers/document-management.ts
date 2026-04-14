// @ts-nocheck -- tRPC context types break type inference across router files
/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * Document management procedures: voidDocument, declineSign, resendInvite,
 * claimSlot, createEmbedLink, runIdentityVerification, addressSuggestions,
 * createPaymentCheckout, verifyPaymentCheckout, getReveal, getAccessChallenge,
 * refreshAccess.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isAddressLikeField } from "~/lib/address-autocomplete";
import { normalizeAddress } from "~/lib/crypto/chains";
import { isActionableRecipientRole } from "~/lib/signing/recipient-roles";
import { getBaseUrl } from "~/lib/signing/signing-constants";
import { logger } from "~/lib/utils/logger";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { resolveUnifiedRequestIdentity } from "~/server/auth/auth-identity";
import { evaluateIdentityVerification } from "~/server/auth/id-verification";
import { verifySignature } from "~/server/crypto/rust-engine";
import {
  findDocumentById,
  findSignerByIdAndDocumentId,
  findSignersByDocumentId,
  isSchemaDriftError,
} from "~/server/db/compat";
import { documents, signers } from "~/server/db/schema";
import { resolveDocumentViewerAccess } from "~/server/documents/document-access";
import { searchAddressSuggestions } from "~/server/messaging/address-autocomplete";
import { resolveDocumentBranding, sendSignerInvite } from "~/server/messaging/delivery";
import {
  createPaymentCheckout as createPaymentCheckoutSession,
  verifyPaymentCheckout as verifyPaymentCheckoutSession,
} from "~/server/workspace/payments";
import { addProxyIp } from "~/server/workspace/proxy";
import { getDefaultIntegration } from "~/server/workspace/workspace";
import { getSignerFieldContext, type PostSignReveal, safeLogAudit } from "./document-helpers";
import { requireUnifiedIdentity } from "./document-utils";

export const documentManagementRouter = createTRPCRouter({
  // ── Void / cancel document (creator only, while PENDING) ──
  voidDocument: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
      if (!identity.authSession && !identity.walletSession) {
        throw new Error("Not signed in");
      }

      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const viewerAccess = resolveDocumentViewerAccess({
        document: doc,
        signers: [],
        identity,
      });

      if (!viewerAccess.isCreator) {
        throw new Error("Only the document creator can void a document");
      }
      if (doc.status !== "PENDING") {
        throw new Error("Only pending documents can be voided");
      }

      const actor = identity.walletSession?.address?.toLowerCase() ?? identity.email ?? "system";

      await ctx.db.update(documents).set({ status: "VOIDED" }).where(eq(documents.id, input.documentId));

      void safeLogAudit({
        documentId: doc.id,
        eventType: "DOCUMENT_VOIDED",
        actor,
        actorType: identity.walletSession ? "wallet" : identity.email ? "email" : "system",
        ipAddress: ctx.clientIp,
        metadata: { reason: input.reason ?? null },
      });

      // Notify signers with email
      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      for (const s of docSigners) {
        if (s.email) {
          // Best-effort notify — email function may not support void emails yet
          logger.info("void", `Would notify ${s.email} that "${doc.title}" was voided`);
        }
      }

      return { ok: true };
    }),

  // ── Decline signing (signer declines with optional reason) ──
  declineSign: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");
      if (doc.status !== "PENDING") throw new Error("Document is no longer pending");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((s) => s.claimToken === input.claimToken);
      if (!signer) throw new Error("Invalid signing link");
      if (signer.status !== "PENDING") throw new Error("Already responded");

      try {
        await ctx.db
          .update(signers)
          .set({
            status: "DECLINED",
            declineReason: input.reason ?? null,
            declinedAt: new Date(),
          })
          .where(eq(signers.id, signer.id));
      } catch (error) {
        if (!isSchemaDriftError(error)) throw error;
        await ctx.db
          .update(signers)
          .set({
            status: "DECLINED",
          })
          .where(eq(signers.id, signer.id));
      }

      void safeLogAudit({
        documentId: doc.id,
        eventType: "SIGNER_DECLINED",
        actor: signer.address ?? signer.email ?? input.claimToken,
        actorType: signer.address ? "wallet" : "email",
        ipAddress: ctx.clientIp,
        metadata: { signerLabel: signer.label, reason: input.reason ?? null },
      });

      return { ok: true };
    }),

  // ── Resend signing invitation (creator only) ──
  resendInvite: publicProcedure
    .input(z.object({ documentId: z.string(), signerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
      if (!identity.authSession && !identity.walletSession) {
        throw new Error("Not signed in");
      }

      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const viewerAccess = resolveDocumentViewerAccess({
        document: doc,
        signers: [],
        identity,
      });

      if (!viewerAccess.isCreator) {
        throw new Error("Only the document creator can resend invites");
      }

      const signer = await findSignerByIdAndDocumentId(ctx.db, input.signerId, input.documentId);
      if (!signer) throw new Error("Signer not found");
      if (signer.status !== "PENDING") throw new Error("Signer already responded");
      if (!signer.email && !signer.phone) throw new Error("Signer has no delivery address");

      const baseUrl = getBaseUrl();
      await sendSignerInvite({
        ownerAddress: doc.createdBy,
        brandingProfileId: doc.brandingProfileId,
        document: doc,
        signer,
        signUrl: `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}`,
        reason: "reminder",
      });

      void safeLogAudit({
        documentId: doc.id,
        eventType: "SIGNER_INVITED",
        actor: signer.email ?? signer.phone ?? signer.label,
        actorType: signer.email ? "email" : "system",
        ipAddress: ctx.clientIp,
        metadata: {
          signerLabel: signer.label,
          deliveryMethods: signer.deliveryMethods,
          resend: true,
        },
      });

      return { ok: true };
    }),

  // ── Creator claims a signer slot (returns the claim token so they can sign) ──
  claimSlot: publicProcedure
    .input(z.object({ documentId: z.string(), signerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const identity = await requireUnifiedIdentity(ctx);
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const viewerAccess = resolveDocumentViewerAccess({
        document: doc,
        signers: [],
        identity,
      });

      if (!viewerAccess.isCreator) {
        throw new Error("Only the document creator can claim slots");
      }

      const signer = await findSignerByIdAndDocumentId(ctx.db, input.signerId, input.documentId);
      if (!signer) throw new Error("Signer slot not found");
      if (signer.status !== "PENDING") throw new Error("This slot is already signed");
      if (signer.address && !identity.walletAddressSet.has(signer.address.toLowerCase())) {
        throw new Error("This slot is claimed by another wallet");
      }

      const baseUrl = getBaseUrl();
      return {
        claimToken: signer.claimToken,
        signUrl: `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}`,
        embedUrl: `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}&embed=1`,
      };
    }),

  createEmbedLink: publicProcedure
    .input(z.object({ documentId: z.string(), signerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const identity = await requireUnifiedIdentity(ctx);
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const viewerAccess = resolveDocumentViewerAccess({
        document: doc,
        signers: [],
        identity,
      });

      if (!viewerAccess.isCreator) {
        throw new Error("Only the document creator can generate embed links");
      }

      const signer = await findSignerByIdAndDocumentId(ctx.db, input.signerId, input.documentId);
      if (!signer) throw new Error("Signer not found");

      const baseUrl = getBaseUrl();
      return {
        embedUrl: `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}&embed=1`,
        signUrl: `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}`,
      };
    }),

  runIdentityVerification: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        fieldValues: z.record(z.string()).default({}),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((entry) => entry.claimToken === input.claimToken);
      if (!signer) throw new Error("Invalid signing link");

      const { editableFields } = await getSignerFieldContext({
        doc,
        docSigners,
        signer,
      });
      const idVerificationFields = editableFields.filter((field) => field.type === "id-verification");
      if (idVerificationFields.length === 0) {
        throw new Error("This document does not require built-in identity verification");
      }

      const verification = evaluateIdentityVerification({
        fields: editableFields,
        fieldValues: input.fieldValues,
        signerAddress: signer.address,
        signerEmail: signer.email,
        threshold: Number((idVerificationFields[0]?.settings as { threshold?: number } | undefined)?.threshold ?? 60),
      });

      return { verification };
    }),

  addressSuggestions: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        fieldId: z.string(),
        query: z.string().min(3).max(120),
        limit: z.number().int().min(1).max(10).default(5),
        countryCodes: z.array(z.string().min(2).max(3)).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((entry) => entry.claimToken === input.claimToken);
      if (!signer) throw new Error("Invalid signing link");

      const { editableFields } = await getSignerFieldContext({
        doc,
        docSigners,
        signer,
      });
      const field = editableFields.find((entry) => entry.id === input.fieldId);
      if (!field || !isAddressLikeField(field)) {
        throw new Error("Address field not found");
      }

      const config = await getDefaultIntegration(doc.createdBy, "ADDRESS");
      if (!config || config.enabled === false) {
        return { suggestions: [] };
      }

      const suggestions = await searchAddressSuggestions({
        config,
        query: input.query,
        limit: input.limit,
        countryCodes: input.countryCodes,
      });

      return { suggestions };
    }),

  createPaymentCheckout: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        fieldId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((entry) => entry.claimToken === input.claimToken);
      if (!signer) throw new Error("Invalid signing link");
      if (!isActionableRecipientRole(signer.role)) {
        throw new Error("This recipient cannot complete payment-gated signing");
      }

      const { editableFields } = await getSignerFieldContext({
        doc,
        docSigners,
        signer,
      });
      const field = editableFields.find((entry) => entry.id === input.fieldId);
      if (field?.type !== "payment-request") {
        throw new Error("Payment field not found");
      }

      const paymentConfig = await getDefaultIntegration(doc.createdBy, "PAYMENT");
      if (!paymentConfig?.enabled) {
        throw new Error("No payment provider is configured for this workspace");
      }

      const baseUrl = getBaseUrl();
      const provider = paymentConfig.provider.toUpperCase();
      const successUrl =
        provider === "STRIPE"
          ? `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}&paymentField=${field.id}&paymentProvider=${provider}&paymentRef={CHECKOUT_SESSION_ID}`
          : `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}&paymentField=${field.id}&paymentProvider=${provider}`;
      const cancelUrl = `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}&paymentCanceled=1&paymentField=${field.id}`;

      const checkout = await createPaymentCheckoutSession({
        config: paymentConfig,
        field,
        successUrl,
        cancelUrl,
        metadata: {
          documentId: doc.id,
          signerId: signer.id,
          fieldId: field.id,
        },
      });

      return {
        provider: paymentConfig.provider,
        checkoutUrl: checkout.checkoutUrl,
        reference: checkout.reference,
      };
    }),

  verifyPaymentCheckout: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        fieldId: z.string(),
        reference: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((entry) => entry.claimToken === input.claimToken);
      if (!signer) throw new Error("Invalid signing link");

      const { editableFields } = await getSignerFieldContext({
        doc,
        docSigners,
        signer,
      });
      const field = editableFields.find((entry) => entry.id === input.fieldId);
      if (field?.type !== "payment-request") {
        throw new Error("Payment field not found");
      }

      const paymentConfig = await getDefaultIntegration(doc.createdBy, "PAYMENT");
      if (!paymentConfig?.enabled) {
        throw new Error("No payment provider is configured for this workspace");
      }

      const payment = await verifyPaymentCheckoutSession({
        config: paymentConfig,
        field,
        reference: input.reference,
      });

      return { payment };
    }),

  // ── Post-sign reveal: only accessible after the caller has signed ──
  getReveal: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
      if (!identity.authSession && !identity.walletSession) {
        throw new Error("Not signed in");
      }

      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const viewerAccess = resolveDocumentViewerAccess({
        document: doc,
        signers: docSigners,
        identity,
      });
      const mySigner = viewerAccess.matchingSigner;

      // Must be creator OR a signer who has SIGNED
      if (!viewerAccess.isCreator && mySigner?.status !== "SIGNED") {
        throw new Error("You must sign the document before accessing this content");
      }

      if (!doc.postSignReveal?.enabled) {
        return null;
      }

      return {
        reveal: doc.postSignReveal,
        signer: mySigner
          ? {
              id: mySigner.id,
              label: mySigner.label,
              address: mySigner.address,
              chain: mySigner.chain,
              lastIp: mySigner.lastIp,
              ipUpdatedAt: mySigner.ipUpdatedAt,
            }
          : null,
        documentId: doc.id,
        documentTitle: doc.title,
        documentStatus: doc.status,
      };
    }),

  // ── Access challenge: get a message to sign for IP refresh ──
  getAccessChallenge: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        callerAddress: z.string(),
      }),
    )
    .query(async ({ ctx: _ctx, input }) => {
      const timestamp = new Date().toISOString();
      const message = [
        "Proofmark — Access Verification",
        "",
        `Document: ${input.documentId}`,
        `Address: ${input.callerAddress}`,
        `Timestamp: ${timestamp}`,
        "",
        "Sign this message to verify your identity and refresh your IP access.",
        "This does not modify the document or create any obligations.",
      ].join("\n");

      return { message, timestamp };
    }),

  // ── Refresh access: verify wallet signature + auto-grab IP ──
  refreshAccess: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        callerAddress: z.string(),
        chain: z.enum(["ETH", "SOL", "BTC"]),
        signature: z.string(),
        challengeMessage: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const address = normalizeAddress(input.chain, input.callerAddress);

      // Verify the wallet signature
      const claimVerify = await verifySignature({
        chain: input.chain,
        address,
        message: input.challengeMessage,
        signature: input.signature,
      });

      if (!claimVerify.ok) {
        const debugInfo =
          claimVerify.debug.length > 0
            ? `\n\n--- DEBUG (${input.chain} / ${address}) ---\n${claimVerify.debug.join("\n")}`
            : "";
        throw new Error(`Signature verification failed (scheme=${claimVerify.scheme})${debugInfo}`);
      }

      // Find the signer
      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);

      const mySigner = docSigners.find(
        (s) => s.address?.toLowerCase() === address.toLowerCase() && s.status === "SIGNED",
      );

      if (!mySigner) throw new Error("Not authorized — you must have signed this document");

      const doc = await findDocumentById(ctx.db, input.documentId);
      const reveal = doc?.postSignReveal as PostSignReveal | null;
      const proxyDomain = reveal?.testbedAccess?.proxyEndpoint;

      if (proxyDomain && mySigner.lastIp) {
        void import("~/server/workspace/proxy").then((m) =>
          m.removeProxyIp({ domain: proxyDomain, ip: mySigner.lastIp! }),
        );
      }

      // Grab current IP from request
      const newIp = ctx.clientIp;
      if (!newIp) throw new Error("Could not detect your IP address");

      await ctx.db.update(signers).set({ lastIp: newIp, ipUpdatedAt: new Date() }).where(eq(signers.id, mySigner.id));

      // Register new IP on proxy
      if (proxyDomain) {
        void addProxyIp({ domain: proxyDomain, ip: newIp });
      }

      return { ok: true, ip: newIp };
    }),
});
