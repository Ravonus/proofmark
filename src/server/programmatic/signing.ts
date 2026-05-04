import { eq } from "drizzle-orm";
import { z } from "zod";
import { type NextRequest } from "next/server";
import { tokenizeDocument } from "~/lib/document/document-tokens";
import { VERIFY_FIELD_TYPES } from "~/lib/signing/signing-constants";
import { tokenGateWalletProofListSchema } from "~/lib/token-gates";
import {
  computeDocumentStateHash,
  getSignerFieldContext,
  handlePostSignCompletion,
  safeLogAudit,
  safeSendSigningOtp,
  safeVerifySigningOtp,
} from "~/server/api/routers/document-helpers";
import {
  persistEmailSignature,
  prepareEmailSign,
  runEmailPostSignSideEffects,
  validateEmailSigner,
} from "~/server/api/routers/document-sign-email";
import {
  mergeMobileForensics,
  prepareWalletSign,
  runPostSignSideEffects,
  validateWalletSigner,
} from "~/server/api/routers/document-sign-wallet-helpers";
import { forensicInputSchema } from "~/server/api/routers/document-utils";
import { resolveDocumentBranding } from "~/server/messaging/delivery";
import { buildSigningMessage, decryptDocument as decryptContent, hashHandSignature } from "~/server/crypto/rust-engine";
import { issueCanvasChallenge, issueLivenessChallenge, issueTimingToken } from "~/server/crypto/signing-challenges";
import { db } from "~/server/db";
import { findDocumentById, findSignersByDocumentId } from "~/server/db/compat";
import { signers } from "~/server/db/schema";
import { saveSignerAttachment } from "~/server/documents/attachments";
import { saveImportedPdf } from "~/server/storage/imported-pdfs";
import { normalizeOwnerAddress } from "~/server/workspace/workspace";
import { ProgrammaticApiError } from "./errors";

type PreparedForensicResult = {
  data?: {
    flags?: Array<{ code: string }>;
  } | null;
  hash: string;
  outcome?: {
    action?: string | null;
  } | null;
};

type PreparedIdentityResult = {
  identityLevel: "L0_WALLET" | "L1_EMAIL" | "L2_VERIFIED" | "L3_KYC";
};

type PreparedWalletSignResult = {
  address: string;
  documentStateHash: string;
  forensic: PreparedForensicResult;
  idResult: PreparedIdentityResult;
  inkHash?: string | null;
  mergedForensicEvidence: Record<string, unknown> | null;
  sanitizedFieldValues: Record<string, string> | null;
  scheme: string | null;
  signedAt: Date;
  signerEmail: string | null;
  signerIp: string | null;
  userAgentStr: string | null;
};

type PreparedEmailSignResult = {
  documentStateHash: string;
  forensic: PreparedForensicResult;
  forensicHash: string;
  idResult: PreparedIdentityResult;
  inkHash: string | undefined;
  mergedForensicEvidence: Record<string, unknown> | null;
  sanitizedFieldValues: Record<string, string> | null;
  signedAt: Date;
  signerIp: string | null;
  signer: { id: string };
  userAgentStr: string | null;
};

const requestSigningOtpSchema = z.object({
  documentId: z.string(),
  claimToken: z.string(),
  email: z.string().email(),
});

const saveFieldValuesSchema = z.object({
  documentId: z.string(),
  claimToken: z.string(),
  fieldValues: z.record(z.string()),
});

const getSigningMessageSchema = z.object({
  documentId: z.string(),
  claimToken: z.string(),
  signerAddress: z.string(),
  chain: z.enum(["ETH", "SOL", "BTC"]),
  handSignatureData: z.string().optional(),
  tokenGateProofs: tokenGateWalletProofListSchema.optional(),
  fieldValues: z.record(z.string()).optional(),
});

const signWalletSchema = z.object({
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
});

const signEmailSchema = z.object({
  documentId: z.string(),
  claimToken: z.string(),
  email: z.string().email(),
  otpCode: z.string().length(6),
  fieldValues: z.record(z.string()).optional(),
  handSignatureData: z.string().optional(),
  consentText: z.string().min(1),
  forensic: forensicInputSchema,
});

