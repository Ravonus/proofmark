// @ts-nocheck -- tRPC context types break type inference across router files
/* eslint-disable @typescript-eslint/consistent-type-imports, @typescript-eslint/no-duplicate-type-constituents, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
/**
 * createDocumentPacket — extracted from document.ts for file-length + complexity compliance.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { normalizeDocumentAutomationPolicy } from "~/lib/forensic/premium";
import { computeIpfsCid } from "~/lib/ipfs";
import { isActionableRecipientRole } from "~/lib/signing/recipient-roles";
import { getBaseUrl } from "~/lib/signing/signing-constants";
import { getSignerTokenGateChains, normalizeSignerTokenGate } from "~/lib/token-gates";
import type { createTRPCContext } from "~/server/api/trpc";
import { checkDocumentCreationLimit } from "~/server/billing/gate";
import { encryptDocument as encryptContent, hashDocument, isEncryptionAvailable } from "~/server/crypto/rust-engine";
import { insertDocumentCompat, insertSignersCompat, isSchemaDriftError } from "~/server/db/compat";
import { documents, documentTemplates, type ReminderConfig, signers } from "~/server/db/schema";
import { sendSignerInvite } from "~/server/messaging/delivery";
import { safeFireEmail } from "~/server/messaging/email";
import { createReminderConfig, normalizeOwnerAddress } from "~/server/workspace/workspace";
import { onDocumentCreated } from "~/server/hooks/affiliate-hooks";
import { signMessageAsAdmin } from "~/server/system-wallet/admin-signer";
import { buildSigningMessage } from "~/server/crypto/rust-engine";
import { createDocumentInput, generateToken, safeIndexDocument, safeLogAudit } from "./document-helpers";

export function requiresTokenGateWalletProofs(gate: Parameters<typeof normalizeSignerTokenGate>[0]): boolean {
  const normalized = normalizeSignerTokenGate(gate);
  if (!normalized) return false;
  return normalized.devBypass || getSignerTokenGateChains(normalized).length > 1;
}

/**
 * Build encrypted content if needed, create document + signers rows, send invites.
 * Extracted as a standalone function to reduce per-procedure complexity.
 */
export async function createDocumentPacket(
  ctx: Awaited<ReturnType<typeof createTRPCContext>> & {
    session: { address: string; chain: string };
  },
  input: z.infer<typeof createDocumentInput>,
  groupOptions?: {
    groupId: string;
    signerGroupRoles: Array<string | null>;
  },
) {
  const ownerAddress = normalizeOwnerAddress(ctx.session.address);

  // ── Check billing limits before creating ──

  await checkDocumentCreationLimit(ctx.session.userId ?? undefined, ctx.session.address);

  // ── Validate template (early return) ──
  if (input.templateId) {
    await validateTemplate(ctx.db, input.templateId, ownerAddress);
  }

  // ── Content hash + encryption ──
  // Standalone docs salt the hash with the creation time so two docs
  // with identical text still get distinct hashes. GROUP siblings must
  // do the OPPOSITE: every sibling of a shared-NDA group needs the SAME
  // contentHash so the discloser's wallet signature (which is bound to
  // documentStateHash = hash(contentHash + fieldValues)) verifies on
  // every sibling and can be cloned to recipients added later — i.e.
  // the discloser signs ONCE for the whole group. We salt grouped docs
  // with the stable groupId instead of Date.now() so all siblings
  // (initial + added via PATCH /groups) share a contentHash. At
  // discloser-sign time the recipient slots are empty, so field values
  // don't perturb the hash across siblings.
  const hashSalt = groupOptions?.groupId ?? Date.now().toString();
  const contentHash = await hashDocument(input.content + "\n" + hashSalt);
  const accessToken = generateToken();
  const { storedContent, encryptedAtRest, encryptionKeyWrapped } = await prepareContent(
    input.content,
    input.securityMode,
  );
  const ipfsCid = input.securityMode === "ENCRYPTED_IPFS" ? await computeIpfsCid(storedContent) : null;

  // ── Reminder config ──
  const reminderConfig: ReminderConfig | null = input.reminder
    ? createReminderConfig(input.reminder.cadence, input.reminder.channels)
    : null;

  // ── Insert document ──
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

  // ── Insert signers ──
  const insertedSigners = await insertSignerRows(ctx.db, doc, input, groupOptions);

  // ── Auto-sign any slot flagged useAdminWallet=true ──
  // Loads the org's custodial wallet (admin@agorix.io), builds the
  // canonical signing message the rust engine emits for browser-sign,
  // signs via personalSign, and writes the result back onto the signer
  // row. Recipients now see "signed by the org" the moment the contract
  // loads — no host-side wallet popup at creation time.
  await autoSignAdminSlots(ctx.db, doc, input, insertedSigners);

  // ── Advance sequential signing pointer ──
  await maybeAdvanceSequentialPointer(ctx.db, doc, insertedSigners);

  // ── Audit + index ──
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

  // ── Send invites (opt-in) ──
  // Auto-invites only fire when explicitly requested via input.sendInvites.
  // Default behavior: creator gets sign URLs back and shares them however
  // they want (link, SMS, in-person QR, etc). The contract isn't tied to
  // an email until the signer provides one (typically as a contract field).
  if (input.sendInvites === true) {
    await sendSignerInvites(doc, insertedSigners, input, ownerAddress);
  }

  // ── Affiliate tracking ──
  void onDocumentCreated(doc.id);

  return { doc, contentHash, accessToken, insertedSigners, reminderConfig };
}

