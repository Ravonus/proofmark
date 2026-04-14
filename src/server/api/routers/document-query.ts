// @ts-nocheck -- tRPC context types break type inference across router files
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * Document query procedures: get, getForensicReplay, saveForensicSession,
 * claimDocuments, checkVerificationSessions, listByAddress.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { EnhancedForensicEvidence } from "~/lib/forensic/premium";
import { extractReplaySignatureAnalysis } from "~/lib/forensic/signature-analysis";
import { isActionableRecipientRole } from "~/lib/signing/recipient-roles";
import { getBaseUrl, VERIFY_FIELD_TYPES } from "~/lib/signing/signing-constants";
import { authedProcedure, createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { resolveUnifiedRequestIdentity } from "~/server/auth/auth-identity";
import { decryptDocument as decryptContent } from "~/server/crypto/rust-engine";
import { evaluateSignerTokenGate } from "~/server/crypto/token-gates";
import {
  findDocumentById,
  findDocumentsByCreator,
  findSignersByAddress,
  findSignersByDocumentId,
} from "~/server/db/compat";
import { documents, signers } from "~/server/db/schema";
import { resolveDocumentViewerAccess } from "~/server/documents/document-access";
import { safeLogAudit } from "./document-helpers";
import { requireUnifiedIdentity } from "./document-utils";

/** Extract forensic flags from signer evidence. */
function getForensicFlags(evidence: unknown): Array<{ code: string; severity: string; message: string }> {
  return (
    (
      evidence as {
        flags?: Array<{ code: string; severity: string; message: string }>;
      } | null
    )?.flags ?? []
  );
}

/** Extract geo data from signer evidence. */
function getForensicGeo(evidence: unknown) {
  return (
    (
      evidence as {
        geo?: {
          city?: string;
          region?: string;
          country?: string;
          isVpn?: boolean;
          isProxy?: boolean;
          isTor?: boolean;
        } | null;
      } | null
    )?.geo ?? null
  );
}

/** Resolve whether a signer can sign based on ordering rules. */
function resolveCanSign(
  role: string,
  isSequential: boolean,
  signerOrder: number,
  currentIndex: number | null,
): boolean {
  if (!isActionableRecipientRole(role)) return false;
  if (!isSequential) return true;
  return signerOrder === (currentIndex ?? 0);
}

/** Fields only visible to the document creator. */
function creatorOnlyFields(
  s: Awaited<ReturnType<typeof findSignersByDocumentId>>[number],
  docId: string,
  opts: { isCreator: boolean; isMatchingSigner: boolean },
) {
  if (!opts.isCreator && !opts.isMatchingSigner) {
    return {
      email: null,
      phone: null,
      signature: null,
      handSignatureHash: null,
      claimToken: null,
      signUrl: null,
      deliveryMethods: [] as unknown[],
      declineReason: null,
      forensicHash: null,
      forensicFlags: [] as Array<{
        code: string;
        severity: string;
        message: string;
      }>,
      forensicGeo: null as ReturnType<typeof getForensicGeo>,
    };
  }
  return {
    email: s.email,
    phone: s.phone,
    signature: s.signature,
    handSignatureHash: s.handSignatureHash,
    claimToken: s.claimToken,
    signUrl: `${getBaseUrl()}/sign/${docId}?claim=${s.claimToken}`,
    deliveryMethods: s.deliveryMethods ?? [],
    declineReason: s.declineReason,
    forensicHash: s.forensicHash ?? null,
    forensicFlags: getForensicFlags(s.forensicEvidence),
    forensicGeo: getForensicGeo(s.forensicEvidence),
  };
}

/** Build the sanitized signer list for the `get` procedure response. */
function buildSanitizedSigners(
  docSigners: Awaited<ReturnType<typeof findSignersByDocumentId>>,
  doc: Awaited<ReturnType<typeof findDocumentById>>,
  opts: {
    isCreator: boolean;
    matchingSignerId: string | null;
    claimToken?: string;
    isSequential: boolean;
    targetSignerForGate: (typeof docSigners)[number] | undefined;
    tokenGateEvaluation: unknown;
  },
) {
  return docSigners.map((s) => {
    const isMatchingSigner = opts.matchingSignerId === s.id || opts.claimToken === s.claimToken;
    const creator = creatorOnlyFields(s, doc.id, {
      isCreator: opts.isCreator,
      isMatchingSigner,
    });
    return {
      id: s.id,
      label: s.label,
      address: s.address,
      chain: s.chain,
      ...creator,
      status: s.status,
      signedAt: s.signedAt,
      scheme: s.scheme,
      handSignatureData: s.handSignatureData ?? null,
      isYou: isMatchingSigner,
      isClaimed: !!s.address || !!s.otpVerifiedAt || !!s.userId,
      fields: s.fields ?? [],
      fieldValues: s.fieldValues ?? null,
      tokenGates: s.tokenGates ?? null,
      tokenGateEvaluation: s.id === opts.targetSignerForGate?.id ? opts.tokenGateEvaluation : null,
      signMethod: s.signMethod,
      role: s.role,
      declinedAt: s.declinedAt,
      signerOrder: s.signerOrder,
      identityLevel: s.identityLevel,
      canSign: resolveCanSign(s.role, opts.isSequential, s.signerOrder, doc.currentSignerIndex),
      groupRole: s.groupRole ?? null,
      finalizationSignature: s.finalizationSignature ?? null,
    };
  });
}

/** Build the forensic replay signer data. */
function buildReplaySigner(signer: Awaited<ReturnType<typeof findSignersByDocumentId>>[number]) {
  const forensic = (signer.forensicEvidence as EnhancedForensicEvidence | null) ?? null;
  const replay = forensic?.behavioral?.replay ?? null;
  return {
    id: signer.id,
    label: signer.label,
    status: signer.status,
    signedAt: signer.signedAt,
    signMethod: signer.signMethod,
    chain: signer.chain,
    address: signer.address,
    email: signer.email,
    role: signer.role,
    canSign: signer.status !== "SIGNED",
    handSignatureData: signer.handSignatureData ?? null,
    fieldValues: signer.fieldValues ?? null,
    fields: signer.fields ?? [],
    forensicHash: signer.forensicHash ?? forensic?.evidenceHash ?? null,
    replay,
    mobileForensics: (forensic as Record<string, unknown> | null)?.mobileForensics ?? null,
    documentViewingStartedMs: forensic?.behavioral?.documentViewingStartedMs ?? 0,
    aiForensicReview: (forensic as Record<string, unknown> | null)?.aiForensicReview ?? null,
    signatureMotion: replay ? extractReplaySignatureAnalysis(replay) : null,
    flags: forensic?.flags ?? [],
    automationReview: forensic?.automationReview
      ? {
          verdict: forensic.automationReview.verdict,
          confidence: forensic.automationReview.confidence,
          source: forensic.automationReview.source,
          automationScore: forensic.automationReview.automationScore,
          recommendedAction: forensic.automationReview.recommendedAction,
          rationale: forensic.automationReview.rationale,
          createdAt: forensic.automationReview.createdAt,
        }
      : null,
    policyOutcome: forensic?.policyOutcome
      ? {
          action: forensic.policyOutcome.action,
          blocked: forensic.policyOutcome.blocked,
          reason: forensic.policyOutcome.reason,
        }
      : null,
    storage: forensic?.storage
      ? {
          mode: forensic.storage.mode,
          objectCid: forensic.storage.objectCid,
          objectHash: forensic.storage.objectHash,
          byteLength: forensic.storage.byteLength,
          anchored: forensic.storage.anchored,
          anchors: forensic.storage.anchors,
        }
      : null,
    sessionProfile: forensic?.sessionProfile ?? null,
    signerBaseline: forensic?.signerBaseline ?? null,
    forensicSessions: forensic?.forensicSessions ?? [],
  };
}

/** Resolve the target signer for token gate evaluation and evaluate it. */
async function resolveTokenGateForViewer(
  docSigners: Awaited<ReturnType<typeof findSignersByDocumentId>>,
  input: {
    claimToken?: string;
    viewerAddress?: string;
    viewerChain?: string | null;
  },
  callerAddress: string | null,
  callerChain: string | null,
  matchingSignerId: string | null,
) {
  const effectiveAddress = input.viewerAddress ?? callerAddress;
  const effectiveChain = input.viewerChain ?? (callerChain === "BASE" ? "ETH" : callerChain);
  const byClaimToken = input.claimToken ? docSigners.find((e) => e.claimToken === input.claimToken) : undefined;
  const byAddress = effectiveAddress
    ? docSigners.find((e) => e.address?.toLowerCase() === effectiveAddress.toLowerCase())
    : undefined;
  const byMatchedSignerId = matchingSignerId ? docSigners.find((entry) => entry.id === matchingSignerId) : undefined;
  const targetSignerForGate = byClaimToken ?? byAddress ?? byMatchedSignerId;

  const tokenGateEvaluation =
    effectiveAddress && effectiveChain && targetSignerForGate?.tokenGates
      ? await evaluateSignerTokenGate({
          gate: targetSignerForGate.tokenGates,
          address: effectiveAddress,
          chain: effectiveChain,
        })
      : null;

  return { targetSignerForGate, tokenGateEvaluation };
}

function getSignerRequiredSocialIdentifiers(
  signer: Awaited<ReturnType<typeof findSignersByDocumentId>>[number],
): string[] {
  const fields =
    (signer.fields as Array<{
      type?: string;
      settings?: Record<string, unknown>;
    }> | null) ?? [];

  return fields
    .filter((field) => VERIFY_FIELD_TYPES.has(field.type ?? ""))
    .map((field) => field.settings?.requiredUsername)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/^@/, "").trim().toLowerCase())
    .filter(Boolean);
}