function assertOwnedDocumentOwner(ownerAddress: string, createdBy: string) {
  if (normalizeOwnerAddress(createdBy) !== normalizeOwnerAddress(ownerAddress)) {
    throw new ProgrammaticApiError(404, "Document not found");
  }
}

async function loadOwnedSigningContext(ownerAddress: string, documentId: string, claimToken: string) {
  const doc = await findDocumentById(db, documentId);
  if (!doc) {
    throw new ProgrammaticApiError(404, "Document not found");
  }

  assertOwnedDocumentOwner(ownerAddress, doc.createdBy);
  const docSigners = await findSignersByDocumentId(db, documentId);
  const signer = docSigners.find((entry) => entry.claimToken === claimToken);
  if (!signer) {
    throw new ProgrammaticApiError(403, "Invalid signing link");
  }

  return { doc, docSigners, signer };
}

export async function saveProgrammaticFieldValues(ownerAddress: string, rawInput: unknown) {
  const input = saveFieldValuesSchema.parse(rawInput);
  const { doc, docSigners, signer } = await loadOwnedSigningContext(ownerAddress, input.documentId, input.claimToken);

  if (doc.status !== "PENDING") return { saved: false };
  if (signer.status === "SIGNED") return { saved: false };

  const { editableFields } = await getSignerFieldContext({
    doc,
    docSigners,
    signer,
  });
  const allowedIds = new Set(editableFields.map((field) => field.id));
  const verifyFields = editableFields.filter((field) => VERIFY_FIELD_TYPES.has(field.type));

  if (verifyFields.length > 0) {
    const existing = signer.fieldValues ?? {};
    const hasAnyVerification = verifyFields.some((field) => {
      const value = existing[field.id];
      return value?.includes('"status":"verified"');
    });
    const socialVerifications = ((signer as { socialVerifications?: unknown[] }).socialVerifications ?? []) as Array<{
      verifiedAt?: string;
    }>;
    if (!hasAnyVerification && socialVerifications.length === 0) {
      return { saved: false, reason: "verification_required" as const };
    }
  }

  const verifyFieldIds = new Set(verifyFields.map((field) => field.id));
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.fieldValues)) {
    if (!allowedIds.has(key) || verifyFieldIds.has(key)) continue;
    sanitized[key] = value;
  }

  if (Object.keys(sanitized).length === 0) return { saved: false };

  const existing = signer.fieldValues ?? {};
  await db
    .update(signers)
    .set({ fieldValues: { ...existing, ...sanitized } })
    .where(eq(signers.id, signer.id));
  return { saved: true };
}

