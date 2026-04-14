import { eq } from "drizzle-orm";
import { z } from "zod";
import { computeIpfsCid } from "~/lib/ipfs";
import {
  createDocumentSchema,
  documentReminderSchema,
  documentSignerSchema,
  documentStatusSchema,
  gazeTrackingSchema,
  postSignRevealSchema,
  proofModeSchema,
  securityModeSchema,
  signingOrderSchema,
} from "~/lib/schemas/document";
import { deriveSecurityMode } from "~/lib/signing/document-security";
import { isActionableRecipientRole } from "~/lib/signing/recipient-roles";
import { getBaseUrl } from "~/lib/signing/signing-constants";
import { normalizeSignerTokenGate } from "~/lib/token-gates";
import {
  generateToken,
  resolveDocumentContent,
  safeIndexDocument,
  safeLogAudit,
} from "~/server/api/routers/document-helpers";
import { createDocumentPacket } from "~/server/api/routers/document-packets";
import { encryptDocument as encryptContent, hashDocument, isEncryptionAvailable } from "~/server/crypto/rust-engine";
import { db } from "~/server/db";
import {
  findDocumentById,
  findDocumentsByCreator,
  findSignerByIdAndDocumentId,
  findSignersByDocumentId,
} from "~/server/db/compat";
import { documents, signers } from "~/server/db/schema";
import { generateProofPacket } from "~/server/documents/proof-packet";
import { sendSignerInvite } from "~/server/messaging/delivery";
import { createReminderConfig, getDefaultReminderChannels, normalizeOwnerAddress } from "~/server/workspace/workspace";
import { ProgrammaticApiError } from "./errors";

const baseUrl = getBaseUrl();

export const listProgrammaticDocumentsQuerySchema = z.object({
  status: documentStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const updateProgrammaticDocumentSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    content: z.string().min(1).optional(),
    createdByEmail: z.string().email().optional().or(z.literal("")),
    signers: z.array(documentSignerSchema).min(1).max(20).optional(),
    proofMode: proofModeSchema.optional(),
    securityMode: securityModeSchema.optional(),
    signingOrder: signingOrderSchema.optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
    reminder: documentReminderSchema.nullable().optional(),
    gazeTracking: gazeTrackingSchema.optional(),
    postSignReveal: postSignRevealSchema.nullable().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one field must be provided",
  })
  .refine((input) => !(input.expiresAt !== undefined && input.expiresInDays !== undefined), {
    message: "Provide either expiresAt or expiresInDays, not both",
  });

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function countSignerStatuses(docSigners: Awaited<ReturnType<typeof findSignersByDocumentId>>) {
  return {
    total: docSigners.length,
    pending: docSigners.filter((signer) => signer.status === "PENDING").length,
    signed: docSigners.filter((signer) => signer.status === "SIGNED").length,
    declined: docSigners.filter((signer) => signer.status === "DECLINED").length,
  };
}

function serializeSigner(signer: Awaited<ReturnType<typeof findSignersByDocumentId>>[number], documentId: string) {
  return {
    id: signer.id,
    label: signer.label,
    role: signer.role,
    groupRole: signer.groupRole ?? null,
    signMethod: signer.signMethod,
    status: signer.status,
    signerOrder: signer.signerOrder,
    identityLevel: signer.identityLevel,
    address: signer.address,
    chain: signer.chain,
    email: signer.email,
    phone: signer.phone,
    fields: signer.fields ?? [],
    fieldValues: signer.fieldValues ?? null,
    deliveryMethods: signer.deliveryMethods ?? [],
    tokenGates: signer.tokenGates ?? null,
    claimToken: signer.claimToken,
    signUrl: `${baseUrl}/sign/${documentId}?claim=${signer.claimToken}`,
    embedUrl: `${baseUrl}/sign/${documentId}?claim=${signer.claimToken}&embed=1`,
    signedAt: toIso(signer.signedAt),
    declinedAt: toIso(signer.declinedAt),
    declineReason: signer.declineReason ?? null,
    finalizationSignature: signer.finalizationSignature ?? null,
    finalizationSignedAt: toIso(signer.finalizationSignedAt),
  };
}

