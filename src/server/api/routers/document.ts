// @ts-nocheck
import { z } from "zod";
import { randomBytes } from "crypto";
import { eq, and, gt } from "drizzle-orm";
import { type createTRPCContext, createTRPCRouter, publicProcedure, authedProcedure } from "~/server/api/trpc";
import { resolveUnifiedRequestIdentity, type UnifiedRequestIdentity } from "~/server/auth-identity";
import { resolveDocumentViewerAccess } from "~/server/document-access";
import {
  issueLivenessChallenge,
  verifyLivenessChallenge,
  issueTimingToken,
  verifyTimingToken,
  issueCanvasChallenge,
  verifyCanvasChallenge,
  type LivenessResponse,
} from "~/server/signing-challenges";
import {
  documents,
  signers,
  mobileSignSessions,
  documentTemplates,
  auditEvents,
  type ReminderConfig,
} from "~/server/db/schema";
import { hashDocument, hashHandSignature, buildSigningMessage, verifySignature } from "~/server/rust-engine";
import { computeIpfsCid } from "~/lib/ipfs";
import { normalizeAddress } from "~/lib/chains";
import { isAddressLikeField } from "~/lib/address-autocomplete";
import { isActionableRecipientRole } from "~/lib/recipient-roles";
import { sendAutomationAlertEmail, sendSignerConfirmation } from "~/server/email";
import { sendSignerInvite, resolveDocumentBranding } from "~/server/delivery";
import { addProxyIp } from "~/server/proxy";
import {
  encryptDocument as encryptContent,
  decryptDocument as decryptContent,
  isEncryptionAvailable,
} from "~/server/rust-engine";
import {
  createReminderConfig,
  getDefaultIntegration,
  getDefaultReminderChannels,
  normalizeOwnerAddress,
} from "~/server/workspace";
import { evaluateIdentityVerification } from "~/server/id-verification";
import { searchAddressSuggestions } from "~/server/address-autocomplete";
import {
  createPaymentCheckout as createPaymentCheckoutSession,
  verifyPaymentCheckout as verifyPaymentCheckoutSession,
} from "~/server/payments";
import {
  findDocumentByContentHash,
  findDocumentById,
  findDocumentByIpfsCid,
  findDocumentsByCreator,
  findSignerByIdAndDocumentId,
  findSignersByAddress,
  findSignersByDocumentId,
  findDocumentsByGroupId,
  insertDocumentCompat,
  insertSignersCompat,
  isSchemaDriftError,
} from "~/server/db/compat";
import {
  safeLogAudit,
  safeIndexDocument,
  safeSendSigningOtp,
  safeVerifySigningOtp,
  createDocumentInput,
  generateToken,
  assertPaidPaymentFields,
  getSignerFieldContext,
  handlePostSignCompletion,
  propagateGroupSignature,
  computeDocumentStateHash,
  processIdentityVerification,
  type PostSignReveal,
} from "./document-helpers";
import { VERIFY_FIELD_TYPES, GROUP_ROLE, getBaseUrl } from "~/lib/signing-constants";
import { logger } from "~/lib/logger";
import { assembleForensicEvidence } from "~/server/rust-engine";
import type { ClientFingerprint, BehavioralSignals } from "~/lib/forensic/types";
import { extractReplaySignatureAnalysis } from "~/lib/forensic/signature-analysis";
import { deriveSecurityMode } from "~/lib/document-security";
import type { PersistedForensicSessionCapture } from "~/lib/forensic/session";
import {
  normalizeDocumentAutomationPolicy,
  type DocumentAutomationPolicy,
  type EnhancedForensicEvidence,
} from "~/lib/forensic/premium";
import { enrichForensicEvidence } from "~/server/forensic-proof";
import { getSignerTokenGateChains, normalizeSignerTokenGate, tokenGateWalletProofListSchema } from "~/lib/token-gates";
import { evaluateSignerTokenGate, evaluateSignerTokenGateWithProofs } from "~/server/token-gates";

/** Zod schema for client-side forensic data sent with sign requests */
const forensicInputSchema = z
  .object({
    fingerprint: z.record(z.unknown()),
    behavioral: z.record(z.unknown()),
    session: z
      .object({
        sessionId: z.string(),
        visitIndex: z.number(),
        startedAt: z.string(),
        endedAt: z.string().nullable().optional(),
        durationMs: z.number().optional(),
      })
      .optional(),
  })
  .optional();

type ForensicInputPayload = {
  fingerprint: Record<string, unknown>;
  behavioral: Record<string, unknown>;
  session?: {
    sessionId: string;
    visitIndex: number;
    startedAt: string;
    endedAt?: string | null;
    durationMs?: number;
  };
};

function isPersistedForensicSessionCapture(value: unknown): value is PersistedForensicSessionCapture {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedForensicSessionCapture>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.visitIndex === "number" &&
    typeof candidate.startedAt === "string" &&
    (candidate.endedAt === null || candidate.endedAt === undefined || typeof candidate.endedAt === "string") &&
    typeof candidate.durationMs === "number" &&
    !!candidate.behavioral &&
    typeof candidate.behavioral === "object" &&
    (candidate.replay === null || candidate.replay === undefined || typeof candidate.replay === "object")
  );
}

function normalizePriorForensicSessions(value: unknown): PersistedForensicSessionCapture[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPersistedForensicSessionCapture);
}

function mergeForensicSessionCaptures(
  priorSessions: PersistedForensicSessionCapture[],
  currentSession: PersistedForensicSessionCapture | null,
): PersistedForensicSessionCapture[] {
  if (!currentSession) return priorSessions;

  const remaining = priorSessions.filter((session) => session.sessionId !== currentSession.sessionId);
  return [...remaining, currentSession].sort((left, right) => {
    if (left.visitIndex !== right.visitIndex) return left.visitIndex - right.visitIndex;
    return left.startedAt.localeCompare(right.startedAt);
  });
}

async function requireUnifiedIdentity(ctx: Awaited<ReturnType<typeof createTRPCContext>>) {
  const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
  if (!identity.authSession && !identity.walletSession) {
    throw new Error("Not signed in");
  }
  return identity;
}

function getIdentityActor(identity: UnifiedRequestIdentity) {
  const actor = identity.walletSession?.address?.toLowerCase() ?? identity.email ?? "system";
  const actorType: "wallet" | "email" | "system" = identity.walletSession
    ? "wallet"
    : identity.email
      ? "email"
      : "system";
  return { actor, actorType };
}

