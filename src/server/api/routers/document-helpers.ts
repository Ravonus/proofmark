import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import {
  decodeStructuredFieldValue,
  encodeStructuredFieldValue,
  type PaymentFieldValue,
} from "~/lib/document/field-values";
import { isActionableRecipientRole } from "~/lib/signing/recipient-roles";
import { documents, type PostSignReveal, type signers, signers as signersTable } from "~/server/db/schema";

export {
  createDocumentSchema as createDocumentInput,
  documentFieldSchema as fieldInput,
  documentReminderSchema as reminderInput,
  documentSignerSchema as signerInput,
} from "~/lib/schemas/document";

import type { InlineField } from "~/lib/document/document-tokens";
import { GROUP_ROLE, getBaseUrl, type SignData } from "~/lib/signing/signing-constants";
import type { AuditLogParams } from "~/server/audit/audit";
import { evaluateIdentityVerification } from "~/server/auth/id-verification";
import { decryptDocument as decryptContent, hashDocument } from "~/server/crypto/rust-engine";
import type { db as _dbInstance } from "~/server/db";
import { findDocumentsByGroupId, findSignersByDocumentId } from "~/server/db/compat";
import type { BrandingSettings } from "~/server/db/schema";
import { resolveDocumentBranding, sendSignerInvite } from "~/server/messaging/delivery";
import { sendCompletionEmail, sendFinalizationEmail } from "~/server/messaging/email";

/** Type alias for the Drizzle database client used throughout document helpers. */
type Db = typeof _dbInstance;

// ── Safe-import wrappers (new tables may not exist before db:push) ──

export async function safeLogAudit(params: AuditLogParams) {
  try {
    const { logAuditEvent } = await import("~/server/audit/audit");
    await logAuditEvent(params);
  } catch (e) {
    console.warn("[audit] Failed to log event (run db:push?):", (e as Error).message);
  }
}

export async function safeIndexDocument(documentId: string) {
  try {
    const { indexDocument } = await import("~/server/documents/search-index");
    await indexDocument(documentId);
  } catch (e) {
    console.warn("[search-index] Failed to index (run db:push?):", (e as Error).message);
  }
}

export async function safeSendSigningOtp(params: {
  signerId: string;
  email: string;
  documentTitle: string;
  signerLabel: string;
  branding?: BrandingSettings;
  replyTo?: string;
}) {
  const { sendSigningOtp } = await import("~/server/auth/otp");
  return sendSigningOtp(params);
}

export async function safeVerifySigningOtp(params: { signerId: string; code: string }) {
  const { verifySigningOtp } = await import("~/server/auth/otp");
  return verifySigningOtp(params);
}
// ── Utility functions ──

export function generateToken(): string {
  return randomBytes(24).toString("base64url");
}

export function getActionableSigners(rows: Array<typeof signers.$inferSelect>) {
  return rows.filter((row) => isActionableRecipientRole(row.role));
}

export function getNextPendingSignerOrder(rows: Array<typeof signers.$inferSelect>, currentOrder: number) {
  const next = rows
    .filter((row) => isActionableRecipientRole(row.role) && row.status === "PENDING" && row.signerOrder > currentOrder)
    .sort((a, b) => a.signerOrder - b.signerOrder)[0];
  return next?.signerOrder ?? currentOrder;
}

export function assertPaidPaymentFields(
  fields: Array<{ id: string; type: string }>,
  fieldValues: Record<string, string> | null | undefined,
) {
  if (!fieldValues) return;
  for (const field of fields) {
    if (field.type !== "payment-request") continue;
    const payment = decodeStructuredFieldValue<PaymentFieldValue>(fieldValues[field.id]);
    if (payment?.kind !== "payment" || payment.status !== "paid") {
      throw new Error(`Payment is required for "${field.id}" before completion`);
    }
  }
}

export async function resolveDocumentContent(
  doc: Pick<typeof documents.$inferSelect, "content" | "encryptedAtRest" | "encryptionKeyWrapped">,
) {
  if (doc.encryptedAtRest && doc.encryptionKeyWrapped) {
    return await decryptContent(doc.content, doc.encryptionKeyWrapped);
  }
  return doc.content;
}

/**
 * Compute a hash that covers the document template AND all current field values.
 * Each signer's wallet signature covers this hash, proving they saw the specific
 * document state at signing time — not just the template.
 */
