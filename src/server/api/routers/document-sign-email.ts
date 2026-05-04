// @ts-nocheck -- tRPC context types break type inference across router files
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unnecessary-type-assertion */
/**
 * Email signing procedures: requestSigningOtp, signWithEmail.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isActionableRecipientRole } from "~/lib/signing/recipient-roles";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { hashHandSignature } from "~/server/crypto/rust-engine";
import { findDocumentById, findSignersByDocumentId } from "~/server/db/compat";
import { mobileSignSessions, signers } from "~/server/db/schema";
import { resolveDocumentBranding } from "~/server/messaging/delivery";
import { safeFireEmail, sendSignerConfirmation } from "~/server/messaging/email";
import { onDocumentSigned } from "~/server/hooks/affiliate-hooks";
import {
  assertPaidPaymentFields,
  computeDocumentStateHash,
  getSignerFieldContext,
  handlePostSignCompletion,
  processIdentityVerification,
  propagateGroupSignature,
  safeLogAudit,
  safeSendSigningOtp,
  safeVerifySigningOtp,
} from "./document-helpers";
import {
  collectForensicEvidence,
  forensicInputSchema,
  loadDocumentAutomationPolicy,
  maybeNotifyCreatorOfAutomationReview,
  normalizePriorForensicSessions,
} from "./document-utils";

/** Merge mobile signing forensic data into signer record. */
async function mergeMobileForensics(
  db: any,
  documentId: string,
  signer: { id: string; label: string },
  mergedEvidence: Record<string, unknown> | null,
) {
  const mobileSess = await db
    .select()
    .from(mobileSignSessions)
    .where(
      and(
        eq(mobileSignSessions.documentId, documentId),
        eq(mobileSignSessions.signerLabel, signer.label),
        eq(mobileSignSessions.status, "signed"),
      ),
    );
  if (mobileSess.length === 0) return;
  const forensics = mobileSess.map((s: any) => s.metadata).filter(Boolean);
  if (forensics.length === 0) return;
  await db
    .update(signers)
    .set({
      forensicEvidence: {
        ...mergedEvidence!,
        mobileForensics: forensics,
      } as any,
    })
    .where(eq(signers.id, signer.id));
}

/** Post-sign side effects for email signing: confirmation, propagation, sessions, AI review. */
export async function runEmailPostSignSideEffects(params: {
  ctx: any;
  doc: any;
  docSigners: any;
  signer: any;
  signerIp: string | null;
  email: string;
  forensic: any;
  signedAt: Date;
  inkHash: string | undefined;
  sanitizedFieldValues: any;
  userAgentStr: string | null;
  idResult: any;
  mergedForensicEvidence: any;
  documentStateHash: string;
  consentText: string;
  handSignatureData?: string;
}) {
  const {
    ctx,
    doc,
    signer,
    email,
    signedAt,
    inkHash,
    sanitizedFieldValues,
    signerIp,
    userAgentStr,
    idResult,
    mergedForensicEvidence,
    documentStateHash,
    consentText,
    handSignatureData,
  } = params;

  if (email) {
    const branding = await resolveDocumentBranding(doc.createdBy, doc.brandingProfileId);
    safeFireEmail(
      sendSignerConfirmation({
        to: email,
        signerLabel: signer.label,
        documentTitle: doc.title,
        contentHash: doc.contentHash,
        chain: "ETH",
        scheme: "EMAIL_OTP_CONSENT",
        branding,
        replyTo: branding.emailReplyTo,
      }),
      "sendSignerConfirmation (email)",
    );
  }

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
      email,
      handSignatureData: handSignatureData ?? null,
      handSignatureHash: inkHash ?? null,
      fieldValues: sanitizedFieldValues,
      lastIp: signerIp,
      ipUpdatedAt: signerIp ? signedAt : null,
      userAgent: userAgentStr,
      identityLevel: idResult.identityLevel,
      forensicEvidence: mergedForensicEvidence,
      forensicHash: params.forensic.hash,
      documentStateHash,
      consentText,
      consentAt: signedAt,
    },
  });

  void (async () => {
    try {
      const { storeVerificationSession } = await import("~/server/auth/verification-sessions");
      await storeVerificationSession({
        identifier: email,
        provider: "email",
        displayName: email,
      });
    } catch {}
  })();

  try {
    const m = await import("~/generated/premium/ai/forensic-queue");
    m.enqueueForensicReview({ signerId: signer.id, documentId: doc.id });
  } catch {}
}