export async function getProgrammaticSigningMessage(ownerAddress: string, rawInput: unknown) {
  const input = getSigningMessageSchema.parse(rawInput);
  const { doc, docSigners, signer } = await loadOwnedSigningContext(ownerAddress, input.documentId, input.claimToken);

  await validateWalletSigner(signer, doc, {
    signerAddress: input.signerAddress,
    chain: input.chain,
    claimToken: input.claimToken,
    tokenGateProofs: input.tokenGateProofs,
    documentId: input.documentId,
  } as never);

  const inkHash = input.handSignatureData ? await hashHandSignature(input.handSignatureData) : undefined;
  const gazeEnabled = doc.gazeTracking !== "off";
  const timingToken = issueTimingToken(input.documentId, input.claimToken);
  const livenessChallenge = gazeEnabled ? issueLivenessChallenge(input.documentId, input.claimToken) : null;
  const canvasChallenge = issueCanvasChallenge(input.documentId, input.claimToken);

  const { editableFields } = await getSignerFieldContext({ doc, docSigners, signer });
  const allowedIds = new Set(editableFields.map((field) => field.id));
  let sanitizedFieldValues = input.fieldValues
    ? Object.fromEntries(Object.entries(input.fieldValues).filter(([key]) => allowedIds.has(key)))
    : null;
  if (sanitizedFieldValues && Object.keys(sanitizedFieldValues).length === 0) {
    sanitizedFieldValues = null;
  }

  const signerIdx = docSigners.findIndex((entry) => entry.id === signer.id);
  const documentStateHash = await computeDocumentStateHash({
    contentHash: doc.contentHash,
    docSigners,
    currentSignerFieldValues: sanitizedFieldValues,
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
}

export async function signProgrammaticWallet(params: {
  ownerAddress: string;
  req: NextRequest;
  clientIp: string | null;
  input: unknown;
}) {
  const input = signWalletSchema.parse(params.input);
  const { doc, docSigners, signer } = await loadOwnedSigningContext(
    params.ownerAddress,
    input.documentId,
    input.claimToken,
  );

  if (doc.status !== "PENDING") throw new ProgrammaticApiError(409, "Document is no longer pending");

  await validateWalletSigner(signer, doc, {
    signerAddress: input.signerAddress,
    chain: input.chain,
    claimToken: input.claimToken,
    tokenGateProofs: input.tokenGateProofs,
    documentId: input.documentId,
  } as never);

  const ctx = { db, clientIp: params.clientIp, req: params.req };
  const prepared = (await prepareWalletSign(ctx, input, doc, docSigners, signer)) as PreparedWalletSignResult;

  await db
    .update(signers)
    .set({
      address: prepared.address,
      chain: input.chain,
      status: "SIGNED",
      signature: input.signature,
      signedAt: prepared.signedAt,
      scheme: prepared.scheme,
      email: prepared.signerEmail,
      handSignatureData: input.handSignatureData ?? null,
      handSignatureHash: prepared.inkHash ?? null,
      fieldValues: prepared.sanitizedFieldValues,
      lastIp: prepared.signerIp,
      ipUpdatedAt: prepared.signerIp ? prepared.signedAt : undefined,
      userAgent: prepared.userAgentStr,
      identityLevel: prepared.idResult.identityLevel,
      forensicEvidence: prepared.mergedForensicEvidence,
      forensicHash: prepared.forensic.hash,
      documentStateHash: prepared.documentStateHash,
    })
    .where(eq(signers.id, signer.id));

  await mergeMobileForensics(db, doc.id, signer, prepared.mergedForensicEvidence);

  void safeLogAudit({
    documentId: doc.id,
    eventType: "SIGNER_SIGNED",
    actor: prepared.address,
    actorType: "wallet",
    ipAddress: prepared.signerIp,
    userAgent: prepared.userAgentStr,
    metadata: {
      signMethod: "WALLET",
      chain: input.chain,
      scheme: prepared.scheme,
      signerLabel: signer.label,
      hasHandSignature: !!input.handSignatureData,
      forensicHash: prepared.forensic.hash,
      forensicFlags: prepared.forensic.data?.flags?.map((flag: { code: string }) => flag.code) ?? [],
      automationAction: prepared.forensic.outcome?.action ?? "ALLOW",
      via: "programmatic-api",
    },
  });

  await runPostSignSideEffects({
    ctx,
    doc,
    docSigners,
    signer,
    signerIp: prepared.signerIp,
    signerEmail: prepared.signerEmail,
    forensic: prepared.forensic,
    mergedForensicEvidence: prepared.mergedForensicEvidence,
    idResult: prepared.idResult,
    signData: {
      address: prepared.address,
      chain: input.chain,
      signature: input.signature,
      signedAt: prepared.signedAt,
      scheme: prepared.scheme,
      email: prepared.signerEmail,
      handSignatureData: input.handSignatureData ?? null,
      handSignatureHash: prepared.inkHash ?? null,
      fieldValues: prepared.sanitizedFieldValues,
      lastIp: prepared.signerIp,
      ipUpdatedAt: prepared.signerIp ? prepared.signedAt : null,
      userAgent: prepared.userAgentStr,
      identityLevel: prepared.idResult.identityLevel,
      forensicEvidence: prepared.mergedForensicEvidence,
      forensicHash: prepared.forensic.hash,
      documentStateHash: prepared.documentStateHash,
    },
  });

  const { allSigned } = await handlePostSignCompletion({
    db,
    doc,
    docSigners,
    justSignedId: signer.id,
    justSignedOrder: signer.signerOrder ?? 0,
  });

  return { ok: true, allSigned };
}

export async function requestProgrammaticSigningOtp(params: {
  ownerAddress: string;
  clientIp: string | null;
  input: unknown;
}) {
  const input = requestSigningOtpSchema.parse(params.input);
  const { doc, signer } = await loadOwnedSigningContext(params.ownerAddress, input.documentId, input.claimToken);

  validateEmailSigner(signer, doc);
  const branding = await resolveDocumentBranding(doc.createdBy, doc.brandingProfileId);
  const result = await safeSendSigningOtp({
    signerId: signer.id,
    email: input.email,
    documentTitle: doc.title,
    signerLabel: signer.label,
    branding,
    replyTo: branding.emailReplyTo,
  });

  void safeLogAudit({
    documentId: doc.id,
    eventType: "SIGNER_OTP_SENT",
    actor: input.email,
    actorType: "email",
    ipAddress: params.clientIp,
    metadata: { signerLabel: signer.label, via: "programmatic-api" },
  });

  return { sent: result.sent };
}

export async function signProgrammaticEmail(params: {
  ownerAddress: string;
  req: NextRequest;
  clientIp: string | null;
  input: unknown;
}) {
  const input = signEmailSchema.parse(params.input);
  const { doc, docSigners, signer } = await loadOwnedSigningContext(
    params.ownerAddress,
    input.documentId,
    input.claimToken,
  );

  if (doc.status !== "PENDING") throw new ProgrammaticApiError(409, "Document is no longer pending");
  validateEmailSigner(signer, doc);

  const otpResult = await safeVerifySigningOtp({
    signerId: signer.id,
    code: input.otpCode,
  });
  if (!otpResult.valid) {
    throw new ProgrammaticApiError(400, otpResult.reason ?? "Invalid code");
  }

  void safeLogAudit({
    documentId: doc.id,
    eventType: "SIGNER_OTP_VERIFIED",
    actor: input.email,
    actorType: "email",
    ipAddress: params.clientIp,
    metadata: { via: "programmatic-api" },
  });

  const ctx = { db, clientIp: params.clientIp, req: params.req };
  const prepared = (await prepareEmailSign(ctx, input, doc, docSigners, signer)) as PreparedEmailSignResult;

  await persistEmailSignature(db, {
    ...prepared,
    email: input.email,
    consentText: input.consentText,
    handSignatureData: input.handSignatureData,
  });
  await mergeMobileForensics(db, doc.id, signer, prepared.mergedForensicEvidence);

  void safeLogAudit({
    documentId: doc.id,
    eventType: "SIGNER_SIGNED",
    actor: input.email,
    actorType: "email",
    ipAddress: prepared.signerIp,
    userAgent: prepared.userAgentStr,
    metadata: {
      signMethod: "EMAIL_OTP",
      signerLabel: signer.label,
      consentCaptured: true,
      hasHandSignature: !!input.handSignatureData,
      forensicHash: prepared.forensic.hash,
      forensicFlags: prepared.forensic.data?.flags?.map((flag: { code: string }) => flag.code) ?? [],
      automationAction: prepared.forensic.outcome?.action ?? "ALLOW",
      via: "programmatic-api",
    },
  });

  await runEmailPostSignSideEffects({
    ctx,
    doc,
    docSigners,
    signer,
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
    db,
    doc,
    docSigners,
    justSignedId: signer.id,
    justSignedOrder: signer.signerOrder ?? 0,
  });

  return { ok: true, allSigned };
}

// ── Hybrid signing: import a physically-signed PDF as a signer's signature ──
//
// Caller provides:
//  - documentId + claimToken              identifies which signer this is
//  - signatureImage (data URL)            cropped from the scan, used as the
//                                          rendered signature in the digital view
//  - fieldValues                          form values transcribed from the scan
//                                          (same shape as digital signing)
//  - originalPdf (base64)                 the full scanned PDF, kept as proof
//
// Result: the signer is marked SIGNED with signMethod=MANUAL_IMPORT and
// signatureSource=MANUAL_PDF. NO forensic evidence is captured (the signing
// happened offline, on paper). The original scan + its hash are stored for
// later verification/download.
const importSignatureSchema = z.object({
  documentId: z.string().min(1),
  claimToken: z.string().min(1),
  /** Cropped signature image as a data URL (e.g. "data:image/png;base64,...") */
  signatureImage: z
    .string()
    .min(20)
    .refine((s) => s.startsWith("data:image/"), "signatureImage must be a data: image URL"),
  /** Form field values transcribed from the scan (same shape as digital signing) */
  fieldValues: z.record(z.string()).optional(),
  /** Full scanned PDF as base64 — stored as the integrity record for this import */
  originalPdfBase64: z
    .string()
    .min(100)
    .refine((s) => /^[A-Za-z0-9+/=\s]+$/.test(s), "originalPdfBase64 must be base64-encoded"),
  /** Optional: signer's email captured during the offline flow (for receipts) */
  signerEmail: z.string().email().optional().or(z.literal("")),
  /** Optional: explicit consent text the signer agreed to (ESIGN/UETA hygiene) */
  consentText: z.string().max(2000).optional(),
});

const MAX_IMPORTED_PDF_BYTES = 25 * 1024 * 1024; // 25MB

export async function importProgrammaticSignature(params: {
  ownerAddress: string;
  clientIp: string | null;
  input: unknown;
}) {
  const input = importSignatureSchema.parse(params.input);
  const { doc, docSigners, signer } = await loadOwnedSigningContext(
    params.ownerAddress,
    input.documentId,
    input.claimToken,
  );

  if (doc.status !== "PENDING") {
    throw new ProgrammaticApiError(409, "Document is no longer pending");
  }
  if (signer.status !== "PENDING") {
    throw new ProgrammaticApiError(409, "Signer already responded");
  }

  // Decode the PDF and bound its size before persisting.
  const pdfBytes = Buffer.from(input.originalPdfBase64, "base64");
  if (pdfBytes.byteLength === 0) {
    throw new ProgrammaticApiError(400, "originalPdfBase64 decoded to zero bytes");
  }
  if (pdfBytes.byteLength > MAX_IMPORTED_PDF_BYTES) {
    throw new ProgrammaticApiError(413, `Imported PDF exceeds the ${MAX_IMPORTED_PDF_BYTES / (1024 * 1024)}MB limit`);
  }
  // Crude PDF magic-byte check ("%PDF-")
  if (!pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new ProgrammaticApiError(400, "originalPdfBase64 does not contain a valid PDF");
  }

  // Persist the scan and get the storage record.
  const persisted = await saveImportedPdf({
    documentId: doc.id,
    signerId: signer.id,
    bytes: new Uint8Array(pdfBytes),
  });

  // Sanitize field values to the signer's declared fields (mirrors digital flow).
  const content =
    doc.encryptedAtRest && doc.encryptionKeyWrapped
      ? await decryptContent(doc.content, doc.encryptionKeyWrapped)
      : doc.content;
  const { fields: docFields } = tokenizeDocument(content, docSigners.length);
  const signerIdx = signer.signerOrder ?? docSigners.findIndex((entry) => entry.id === signer.id);
  const allowedFieldIds = new Set(
    docFields
      .filter((f) => f.signerIdx === -1 || f.signerIdx === signerIdx)
      .map((f) => f.id)
      .filter((id): id is string => Boolean(id)),
  );
  const sanitizedFieldValues: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.fieldValues ?? {})) {
    if (allowedFieldIds.has(k) && typeof v === "string") sanitizedFieldValues[k] = v;
  }

  const signedAt = new Date();
  const documentStateHash = await computeDocumentStateHash({
    contentHash: doc.contentHash,
    docSigners,
    currentSignerFieldValues: sanitizedFieldValues,
    currentSignerIndex: signerIdx,
  });
  const inkHash = await hashHandSignature(input.signatureImage);

  await db
    .update(signers)
    .set({
      status: "SIGNED",
      signedAt,
      signMethod: "MANUAL_IMPORT",
      signatureSource: "MANUAL_PDF",
      // The cropped signature image is the digital render — same column the
      // existing token renderer reads, so the contract view "just works".
      handSignatureData: input.signatureImage,
      handSignatureHash: inkHash ?? null,
      fieldValues: Object.keys(sanitizedFieldValues).length ? sanitizedFieldValues : null,
      documentStateHash,
      // Imported scan provenance.
      importedPdfUrl: persisted.url,
      importedPdfHash: persisted.hash,
      importedPdfSize: persisted.size,
      importedAt: signedAt,
      // ESIGN/UETA: store optional explicit consent the operator captured offline.
      consentText: input.consentText ?? null,
      consentAt: input.consentText ? signedAt : null,
      // Record the email if provided so post-sign confirmation can fire.
      email: input.signerEmail || signer.email,
      // Forensics: explicitly NULL — physical signing has no telemetry.
      forensicEvidence: null,
      forensicHash: null,
      lastIp: params.clientIp,
      ipUpdatedAt: params.clientIp ? signedAt : undefined,
      // Identity remains at signer's declared level (typically L1_EMAIL or L0_WALLET).
      // We do NOT upgrade — physical signing doesn't prove identity stronger than
      // however the operator collected the original signed page.
    })
    .where(eq(signers.id, signer.id));

  void safeLogAudit({
    documentId: doc.id,
    eventType: "SIGNER_SIGNED",
    actor: input.signerEmail || signer.label,
    actorType: "system",
    ipAddress: params.clientIp,
    metadata: {
      signMethod: "MANUAL_IMPORT",
      signatureSource: "MANUAL_PDF",
      signerLabel: signer.label,
      importedPdfHash: persisted.hash,
      importedPdfSize: persisted.size,
      via: "programmatic-api",
    },
  });

  const { allSigned } = await handlePostSignCompletion({
    db,
    doc,
    docSigners,
    justSignedId: signer.id,
    justSignedOrder: signer.signerOrder ?? 0,
  });

  return {
    ok: true,
    allSigned,
    signer: {
      id: signer.id,
      status: "SIGNED" as const,
      signMethod: "MANUAL_IMPORT" as const,
      signatureSource: "MANUAL_PDF" as const,
      importedPdfHash: persisted.hash,
      importedPdfSize: persisted.size,
    },
  };
}