export async function computeDocumentStateHash(params: {
  contentHash: string;
  docSigners: Array<{ fieldValues?: Record<string, string> | null }>;
  currentSignerFieldValues?: Record<string, string> | null;
  currentSignerIndex?: number;
}): Promise<string> {
  // Collect field values from all signers, merging the current signer's
  // submitted values at their index position.
  const allFieldValues: Record<string, Record<string, string>> = {};
  for (let i = 0; i < params.docSigners.length; i++) {
    const values =
      i === params.currentSignerIndex && params.currentSignerFieldValues
        ? params.currentSignerFieldValues
        : (params.docSigners[i]!.fieldValues ?? null);
    if (values && Object.keys(values).length > 0) {
      allFieldValues[String(i)] = values;
    }
  }

  // Deterministic JSON: sort keys at every level
  const sortedOuter = Object.keys(allFieldValues).sort();
  const sorted: Record<string, Record<string, string>> = {};
  for (const key of sortedOuter) {
    const inner = allFieldValues[key]!;
    const sortedInner: Record<string, string> = {};
    for (const k of Object.keys(inner).sort()) {
      sortedInner[k] = inner[k]!;
    }
    sorted[key] = sortedInner;
  }

  const payload = params.contentHash + "|" + JSON.stringify(sorted);
  return hashDocument(payload);
}

export async function getSignerFieldContext(params: {
  doc: typeof documents.$inferSelect;
  docSigners: Array<typeof signers.$inferSelect>;
  signer: typeof signers.$inferSelect;
}) {
  const { tokenizeDocument } = await import("~/lib/document/document-tokens");
  const content = await resolveDocumentContent(params.doc);
  const { fields } = tokenizeDocument(content, params.docSigners.length);
  const signerIdx = params.signer.signerOrder ?? params.docSigners.findIndex((entry) => entry.id === params.signer.id);
  const editableFields = fields.filter((field) => field.signerIdx === signerIdx || field.signerIdx === -1);
  return { content, fields, signerIdx, editableFields };
}

export async function assertDocAccess(db: Db, docId: string, callerAddress: string) {
  const { findDocumentById } = await import("~/server/db/compat");
  const doc = await findDocumentById(db, docId);
  if (!doc) throw new Error("Document not found");

  const addr = callerAddress.toLowerCase();
  if (doc.createdBy.toLowerCase() === addr) return doc;

  const docSigners = await findSignersByDocumentId(db, docId);
  const isSigner = docSigners.some((s) => s.address?.toLowerCase() === addr);
  if (!isSigner) throw new Error("Access denied");

  return doc;
}

async function advanceSequentialOrder(
  db: Db,
  doc: typeof documents.$inferSelect,
  docSigners: Array<typeof signers.$inferSelect>,
  justSignedOrder: number,
) {
  const nextIdx = getNextPendingSignerOrder(docSigners, justSignedOrder);
  await db.update(documents).set({ currentSignerIndex: nextIdx }).where(eq(documents.id, doc.id));

  const nextSigner = docSigners.find(
    (s) => s.signerOrder === nextIdx && isActionableRecipientRole(s.role) && s.status === "PENDING",
  );
  if (nextSigner && (nextSigner.email || nextSigner.phone)) {
    const baseUrl = getBaseUrl();
    void sendSignerInvite({
      ownerAddress: doc.createdBy,
      brandingProfileId: (doc as { brandingProfileId?: string | null }).brandingProfileId ?? undefined,
      document: { title: doc.title },
      signer: {
        label: nextSigner.label,
        email: nextSigner.email,
        phone: nextSigner.phone,
        deliveryMethods:
          (nextSigner as { deliveryMethods?: Array<"EMAIL" | "SMS"> | null }).deliveryMethods ?? undefined,
      },
      signUrl: `${baseUrl}/sign/${doc.id}?claim=${nextSigner.claimToken}`,
    });
  }
}

async function notifyDisclosersIfReady(
  _db: Db,
  doc: typeof documents.$inferSelect,
  docSigners: Array<typeof signers.$inferSelect>,
  justSignedId: string,
) {
  const actionable = getActionableSigners(docSigners);
  const nonDisclosers = actionable.filter(
    (s) => (s as { groupRole?: string | null }).groupRole !== GROUP_ROLE.DISCLOSER,
  );
  const allNonDisclosersDone = nonDisclosers.every((s) => s.id === justSignedId || s.status === "SIGNED");
  const disclosersNeedingFinalization = actionable.filter((s) => {
    const role = (s as { groupRole?: string | null }).groupRole;
    const finSig = (s as { finalizationSignature?: string | null }).finalizationSignature;
    return role === GROUP_ROLE.DISCLOSER && s.status === "SIGNED" && !finSig;
  });

  if (!allNonDisclosersDone || disclosersNeedingFinalization.length === 0) return;

  const baseUrl = getBaseUrl();
  const branding = await resolveDocumentBranding(
    doc.createdBy,
    (doc as { brandingProfileId?: string | null }).brandingProfileId,
  );
  for (const discloser of disclosersNeedingFinalization) {
    if (discloser.email) {
      void sendFinalizationEmail({
        to: discloser.email,
        documentTitle: doc.title,
        signerLabel: discloser.label,
        signUrl: `${baseUrl}/sign/${doc.id}?claim=${discloser.claimToken}`,
        branding,
        replyTo: branding.emailReplyTo,
      });
    }
  }
}

