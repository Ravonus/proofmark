/**
 * Immutable audit trail system.
 *
 * Every significant action on a document is logged as an append-only
 * event with a chained hash for tamper detection. Each event's hash
 * includes the previous event's hash, creating a verifiable chain.
 *
 * Hash chain: eventHash = SHA-256(prevEventHash + eventType + actor + timestamp + metadata)
 */

import { createHash } from "crypto";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { dispatchDocumentWebhook } from "~/server/audit/webhooks";
import { db } from "~/server/db";
import { auditEvents } from "~/server/db/schema";
import { createId } from "~/server/db/utils";

export const auditEventTypeSchema = z.enum([
  "DOCUMENT_CREATED",
  "DOCUMENT_VIEWED",
  "DOCUMENT_COMPLETED",
  "DOCUMENT_VOIDED",
  "DOCUMENT_EXPIRED",
  "SIGNER_INVITED",
  "SIGNER_VIEWED",
  "SIGNER_SIGNED",
  "SIGNER_DECLINED",
  "SIGNER_OTP_SENT",
  "SIGNER_OTP_VERIFIED",
  "SIGNATURE_VERIFIED",
  "PROOF_PACKET_GENERATED",
  "AUDIT_HASH_ANCHORED",
  "ACCESS_REFRESHED",
]);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

export const auditLogParamsSchema = z.object({
  documentId: z.string(),
  eventType: auditEventTypeSchema,
  actor: z.string(),
  actorType: z.enum(["wallet", "email", "system"]).optional(),
  ipAddress: z.string().nullish(),
  userAgent: z.string().nullish(),
  metadata: z.record(z.unknown()).optional(),
});
export type AuditLogParams = z.infer<typeof auditLogParamsSchema>;

/**
 * Compute a chained hash for tamper detection.
 * Each event's hash includes the previous event's hash.
 */
function computeEventHash(
  prevHash: string | null,
  eventType: string,
  actor: string,
  timestamp: string,
  metadata?: Record<string, unknown>,
): string {
  const payload = JSON.stringify({
    prev: prevHash ?? "genesis",
    type: eventType,
    actor,
    ts: timestamp,
    meta: metadata ?? {},
  });
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Append an audit event to the immutable log.
 * Returns the event ID and hash.
 */
export async function logAuditEvent(params: AuditLogParams): Promise<{
  eventId: string;
  eventHash: string;
}> {
  // Get the latest event for this document to chain the hash
  const [lastEvent] = await db
    .select({ eventHash: auditEvents.eventHash })
    .from(auditEvents)
    .where(eq(auditEvents.documentId, params.documentId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);

  const now = new Date();
  const eventHash = computeEventHash(
    lastEvent?.eventHash ?? null,
    params.eventType,
    params.actor,
    now.toISOString(),
    params.metadata,
  );

  const eventId = createId();

  await db.insert(auditEvents).values({
    id: eventId,
    documentId: params.documentId,
    eventType: params.eventType,
    actor: params.actor,
    actorType: params.actorType ?? "wallet",
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    metadata: params.metadata ?? null,
    eventHash,
    prevEventHash: lastEvent?.eventHash ?? null,
    createdAt: now,
  });

  try {
    await dispatchDocumentWebhook({
      eventType: params.eventType,
      documentId: params.documentId,
      occurredAt: now.toISOString(),
      actor: params.actor,
      actorType: params.actorType ?? "wallet",
      metadata: params.metadata,
    });
  } catch (error) {
    console.warn("[audit] webhook dispatch failed:", error);
  }

  return { eventId, eventHash };
}

/**
 * Get the full audit trail for a document.
 */
export async function getAuditTrail(documentId: string) {
  return db.select().from(auditEvents).where(eq(auditEvents.documentId, documentId)).orderBy(auditEvents.createdAt);
}

/**
 * Verify the integrity of a document's audit chain.
 * Returns true if all hashes are valid and sequential.
 */
export async function verifyAuditChain(documentId: string): Promise<{ valid: boolean; brokenAt?: number }> {
  const events = await getAuditTrail(documentId);
  if (events.length === 0) return { valid: true };

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const prevEvent = i === 0 ? undefined : events[i - 1];
    const expectedPrev = prevEvent ? prevEvent.eventHash : null;

    if (event.prevEventHash !== expectedPrev) {
      return { valid: false, brokenAt: i };
    }

    const expectedHash = computeEventHash(
      expectedPrev,
      event.eventType,
      event.actor,
      event.createdAt.toISOString(),
      event.metadata as Record<string, unknown> | undefined,
    );

    if (event.eventHash !== expectedHash) {
      return { valid: false, brokenAt: i };
    }
  }

  return { valid: true };
}

/**
 * Compute a summary hash of the entire audit trail for a document.
 * This is what gets anchored on-chain for tamper-proof verification.
 */
export async function computeAuditTrailHash(documentId: string): Promise<string> {
  const events = await getAuditTrail(documentId);
  if (events.length === 0) return createHash("sha256").update("empty").digest("hex");

  // The last event's hash already chains all previous events
  return events[events.length - 1]!.eventHash;
}