// ── Internal helpers ──────────────────────────────────────────────────────

async function validateTemplate(
  db: Awaited<ReturnType<typeof createTRPCContext>>["db"],
  templateId: string,
  ownerAddress: string,
) {
  let template;
  try {
    template = await db.query.documentTemplates.findFirst({
      where: and(eq(documentTemplates.id, templateId), eq(documentTemplates.ownerAddress, ownerAddress)),
    });
  } catch (error) {
    if (!isSchemaDriftError(error)) throw error;
    throw new Error("Templates are not available until the latest database migration is applied");
  }
  if (!template) throw new Error("Template not found");
}

async function prepareContent(
  content: string,
  securityMode: string,
): Promise<{
  storedContent: string;
  encryptedAtRest: boolean;
  encryptionKeyWrapped: string | null;
}> {
  if (securityMode === "HASH_ONLY") {
    return {
      storedContent: content,
      encryptedAtRest: false,
      encryptionKeyWrapped: null,
    };
  }
  if (!isEncryptionAvailable()) {
    throw new Error("Encrypted storage is not configured for this workspace yet.");
  }
  const enc = await encryptContent(content);
  if (!enc) throw new Error("Failed to encrypt document content.");
  return {
    storedContent: enc.encryptedContent,
    encryptedAtRest: true,
    encryptionKeyWrapped: enc.wrappedKey,
  };
}

async function insertSignerRows(
  db: Awaited<ReturnType<typeof createTRPCContext>>["db"],
  doc: { id: string },
  input: z.infer<typeof createDocumentInput>,
  groupOptions?: { signerGroupRoles: Array<string | null> } | undefined,
) {
  const { getDefaultReminderChannels } = await import("~/server/workspace/workspace");
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

  return await insertSignersCompat(db, signerRows);
}

async function maybeAdvanceSequentialPointer(
  db: Awaited<ReturnType<typeof createTRPCContext>>["db"],
  doc: { id: string; signingOrder: string; currentSignerIndex: number | null },
  insertedSigners: Array<{ signerOrder: number; role: string }>,
) {
  if (doc.signingOrder !== "sequential") return;

  const firstActionable = insertedSigners
    .filter((row) => isActionableRecipientRole(row.role))
    .sort((a, b) => a.signerOrder - b.signerOrder)[0];

  if (firstActionable && firstActionable.signerOrder !== (doc.currentSignerIndex ?? 0)) {
    await db.update(documents).set({ currentSignerIndex: firstActionable.signerOrder }).where(eq(documents.id, doc.id));
    doc.currentSignerIndex = firstActionable.signerOrder;
  }
}