/**
 * Shared post-signing completion logic: advance sequential order, mark COMPLETED
 * if all actionable signers are done, send completion email.
 */
export async function handlePostSignCompletion(params: {
  db: Db;
  doc: typeof documents.$inferSelect;
  docSigners: Array<typeof signers.$inferSelect>;
  justSignedId: string;
  justSignedOrder: number;
}) {
  const { db, doc, docSigners, justSignedId, justSignedOrder } = params;

  const allSigned = getActionableSigners(docSigners).every((s) => {
    if (s.id === justSignedId) return true;
    if (s.status !== "SIGNED") return false;
    // Discloser needs finalization signature before the contract can complete
    const groupRole = (s as { groupRole?: string | null }).groupRole;
    if (groupRole === "discloser") {
      return !!(s as { finalizationSignature?: string | null }).finalizationSignature;
    }
    return true;
  });

  if (doc.signingOrder === "sequential" && !allSigned) {
    await advanceSequentialOrder(db, doc, docSigners, justSignedOrder);
  }

  if (!allSigned) {
    await notifyDisclosersIfReady(db, doc, docSigners, justSignedId);
  }

  if (allSigned) {
    await db.update(documents).set({ status: "COMPLETED" }).where(eq(documents.id, doc.id));

    void safeLogAudit({
      documentId: doc.id,
      eventType: "DOCUMENT_COMPLETED",
      actor: "system",
      actorType: "system",
      metadata: { signerCount: docSigners.length },
    });

    void safeIndexDocument(doc.id);

    const updatedSigners = await findSignersByDocumentId(db, doc.id);
    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3100";
    const branding = await resolveDocumentBranding(doc.createdBy, doc.brandingProfileId);
    void sendCompletionEmail({
      doc,
      allSigners: updatedSigners,
      verifyUrl: `${baseUrl}/verify/${doc.contentHash}`,
      branding,
      replyTo: branding.emailReplyTo,
    });
  }

  return { allSigned };
}

async function propagateToSibling(
  db: Db,
  doc: { id: string; groupId: string | null; contentHash: string },
  siblingDoc: { id: string; contentHash: string },
  signData: SignData,
): Promise<boolean> {
  const siblingSigners = await findSignersByDocumentId(db, siblingDoc.id);
  const discloserSigner = siblingSigners.find((s) => s.groupRole === GROUP_ROLE.DISCLOSER);
  if (!discloserSigner || discloserSigner.status === "SIGNED") return false;

  const sameContent = siblingDoc.contentHash === doc.contentHash;

  if (sameContent) {
    const siblingSignerIdx = siblingSigners.findIndex((s) => s.id === discloserSigner.id);
    const siblingStateHash = await computeDocumentStateHash({
      contentHash: siblingDoc.contentHash,
      docSigners: siblingSigners,
      currentSignerFieldValues: signData.fieldValues,
      currentSignerIndex: siblingSignerIdx >= 0 ? siblingSignerIdx : undefined,
    });
    await db
      .update(signersTable)
      .set({
        address: signData.address,
        chain: signData.chain,
        status: "SIGNED",
        signature: signData.signature,
        signedAt: signData.signedAt,
        scheme: signData.scheme,
        email: signData.email,
        handSignatureData: signData.handSignatureData,
        handSignatureHash: signData.handSignatureHash,
        fieldValues: signData.fieldValues,
        lastIp: signData.lastIp,
        ipUpdatedAt: signData.ipUpdatedAt,
        userAgent: signData.userAgent,
        identityLevel: signData.identityLevel as "L0_WALLET" | "L1_EMAIL" | "L2_VERIFIED" | "L3_KYC",
        forensicEvidence: signData.forensicEvidence,
        forensicHash: signData.forensicHash,
        documentStateHash: siblingStateHash,
        consentText: signData.consentText ?? null,
        consentAt: signData.consentAt ?? null,
      })
      .where(eq(signersTable.id, discloserSigner.id));
  } else {
    await db
      .update(signersTable)
      .set({
        address: signData.address,
        chain: signData.chain,
        email: signData.email,
        fieldValues: signData.fieldValues,
        lastIp: signData.lastIp,
        ipUpdatedAt: signData.ipUpdatedAt,
        userAgent: signData.userAgent,
      })
      .where(eq(signersTable.id, discloserSigner.id));
  }

  void safeLogAudit({
    documentId: siblingDoc.id,
    eventType: sameContent ? "SIGNER_SIGNED" : "SIGNER_VIEWED",
    actor: signData.address ?? signData.email ?? "system",
    actorType: signData.address ? "wallet" : "email",
    metadata: {
      propagatedFrom: doc.id,
      groupId: doc.groupId,
      signerLabel: discloserSigner.label,
      prefillOnly: !sameContent,
    },
  });

  return true;
}