/** Prepare all data needed for email signing: forensics, identity, field validation, state hash. */
export async function prepareEmailSign(ctx: any, input: any, doc: any, docSigners: any, signer: any) {
  const signerIp = ctx.clientIp;
  const userAgentStr = ctx.req?.headers.get("user-agent") ?? null;
  const inkHash = input.handSignatureData ? await hashHandSignature(input.handSignatureData) : undefined;
  const automationPolicy = await loadDocumentAutomationPolicy(ctx.db, doc.id);
  const existingForensicEvidence = (signer.forensicEvidence as Record<string, unknown> | null) ?? null;
  const priorSessions = normalizePriorForensicSessions(existingForensicEvidence?.forensicSessions);

  const { editableFields } = await getSignerFieldContext({
    doc,
    docSigners,
    signer,
  });
  let sanitizedFieldValues = sanitizeFieldValues(input.fieldValues, editableFields);
  assertPaidPaymentFields(
    editableFields.filter((f: any) => f.type === "payment-request"),
    sanitizedFieldValues,
  );

  const forensic = await collectForensicEvidence(input.forensic, signerIp, userAgentStr, ctx.req?.headers, {
    proofMode: doc.proofMode,
    automationPolicy,
    signMethod: "EMAIL_OTP",
    hasHandSignature: !!input.handSignatureData,
    priorSessions,
  });
  await handleForensicOutcome(forensic, doc, signer.label);

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
    ? ({ ...existingForensicEvidence, ...forensic.data } as unknown as Record<string, unknown>)
    : existingForensicEvidence;

  const signerIdx = docSigners.findIndex((s: any) => s.id === signer.id);
  const documentStateHash = await computeDocumentStateHash({
    contentHash: doc.contentHash,
    docSigners,
    currentSignerFieldValues: sanitizedFieldValues,
    currentSignerIndex: signerIdx >= 0 ? signerIdx : undefined,
  });

  return {
    signerIp,
    userAgentStr,
    inkHash,
    sanitizedFieldValues,
    forensic,
    idResult,
    signedAt,
    mergedForensicEvidence,
    documentStateHash,
    forensicHash: forensic.hash,
    signer,
  };
}

/** Validate the signer is eligible for email signing. */
export function validateEmailSigner(signer: any, doc: any): asserts signer {
  if (!signer) throw new Error("Invalid signing link");
  if (signer.status === "SIGNED") throw new Error("Already signed");
  if (!isActionableRecipientRole(signer.role))
    throw new Error("This recipient is view-only and cannot complete the document");
  if (doc.signingOrder === "sequential" && signer.signerOrder !== (doc.currentSignerIndex ?? 0))
    throw new Error("It is not this recipient's turn yet");
  if (signer.signMethod !== "EMAIL_OTP") throw new Error("This signer slot requires wallet signing");
  if (signer.tokenGates) throw new Error("This signer uses token-gated access and must sign with a wallet.");
}