async function serializeDocumentDetail(
  doc: NonNullable<Awaited<ReturnType<typeof findDocumentById>>>,
  docSigners: Awaited<ReturnType<typeof findSignersByDocumentId>>,
) {
  const content = await resolveDocumentContent(doc);
  return {
    id: doc.id,
    title: doc.title,
    content,
    contentHash: doc.contentHash,
    accessToken: doc.accessToken,
    status: doc.status,
    createdBy: doc.createdBy,
    createdByEmail: doc.createdByEmail,
    createdAt: toIso(doc.createdAt),
    expiresAt: toIso(doc.expiresAt),
    ipfsCid: doc.ipfsCid,
    proofMode: doc.proofMode,
    securityMode: deriveSecurityMode(doc),
    signingOrder: doc.signingOrder,
    currentSignerIndex: doc.currentSignerIndex ?? 0,
    encryptedAtRest: doc.encryptedAtRest,
    gazeTracking: doc.gazeTracking,
    reminderConfig: doc.reminderConfig ?? null,
    postSignReveal: doc.postSignReveal ?? null,
    templateId: doc.templateId,
    brandingProfileId: doc.brandingProfileId,
    pdfStyleTemplateId: doc.pdfStyleTemplateId,
    groupId: doc.groupId,
    canEdit: doc.status === "PENDING" && docSigners.every((signer) => signer.status === "PENDING"),
    counts: countSignerStatuses(docSigners),
    signers: docSigners.map((signer) => serializeSigner(signer, doc.id)),
    links: {
      proof: `/api/programmatic/documents/${doc.id}/proof`,
      audit: `/api/programmatic/documents/${doc.id}/audit`,
    },
  };
}

async function serializeDocumentSummary(
  doc: NonNullable<Awaited<ReturnType<typeof findDocumentById>>>,
  docSigners: Awaited<ReturnType<typeof findSignersByDocumentId>>,
) {
  return {
    id: doc.id,
    title: doc.title,
    status: doc.status,
    createdAt: toIso(doc.createdAt),
    expiresAt: toIso(doc.expiresAt),
    proofMode: doc.proofMode,
    securityMode: deriveSecurityMode(doc),
    signingOrder: doc.signingOrder,
    counts: countSignerStatuses(docSigners),
    groupId: doc.groupId,
  };
}

async function assertOwnedDocument(ownerAddress: string, documentId: string) {
  const normalizedOwner = normalizeOwnerAddress(ownerAddress);
  const doc = await findDocumentById(db, documentId);
  if (!doc || normalizeOwnerAddress(doc.createdBy) !== normalizedOwner) {
    throw new ProgrammaticApiError(404, "Document not found");
  }
  return doc;
}

async function assertMutablePendingDocument(ownerAddress: string, documentId: string) {
  const doc = await assertOwnedDocument(ownerAddress, documentId);
  const docSigners = await findSignersByDocumentId(db, documentId);

  if (doc.status !== "PENDING") {
    throw new ProgrammaticApiError(409, "Only pending documents can be edited");
  }

  if (docSigners.some((signer) => signer.status !== "PENDING")) {
    throw new ProgrammaticApiError(409, "This document already has signer activity and can no longer be edited");
  }

  return { doc, docSigners };
}

function resolveCurrentSignerIndex(
  signingOrder: "parallel" | "sequential",
  docSigners: Array<{ signerOrder: number; role: string }>,
) {
  if (signingOrder !== "sequential") return 0;
  const firstActionable = docSigners
    .filter((signer) => isActionableRecipientRole(signer.role))
    .sort((left, right) => left.signerOrder - right.signerOrder)[0];
  return firstActionable?.signerOrder ?? 0;
}