/**
 * When a "discloser" signer in a document group signs one contract, propagate
 * the exact same signature, forensic evidence, and field values to the
 * discloser's signer row on every sibling document in the group.
 */
export async function propagateGroupSignature(params: {
  db: Db;
  doc: {
    id: string;
    groupId: string | null;
    contentHash: string;
    signingOrder: string;
    brandingProfileId?: string | null;
    createdBy?: string;
  };
  signer: { id: string; groupRole: string | null };
  signData: SignData;
}): Promise<{ propagatedCount: number }> {
  const { db, doc, signer, signData } = params;

  if (!doc.groupId || signer.groupRole !== GROUP_ROLE.DISCLOSER) {
    return { propagatedCount: 0 };
  }

  const siblingDocs = await findDocumentsByGroupId(db, doc.groupId);
  let propagatedCount = 0;

  for (const siblingDoc of siblingDocs) {
    if (siblingDoc.id === doc.id) continue;
    if (siblingDoc.status !== "PENDING") continue;

    const didPropagate = await propagateToSibling(db, doc, siblingDoc, signData);
    if (didPropagate) propagatedCount++;
  }

  if (propagatedCount > 0) {
    console.warn(
      `[group] Propagated data from ${doc.id} to ${propagatedCount} sibling(s) in group ${doc.groupId} (awaiting individual signatures)`,
    );
  }

  return { propagatedCount };
}

/**
 * Evaluates identity verification fields and upgrades the signer's identity level.
 *
 * Identity levels progress from L0 (wallet only) through L3 (full KYC). If any
 * `id-verification` field is present, the signer's submitted data is scored against
 * the configured threshold. On pass, the identity level is promoted to L3_KYC and
 * the verification result is encoded into the field values for the audit trail.
 *
 * Throws if the verification score is below the threshold.
 */
type IdentityLevel = "L0_WALLET" | "L1_EMAIL" | "L2_VERIFIED" | "L3_KYC";

export function processIdentityVerification(params: {
  editableFields: InlineField[];
  sanitizedFieldValues: Record<string, string> | null;
  signerAddress?: string | null;
  signerEmail?: string | null;
  baseIdentityLevel: IdentityLevel;
}): {
  sanitizedFieldValues: Record<string, string> | null;
  identityLevel: IdentityLevel;
} {
  const { editableFields, signerAddress, signerEmail, baseIdentityLevel } = params;
  let { sanitizedFieldValues } = params;

  const idVerificationFields = editableFields.filter((field) => field.type === "id-verification");
  let identityLevel: IdentityLevel = baseIdentityLevel;

  if (idVerificationFields.length > 0) {
    const verification = evaluateIdentityVerification({
      fields: editableFields,
      fieldValues: sanitizedFieldValues ?? {},
      signerAddress: signerAddress ?? undefined,
      signerEmail: signerEmail ?? undefined,
      threshold: Number((idVerificationFields[0]?.settings as { threshold?: number } | undefined)?.threshold ?? 60),
    });

    if (verification.status !== "verified") {
      throw new Error(
        `Identity verification is required before completion (score ${verification.score}/${verification.threshold})`,
      );
    }

    const encodedVerification = encodeStructuredFieldValue(verification);
    const merged = { ...(sanitizedFieldValues ?? {}) };
    for (const field of idVerificationFields) {
      merged[field.id] = encodedVerification;
    }
    sanitizedFieldValues = merged;
    identityLevel = "L3_KYC";
  }

  return { sanitizedFieldValues, identityLevel };
}

export { type PostSignReveal };