/** Sanitize field values to only include allowed field IDs. */
function sanitizeFieldValues(
  fieldValues: Record<string, string> | undefined,
  editableFields: Array<{ id: string }>,
): Record<string, string> | null {
  if (!fieldValues) return null;
  const allowedIds = new Set(editableFields.map((f) => f.id));
  const sanitized = Object.fromEntries(Object.entries(fieldValues).filter(([key]) => allowedIds.has(key)));
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

/** Persist the email signing record and log the audit event. */
export async function persistEmailSignature(
  db: any,
  params: {
    signer: any;
    email: string;
    signedAt: Date;
    inkHash: string | undefined;
    sanitizedFieldValues: Record<string, string> | null;
    signerIp: string | null;
    userAgentStr: string | null;
    consentText: string;
    handSignatureData?: string;
    idResult: any;
    mergedForensicEvidence: any;
    forensicHash: string | null;
    documentStateHash: string;
  },
) {
  const {
    signer,
    email,
    signedAt,
    inkHash,
    sanitizedFieldValues,
    signerIp,
    userAgentStr,
    consentText,
    handSignatureData,
    idResult,
    mergedForensicEvidence,
    forensicHash,
    documentStateHash,
  } = params;
  await db
    .update(signers)
    .set({
      email,
      status: "SIGNED",
      signedAt,
      scheme: "EMAIL_OTP_CONSENT",
      handSignatureData: handSignatureData ?? null,
      handSignatureHash: inkHash ?? null,
      fieldValues: sanitizedFieldValues,
      lastIp: signerIp,
      ipUpdatedAt: signerIp ? signedAt : undefined,
      userAgent: userAgentStr,
      consentText,
      consentAt: signedAt,
      identityLevel: idResult.identityLevel,
      forensicEvidence: mergedForensicEvidence,
      forensicHash,
      documentStateHash,
    })
    .where(eq(signers.id, signer.id));
}

/** Handle forensic automation review outcome — notify creator and block if needed. */
async function handleForensicOutcome(forensic: any, doc: any, signerLabel: string) {
  if (forensic.outcome?.action && forensic.outcome.action !== "ALLOW") {
    await maybeNotifyCreatorOfAutomationReview({
      doc,
      signerLabel,
      review: forensic.review,
      outcome: forensic.outcome,
    });
  }
  if (forensic.outcome?.blocked) {
    throw new Error("This document requires a human signer for critical steps. The creator has been notified.");
  }
}

export const documentSignEmailRouter = createTRPCRouter({
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
      validateEmailSigner(signer, doc);

      const otpResult = await safeVerifySigningOtp({
        signerId: signer!.id,
        code: input.otpCode,
      });
      if (!otpResult.valid) throw new Error(otpResult.reason ?? "Invalid code");

      void safeLogAudit({
        documentId: doc.id,
        eventType: "SIGNER_OTP_VERIFIED",
        actor: input.email,
        actorType: "email",
        ipAddress: ctx.clientIp,
      });

      const prepared = await prepareEmailSign(ctx, input, doc, docSigners, signer!);

      await persistEmailSignature(ctx.db, {
        ...prepared,
        email: input.email,
        consentText: input.consentText,
        handSignatureData: input.handSignatureData,
      });
      await mergeMobileForensics(ctx.db, doc.id, signer!, prepared.mergedForensicEvidence);

      void safeLogAudit({
        documentId: doc.id,
        eventType: "SIGNER_SIGNED",
        actor: input.email,
        actorType: "email",
        ipAddress: prepared.signerIp,
        userAgent: prepared.userAgentStr,
        metadata: {
          signMethod: "EMAIL_OTP",
          signerLabel: signer!.label,
          consentCaptured: true,
          hasHandSignature: !!input.handSignatureData,
          forensicHash: prepared.forensic.hash,
          forensicFlags: prepared.forensic.data?.flags?.map((f: any) => f.code) ?? [],
          automationAction: prepared.forensic.outcome?.action ?? "ALLOW",
        },
      });

      void onDocumentSigned(doc.id, signer!.id);

      await runEmailPostSignSideEffects({
        ctx,
        doc,
        docSigners,
        signer: signer!,
        signerIp: prepared.signerIp,
        email: input.email,
        forensic: prepared.forensic,
        signedAt: prepared.signedAt,
        inkHash: prepared.inkHash,
        sanitizedFieldValues: prepared.sanitizedFieldValues,
        userAgentStr: prepared.userAgentStr,
        idResult: prepared.idResult,
        mergedForensicEvidence: prepared.mergedForensicEvidence,
        documentStateHash: prepared.documentStateHash,
        consentText: input.consentText,
        handSignatureData: input.handSignatureData,
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