async function prepareStoredContent(
  content: string,
  securityMode: "HASH_ONLY" | "ENCRYPTED_PRIVATE" | "ENCRYPTED_IPFS",
) {
  if (securityMode === "HASH_ONLY") {
    return {
      storedContent: content,
      encryptedAtRest: false,
      encryptionKeyWrapped: null,
      ipfsCid: null,
    };
  }

  if (!isEncryptionAvailable()) {
    throw new ProgrammaticApiError(503, "Encrypted storage is not configured for this workspace yet.");
  }

  const encrypted = await encryptContent(content);
  if (!encrypted) {
    throw new ProgrammaticApiError(500, "Failed to encrypt document content");
  }

  const ipfsCid = securityMode === "ENCRYPTED_IPFS" ? await computeIpfsCid(encrypted.encryptedContent) : null;
  return {
    storedContent: encrypted.encryptedContent,
    encryptedAtRest: true,
    encryptionKeyWrapped: encrypted.wrappedKey,
    ipfsCid,
  };
}

function buildSignerRows(documentId: string, inputSigners: z.infer<typeof createDocumentSchema>["signers"]) {
  return inputSigners.map((signer, index) => {
    const email = signer.email?.trim() || null;
    const phone = signer.phone?.trim() || null;
    const deliveryMethods = signer.deliveryMethods?.length
      ? signer.deliveryMethods
      : getDefaultReminderChannels(email, phone);

    return {
      documentId,
      label: signer.label,
      email,
      phone,
      fields: (signer.fields ?? null) as (typeof signers.$inferInsert)["fields"],
      tokenGates: normalizeSignerTokenGate(signer.tokenGates),
      claimToken: generateToken(),
      signMethod: signer.signMethod,
      signerOrder: index,
      identityLevel: signer.signMethod === "EMAIL_OTP" ? ("L1_EMAIL" as const) : ("L0_WALLET" as const),
      deliveryMethods,
      role: signer.role,
      groupRole: null,
    };
  });
}

function rememberAuditFields(input: z.infer<typeof updateProgrammaticDocumentSchema>) {
  return Object.keys(input).sort();
}

async function sendInvitesForDocument(
  doc: {
    id: string;
    title: string;
    createdBy: string;
    brandingProfileId: string | null;
    signingOrder: string;
  },
  docSigners: Awaited<ReturnType<typeof findSignersByDocumentId>>,
) {
  const firstActionableOrder =
    doc.signingOrder === "sequential"
      ? (docSigners
          .filter((signer) => isActionableRecipientRole(signer.role))
          .sort((left, right) => left.signerOrder - right.signerOrder)[0]?.signerOrder ?? 0)
      : null;

  for (const signer of docSigners) {
    if (firstActionableOrder !== null && signer.signerOrder > firstActionableOrder) {
      continue;
    }

    if (!signer.email && !signer.phone) {
      continue;
    }

    void sendSignerInvite({
      ownerAddress: doc.createdBy,
      brandingProfileId: doc.brandingProfileId,
      document: doc,
      signer,
      signUrl: `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}`,
    });
  }
}

export async function listOwnedDocuments(
  ownerAddress: string,
  input: z.infer<typeof listProgrammaticDocumentsQuerySchema>,
) {
  const normalizedOwner = normalizeOwnerAddress(ownerAddress);
  const docs = await findDocumentsByCreator(db, normalizedOwner);
  const filtered = input.status ? docs.filter((doc) => doc.status === input.status) : docs;
  const limited = filtered.slice(0, input.limit);

  const serialized = [];
  for (const doc of limited) {
    const docSigners = await findSignersByDocumentId(db, doc.id);
    serialized.push(await serializeDocumentSummary(doc, docSigners));
  }

  return {
    count: serialized.length,
    documents: serialized,
  };
}

export async function getOwnedDocument(ownerAddress: string, documentId: string) {
  const doc = await assertOwnedDocument(ownerAddress, documentId);
  const docSigners = await findSignersByDocumentId(db, documentId);
  return serializeDocumentDetail(doc, docSigners);
}