/** Collect forensic evidence from sign request (non-blocking). */
async function collectForensicEvidence(
  forensicInput: ForensicInputPayload | undefined,
  ip: string | null,
  userAgent: string | null,
  headers: Headers | undefined,
  options?: {
    proofMode?: "PRIVATE" | "HYBRID" | "CRYPTO_NATIVE";
    automationPolicy?: Partial<DocumentAutomationPolicy> | null;
    signMethod?: "WALLET" | "EMAIL_OTP";
    hasHandSignature?: boolean;
    priorSessions?: PersistedForensicSessionCapture[] | null;
  },
): Promise<{
  data: EnhancedForensicEvidence | null;
  hash: string | null;
  review: EnhancedForensicEvidence["automationReview"] | null;
  outcome: EnhancedForensicEvidence["policyOutcome"] | null;
}> {
  if (!forensicInput) return { data: null, hash: null, review: null, outcome: null };
  try {
    const baseEvidence = await assembleForensicEvidence({
      fingerprint: forensicInput.fingerprint as unknown as ClientFingerprint,
      behavioral: forensicInput.behavioral as unknown as BehavioralSignals,
      ip,
      userAgent,
      headers: headers ?? new Headers(),
    });
    // Inject server-side challenge verification flags
    const challengeFlags = (forensicInput as Record<string, unknown>)._challengeFlags as
      | Array<{ code: string; severity: string; message: string }>
      | undefined;
    if (challengeFlags) {
      for (const flag of challengeFlags) {
        baseEvidence.flags.push({
          code: flag.code,
          severity: flag.severity as "info" | "warn" | "critical",
          message: flag.message,
        });
      }
    }
    const currentSession = forensicInput.session
      ? {
          sessionId: forensicInput.session.sessionId,
          visitIndex: forensicInput.session.visitIndex,
          startedAt: forensicInput.session.startedAt,
          endedAt: forensicInput.session.endedAt ?? new Date().toISOString(),
          durationMs: forensicInput.session.durationMs ?? baseEvidence.behavioral.timeOnPage,
          behavioral: baseEvidence.behavioral,
          replay: baseEvidence.behavioral.replay ?? null,
        }
      : null;
    const forensicSessions = mergeForensicSessionCaptures(options?.priorSessions ?? [], currentSession);
    const { evidence, hash } = await enrichForensicEvidence({
      evidence: baseEvidence,
      proofMode: options?.proofMode ?? "PRIVATE",
      automationPolicy: options?.automationPolicy ?? null,
      reviewContext: {
        signMethod: options?.signMethod,
        hasHandSignature: options?.hasHandSignature,
      },
      priorSessions: forensicSessions,
    });
    return { data: evidence, hash, review: evidence.automationReview ?? null, outcome: evidence.policyOutcome ?? null };
  } catch (err) {
    logger.warn("forensic", `Failed to assemble forensic evidence: ${String(err)}`);
    return { data: null, hash: null, review: null, outcome: null };
  }
}

async function loadDocumentAutomationPolicy(
  db: Awaited<ReturnType<typeof createTRPCContext>>["db"],
  documentId: string,
): Promise<DocumentAutomationPolicy> {
  let createdEvent: { metadata: Record<string, unknown> | null } | undefined;
  try {
    [createdEvent] = await db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(and(eq(auditEvents.documentId, documentId), eq(auditEvents.eventType, "DOCUMENT_CREATED")))
      .limit(1);
  } catch (error) {
    if (!isSchemaDriftError(error)) throw error;
    return normalizeDocumentAutomationPolicy(null);
  }

  const rawPolicy = createdEvent?.metadata
    ? (createdEvent.metadata.automationPolicy as Partial<DocumentAutomationPolicy> | undefined)
    : undefined;

  return normalizeDocumentAutomationPolicy(rawPolicy ?? null);
}

async function maybeNotifyCreatorOfAutomationReview(params: {
  doc: Pick<typeof documents.$inferSelect, "id" | "title" | "createdBy" | "createdByEmail" | "brandingProfileId">;
  signerLabel: string;
  review: EnhancedForensicEvidence["automationReview"] | null;
  outcome: EnhancedForensicEvidence["policyOutcome"] | null;
}) {
  if (!params.outcome?.notifyCreator || !params.review || !params.doc.createdByEmail) return;
  try {
    const branding = await resolveDocumentBranding(params.doc.createdBy, params.doc.brandingProfileId);
    await sendAutomationAlertEmail({
      to: params.doc.createdByEmail,
      documentTitle: params.doc.title,
      signerLabel: params.signerLabel,
      verdict: params.review.verdict,
      confidence: params.review.confidence,
      action: params.outcome.action,
      reason: params.outcome.reason,
      branding,
      replyTo: branding.emailReplyTo,
    });
  } catch (error) {
    logger.warn("automation", `Failed to notify creator of automation review: ${String(error)}`);
  }
}

async function createDocumentPacket(
  ctx: Awaited<ReturnType<typeof createTRPCContext>> & {
    session: {
      address: string;
      chain: string;
    };
  },
  input: z.infer<typeof createDocumentInput>,
  groupOptions?: {
    groupId: string;
    signerGroupRoles: Array<string | null>;
  },
) {
  const ownerAddress = normalizeOwnerAddress(ctx.session.address);
  if (input.templateId) {
    let template;
    try {
      template = await ctx.db.query.documentTemplates.findFirst({
        where: and(eq(documentTemplates.id, input.templateId), eq(documentTemplates.ownerAddress, ownerAddress)),
      });
    } catch (error) {
      if (!isSchemaDriftError(error)) throw error;
      throw new Error("Templates are not available until the latest database migration is applied");
    }
    if (!template) throw new Error("Template not found");
  }

  const contentHash = await hashDocument(input.content + "\n" + Date.now().toString());
  const accessToken = generateToken();

  let storedContent = input.content;
  let encryptedAtRest = false;
  let encryptionKeyWrapped: string | null = null;
  let ipfsCid: string | null = null;

  if (input.securityMode !== "HASH_ONLY") {
    if (!isEncryptionAvailable()) {
      throw new Error("Encrypted storage is not configured for this workspace yet.");
    }
    const enc = await encryptContent(input.content);
    if (!enc) {
      throw new Error("Failed to encrypt document content.");
    }
    storedContent = enc.encryptedContent;
    encryptedAtRest = true;
    encryptionKeyWrapped = enc.wrappedKey;
  }

  if (input.securityMode === "ENCRYPTED_IPFS") {
    ipfsCid = await computeIpfsCid(storedContent);
  }

  const reminderConfig: ReminderConfig | null = input.reminder
    ? createReminderConfig(input.reminder.cadence, input.reminder.channels)
    : null;

  const [doc] = await insertDocumentCompat(ctx.db, {
    title: input.title,
    content: storedContent,
    contentHash,
    createdBy: ownerAddress,
    createdByEmail: input.createdByEmail || null,
    accessToken,
    ipfsCid,
    postSignReveal: input.postSignReveal ?? null,
    proofMode: input.proofMode,
    signingOrder: input.signingOrder,
    gazeTracking: input.gazeTracking ?? "off",
    expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000) : null,
    encryptedAtRest,
    encryptionKeyWrapped,
    templateId: input.templateId ?? null,
    brandingProfileId: input.brandingProfileId ?? null,
    pdfStyleTemplateId: input.pdfStyleTemplateId ?? null,
    reminderConfig,
    groupId: groupOptions?.groupId ?? null,
  });

  if (!doc) throw new Error("Failed to create document");

  const signerRows = input.signers.map((s, idx) => {
    const email = s.email?.trim() || null;
    const phone = s.phone?.trim() || null;
    const deliveryMethods = s.deliveryMethods?.length ? s.deliveryMethods : getDefaultReminderChannels(email, phone);
    return {
      documentId: doc.id,
      label: s.label,
      email,
      phone,
      fields: (s.fields as (typeof signers.$inferInsert)["fields"]) ?? null,
      tokenGates: normalizeSignerTokenGate(s.tokenGates),
      claimToken: generateToken(),
      signMethod: s.signMethod,
      signerOrder: idx,
      identityLevel: s.signMethod === "EMAIL_OTP" ? ("L1_EMAIL" as const) : ("L0_WALLET" as const),
      deliveryMethods,
      role: s.role,
      groupRole: groupOptions?.signerGroupRoles?.[idx] ?? null,
    };
  });

  const insertedSigners = await insertSignersCompat(ctx.db, signerRows);

  if (doc.signingOrder === "sequential") {
    const firstActionable = insertedSigners
      .filter((row) => isActionableRecipientRole(row.role))
      .sort((a, b) => a.signerOrder - b.signerOrder)[0];

    if (firstActionable && firstActionable.signerOrder !== (doc.currentSignerIndex ?? 0)) {
      await ctx.db
        .update(documents)
        .set({ currentSignerIndex: firstActionable.signerOrder })
        .where(eq(documents.id, doc.id));
      doc.currentSignerIndex = firstActionable.signerOrder;
    }
  }

  void safeLogAudit({
    documentId: doc.id,
    eventType: "DOCUMENT_CREATED",
    actor: ownerAddress,
    actorType: "wallet",
    ipAddress: ctx.clientIp,
    metadata: {
      proofMode: input.proofMode,
      signingOrder: input.signingOrder,
      signerCount: input.signers.length,
      encryptedAtRest,
      templateId: input.templateId ?? null,
      reminderEnabled: !!reminderConfig?.enabled,
      brandingProfileId: input.brandingProfileId ?? null,
      automationPolicy: normalizeDocumentAutomationPolicy(input.automationPolicy ?? null),
    },
  });

  void safeIndexDocument(doc.id);

  const baseUrl = getBaseUrl();
  // For sequential signing, only invite the first actionable signer.
  // Later signers get notified when their turn arrives.
  const firstActionableOrder =
    input.signingOrder === "sequential"
      ? (insertedSigners
          .filter((s) => isActionableRecipientRole(s.role))
          .sort((a, b) => a.signerOrder - b.signerOrder)[0]?.signerOrder ?? 0)
      : null;

  for (const signer of insertedSigners) {
    if (firstActionableOrder !== null && signer.signerOrder > firstActionableOrder) continue;

    if (signer.email || signer.phone) {
      void sendSignerInvite({
        ownerAddress,
        brandingProfileId: doc.brandingProfileId,
        document: doc,
        signer,
        signUrl: `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}`,
      });

      void safeLogAudit({
        documentId: doc.id,
        eventType: "SIGNER_INVITED",
        actor: signer.email ?? signer.phone ?? signer.label,
        actorType: signer.email ? "email" : "system",
        metadata: {
          signerLabel: signer.label,
          signMethod: signer.signMethod,
          deliveryMethods: signer.deliveryMethods,
          tokenGateEnabled: !!signer.tokenGates,
        },
      });
    }
  }

  return {
    doc,
    contentHash,
    accessToken,
    insertedSigners,
    reminderConfig,
  };
}