async function resolveSignerFromVerificationSessions(
  identity: Awaited<ReturnType<typeof resolveUnifiedRequestIdentity>>,
  docSigners: Awaited<ReturnType<typeof findSignersByDocumentId>>,
) {
  if (!identity.userId && identity.walletAddressSet.size === 0) return null;

  try {
    const { getVerificationSessionsForActor } = await import("~/server/auth/verification-sessions");
    const sessions = await getVerificationSessionsForActor({
      userId: identity.userId,
      walletAddresses: [...identity.walletAddressSet],
    });
    if (sessions.length === 0) return null;

    const usernamesByProvider = new Set(
      sessions
        .filter((session) => ["x", "github", "discord", "google"].includes(session.provider))
        .map((session) => `${session.provider}:${session.identifier.toLowerCase()}`),
    );

    const matches = docSigners.filter((signer) => {
      const signerVerifications =
        (signer.socialVerifications as Array<{
          provider?: string;
          username?: string;
        }> | null) ?? [];

      if (
        signerVerifications.some((verification) =>
          usernamesByProvider.has(`${verification.provider}:${verification.username?.toLowerCase() ?? ""}`),
        )
      ) {
        return true;
      }

      const requiredIdentifiers = getSignerRequiredSocialIdentifiers(signer);
      if (requiredIdentifiers.length === 0) return false;

      return requiredIdentifiers.some((identifier) => {
        for (const provider of ["x", "github", "discord", "google"] as const) {
          if (usernamesByProvider.has(`${provider}:${identifier}`)) return true;
        }
        return false;
      });
    });

    return matches.length === 1 ? matches[0]! : null;
  } catch {
    return null;
  }
}