async function sendSignerInvites(
  doc: { id: string; brandingProfileId: string | null; signingOrder?: string },
  insertedSigners: Array<{
    id: string;
    label: string;
    email: string | null;
    phone: string | null;
    claimToken: string;
    signMethod: string;
    signerOrder: number;
    deliveryMethods: unknown;
    role: string;
    tokenGates: unknown;
  }>,
  input: { signingOrder: string },
  ownerAddress: string,
) {
  const baseUrl = getBaseUrl();
  const firstActionableOrder =
    input.signingOrder === "sequential"
      ? (insertedSigners
          .filter((s) => isActionableRecipientRole(s.role))
          .sort((a, b) => a.signerOrder - b.signerOrder)[0]?.signerOrder ?? 0)
      : null;

  for (const signer of insertedSigners) {
    if (firstActionableOrder !== null && signer.signerOrder > firstActionableOrder) continue;

    if (signer.email || signer.phone) {
      // SMTP/transport failures must NEVER kill the Lambda runtime.
      safeFireEmail(
        sendSignerInvite({
          ownerAddress,
          brandingProfileId: doc.brandingProfileId,
          document: doc,
          signer,
          signUrl: `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}`,
        }),
        "sendSignerInvite (createDocumentPacket)",
      );

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
}

/** For each signer flagged `useAdminWallet=true` in the original input,
 *  pre-sign with the org's custodial wallet so the row lands SIGNED at
 *  creation time. The signing message is the canonical one the rust
 *  engine emits (so verifyMessage on the verifier side gets the same
 *  recovered address as a browser-sign would). Best-effort — a missing
 *  sealed key or load failure logs but doesn't abort document creation;
 *  the row just stays PENDING and the host can wallet-sign manually
 *  later. */
async function autoSignAdminSlots(db, doc, input, insertedSigners) {
  if (!Array.isArray(input.signers) || input.signers.length === 0) return;
  // Map input order → inserted row (same iteration order as insertSignerRows).
  for (let idx = 0; idx < input.signers.length; idx++) {
    const requested = input.signers[idx];
    if (!requested?.useAdminWallet) continue;
    const row = insertedSigners[idx];
    if (!row) continue;
    try {
      const message = await buildSigningMessage({
        documentTitle: doc.title,
        contentHash: doc.contentHash,
        signerLabel: row.label,
        // Address is filled in by the signer; we sign with whatever the
        // admin wallet resolves to. The rust engine's message embeds
        // the supplied address so we need to know it before signing.
        signerAddress: undefined,
        handSignatureHash: undefined,
      });
      const signed = await signMessageAsAdmin(message);
      if (!signed) {
        console.warn(`[autoSignAdminSlots] admin wallet unavailable; ${row.label} stays PENDING`);
        continue;
      }
      // Rebuild the message with the resolved admin address so the
      // signature we just produced verifies against the message we
      // store on the audit trail.
      const messageWithAddr = await buildSigningMessage({
        documentTitle: doc.title,
        contentHash: doc.contentHash,
        signerLabel: row.label,
        signerAddress: signed.address,
        handSignatureHash: undefined,
      });
      const finalSig = (await signMessageAsAdmin(messageWithAddr)) ?? signed;
      await db
        .update(signers)
        .set({
          address: finalSig.address,
          chain: finalSig.chain,
          signature: finalSig.signature,
          signedAt: new Date(),
          scheme: "personal-sign:eth",
          status: "SIGNED",
          identityLevel: "L0_WALLET",
        })
        .where(eq(signers.id, row.id));
      void safeLogAudit({
        documentId: doc.id,
        eventType: "SIGNER_SIGNED",
        actor: finalSig.address,
        actorType: "wallet",
        metadata: {
          signerLabel: row.label,
          via: "admin-custodial-wallet",
          reason: "createDocumentPacket auto-sign",
        },
      });
    } catch (err) {
      console.warn(`[autoSignAdminSlots] sign failed for ${row.label}:`, err?.message ?? err);
    }
  }
}
