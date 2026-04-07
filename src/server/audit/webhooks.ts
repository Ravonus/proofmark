import { createHmac } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "~/server/db";
import { documents, signers, webhookEndpoints } from "~/server/db/schema";

type WebhookPayload = {
  eventType: string;
  documentId: string;
  occurredAt: string;
  actor: string;
  actorType: string;
  metadata?: Record<string, unknown>;
};

function signPayload(secret: string, payload: string) {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export async function dispatchDocumentWebhook(params: WebhookPayload) {
  const document = await db.query.documents.findFirst({
    where: eq(documents.id, params.documentId),
  });
  if (!document) return;

  const endpoints = await db.query.webhookEndpoints.findMany({
    where: and(eq(webhookEndpoints.ownerAddress, document.createdBy), eq(webhookEndpoints.active, true)),
  });

  if (endpoints.length === 0) return;

  const signerRows = await db.query.signers.findMany({
    where: eq(signers.documentId, params.documentId),
  });

  const payload = JSON.stringify({
    ...params,
    document: {
      id: document.id,
      title: document.title,
      status: document.status,
      proofMode: document.proofMode,
      signingOrder: document.signingOrder,
      contentHash: document.contentHash,
      createdAt: document.createdAt.toISOString(),
      expiresAt: document.expiresAt?.toISOString() ?? null,
    },
    signers: signerRows.map((signer) => ({
      id: signer.id,
      label: signer.label,
      email: signer.email,
      phone: signer.phone,
      role: signer.role,
      status: signer.status,
      signedAt: signer.signedAt?.toISOString() ?? null,
      declinedAt: signer.declinedAt?.toISOString() ?? null,
      declineReason: signer.declineReason,
    })),
  });

  for (const endpoint of endpoints) {
    if (endpoint.events.length > 0 && !endpoint.events.includes(params.eventType)) {
      continue;
    }

    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Proofmark-Event": params.eventType,
          "X-Proofmark-Delivery": endpoint.id,
          ...(endpoint.secret ? { "X-Proofmark-Signature": signPayload(endpoint.secret, payload) } : {}),
        },
        body: payload,
      });

      await db
        .update(webhookEndpoints)
        .set({
          lastTriggeredAt: new Date(),
          lastError: response.ok ? null : `HTTP ${response.status}`,
          updatedAt: new Date(),
        })
        .where(eq(webhookEndpoints.id, endpoint.id));
    } catch (error) {
      await db
        .update(webhookEndpoints)
        .set({
          lastError: error instanceof Error ? error.message : "Webhook delivery failed",
          updatedAt: new Date(),
        })
        .where(eq(webhookEndpoints.id, endpoint.id));
    }
  }
}