function requiresTokenGateWalletProofs(gate: Parameters<typeof normalizeSignerTokenGate>[0]): boolean {
  const normalized = normalizeSignerTokenGate(gate);
  if (!normalized) return false;
  return normalized.devBypass || getSignerTokenGateChains(normalized).length > 1;
}

export const documentRouter = createTRPCRouter({
  // ── Create: requires session — address taken from session ──
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

  /**
   * Create a document group: N identical contracts for different recipients.
   * The discloser is injected as signer 0 on every document. When the discloser
   * signs any one document, the signature + forensics propagate to all siblings.
   */
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
        // The shared discloser signer (appears on every document)
        discloser: z.object({
          label: z.string().min(1).max(100),
          email: z.string().email().optional().or(z.literal("")),
          fields: createDocumentInput.shape.signers.element.shape.fields,
          signMethod: z.enum(["WALLET", "EMAIL_OTP"]).default("WALLET"),
        }),
        // One document is created per recipient
        recipients: z.array(createDocumentInput.shape.signers.element).min(1).max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const baseUrl = getBaseUrl();
      const groupId = randomBytes(12).toString("base64url");

      const results: Array<{
        documentId: string;
        contentHash: string;
        recipientLabel: string;
        signerLinks: Array<{ label: string; claimToken: string; signUrl: string; signMethod: string }>;
      }> = [];

      for (const recipient of input.recipients) {
        // Build a standard create input with discloser at index 0, recipient at index 1
        const createInput: z.infer<typeof createDocumentInput> = {
          title: input.title,
          content: input.content,
          createdByEmail: input.createdByEmail,
          proofMode: input.proofMode,
          securityMode: input.securityMode,
          signingOrder: "parallel", // parallel — discloser fills first, signs wallet last
          expiresInDays: input.expiresInDays,
          brandingProfileId: input.brandingProfileId,
          templateId: input.templateId,
          pdfStyleTemplateId: input.pdfStyleTemplateId,
          gazeTracking: input.gazeTracking,
          postSignReveal: input.postSignReveal,
          // Recipient at idx 0, discloser at idx 1 — matches the content
          // template convention where signerIdx 0 = recipient fields and
          // signerIdx 1 = discloser fields.
          signers: [
            recipient,
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

  // ── Get doc: requires session auth OR a valid claim token ──
  get: publicProcedure
    .input(
      z.object({
        id: z.string(),
        claimToken: z.string().optional(),
        viewerAddress: z.string().optional(),
        viewerChain: z.enum(["ETH", "SOL", "BTC"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.id);
      if (!doc) throw new Error("Document not found");

      // Auto-expire documents past their expiration date
      if (doc.expiresAt && doc.status === "PENDING" && doc.expiresAt < new Date()) {
        await ctx.db.update(documents).set({ status: "EXPIRED" }).where(eq(documents.id, doc.id));
        doc.status = "EXPIRED" as typeof doc.status;
        void safeLogAudit({
          documentId: doc.id,
          eventType: "DOCUMENT_EXPIRED",
          actor: "system",
          actorType: "system",
        });
      }

      const docSigners = await findSignersByDocumentId(ctx.db, input.id);

      const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
      const callerAddress = identity.walletSession?.address ?? null;
      const callerChain = identity.walletSession?.chain ?? null;
      const viewerAccess = resolveDocumentViewerAccess({
        document: doc,
        signers: docSigners,
        identity,
      });

      // Access check: must be creator, a claimed signer, or have a valid claim token
      let authorized = viewerAccess.canAccessDocument;

      if (input.claimToken) {
        if (docSigners.some((s) => s.claimToken === input.claimToken)) authorized = true;
      }

      // Completed documents are viewable for forensic/legal replay purposes
      if (doc.status === "COMPLETED") authorized = true;

      if (!authorized) throw new Error("Access denied — connect the correct wallet or use your signing link");

      // Audit: document viewed
      const viewerActor = callerAddress ?? identity.email ?? input.claimToken ?? "anonymous";
      void safeLogAudit({
        documentId: doc.id,
        eventType: "DOCUMENT_VIEWED",
        actor: viewerActor,
        actorType: callerAddress ? "wallet" : identity.email ? "email" : "system",
        ipAddress: ctx.clientIp,
      });

      // Strip claim tokens and raw signatures from response for non-creators
      const isCreator = viewerAccess.isCreator;

      // Decrypt content if encrypted at rest
      let content = doc.content;
      if (doc.encryptedAtRest && doc.encryptionKeyWrapped) {
        try {
          content = await decryptContent(doc.content, doc.encryptionKeyWrapped);
        } catch {
          content = "[Encrypted content — decryption key unavailable]";
        }
      }

      // For sequential signing, check if each signer's turn has come
      const isSequential = doc.signingOrder === "sequential";
      const effectiveViewerAddress = input.viewerAddress ?? callerAddress;
      const effectiveViewerChain = input.viewerChain ?? (callerChain === "BASE" ? "ETH" : (callerChain ?? null));
      const targetSignerForGate =
        (input.claimToken ? docSigners.find((entry) => entry.claimToken === input.claimToken) : undefined) ??
        (effectiveViewerAddress
          ? docSigners.find((entry) => entry.address?.toLowerCase() === effectiveViewerAddress.toLowerCase())
          : undefined);
      const tokenGateEvaluation =
        effectiveViewerAddress && effectiveViewerChain && targetSignerForGate?.tokenGates
          ? await evaluateSignerTokenGate({
              gate: targetSignerForGate.tokenGates,
              address: effectiveViewerAddress,
              chain: effectiveViewerChain,
            })
          : null;

      const sanitizedSigners = docSigners.map((s) => ({
        id: s.id,
        label: s.label,
        address: s.address,
        chain: s.chain,
        email: isCreator ? s.email : null,
        phone: isCreator ? s.phone : null,
        status: s.status,
        signedAt: s.signedAt,
        scheme: s.scheme,
        signature: isCreator ? s.signature : null,
        handSignatureData: s.handSignatureData ?? null,
        handSignatureHash: isCreator ? s.handSignatureHash : null,
        isYou: input.claimToken === s.claimToken,
        isClaimed: !!s.address || !!s.otpVerifiedAt,
        fields: s.fields ?? [],
        fieldValues: s.fieldValues ?? null,
        tokenGates: s.tokenGates ?? null,
        tokenGateEvaluation: s.id === targetSignerForGate?.id ? tokenGateEvaluation : null,
        signMethod: s.signMethod,
        role: s.role,
        deliveryMethods: isCreator ? (s.deliveryMethods ?? []) : [],
        declineReason: isCreator ? s.declineReason : null,
        declinedAt: s.declinedAt,
        signerOrder: s.signerOrder,
        identityLevel: s.identityLevel,
        forensicHash: isCreator ? (s.forensicHash ?? null) : null,
        forensicFlags: isCreator
          ? ((s.forensicEvidence as { flags?: Array<{ code: string; severity: string; message: string }> } | null)
              ?.flags ?? [])
          : [],
        forensicGeo: isCreator
          ? ((
              s.forensicEvidence as {
                geo?: {
                  city?: string;
                  region?: string;
                  country?: string;
                  isVpn?: boolean;
                  isProxy?: boolean;
                  isTor?: boolean;
                } | null;
              } | null
            )?.geo ?? null)
          : null,
        // In sequential mode, signers can only sign when it's their turn
        canSign: isActionableRecipientRole(s.role)
          ? isSequential
            ? s.signerOrder === (doc.currentSignerIndex ?? 0)
            : true
          : false,
        groupRole: s.groupRole ?? null,
        finalizationSignature: s.finalizationSignature ?? null,
      }));

      return {
        ...doc,
        content,
        accessToken: isCreator ? doc.accessToken : undefined,
        signers: sanitizedSigners,
        reminderConfig: isCreator ? doc.reminderConfig : null,
        postSignReveal: doc.postSignReveal ? { enabled: doc.postSignReveal.enabled } : null,
      };
    }),

  getForensicReplay: publicProcedure
    .input(
      z.object({
        id: z.string(),
        contentHash: z.string().optional(),
        claimToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.id);
      if (!doc) return null;

      const docSigners = await findSignersByDocumentId(ctx.db, input.id);

      // Access: creator, any signer, anyone with content hash, or anyone with a valid claim token
      let authorized = false;

      const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
      const viewerAccess = resolveDocumentViewerAccess({
        document: doc,
        signers: docSigners,
        identity,
      });

      if (viewerAccess.canAccessDocument) authorized = true;

      if (input.contentHash && doc.contentHash === input.contentHash) authorized = true;
      if (input.claimToken && docSigners.some((s) => s.claimToken === input.claimToken)) authorized = true;

      // For completed documents, replay is public evidence (courts need it)
      if (doc.status === "COMPLETED") authorized = true;

      if (!authorized) return null;

      return {
        documentId: doc.id,
        title: doc.title,
        content: doc.content,
        contentHash: doc.contentHash,
        status: doc.status,
        generatedAt: new Date().toISOString(),
        signers: docSigners.map((signer) => {
          const forensic = (signer.forensicEvidence as EnhancedForensicEvidence | null) ?? null;
          const replay = forensic?.behavioral?.replay ?? null;

          return {
            id: signer.id,
            label: signer.label,
            status: signer.status,
            signedAt: signer.signedAt,
            signMethod: signer.signMethod,
            chain: signer.chain,
            address: signer.address,
            email: signer.email,
            role: signer.role,
            canSign: signer.status !== "SIGNED",
            handSignatureData: signer.handSignatureData ?? null,
            fieldValues: signer.fieldValues ?? null,
            fields: signer.fields ?? [],
            forensicHash: signer.forensicHash ?? forensic?.evidenceHash ?? null,
            replay,
            mobileForensics: (forensic as Record<string, unknown> | null)?.mobileForensics ?? null,
            documentViewingStartedMs: forensic?.behavioral?.documentViewingStartedMs ?? 0,
            aiForensicReview: (forensic as Record<string, unknown> | null)?.aiForensicReview ?? null,
            signatureMotion: replay ? extractReplaySignatureAnalysis(replay) : null,
            flags: forensic?.flags ?? [],
            automationReview: forensic?.automationReview
              ? {
                  verdict: forensic.automationReview.verdict,
                  confidence: forensic.automationReview.confidence,
                  source: forensic.automationReview.source,
                  automationScore: forensic.automationReview.automationScore,
                  recommendedAction: forensic.automationReview.recommendedAction,
                  rationale: forensic.automationReview.rationale,
                  createdAt: forensic.automationReview.createdAt,
                }
              : null,
            policyOutcome: forensic?.policyOutcome
              ? {
                  action: forensic.policyOutcome.action,
                  blocked: forensic.policyOutcome.blocked,
                  reason: forensic.policyOutcome.reason,
                }
              : null,
            storage: forensic?.storage
              ? {
                  mode: forensic.storage.mode,
                  objectCid: forensic.storage.objectCid,
                  objectHash: forensic.storage.objectHash,
                  byteLength: forensic.storage.byteLength,
                  anchored: forensic.storage.anchored,
                  anchors: forensic.storage.anchors,
                }
              : null,
            // Session profile with per-category verdicts
            sessionProfile: forensic?.sessionProfile ?? null,
            signerBaseline: forensic?.signerBaseline ?? null,
            // Multi-session forensic data
            forensicSessions: forensic?.forensicSessions ?? [],
          };
        }),
      };
    }),

  // ── Save intermediate forensic session (before signing) ──
  saveForensicSession: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        session: z.object({
          sessionId: z.string(),
          visitIndex: z.number(),
          startedAt: z.string(),
          endedAt: z.string().nullable(),
          durationMs: z.number(),
          behavioral: z.record(z.unknown()),
          replay: z.record(z.unknown()).nullable(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((s) => s.claimToken === input.claimToken);
      if (!signer) throw new Error("Invalid signing link");

      // Append to existing sessions array stored in forensicEvidence
      const existing = (signer.forensicEvidence as Record<string, unknown> | null) ?? {};
      const sessions = (existing.forensicSessions as unknown[] | undefined) ?? [];
      sessions.push(input.session);

      await ctx.db
        .update(signers)
        .set({
          forensicEvidence: { ...existing, forensicSessions: sessions } as unknown as Record<string, unknown>,
        })
        .where(eq(signers.id, signer.id));

      return { saved: true, sessionCount: sessions.length };
    }),

  // ── Claim documents: link guest signing history to a user account ──
  claimDocuments: authedProcedure.mutation(async ({ ctx }) => {
    try {
      const { claimSignerDocuments, getVerificationSessionsForIdentifiers } =
        await import("~/server/verification-sessions");
      const addr = ctx.session.address.toLowerCase();

      const sessions = await getVerificationSessionsForIdentifiers([addr]);
      const socialUsernames = sessions
        .filter((s) => ["x", "github", "discord", "google"].includes(s.provider))
        .map((s) => ({ provider: s.provider as "x" | "github" | "discord" | "google", username: s.identifier }));

      let email: string | null = null;
      try {
        const { users } = await import("~/server/db/schema");
        const [user] = await ctx.db
          .select()
          .from(users)
          .where(eq(users.id, ctx.session.userId ?? ""))
          .limit(1);
        email = user?.email ?? null;
      } catch {}

      const result = await claimSignerDocuments({
        userId: ctx.session.userId ?? ctx.session.address,
        email,
        walletAddress: addr,
        socialUsernames,
      });

      return { claimedCount: result.claimedCount };
    } catch (e) {
      console.warn("[claimDocuments] Failed:", (e as Error).message);
      return { claimedCount: 0 };
    }
  }),

  // ── Check for existing verification sessions ──
  checkVerificationSessions: publicProcedure
    .input(
      z.object({
        identifiers: z.array(z.string()).min(1).max(10),
      }),
    )
    .query(async ({ input }) => {
      try {
        const { getVerificationSessionsForIdentifiers } = await import("~/server/verification-sessions");
        const sessions = await getVerificationSessionsForIdentifiers(input.identifiers);
        return sessions.map((s) => ({
          identifier: s.identifier,
          provider: s.provider,
          profileId: s.profileId,
          displayName: s.displayName,
          verifiedAt: s.verifiedAt,
          expiresAt: s.expiresAt,
          chain: s.chain,
        }));
      } catch {
        return [];
      }
    }),

  // ── Auto-save field values to server (progress persistence) ──
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
      const { editableFields } = await getSignerFieldContext({ doc, docSigners, signer });
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
        const socialVerifs = (signer.socialVerifications ?? []) as Array<{ verifiedAt?: string }>;
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
      if (!signer) throw new Error("Invalid signing link");
      if (signer.status === "SIGNED") throw new Error("Already signed");
      if (signer.tokenGates) {
        const gateEvaluation = requiresTokenGateWalletProofs(signer.tokenGates)
          ? await evaluateSignerTokenGateWithProofs({
              gate: signer.tokenGates,
              documentId: input.documentId,
              claimToken: input.claimToken,
              proofs: input.tokenGateProofs ?? [],
            })
          : await evaluateSignerTokenGate({
              gate: signer.tokenGates,
              address: input.signerAddress,
              chain: input.chain,
            });
        if (gateEvaluation && !gateEvaluation.eligible) {
          throw new Error(gateEvaluation.summary);
        }
      }
      if (!isActionableRecipientRole(signer.role)) {
        throw new Error("This recipient is view-only and does not require a signing message");
      }
      if (doc.signingOrder === "sequential" && signer.signerOrder !== (doc.currentSignerIndex ?? 0)) {
        throw new Error("It is not this recipient's turn yet");
      }

      if (signer.address && signer.address.toLowerCase() !== input.signerAddress.toLowerCase()) {
        throw new Error("This signing slot is already claimed by another wallet");
      }

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
      if (!signer) throw new Error("Invalid signing link");
      if (signer.status === "SIGNED") throw new Error("Already signed");
      if (signer.tokenGates) {
        const gateEvaluation = requiresTokenGateWalletProofs(signer.tokenGates)
          ? await evaluateSignerTokenGateWithProofs({
              gate: signer.tokenGates,
              documentId: input.documentId,
              claimToken: input.claimToken,
              proofs: input.tokenGateProofs ?? [],
            })
          : await evaluateSignerTokenGate({
              gate: signer.tokenGates,
              address: input.signerAddress,
              chain: input.chain,
            });
        if (gateEvaluation && !gateEvaluation.eligible) {
          throw new Error(gateEvaluation.summary);
        }
      }

      // If already claimed by different address, reject
      if (signer.address && signer.address.toLowerCase() !== input.signerAddress.toLowerCase()) {
        throw new Error("This signing slot is already claimed by another wallet");
      }

      const address = normalizeAddress(input.chain, input.signerAddress);

      // Check if another signer slot on this document already claimed this address
      const addressConflict = docSigners.find(
        (s) => s.id !== signer.id && s.address?.toLowerCase() === address.toLowerCase(),
      );
      if (addressConflict) {
        throw new Error(
          `This wallet is already assigned to "${addressConflict.label}" on this document. Use a different wallet for each signer.`,
        );
      }

      const { editableFields } = await getSignerFieldContext({ doc, docSigners, signer });
      const allowedIds = new Set(editableFields.map((field) => field.id));
      let sanitizedFieldValues = input.fieldValues
        ? Object.fromEntries(Object.entries(input.fieldValues).filter(([key]) => allowedIds.has(key)))
        : null;

      if (sanitizedFieldValues && Object.keys(sanitizedFieldValues).length === 0) {
        sanitizedFieldValues = null;
      }

      // Compute ink signature hash from the raw data (same as getSigningMessage)
      const inkHash = input.handSignatureData
        ? await hashHandSignature(input.handSignatureData)
        : input.handSignatureHash;

      // Recompute documentStateHash server-side (must match what getSigningMessage returned)
      const signerIdx = docSigners.findIndex((s) => s.id === signer.id);
      const documentStateHash = await computeDocumentStateHash({
        contentHash: doc.contentHash,
        docSigners,
        currentSignerFieldValues: sanitizedFieldValues,
        currentSignerIndex: signerIdx >= 0 ? signerIdx : undefined,
      });

      const message = await buildSigningMessage({
        documentTitle: doc.title,
        contentHash: documentStateHash,
        signerLabel: signer.label,
        signerAddress: address,
        chain: input.chain,
        handSignatureHash: inkHash,
      });

      const verifyResult = await verifySignature({
        chain: input.chain,
        address,
        message,
        signature: input.signature,
      });
      const { ok, scheme } = verifyResult;

      if (!ok) {
        const debugInfo =
          verifyResult.debug.length > 0
            ? `\n\n--- DEBUG (${input.chain} / ${address}) ---\n${verifyResult.debug.join("\n")}`
            : "";
        throw new Error(`Signature verification failed (scheme=${scheme})${debugInfo}`);
      }

      const signerEmail = input.email || signer.email;
      const signerIp = ctx.clientIp;
      const userAgentStr = ctx.req?.headers.get("user-agent") ?? null;
      const paymentFields = editableFields.filter((field) => field.type === "payment-request");
      const automationPolicy = await loadDocumentAutomationPolicy(ctx.db, doc.id);
      const existingForensicEvidence = (signer.forensicEvidence as Record<string, unknown> | null) ?? null;
      const priorSessions = normalizePriorForensicSessions(existingForensicEvidence?.forensicSessions);

      assertPaidPaymentFields(paymentFields, sanitizedFieldValues);

      // ── Verify server-issued signing challenges ──────────────────────
      const challengeFlags: Array<{ code: string; severity: string; message: string }> = [];
      const cr = input.challengeResponses;

      // Challenge verification — when client provides responses, verify them.
      // Missing challenges are logged as "info" (not blocking) until client-side
      // implementation is complete. Present but invalid/tampered = "critical".
      if (cr?.timingToken) {
        const claimedTime =
          typeof input.forensic?.behavioral.timeOnPage === "number" ? input.forensic.behavioral.timeOnPage : 0;
        const timing = verifyTimingToken(cr.timingToken, input.documentId, input.claimToken, claimedTime);
        challengeFlags.push(...timing.flags);
      } else {
        challengeFlags.push({ code: "TIMING_TOKEN_MISSING", severity: "info", message: "No timing token provided" });
      }

      if (doc.gazeTracking !== "off") {
        if (cr?.livenessResponse) {
          const liveness = verifyLivenessChallenge(
            cr.livenessResponse as LivenessResponse,
            input.documentId,
            input.claimToken,
          );
          challengeFlags.push(...liveness.flags);
        } else {
          challengeFlags.push({
            code: "LIVENESS_CHALLENGE_MISSING",
            severity: "info",
            message: "Gaze liveness challenge response not provided",
          });
        }
      }

      if (cr?.canvasToken && cr?.canvasHash) {
        const canvas = verifyCanvasChallenge(cr.canvasToken, cr.canvasHash, input.documentId, input.claimToken);
        challengeFlags.push(...canvas.flags);
      } else {
        challengeFlags.push({
          code: "CANVAS_CHALLENGE_MISSING",
          severity: "info",
          message: "Canvas proof-of-work not provided",
        });
      }

      if (!input.forensic) {
        input.forensic = { fingerprint: {}, behavioral: {} };
      }
      (input.forensic as Record<string, unknown>)._challengeFlags = challengeFlags;

      const forensic = await collectForensicEvidence(input.forensic, signerIp, userAgentStr, ctx.req?.headers, {
        proofMode: doc.proofMode,
        automationPolicy,
        signMethod: "WALLET",
        hasHandSignature: !!input.handSignatureData,
        priorSessions,
      });

      if (forensic.outcome?.action && forensic.outcome.action !== "ALLOW") {
        await maybeNotifyCreatorOfAutomationReview({
          doc,
          signerLabel: signer.label,
          review: forensic.review,
          outcome: forensic.outcome,
        });
      }
      if (forensic.outcome?.blocked) {
        throw new Error("This document requires a human signer for critical steps. The creator has been notified.");
      }

      const baseIdentityLevel = signerIp && userAgentStr ? "L2_VERIFIED" : signer.identityLevel;
      const idResult = processIdentityVerification({
        editableFields,
        sanitizedFieldValues,
        signerAddress: address,
        signerEmail,
        baseIdentityLevel,
      });
      sanitizedFieldValues = idResult.sanitizedFieldValues;

      const signedAt = new Date();
      const mergedForensicEvidence = forensic.data
        ? ({
            ...existingForensicEvidence,
            ...forensic.data,
          } as unknown as Record<string, unknown>)
        : existingForensicEvidence;

      await ctx.db
        .update(signers)
        .set({
          address,
          chain: input.chain,
          status: "SIGNED",
          signature: input.signature,
          signedAt,
          scheme,
          email: signerEmail,
          handSignatureData: input.handSignatureData ?? null,
          handSignatureHash: inkHash ?? null,
          fieldValues: sanitizedFieldValues,
          lastIp: signerIp,
          ipUpdatedAt: signerIp ? signedAt : undefined,
          userAgent: userAgentStr,
          identityLevel: idResult.identityLevel,
          forensicEvidence: mergedForensicEvidence,
          forensicHash: forensic.hash,
          documentStateHash,
        })
        .where(eq(signers.id, signer.id));

      // Merge mobile signing forensic data (strokes, device info) into signer record
      const mobileSessions = await ctx.db
        .select()
        .from(mobileSignSessions)
        .where(
          and(
            eq(mobileSignSessions.documentId, doc.id),
            eq(mobileSignSessions.signerLabel, signer.label),
            eq(mobileSignSessions.status, "signed"),
          ),
        );
      if (mobileSessions.length > 0) {
        const mobileForensics = mobileSessions.map((s) => s.metadata as Record<string, unknown> | null).filter(Boolean);
        if (mobileForensics.length > 0) {
          await ctx.db
            .update(signers)
            .set({
              forensicEvidence: {
                ...mergedForensicEvidence!,
                mobileForensics,
              } as unknown as Record<string, unknown>,
            })
            .where(eq(signers.id, signer.id));
        }
      }

      void safeLogAudit({
        documentId: doc.id,
        eventType: "SIGNER_SIGNED",
        actor: address,
        actorType: "wallet",
        ipAddress: signerIp,
        userAgent: userAgentStr,
        metadata: {
          signMethod: "WALLET",
          chain: input.chain,
          scheme,
          signerLabel: signer.label,
          hasHandSignature: !!input.handSignatureData,
          forensicHash: forensic.hash,
          forensicFlags: forensic.data?.flags?.map((f) => f.code) ?? [],
          automationAction: forensic.outcome?.action ?? "ALLOW",
        },
      });

      const reveal = doc.postSignReveal;
      const proxyDomain = reveal?.testbedAccess?.proxyEndpoint;
      if (proxyDomain && signerIp) {
        void addProxyIp({ domain: proxyDomain, ip: signerIp });
      }

      const branding = await resolveDocumentBranding(doc.createdBy, doc.brandingProfileId);

      if (signerEmail) {
        void sendSignerConfirmation({
          to: signerEmail,
          signerLabel: signer.label,
          documentTitle: doc.title,
          contentHash: doc.contentHash,
          chain: input.chain,
          scheme,
          branding,
          replyTo: branding.emailReplyTo,
        });
      }

      const { allSigned } = await handlePostSignCompletion({
        db: ctx.db,
        doc,
        docSigners,
        justSignedId: signer.id,
        justSignedOrder: signer.signerOrder ?? 0,
      });

      // Propagate data to sibling documents in the same group
      await propagateGroupSignature({
        db: ctx.db,
        doc,
        signer,
        signData: {
          address,
          chain: input.chain,
          signature: input.signature,
          signedAt,
          scheme,
          email: signerEmail,
          handSignatureData: input.handSignatureData ?? null,
          handSignatureHash: inkHash ?? null,
          fieldValues: sanitizedFieldValues,
          lastIp: signerIp,
          ipUpdatedAt: signerIp ? signedAt : null,
          userAgent: userAgentStr,
          identityLevel: idResult.identityLevel,
          forensicEvidence: mergedForensicEvidence,
          forensicHash: forensic.hash,
          documentStateHash,
        },
      });

      // Store wallet verification session for reuse across contracts
      void (async () => {
        try {
          const { storeVerificationSession } = await import("~/server/verification-sessions");
          await storeVerificationSession({
            identifier: address,
            provider: "wallet",
            chain: input.chain,
            displayName: address,
          });
        } catch {}
      })();

      // Enqueue async AI forensic review (non-blocking, runs in background)
      try {
        const { enqueueAiForensicReview } = await import(/* webpackIgnore: true */ "~/premium/ai/forensic-queue");
        enqueueAiForensicReview(signer.id, doc.id);
      } catch {}

      return { ok: true, allSigned };
    }),

  // ── List docs for the current account (linked wallets and/or email signers) ──
  listByAddress: publicProcedure.input(z.object({}).optional()).query(async ({ ctx }) => {
    const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
    if (!identity.authSession && !identity.walletSession) {
      throw new Error("Not signed in");
    }

    const creatorAddresses = [...identity.walletAddressSet];
    const createdDocGroups = await Promise.all(creatorAddresses.map((addr) => findDocumentsByCreator(ctx.db, addr)));
    const createdDocs = createdDocGroups.flat();

    const signerRowGroups = await Promise.all(creatorAddresses.map((addr) => findSignersByAddress(ctx.db, addr)));
    const signerRows = signerRowGroups.flat();

    if (identity.email) {
      const emailSignerRows = await ctx.db.select().from(signers).where(eq(signers.email, identity.email));
      signerRows.push(...emailSignerRows);
    }

    if (identity.userId) {
      const userSignerRows = await ctx.db.select().from(signers).where(eq(signers.userId, identity.userId));
      signerRows.push(...userSignerRows);
    }

    const allDocIds = new Set([...createdDocs.map((d) => d.id), ...signerRows.map((s) => s.documentId)]);

    const results: Array<
      (typeof createdDocs)[number] & {
        viewerIsCreator: boolean;
        signers: Array<{
          id: string;
          label: string;
          address: string | null;
          chain: string | null;
          status: string;
          signedAt: Date | null;
          isYou: boolean;
        }>;
      }
    > = [];

    for (const docId of allDocIds) {
      const doc = createdDocs.find((d) => d.id === docId) ?? (await findDocumentById(ctx.db, docId));
      if (!doc) continue;

      const docSigners = await findSignersByDocumentId(ctx.db, docId);
      const viewerAccess = resolveDocumentViewerAccess({
        document: doc,
        signers: docSigners,
        identity,
      });

      results.push({
        ...doc,
        viewerIsCreator: viewerAccess.isCreator,
        postSignReveal: viewerAccess.isCreator
          ? (doc.postSignReveal ?? null)
          : doc.postSignReveal
            ? { enabled: doc.postSignReveal.enabled }
            : null,
        signers: docSigners.map((s) => ({
          id: s.id,
          label: s.label,
          address: s.address,
          chain: s.chain,
          status: s.status,
          signedAt: s.signedAt,
          isYou: viewerAccess.matchingSigner?.id === s.id,
        })),
      });
    }

    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results;
  }),

  // ── Void / cancel document (creator only, while PENDING) ──
  voidDocument: publicProcedure
    .input(z.object({ documentId: z.string(), reason: z.string().max(500).optional() }))
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

      const { editableFields } = await getSignerFieldContext({ doc, docSigners, signer });
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

      const { editableFields } = await getSignerFieldContext({ doc, docSigners, signer });
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

      const { editableFields } = await getSignerFieldContext({ doc, docSigners, signer });
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

      const { editableFields } = await getSignerFieldContext({ doc, docSigners, signer });
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

      // Remove old IP from proxy
      if (proxyDomain && mySigner.lastIp) {
        void import("~/server/proxy").then((m) => m.removeProxyIp({ domain: proxyDomain, ip: mySigner.lastIp! }));
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

  // ── Email signing: request OTP ──
  requestSigningOtp: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        email: z.string().email(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);

      const signer = docSigners.find((s) => s.claimToken === input.claimToken);
      if (!signer) throw new Error("Invalid signing link");
      if (signer.status === "SIGNED") throw new Error("Already signed");
      if (!isActionableRecipientRole(signer.role)) {
        throw new Error("This recipient is view-only and does not require signing");
      }
      if (doc.signingOrder === "sequential" && signer.signerOrder !== (doc.currentSignerIndex ?? 0)) {
        throw new Error("It is not this recipient's turn yet");
      }
      if (signer.signMethod !== "EMAIL_OTP") {
        throw new Error("This signer slot requires wallet signing");
      }
      if (signer.tokenGates) {
        throw new Error("This signer uses token-gated access and must sign with a wallet.");
      }

      const branding = await resolveDocumentBranding(doc.createdBy, doc.brandingProfileId);
      const result = await safeSendSigningOtp({
        signerId: signer.id,
        email: input.email,
        documentTitle: doc.title,
        signerLabel: signer.label,
        branding,
        replyTo: branding.emailReplyTo,
      });

      // Audit: OTP sent
      void safeLogAudit({
        documentId: doc.id,
        eventType: "SIGNER_OTP_SENT",
        actor: input.email,
        actorType: "email",
        ipAddress: ctx.clientIp,
        metadata: { signerLabel: signer.label },
      });

      return { sent: result.sent };
    }),

  // ── Email signing: verify OTP and sign ──
  signWithEmail: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        email: z.string().email(),
        otpCode: z.string().length(6),
        fieldValues: z.record(z.string()).optional(),
        handSignatureData: z.string().optional(),
        // Explicit consent text that the signer agreed to (ESIGN/UETA compliance)
        consentText: z.string().min(1),
        forensic: forensicInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.documentId);
      if (!doc) throw new Error("Document not found");
      if (doc.status !== "PENDING") throw new Error("Document is no longer pending");

      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);

      const signer = docSigners.find((s) => s.claimToken === input.claimToken);
      if (!signer) throw new Error("Invalid signing link");
      if (signer.status === "SIGNED") throw new Error("Already signed");
      if (!isActionableRecipientRole(signer.role)) {
        throw new Error("This recipient is view-only and cannot complete the document");
      }
      if (doc.signingOrder === "sequential" && signer.signerOrder !== (doc.currentSignerIndex ?? 0)) {
        throw new Error("It is not this recipient's turn yet");
      }
      if (signer.signMethod !== "EMAIL_OTP") {
        throw new Error("This signer slot requires wallet signing");
      }
      if (signer.tokenGates) {
        throw new Error("This signer uses token-gated access and must sign with a wallet.");
      }

      // Verify the OTP
      const otpResult = await safeVerifySigningOtp({
        signerId: signer.id,
        code: input.otpCode,
      });

      if (!otpResult.valid) {
        throw new Error(otpResult.reason ?? "Invalid code");
      }

      // Audit: OTP verified
      void safeLogAudit({
        documentId: doc.id,
        eventType: "SIGNER_OTP_VERIFIED",
        actor: input.email,
        actorType: "email",
        ipAddress: ctx.clientIp,
      });

      const signerIp = ctx.clientIp;
      const userAgentStr = ctx.req?.headers.get("user-agent") ?? null;
      const inkHash = input.handSignatureData ? await hashHandSignature(input.handSignatureData) : undefined;
      const automationPolicy = await loadDocumentAutomationPolicy(ctx.db, doc.id);
      const existingForensicEvidence = (signer.forensicEvidence as Record<string, unknown> | null) ?? null;
      const priorSessions = normalizePriorForensicSessions(existingForensicEvidence?.forensicSessions);

      const { editableFields } = await getSignerFieldContext({ doc, docSigners, signer });
      const allowedIds = new Set(editableFields.map((field) => field.id));
      let sanitizedFieldValues = input.fieldValues
        ? Object.fromEntries(Object.entries(input.fieldValues).filter(([key]) => allowedIds.has(key)))
        : null;

      if (sanitizedFieldValues && Object.keys(sanitizedFieldValues).length === 0) {
        sanitizedFieldValues = null;
      }

      const paymentFields = editableFields.filter((field) => field.type === "payment-request");

      assertPaidPaymentFields(paymentFields, sanitizedFieldValues);

      const forensic = await collectForensicEvidence(input.forensic, signerIp, userAgentStr, ctx.req?.headers, {
        proofMode: doc.proofMode,
        automationPolicy,
        signMethod: "EMAIL_OTP",
        hasHandSignature: !!input.handSignatureData,
        priorSessions,
      });

      if (forensic.outcome?.action && forensic.outcome.action !== "ALLOW") {
        await maybeNotifyCreatorOfAutomationReview({
          doc,
          signerLabel: signer.label,
          review: forensic.review,
          outcome: forensic.outcome,
        });
      }
      if (forensic.outcome?.blocked) {
        throw new Error("This document requires a human signer for critical steps. The creator has been notified.");
      }

      const baseIdentityLevel = signerIp && userAgentStr ? "L2_VERIFIED" : "L1_EMAIL";
      const idResult = processIdentityVerification({
        editableFields,
        sanitizedFieldValues,
        signerEmail: input.email,
        baseIdentityLevel,
      });
      sanitizedFieldValues = idResult.sanitizedFieldValues;

      const signedAt = new Date();
      const mergedForensicEvidence = forensic.data
        ? ({
            ...existingForensicEvidence,
            ...forensic.data,
          } as unknown as Record<string, unknown>)
        : existingForensicEvidence;

      const signerIdx = docSigners.findIndex((s) => s.id === signer.id);
      const documentStateHash = await computeDocumentStateHash({
        contentHash: doc.contentHash,
        docSigners,
        currentSignerFieldValues: sanitizedFieldValues,
        currentSignerIndex: signerIdx >= 0 ? signerIdx : undefined,
      });

      await ctx.db
        .update(signers)
        .set({
          email: input.email,
          status: "SIGNED",
          signedAt,
          scheme: "EMAIL_OTP_CONSENT",
          handSignatureData: input.handSignatureData ?? null,
          handSignatureHash: inkHash ?? null,
          fieldValues: sanitizedFieldValues,
          lastIp: signerIp,
          ipUpdatedAt: signerIp ? signedAt : undefined,
          userAgent: userAgentStr,
          consentText: input.consentText,
          consentAt: signedAt,
          identityLevel: idResult.identityLevel,
          forensicEvidence: mergedForensicEvidence,
          forensicHash: forensic.hash,
          documentStateHash,
        })
        .where(eq(signers.id, signer.id));

      // Merge mobile signing forensic data into signer record
      const mobileSessions = await ctx.db
        .select()
        .from(mobileSignSessions)
        .where(
          and(
            eq(mobileSignSessions.documentId, doc.id),
            eq(mobileSignSessions.signerLabel, signer.label),
            eq(mobileSignSessions.status, "signed"),
          ),
        );
      if (mobileSessions.length > 0) {
        const mobileForensics = mobileSessions.map((s) => s.metadata as Record<string, unknown> | null).filter(Boolean);
        if (mobileForensics.length > 0) {
          await ctx.db
            .update(signers)
            .set({
              forensicEvidence: {
                ...mergedForensicEvidence!,
                mobileForensics,
              } as unknown as Record<string, unknown>,
            })
            .where(eq(signers.id, signer.id));
        }
      }

      void safeLogAudit({
        documentId: doc.id,
        eventType: "SIGNER_SIGNED",
        actor: input.email,
        actorType: "email",
        ipAddress: signerIp,
        userAgent: userAgentStr,
        metadata: {
          signMethod: "EMAIL_OTP",
          signerLabel: signer.label,
          consentCaptured: true,
          hasHandSignature: !!input.handSignatureData,
          forensicHash: forensic.hash,
          forensicFlags: forensic.data?.flags?.map((f) => f.code) ?? [],
          automationAction: forensic.outcome?.action ?? "ALLOW",
        },
      });

      if (input.email) {
        const branding = await resolveDocumentBranding(doc.createdBy, doc.brandingProfileId);
        void sendSignerConfirmation({
          to: input.email,
          signerLabel: signer.label,
          documentTitle: doc.title,
          contentHash: doc.contentHash,
          chain: "ETH",
          scheme: "EMAIL_OTP_CONSENT",
          branding,
          replyTo: branding.emailReplyTo,
        });
      }

      const { allSigned } = await handlePostSignCompletion({
        db: ctx.db,
        doc,
        docSigners,
        justSignedId: signer.id,
        justSignedOrder: signer.signerOrder ?? 0,
      });

      // Propagate signature to sibling documents in the same group
      await propagateGroupSignature({
        db: ctx.db,
        doc,
        signer,
        signData: {
          address: null,
          chain: null,
          signature: null,
          signedAt,
          scheme: "EMAIL_OTP_CONSENT",
          email: input.email,
          handSignatureData: input.handSignatureData ?? null,
          handSignatureHash: inkHash ?? null,
          fieldValues: sanitizedFieldValues,
          lastIp: signerIp,
          ipUpdatedAt: signerIp ? signedAt : null,
          userAgent: userAgentStr,
          identityLevel: idResult.identityLevel,
          forensicEvidence: mergedForensicEvidence,
          forensicHash: forensic.hash,
          documentStateHash,
          consentText: input.consentText,
          consentAt: signedAt,
        },
      });

      // Store email verification session for reuse across contracts
      void (async () => {
        try {
          const { storeVerificationSession } = await import("~/server/verification-sessions");
          await storeVerificationSession({
            identifier: input.email,
            provider: "email",
            displayName: input.email,
          });
        } catch {}
      })();

      // Enqueue async AI forensic review (non-blocking)
      try {
        const { enqueueAiForensicReview } = await import(/* webpackIgnore: true */ "~/premium/ai/forensic-queue");
        enqueueAiForensicReview(signer.id, doc.id);
      } catch {}

      return { ok: true, allSigned };
    }),

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

    const { generateProofPacket } = await import("~/server/proof-packet");
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

    const { getAuditTrail, verifyAuditChain } = await import("~/server/audit");
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

    // Fetch audit trail for Certificate of Completion
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
      const { getAuditTrail, verifyAuditChain } = await import("~/server/audit");
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
      return { token, url: `${baseUrl}/mobile-sign/${token}${modeParam}`, expiresAt: expiresAt.toISOString() };
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

      const entries: Array<{ documentId: string; stateHash: string; title: string }> = [];

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
        contracts: entries.map((e) => ({ documentId: e.documentId, stateHash: e.stateHash, title: e.title })),
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
      const entries: Array<{ documentId: string; stateHash: string; discloserId: string }> = [];

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

        entries.push({ documentId: doc.id, stateHash, discloserId: discloser.id });
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
