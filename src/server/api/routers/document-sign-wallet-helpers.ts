// @ts-nocheck -- tRPC context types break type inference across router files
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * Helpers for the wallet signing procedures, extracted to keep
 * document-sign-wallet.ts under 650 lines.
 */
import { and, eq } from "drizzle-orm";
import { normalizeAddress } from "~/lib/crypto/chains";
import { isActionableRecipientRole } from "~/lib/signing/recipient-roles";
import { buildSigningMessage, hashHandSignature, verifySignature } from "~/server/crypto/rust-engine";
import {
  type LivenessResponse,
  verifyCanvasChallenge,
  verifyLivenessChallenge,
  verifyTimingToken,
} from "~/server/crypto/signing-challenges";
import { evaluateSignerTokenGate, evaluateSignerTokenGateWithProofs } from "~/server/crypto/token-gates";
import { mobileSignSessions, signers } from "~/server/db/schema";
import { resolveDocumentBranding } from "~/server/messaging/delivery";
import { sendSignerConfirmation } from "~/server/messaging/email";
import { addProxyIp } from "~/server/workspace/proxy";
import {
  assertPaidPaymentFields,
  computeDocumentStateHash,
  getSignerFieldContext,
  processIdentityVerification,
  propagateGroupSignature,
} from "./document-helpers";
import { requiresTokenGateWalletProofs } from "./document-packets";
import {
  collectForensicEvidence,
  loadDocumentAutomationPolicy,
  maybeNotifyCreatorOfAutomationReview,
  normalizePriorForensicSessions,
} from "./document-utils";

type ChallengeFlag = { code: string; severity: string; message: string };

/** Verify server-issued signing challenges and return flags. */
export function verifyChallengeResponses(
  cr:
    | {
        timingToken?: string;
        livenessResponse?: unknown;
        canvasHash?: string;
        canvasToken?: string;
      }
    | undefined,
  documentId: string,
  claimToken: string,
  gazeTracking: string,
  forensicInput: { behavioral: Record<string, unknown> } | undefined,
): ChallengeFlag[] {
  const flags: ChallengeFlag[] = [];

  if (cr?.timingToken) {
    const claimedTime =
      typeof forensicInput?.behavioral.timeOnPage === "number" ? forensicInput.behavioral.timeOnPage : 0;
    flags.push(...verifyTimingToken(cr.timingToken, documentId, claimToken, claimedTime).flags);
  } else {
    flags.push({
      code: "TIMING_TOKEN_MISSING",
      severity: "info",
      message: "No timing token provided",
    });
  }

  if (gazeTracking !== "off") {
    if (cr?.livenessResponse) {
      flags.push(...verifyLivenessChallenge(cr.livenessResponse as LivenessResponse, documentId, claimToken).flags);
    } else {
      flags.push({
        code: "LIVENESS_CHALLENGE_MISSING",
        severity: "info",
        message: "Gaze liveness challenge response not provided",
      });
    }
  }

  if (cr?.canvasToken && cr?.canvasHash) {
    flags.push(...verifyCanvasChallenge(cr.canvasToken, cr.canvasHash, documentId, claimToken).flags);
  } else {
    flags.push({
      code: "CANVAS_CHALLENGE_MISSING",
      severity: "info",
      message: "Canvas proof-of-work not provided",
    });
  }

  return flags;
}

/** Merge mobile signing forensic data into the signer record. */
export async function mergeMobileForensics(
  db: unknown,
  documentId: string,
  signer: { id: string; label: string },
  mergedForensicEvidence: Record<string, unknown> | null,
) {
  const mobileSess = await (db as any)
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
  const mobileForensics = mobileSess.map((s: any) => s.metadata as Record<string, unknown> | null).filter(Boolean);
  if (mobileForensics.length === 0) return;
  await (db as any)
    .update(signers)
    .set({
      forensicEvidence: {
        ...mergedForensicEvidence!,
        mobileForensics,
      } as unknown as Record<string, unknown>,
    })
    .where(eq(signers.id, signer.id));
}

/** Run post-sign side effects: proxy IP, confirmation email, group propagation, sessions, AI review. */
export async function runPostSignSideEffects(params: {
  ctx: any;
  doc: any;
  docSigners: any;
  signer: any;
  signerIp: string | null;
  signerEmail: string | null | undefined;
  forensic: any;
  mergedForensicEvidence: any;
  idResult: any;
  signData: any;
}) {
  const { ctx, doc, signer, signerIp, signerEmail, signData } = params;

  const reveal = doc.postSignReveal;
  const proxyDomain = reveal?.testbedAccess?.proxyEndpoint;
  if (proxyDomain && signerIp) {
    void addProxyIp({ domain: proxyDomain, ip: signerIp });
  }

  if (signerEmail) {
    const branding = await resolveDocumentBranding(doc.createdBy, doc.brandingProfileId);
    void sendSignerConfirmation({
      to: signerEmail,
      signerLabel: signer.label,
      documentTitle: doc.title,
      contentHash: doc.contentHash,
      chain: signData.chain,
      scheme: signData.scheme ?? "EMAIL_OTP_CONSENT",
      branding,
      replyTo: branding.emailReplyTo,
    });
  }

  await propagateGroupSignature({ db: ctx.db, doc, signer, signData });

  void (async () => {
    try {
      const { storeVerificationSession } = await import("~/server/auth/verification-sessions");
      if (signData.address) {
        await storeVerificationSession({
          identifier: signData.address,
          provider: "wallet",
          chain: signData.chain,
          displayName: signData.address,
        });
      } else if (signData.email) {
        await storeVerificationSession({
          identifier: signData.email,
          provider: "email",
          displayName: signData.email,
        });
      }
    } catch {}
  })();

  try {
    const m = await import("~/generated/premium/ai/forensic-queue");
    m.enqueueForensicReview({ signerId: signer.id, documentId: doc.id });
  } catch {}
}