/** Auto-expire a document if it's past its expiration date. */
async function maybeExpireDocument(db: any, doc: any) {
  if (doc.expiresAt && doc.status === "PENDING" && doc.expiresAt < new Date()) {
    await db.update(documents).set({ status: "EXPIRED" }).where(eq(documents.id, doc.id));
    doc.status = "EXPIRED" as typeof doc.status;
    void safeLogAudit({
      documentId: doc.id,
      eventType: "DOCUMENT_EXPIRED",
      actor: "system",
      actorType: "system",
    });
  }
}

/** Decrypt document content if encrypted, returning the plaintext or a fallback message. */
async function resolveContent(doc: any): Promise<string> {
  if (doc.encryptedAtRest && doc.encryptionKeyWrapped) {
    try {
      return await decryptContent(doc.content, doc.encryptionKeyWrapped);
    } catch {
      return "[Encrypted content — decryption key unavailable]";
    }
  }
  return doc.content;
}

/** Fire-and-forget audit log for document views. */
function logDocumentView(
  docId: string,
  callerAddress: string | null,
  email: string | null | undefined,
  claimToken: string | undefined,
  clientIp: string | null,
) {
  const viewerActor = callerAddress ?? email ?? claimToken ?? "anonymous";
  void safeLogAudit({
    documentId: docId,
    eventType: "DOCUMENT_VIEWED",
    actor: viewerActor,
    actorType: callerAddress ? "wallet" : email ? "email" : "system",
    ipAddress: clientIp,
  });
}

