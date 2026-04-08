import { and, eq } from "drizzle-orm";
import { logAuditEvent } from "~/server/crypto/rust-engine";
import { db } from "~/server/db";
import { documents, signers } from "~/server/db/schema";
import { sendSignerInvite } from "~/server/messaging/delivery";
import { advanceReminderConfig } from "~/server/workspace/workspace";

export async function runDocumentAutomationSweep(now = new Date()) {
  const pendingDocs = await db.query.documents.findMany({
    where: eq(documents.status, "PENDING"),
  });

  let expired = 0;
  let reminded = 0;

  for (const doc of pendingDocs) {
    if (doc.expiresAt && doc.expiresAt <= now) {
      await db.update(documents).set({ status: "EXPIRED" }).where(eq(documents.id, doc.id));

      await logAuditEvent({
        documentId: doc.id,
        eventType: "DOCUMENT_EXPIRED",
        actor: "system",
        actorType: "system",
        metadata: { automation: true },
      });
      expired += 1;
      continue;
    }

    if (!doc.reminderConfig || !doc.reminderConfig.enabled || !doc.reminderConfig.nextReminderAt) {
      continue;
    }

    const nextReminderAt = new Date(doc.reminderConfig.nextReminderAt);
    const sentCount = doc.reminderConfig.sentCount ?? 0;
    if (nextReminderAt > now || sentCount >= doc.reminderConfig.maxSends) {
      continue;
    }

    const pendingSigners = await db.query.signers.findMany({
      where: and(eq(signers.documentId, doc.id), eq(signers.status, "PENDING")),
    });

    const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3100";
    for (const signer of pendingSigners) {
      await sendSignerInvite({
        ownerAddress: doc.createdBy,
        brandingProfileId: doc.brandingProfileId,
        document: { title: doc.title },
        signer,
        signUrl: `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}`,
        reason: "reminder",
      });
    }

    await db
      .update(documents)
      .set({
        reminderConfig: advanceReminderConfig(doc.reminderConfig, now),
      })
      .where(eq(documents.id, doc.id));

    reminded += pendingSigners.length;
  }

  return { expired, reminded, scanned: pendingDocs.length };
}