/** Validate a signer is eligible for the getSigningMessage or sign operation. */
export async function validateWalletSigner(
  signer: any,
  doc: any,
  input: {
    signerAddress: string;
    chain: string;
    claimToken: string;
    tokenGateProofs?: any[];
  },
) {
  if (!signer) throw new Error("Invalid signing link");
  if (signer.status === "SIGNED") throw new Error("Already signed");
  if (signer.tokenGates) {
    const gateEvaluation = requiresTokenGateWalletProofs(signer.tokenGates)
      ? await evaluateSignerTokenGateWithProofs({
          gate: signer.tokenGates,
          ...{
            documentId: (input as any).documentId,
            claimToken: input.claimToken,
          },
          proofs: input.tokenGateProofs ?? [],
        })
      : await evaluateSignerTokenGate({
          gate: signer.tokenGates,
          address: input.signerAddress,
          chain: input.chain,
        });
    if (gateEvaluation && !gateEvaluation.eligible) throw new Error(gateEvaluation.summary);
  }
  if (!isActionableRecipientRole(signer.role))
    throw new Error("This recipient is view-only and does not require a signing message");
  if (doc.signingOrder === "sequential" && signer.signerOrder !== (doc.currentSignerIndex ?? 0))
    throw new Error("It is not this recipient's turn yet");
  if (signer.address && signer.address.toLowerCase() !== input.signerAddress.toLowerCase())
    throw new Error("This signing slot is already claimed by another wallet");
}

/** Build signing message, verify the wallet signature, and throw on failure. */
async function verifyWalletSignature(opts: {
  doc: any;
  signer: any;
  address: string;
  input: any;
  inkHash: string | undefined;
  documentStateHash: string;
}) {
  const { doc, signer, address, input, inkHash, documentStateHash } = opts;
  const message = await buildSigningMessage({
    documentTitle: doc.title,
    contentHash: documentStateHash,
    signerLabel: signer.label,
    signerAddress: address,
    chain: input.chain,
    handSignatureHash: inkHash,
  });
  const result = await verifySignature({
    chain: input.chain,
    address,
    message,
    signature: input.signature,
  });
  if (!result.ok) {
    const debugInfo =
      result.debug.length > 0 ? `\n\n--- DEBUG (${input.chain} / ${address}) ---\n${result.debug.join("\n")}` : "";
    throw new Error(`Signature verification failed (scheme=${result.scheme})${debugInfo}`);
  }
  return result;
}

/** Prepare forensics, identity, field values, and state hash for wallet signing. */
export async function prepareWalletSign(ctx: any, input: any, doc: any, docSigners: any, signer: any) {
  const address = normalizeAddress(input.chain, input.signerAddress);
  const addressConflict = docSigners.find(
    (s: any) => s.id !== signer.id && s.address?.toLowerCase() === address.toLowerCase(),
  );
  if (addressConflict)
    throw new Error(
      `This wallet is already assigned to "${addressConflict.label}" on this document. Use a different wallet for each signer.`,
    );

  const { editableFields } = await getSignerFieldContext({
    doc,
    docSigners,
    signer,
  });
  const allowedIds = new Set(editableFields.map((f: any) => f.id));
  let sanitizedFieldValues = input.fieldValues
    ? Object.fromEntries(Object.entries(input.fieldValues).filter(([key]: [string, unknown]) => allowedIds.has(key)))
    : null;
  if (sanitizedFieldValues && Object.keys(sanitizedFieldValues).length === 0) sanitizedFieldValues = null;

  const inkHash = input.handSignatureData ? await hashHandSignature(input.handSignatureData) : input.handSignatureHash;
  const signerIdx = docSigners.findIndex((s: any) => s.id === signer.id);
  const documentStateHash = await computeDocumentStateHash({
    contentHash: doc.contentHash,
    docSigners,
    currentSignerFieldValues: sanitizedFieldValues,
    currentSignerIndex: signerIdx >= 0 ? signerIdx : undefined,
  });

  const verifyResult = await verifyWalletSignature({
    doc,
    signer,
    address,
    input,
    inkHash,
    documentStateHash,
  });

  const signerIp = ctx.clientIp;
  const userAgentStr = ctx.req?.headers.get("user-agent") ?? null;
  const signerEmail = input.email || signer.email;
  const automationPolicy = await loadDocumentAutomationPolicy(ctx.db, doc.id);
  const existingForensicEvidence = (signer.forensicEvidence as Record<string, unknown> | null) ?? null;
  const priorSessions = normalizePriorForensicSessions(existingForensicEvidence?.forensicSessions);

  assertPaidPaymentFields(
    editableFields.filter((f: any) => f.type === "payment-request"),
    sanitizedFieldValues,
  );

  const challengeFlags = verifyChallengeResponses(
    input.challengeResponses,
    input.documentId,
    input.claimToken,
    doc.gazeTracking,
    input.forensic,
  );
  if (!input.forensic) input.forensic = { fingerprint: {}, behavioral: {} };
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
  if (forensic.outcome?.blocked)
    throw new Error("This document requires a human signer for critical steps. The creator has been notified.");

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
    ? ({ ...existingForensicEvidence, ...forensic.data } as unknown as Record<string, unknown>)
    : existingForensicEvidence;

  return {
    address,
    scheme: verifyResult.scheme,
    inkHash,
    sanitizedFieldValues,
    signerIp,
    userAgentStr,
    signerEmail,
    editableFields,
    forensic,
    idResult,
    signedAt,
    mergedForensicEvidence,
    documentStateHash,
  };
}