export const documentQueryRouter = createTRPCRouter({
  get: publicProcedure
    .input(
      z.object({
        id: z.string(),
        claimToken: z.string().optional(),
        viewerAddress: z.string().optional(),
        viewerChain: z.enum(["ETH", "SOL", "BTC"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.id);
      if (!doc) throw new Error("Document not found");

      await maybeExpireDocument(ctx.db, doc);

      const docSigners = await findSignersByDocumentId(ctx.db, input.id);
      const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
      const callerAddress = identity.walletSession?.address ?? null;
      const callerChain = identity.walletSession?.chain ?? null;
      const initialViewerAccess = resolveDocumentViewerAccess({
        document: doc,
        signers: docSigners,
        identity,
      });
      const inferredSigner = initialViewerAccess.matchingSigner
        ? initialViewerAccess.matchingSigner
        : await resolveSignerFromVerificationSessions(identity, docSigners);
      const matchingSigner = inferredSigner ?? null;

      const authorized =
        initialViewerAccess.canAccessDocument ||
        !!matchingSigner ||
        (input.claimToken && docSigners.some((s) => s.claimToken === input.claimToken)) ||
        doc.status === "COMPLETED";
      if (!authorized) throw new Error("Access denied — connect the correct wallet or use your signing link");

      logDocumentView(doc.id, callerAddress, identity.email, input.claimToken, ctx.clientIp);

      const isCreator = initialViewerAccess.isCreator;
      const content = await resolveContent(doc);
      const isSequential = doc.signingOrder === "sequential";
      const { targetSignerForGate, tokenGateEvaluation } = await resolveTokenGateForViewer(
        docSigners,
        input,
        callerAddress,
        callerChain,
        matchingSigner?.id ?? null,
      );

      return {
        ...doc,
        content,
        accessToken: isCreator ? doc.accessToken : undefined,
        signers: buildSanitizedSigners(docSigners, doc, {
          isCreator,
          matchingSignerId: matchingSigner?.id ?? null,
          claimToken: input.claimToken,
          isSequential,
          targetSignerForGate,
          tokenGateEvaluation,
        }),
        reminderConfig: isCreator ? doc.reminderConfig : null,
        postSignReveal: isCreator
          ? (doc.postSignReveal ?? null)
          : doc.postSignReveal
            ? { enabled: doc.postSignReveal.enabled }
            : null,
      };
    }),

  getForensicReplay: publicProcedure
    .input(
      z.object({
        id: z.string(),
        contentHash: z.string().optional(),
        claimToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const doc = await findDocumentById(ctx.db, input.id);
      if (!doc) return null;

      const docSigners = await findSignersByDocumentId(ctx.db, input.id);
      let authorized = false;
      const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
      const viewerAccess = resolveDocumentViewerAccess({
        document: doc,
        signers: docSigners,
        identity,
      });
      if (viewerAccess.canAccessDocument) authorized = true;
      if (input.contentHash && doc.contentHash === input.contentHash) authorized = true;
      if (input.claimToken && docSigners.some((s) => s.claimToken === input.claimToken)) authorized = true;
      if (doc.status === "COMPLETED") authorized = true;
      if (!authorized) return null;

      return {
        documentId: doc.id,
        title: doc.title,
        content: doc.content,
        contentHash: doc.contentHash,
        status: doc.status,
        generatedAt: new Date().toISOString(),
        signers: docSigners.map(buildReplaySigner),
      };
    }),

  saveForensicSession: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        session: z.object({
          sessionId: z.string(),
          visitIndex: z.number(),
          startedAt: z.string(),
          endedAt: z.string().nullable(),
          durationMs: z.number(),
          behavioral: z.record(z.unknown()),
          replay: z.record(z.unknown()).nullable(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const docSigners = await findSignersByDocumentId(ctx.db, input.documentId);
      const signer = docSigners.find((s) => s.claimToken === input.claimToken);
      if (!signer) throw new Error("Invalid signing link");

      const existing = (signer.forensicEvidence as Record<string, unknown> | null) ?? {};
      const sessions = (existing.forensicSessions as unknown[] | undefined) ?? [];
      sessions.push(input.session);

      await ctx.db
        .update(signers)
        .set({
          forensicEvidence: {
            ...existing,
            forensicSessions: sessions,
          } as unknown as Record<string, unknown>,
        })
        .where(eq(signers.id, signer.id));

      return { saved: true, sessionCount: sessions.length };
    }),

  claimDocuments: authedProcedure.mutation(async ({ ctx }) => {
    try {
      const { claimSignerDocuments, getVerificationSessionsForActor } =
        await import("~/server/auth/verification-sessions");
      const addr = ctx.session.address.toLowerCase();

      const sessions = await getVerificationSessionsForActor({
        userId: ctx.session.userId,
        walletAddresses: [addr],
      });
      const socialUsernames = sessions
        .filter((s) => ["x", "github", "discord", "google"].includes(s.provider))
        .map((s) => ({
          provider: s.provider as "x" | "github" | "discord" | "google",
          username: s.identifier,
        }));

      let email: string | null = null;
      try {
        const { users } = await import("~/server/db/schema");
        const [user] = await ctx.db
          .select()
          .from(users)
          .where(eq(users.id, ctx.session.userId ?? ""))
          .limit(1);
        email = user?.email ?? null;
      } catch {}

      const result = await claimSignerDocuments({
        userId: ctx.session.userId ?? ctx.session.address,
        email,
        walletAddress: addr,
        socialUsernames,
      });

      return { claimedCount: result.claimedCount };
    } catch (e) {
      console.warn("[claimDocuments] Failed:", (e as Error).message);
      return { claimedCount: 0 };
    }
  }),

  checkVerificationSessions: publicProcedure
    .input(z.object({ identifiers: z.array(z.string()).min(1).max(10) }))
    .query(async ({ input }) => {
      try {
        const { getVerificationSessionsForIdentifiers } = await import("~/server/auth/verification-sessions");
        const sessions = await getVerificationSessionsForIdentifiers(input.identifiers);
        return sessions.map((s) => ({
          identifier: s.identifier,
          provider: s.provider,
          profileId: s.profileId,
          displayName: s.displayName,
          verifiedAt: s.verifiedAt,
          expiresAt: s.expiresAt,
          chain: s.chain,
        }));
      } catch {
        return [];
      }
    }),

  listByAddress: publicProcedure.input(z.object({}).optional()).query(async ({ ctx }) => {
    const identity = await resolveUnifiedRequestIdentity(ctx.req ?? null);
    if (!identity.authSession && !identity.walletSession) {
      throw new Error("Not signed in");
    }

    const creatorAddresses = [...identity.walletAddressSet];
    const createdDocGroups = await Promise.all(creatorAddresses.map((addr) => findDocumentsByCreator(ctx.db, addr)));
    const createdDocs = createdDocGroups.flat();

    const signerRowGroups = await Promise.all(creatorAddresses.map((addr) => findSignersByAddress(ctx.db, addr)));
    const signerRows = signerRowGroups.flat();

    if (identity.email) {
      const emailSignerRows = await ctx.db.select().from(signers).where(eq(signers.email, identity.email));
      signerRows.push(...emailSignerRows);
    }

    if (identity.userId) {
      const userSignerRows = await ctx.db.select().from(signers).where(eq(signers.userId, identity.userId));
      signerRows.push(...userSignerRows);
    }

    const allDocIds = new Set([...createdDocs.map((d) => d.id), ...signerRows.map((s) => s.documentId)]);

    const baseUrl = getBaseUrl();
    const results: Array<
      (typeof createdDocs)[number] & {
        viewerIsCreator: boolean;
        signers: Array<{
          id: string;
          label: string;
          address: string | null;
          chain: string | null;
          status: string;
          signedAt: Date | null;
          isYou: boolean;
          signUrl: string | null;
        }>;
      }
    > = [];

    for (const docId of allDocIds) {
      const doc = createdDocs.find((d) => d.id === docId) ?? (await findDocumentById(ctx.db, docId));
      if (!doc) continue;

      const docSigners = await findSignersByDocumentId(ctx.db, docId);
      const viewerAccess = resolveDocumentViewerAccess({
        document: doc,
        signers: docSigners,
        identity,
      });

      results.push({
        ...doc,
        viewerIsCreator: viewerAccess.isCreator,
        postSignReveal: viewerAccess.isCreator
          ? (doc.postSignReveal ?? null)
          : doc.postSignReveal
            ? { enabled: doc.postSignReveal.enabled }
            : null,
        signers: docSigners.map((s) => ({
          id: s.id,
          label: s.label,
          address: s.address,
          chain: s.chain,
          status: s.status,
          signedAt: s.signedAt,
          isYou: viewerAccess.matchingSigner?.id === s.id,
          signUrl: viewerAccess.isCreator ? `${baseUrl}/sign/${docId}?claim=${s.claimToken}` : null,
          groupRole: s.groupRole ?? null,
        })),
      });
    }

    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return results;
  }),
});