export async function createOwnedDocument(params: {
  ownerAddress: string;
  userId?: string | null;
  clientIp?: string | null;
  input: z.infer<typeof createDocumentSchema>;
}) {
  const normalizedOwner = normalizeOwnerAddress(params.ownerAddress);
  const { doc } = await createDocumentPacket(
    {
      db,
      clientIp: params.clientIp ?? null,
      req: undefined,
      session: {
        address: normalizedOwner,
        chain: "ETH",
        userId: params.userId ?? null,
      },
      sessionToken: null,
      apiKeyAuth: null,
    } as Parameters<typeof createDocumentPacket>[0],
    params.input,
  );

  return getOwnedDocument(normalizedOwner, doc.id);
}

export async function updateOwnedDocument(params: {
  ownerAddress: string;
  documentId: string;
  clientIp?: string | null;
  input: z.infer<typeof updateProgrammaticDocumentSchema>;
}) {
  const normalizedOwner = normalizeOwnerAddress(params.ownerAddress);
  const { doc, docSigners } = await assertMutablePendingDocument(normalizedOwner, params.documentId);

  const nextPlainContent =
    params.input.content ??
    (params.input.securityMode
      ? await resolveDocumentContent(doc)
      : doc.encryptedAtRest
        ? await resolveDocumentContent(doc)
        : doc.content);
  const nextSecurityMode = params.input.securityMode ?? deriveSecurityMode(doc);
  const shouldRewriteContent = params.input.content !== undefined || params.input.securityMode !== undefined;
  const preparedContent = shouldRewriteContent
    ? await prepareStoredContent(nextPlainContent, nextSecurityMode)
    : {
        storedContent: doc.content,
        encryptedAtRest: doc.encryptedAtRest,
        encryptionKeyWrapped: doc.encryptionKeyWrapped,
        ipfsCid: doc.ipfsCid,
      };

  const nextReminderConfig =
    params.input.reminder === undefined
      ? (doc.reminderConfig ?? null)
      : params.input.reminder
        ? createReminderConfig(params.input.reminder.cadence, params.input.reminder.channels)
        : null;

  const nextExpiresAt =
    params.input.expiresAt !== undefined
      ? params.input.expiresAt
        ? new Date(params.input.expiresAt)
        : null
      : params.input.expiresInDays !== undefined
        ? params.input.expiresInDays === null
          ? null
          : new Date(Date.now() + params.input.expiresInDays * 24 * 60 * 60 * 1000)
        : doc.expiresAt;

  const nextSigningOrder = params.input.signingOrder ?? (doc.signingOrder as "parallel" | "sequential");
  const signerRows = params.input.signers ? buildSignerRows(doc.id, params.input.signers) : null;
  const nextCurrentSignerIndex = resolveCurrentSignerIndex(
    nextSigningOrder,
    signerRows ?? docSigners.map((signer) => ({ signerOrder: signer.signerOrder, role: signer.role })),
  );

  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({
        title: params.input.title ?? doc.title,
        content: preparedContent.storedContent,
        contentHash: shouldRewriteContent ? await hashDocument(`${nextPlainContent}\n${Date.now()}`) : doc.contentHash,
        createdByEmail:
          params.input.createdByEmail !== undefined ? params.input.createdByEmail || null : doc.createdByEmail,
        expiresAt: nextExpiresAt,
        ipfsCid: preparedContent.ipfsCid,
        postSignReveal:
          params.input.postSignReveal === undefined ? (doc.postSignReveal ?? null) : params.input.postSignReveal,
        proofMode: params.input.proofMode ?? doc.proofMode,
        signingOrder: nextSigningOrder,
        currentSignerIndex: nextCurrentSignerIndex,
        encryptedAtRest: preparedContent.encryptedAtRest,
        encryptionKeyWrapped: preparedContent.encryptionKeyWrapped,
        gazeTracking: params.input.gazeTracking ?? doc.gazeTracking,
        reminderConfig: nextReminderConfig,
      })
      .where(eq(documents.id, doc.id));

    if (signerRows) {
      await tx.delete(signers).where(eq(signers.documentId, doc.id));
      await tx.insert(signers).values(signerRows);
    }
  });

  const updatedDoc = await findDocumentById(db, doc.id);
  if (!updatedDoc) {
    throw new ProgrammaticApiError(500, "Document update succeeded but the document could not be reloaded");
  }

  const updatedSigners = await findSignersByDocumentId(db, doc.id);

  if (signerRows) {
    await sendInvitesForDocument(
      {
        id: updatedDoc.id,
        title: updatedDoc.title,
        createdBy: updatedDoc.createdBy,
        brandingProfileId: updatedDoc.brandingProfileId,
        signingOrder: updatedDoc.signingOrder,
      },
      updatedSigners,
    );
  }

  void safeLogAudit({
    documentId: doc.id,
    eventType: "DOCUMENT_UPDATED" as never,
    actor: normalizedOwner,
    actorType: "wallet",
    ipAddress: params.clientIp ?? null,
    metadata: {
      changedFields: rememberAuditFields(params.input),
      signerCount: updatedSigners.length,
      via: "programmatic-api",
    },
  });
  void safeIndexDocument(doc.id);

  return serializeDocumentDetail(updatedDoc, updatedSigners);
}