export async function uploadProgrammaticSignerAttachment(params: {
  ownerAddress: string;
  documentId: string;
  claimToken: string;
  fieldId: string;
  file: File;
}) {
  const { doc, docSigners, signer } = await loadOwnedSigningContext(
    params.ownerAddress,
    params.documentId,
    params.claimToken,
  );

  if (signer.status !== "PENDING") {
    throw new ProgrammaticApiError(400, "Attachments can only be uploaded while signing is pending");
  }

  const content =
    doc.encryptedAtRest && doc.encryptionKeyWrapped
      ? await decryptContent(doc.content, doc.encryptionKeyWrapped)
      : doc.content;
  const { fields } = tokenizeDocument(content, docSigners.length);
  const signerIdx = signer.signerOrder ?? docSigners.findIndex((entry) => entry.id === signer.id);
  const field = fields.find((entry) => entry.id === params.fieldId);

  if (field?.type !== "file-attachment") {
    throw new ProgrammaticApiError(404, "Attachment field not found");
  }
  if (field.signerIdx !== -1 && field.signerIdx !== signerIdx) {
    throw new ProgrammaticApiError(403, "This attachment field belongs to another recipient");
  }

  const bytes = new Uint8Array(await params.file.arrayBuffer());
  const maxSizeMb = Number((field.settings as { maxSizeMb?: number } | undefined)?.maxSizeMb ?? 15);
  if (bytes.byteLength > maxSizeMb * 1024 * 1024) {
    throw new ProgrammaticApiError(400, `Attachment exceeds the ${maxSizeMb}MB limit for this field`);
  }

  const attachment = await saveSignerAttachment({
    documentId: params.documentId,
    signerId: signer.id,
    fieldId: params.fieldId,
    originalName: params.file.name,
    mimeType: params.file.type,
    bytes,
  });

  return { attachment };
}
