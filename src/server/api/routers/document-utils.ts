// @ts-nocheck -- tRPC context types break type inference across router files
/* eslint-disable @typescript-eslint/consistent-type-imports */
/**
 * Shared types, schemas, and helper functions for document router procedures.
 * Extracted from document.ts for file-length compliance.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  type DocumentAutomationPolicy,
  type EnhancedForensicEvidence,
  normalizeDocumentAutomationPolicy,
} from "~/lib/forensic/premium";
import type { PersistedForensicSessionCapture } from "~/lib/forensic/session";
import type { BehavioralSignals, ClientFingerprint } from "~/lib/forensic/types";
import { logger } from "~/lib/utils/logger";
import type { createTRPCContext } from "~/server/api/trpc";
import { resolveUnifiedRequestIdentity, type UnifiedRequestIdentity } from "~/server/auth/auth-identity";
import { assembleForensicEvidence } from "~/server/crypto/rust-engine";
import { isSchemaDriftError } from "~/server/db/compat";
import { auditEvents, documents } from "~/server/db/schema";
import { enrichForensicEvidence } from "~/server/forensic/forensic-proof";
import { resolveDocumentBranding } from "~/server/messaging/delivery";
import { sendAutomationAlertEmail } from "~/server/messaging/email";

/** Zod schema for client-side forensic data sent with sign requests */
export const forensicInputSchema = z
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

export type ForensicInputPayload = {
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

export function isPersistedForensicSessionCapture(value: unknown): value is PersistedForensicSessionCapture {
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

export function normalizePriorForensicSessions(value: unknown): PersistedForensicSessionCapture[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPersistedForensicSessionCapture);
}

export function mergeForensicSessionCaptures(
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

export async function requireUnifiedIdentity(ctx: Awaited<ReturnType<typeof createTRPCContext>>) {
  const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
  if (!identity.authSession && !identity.walletSession) {
    throw new Error("Not signed in");
  }
  return identity;
}

export function getIdentityActor(identity: UnifiedRequestIdentity) {
  const actor = identity.walletSession?.address?.toLowerCase() ?? identity.email ?? "system";
  const actorType: "wallet" | "email" | "system" = identity.walletSession
    ? "wallet"
    : identity.email
      ? "email"
      : "system";
  return { actor, actorType };
}

/** Collect forensic evidence from sign request (non-blocking). */
export async function collectForensicEvidence(
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
    return {
      data: evidence,
      hash,
      review: evidence.automationReview ?? null,
      outcome: evidence.policyOutcome ?? null,
    };
  } catch (err) {
    logger.warn("forensic", `Failed to assemble forensic evidence: ${String(err)}`);
    return { data: null, hash: null, review: null, outcome: null };
  }
}

export async function loadDocumentAutomationPolicy(
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

export async function maybeNotifyCreatorOfAutomationReview(params: {
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