export async function getOwnedDocumentProof(ownerAddress: string, documentId: string) {
  await assertOwnedDocument(ownerAddress, documentId);
  const { manifest, pdf } = await generateProofPacket(documentId);
  return {
    documentId,
    manifest,
    pdfBase64: pdf.toString("base64"),
  };
}

export async function getOwnedDocumentAudit(ownerAddress: string, documentId: string) {
  await assertOwnedDocument(ownerAddress, documentId);

  const { getAuditTrail, verifyAuditChain } = await import("~/server/audit/audit");
  const events = await getAuditTrail(documentId);
  const chain = await verifyAuditChain(documentId);

  return {
    documentId,
    chainValid: chain.valid,
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      actor: event.actor,
      actorType: event.actorType,
      ipAddress: event.ipAddress,
      userAgent: event.userAgent,
      metadata: event.metadata,
      eventHash: event.eventHash,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export async function voidOwnedDocument(params: {
  ownerAddress: string;
  documentId: string;
  clientIp?: string | null;
  reason?: string | null;
}) {
  const normalizedOwner = normalizeOwnerAddress(params.ownerAddress);
  const doc = await assertOwnedDocument(normalizedOwner, params.documentId);

  if (doc.status !== "PENDING") {
    throw new ProgrammaticApiError(409, "Only pending documents can be voided");
  }

  await db.update(documents).set({ status: "VOIDED" }).where(eq(documents.id, doc.id));

  void safeLogAudit({
    documentId: doc.id,
    eventType: "DOCUMENT_VOIDED",
    actor: normalizedOwner,
    actorType: "wallet",
    ipAddress: params.clientIp ?? null,
    metadata: { reason: params.reason ?? null, via: "programmatic-api" },
  });

  return {
    ok: true,
    documentId: doc.id,
    status: "VOIDED" as const,
  };
}

export async function resendOwnedSignerInvite(params: {
  ownerAddress: string;
  documentId: string;
  signerId: string;
  clientIp?: string | null;
}) {
  const normalizedOwner = normalizeOwnerAddress(params.ownerAddress);
  const doc = await assertOwnedDocument(normalizedOwner, params.documentId);
  const signer = await findSignerByIdAndDocumentId(db, params.signerId, params.documentId);

  if (!signer) {
    throw new ProgrammaticApiError(404, "Signer not found");
  }
  if (signer.status !== "PENDING") {
    throw new ProgrammaticApiError(409, "Signer already responded");
  }
  if (!signer.email && !signer.phone) {
    throw new ProgrammaticApiError(400, "Signer has no delivery address");
  }

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
    ipAddress: params.clientIp ?? null,
    metadata: {
      signerLabel: signer.label,
      deliveryMethods: signer.deliveryMethods ?? [],
      resend: true,
      via: "programmatic-api",
    },
  });

  return {
    ok: true,
    signer: serializeSigner(signer, doc.id),
  };
}
