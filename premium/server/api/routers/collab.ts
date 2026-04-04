// @ts-nocheck -- Premium modules (~/premium/*) are in a separate private repo and unavailable at TS compile time
/**
 * Collaboration tRPC router.
 *
 * In the FREE version: all procedures return { available: false } or throw FORBIDDEN.
 * In the PREMIUM version: loads premium/collaboration/router at runtime and
 * delegates all procedures to it.
 */

import { z } from "zod";
import { createTRPCRouter, publicProcedure, authedProcedure } from "~/server/api/trpc";
import { loadPremiumCollab, getPremiumFeatures } from "~/lib/premium";
import { TRPCError } from "@trpc/server";
import { requireFeatureForWallet, resolveWalletIdentity } from "~/server/operator-access";
import type { db as _dbType } from "~/server/db";

type DbClient = typeof _dbType;

type CollabFeatureId =
  | "collab_live_sessions"
  | "collab_review_mode"
  | "collab_shared_ai"
  | "collab_shareable_links"
  | "collab_pdf_review";

interface CollabCtx {
  db: DbClient;
  session: { address: string; chain: string };
}

/** The premium collab module shape (loaded dynamically). */
type PremiumCollabModule = NonNullable<Awaited<ReturnType<typeof loadPremiumCollab>>>;

const COLLAB_FORBIDDEN = "Premium feature — upgrade to enable collaboration";

async function requireCollab(): Promise<PremiumCollabModule> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const collab = await loadPremiumCollab();
  if (!collab) throw new TRPCError({ code: "FORBIDDEN", message: COLLAB_FORBIDDEN });
  return collab;
}

async function requireCollabForSession(ctx: CollabCtx): Promise<PremiumCollabModule> {
  return requireCollabFeatureForSession(ctx, "collab_live_sessions");
}

async function requireCollabFeatureForSession(
  ctx: CollabCtx,
  featureId: CollabFeatureId,
): Promise<PremiumCollabModule> {
  await requireFeatureForWallet(
    ctx.db,
    resolveWalletIdentity(ctx.session.address, ctx.session.chain),
    featureId,
    COLLAB_FORBIDDEN,
  );
  return requireCollab();
}

// Build the full router with premium procedures if available.
// Each procedure loads the premium module on demand.

const annotationAnchorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("doc"),
    tokenIndex: z.number(),
    charOffset: z.number(),
    length: z.number(),
  }),
  z.object({
    kind: z.literal("pdf"),
    page: z.number(),
    rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  }),
]);

export const collabRouter = createTRPCRouter({
  /** Check collaboration feature availability */
  capabilities: publicProcedure.query(async () => {
    const features = getPremiumFeatures();
    return { available: features.collaboration, collaboration: features.collaboration };
  }),

  // ── Sessions ──

  create: authedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        documentId: z.string().optional(),
        pdfBlobUrl: z.string().optional(),
        displayName: z.string().min(1).max(100),
        settings: z
          .object({
            maxParticipants: z.number().min(2).max(100).optional(),
            autoCloseMinutes: z.number().min(5).nullable().optional(),
            allowAnonymousViewers: z.boolean().optional(),
            aiEnabled: z.boolean().optional(),
            reviewOnly: z.boolean().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const collab = await requireCollabForSession(ctx);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = await collab.createSession(ctx.db, {
        hostUserId: ctx.session.address,
        hostDisplayName: input.displayName,
        title: input.title,
        documentId: input.documentId,
        pdfBlobUrl: input.pdfBlobUrl,
        settings: input.settings,
      });
      return {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        sessionId: result.session.id,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        joinToken: result.session.joinToken,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        session: result.session,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        participants: result.participants,
      };
    }),

  join: authedProcedure
    .input(
      z.object({
        joinToken: z.string().min(1),
        displayName: z.string().min(1).max(100),
        role: z.enum(["editor", "viewer", "commentor"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const collab = await requireCollabForSession(ctx);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = await collab.joinSession(
        ctx.db,
        input.joinToken,
        ctx.session.address,
        input.displayName,
        input.role,
      );
      return {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        sessionId: result.session.id,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        session: result.session,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        participants: result.participants,
      };
    }),

  leave: authedProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ ctx, input }) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const collab = await requireCollabForSession(ctx);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await collab.leaveSession(ctx.db, input.sessionId, ctx.session.address);
    return { ok: true };
  }),

  close: authedProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ ctx, input }) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const collab = await requireCollabForSession(ctx);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await collab.closeSession(ctx.db, input.sessionId, ctx.session.address);
    return { ok: true };
  }),

  togglePause: authedProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ ctx, input }) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const collab = await requireCollabForSession(ctx);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const newStatus = await collab.toggleSessionPause(ctx.db, input.sessionId, ctx.session.address);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    return { status: newStatus };
  }),

  saveToDocument: authedProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ ctx, input }) => {
    await requireCollabForSession(ctx);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { saveToDocument } = await import(/* webpackIgnore: true */ "~/premium/collaboration/yjs-persistence");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    await saveToDocument(ctx.db, input.sessionId);
    return { ok: true };
  }),

  get: authedProcedure.input(z.object({ sessionId: z.string() })).query(async ({ ctx, input }) => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const collab = await requireCollabForSession(ctx);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const result = await collab.getSession(ctx.db, input.sessionId);
    if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const myParticipant = result.participants.find(
      (p: { userId: string; role: string }) => p.userId === ctx.session.address,
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return {
      ...result,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      myRole: myParticipant?.role ?? null,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      permissions: myParticipant ? collab.getPermissionsForRole(myParticipant.role) : {},
    };
  }),

  list: authedProcedure
    .input(z.object({ status: z.enum(["active", "paused", "closed"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const collab = await requireCollabForSession(ctx);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      return collab.listUserSessions(ctx.db, ctx.session.address, input?.status);
    }),

  updateRole: authedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        targetUserId: z.string(),
        role: z.enum(["editor", "viewer", "commentor"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const collab = await requireCollabForSession(ctx);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await collab.updateParticipantRole(ctx.db, input.sessionId, ctx.session.address, input.targetUserId, input.role);
      return { ok: true };
    }),

  removeParticipant: authedProcedure
    .input(z.object({ sessionId: z.string(), targetUserId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const collab = await requireCollabForSession(ctx);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      await collab.removeParticipant(ctx.db, input.sessionId, ctx.session.address, input.targetUserId);
      return { ok: true };
    }),

  // ── Annotations ──

  createAnnotation: authedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        type: z.enum(["highlight", "comment", "bookmark", "suggestion"]),
        anchor: annotationAnchorSchema,
        content: z.string().max(5000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireCollabFeatureForSession(ctx, "collab_review_mode");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { createAnnotation } = await import(/* webpackIgnore: true */ "~/premium/collaboration/annotation-manager");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
      return createAnnotation(ctx.db, {
        sessionId: input.sessionId,
        authorUserId: ctx.session.address,
        type: input.type,
        anchor: input.anchor,
        content: input.content,
      });
    }),

  getAnnotations: authedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        type: z.enum(["highlight", "comment", "bookmark", "suggestion"]).optional(),
        resolved: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireCollabFeatureForSession(ctx, "collab_review_mode");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { getAnnotations } = await import(/* webpackIgnore: true */ "~/premium/collaboration/annotation-manager");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
      return getAnnotations(ctx.db, input.sessionId, { type: input.type, resolved: input.resolved });
    }),

  resolveAnnotation: authedProcedure.input(z.object({ annotationId: z.string() })).mutation(async ({ ctx, input }) => {
    await requireCollabFeatureForSession(ctx, "collab_review_mode");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { resolveAnnotation } = await import(/* webpackIgnore: true */ "~/premium/collaboration/annotation-manager");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return resolveAnnotation(ctx.db, input.annotationId, ctx.session.address);
  }),

  deleteAnnotation: authedProcedure
    .input(z.object({ annotationId: z.string(), sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireCollabFeatureForSession(ctx, "collab_review_mode");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { deleteAnnotation } = await import(/* webpackIgnore: true */ "~/premium/collaboration/annotation-manager");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const collab = await requireCollabForSession(ctx);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const session = await collab.getSession(ctx.db, input.sessionId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const isHost = session?.session.hostUserId === ctx.session.address;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      await deleteAnnotation(ctx.db, input.annotationId, ctx.session.address, isHost);
      return { ok: true };
    }),

  annotationCounts: authedProcedure.input(z.object({ sessionId: z.string() })).query(async ({ ctx, input }) => {
    await requireCollabFeatureForSession(ctx, "collab_review_mode");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { getAnnotationCounts } = await import(
      /* webpackIgnore: true */ "~/premium/collaboration/annotation-manager"
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return getAnnotationCounts(ctx.db, input.sessionId);
  }),

  // ── Shared AI ──

  getSharedThreads: authedProcedure.input(z.object({ sessionId: z.string() })).query(async ({ ctx, input }) => {
    await requireCollabFeatureForSession(ctx, "collab_shared_ai");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { getSharedThreads } = await import(/* webpackIgnore: true */ "~/premium/collaboration/ai-threads");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return getSharedThreads(ctx.db, input.sessionId);
  }),

  sendSharedAiMessage: authedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        threadId: z.string().optional(),
        message: z.string().min(1).max(10000),
        displayName: z.string().min(1).max(100),
        provider: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireCollabFeatureForSession(ctx, "collab_shared_ai");
      const { loadPremiumAi } = await import("~/lib/premium");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const ai = await loadPremiumAi();
      if (!ai) throw new TRPCError({ code: "FORBIDDEN", message: "AI not available" });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const resolved = await ai.resolveKeyWithFallback(ctx.session.address, input.provider ?? "anthropic");
      if (!resolved) throw new TRPCError({ code: "BAD_REQUEST", message: "No AI provider configured." });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { sendSharedMessage, getOrCreateDefaultSharedThread } = await import(
        /* webpackIgnore: true */ "~/premium/collaboration/ai-threads"
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { getSession } = await import(/* webpackIgnore: true */ "~/premium/collaboration/session-manager");

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const session = await getSession(ctx.db, input.sessionId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const threadId = input.threadId ?? (await getOrCreateDefaultSharedThread(ctx.db, input.sessionId)).id;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const result = await sendSharedMessage(ctx.db, {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        threadId,
        sessionId: input.sessionId,
        userId: ctx.session.address,
        displayName: input.displayName,
        content: input.message,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        pdfAnalysis: session?.session?.pdfAnalysis,
        complete: async (messages: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const response = await ai.complete(
            {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
              provider: resolved.key.provider,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
              model: input.model ?? resolved.model,
              messages: messages,
              maxTokens: 4096,
            },
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            resolved.key,
          );
          return {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            content: response.content,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            usage: response.usage,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            model: response.model,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            provider: response.provider,
          };
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      return { threadId, userMessage: result.userMessage, aiMessage: result.aiMessage };
    }),

  // ── Private AI ──

  getPrivateThreads: authedProcedure.input(z.object({ sessionId: z.string() })).query(async ({ ctx, input }) => {
    await requireCollabFeatureForSession(ctx, "collab_shared_ai");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { getPrivateThreads } = await import(/* webpackIgnore: true */ "~/premium/collaboration/ai-threads");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return getPrivateThreads(ctx.db, input.sessionId, ctx.session.address);
  }),

  sendPrivateAiMessage: authedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        threadId: z.string().optional(),
        message: z.string().min(1).max(10000),
        provider: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireCollabFeatureForSession(ctx, "collab_shared_ai");
      const { loadPremiumAi } = await import("~/lib/premium");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const ai = await loadPremiumAi();
      if (!ai) throw new TRPCError({ code: "FORBIDDEN", message: "AI not available" });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const resolved = await ai.resolveKeyWithFallback(ctx.session.address, input.provider ?? "anthropic");
      if (!resolved) throw new TRPCError({ code: "BAD_REQUEST", message: "No AI provider configured." });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { sendPrivateMessage, getOrCreateDefaultPrivateThread } = await import(
        /* webpackIgnore: true */ "~/premium/collaboration/ai-threads"
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { getSession } = await import(/* webpackIgnore: true */ "~/premium/collaboration/session-manager");

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const session = await getSession(ctx.db, input.sessionId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const threadId =
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        input.threadId ?? (await getOrCreateDefaultPrivateThread(ctx.db, input.sessionId, ctx.session.address)).id;

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const result = await sendPrivateMessage(ctx.db, {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        threadId,
        sessionId: input.sessionId,
        userId: ctx.session.address,
        content: input.message,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        pdfAnalysis: session?.session?.pdfAnalysis,
        complete: async (messages: unknown[]) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          const response = await ai.complete(
            {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
              provider: resolved.key.provider,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
              model: input.model ?? resolved.model,
              messages: messages,
              maxTokens: 4096,
            },
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            resolved.key,
          );
          return {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            content: response.content,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            usage: response.usage,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            model: response.model,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            provider: response.provider,
          };
        },
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      return { threadId, userMessage: result.userMessage, aiMessage: result.aiMessage };
    }),

  // ── Shareable Links ──

  createLink: authedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        anchor: annotationAnchorSchema,
        generateBreakdown: z.boolean().optional(),
        expiresInHours: z.number().min(1).max(720).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireCollabFeatureForSession(ctx, "collab_shareable_links");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { createShareableLink } = await import(/* webpackIgnore: true */ "~/premium/collaboration/shareable-links");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
      return createShareableLink(ctx.db, {
        sessionId: input.sessionId,
        createdBy: ctx.session.address,
        anchor: input.anchor,
        expiresInHours: input.expiresInHours,
      });
    }),

  resolveLink: authedProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
    await requireCollabFeatureForSession(ctx, "collab_shareable_links");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { resolveShareableLink } = await import(/* webpackIgnore: true */ "~/premium/collaboration/shareable-links");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const link = await resolveShareableLink(ctx.db, input.token);
    if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "Link not found or expired" });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return link;
  }),

  sessionLinks: authedProcedure.input(z.object({ sessionId: z.string() })).query(async ({ ctx, input }) => {
    await requireCollabFeatureForSession(ctx, "collab_shareable_links");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const { getLinksForSession } = await import(/* webpackIgnore: true */ "~/premium/collaboration/shareable-links");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return getLinksForSession(ctx.db, input.sessionId);
  }),

  // ── PDF Import ──

  importPdf: authedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        pdfBlobUrl: z.string(),
        title: z.string().optional(),
        rawText: z.string().optional(),
        pageCount: z.number().optional(),
        sections: z
          .array(
            z.object({
              title: z.string(),
              pageStart: z.number(),
              pageEnd: z.number(),
              textPreview: z.string(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireCollabFeatureForSession(ctx, "collab_pdf_review");
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const { collabSessions } = await import(/* webpackIgnore: true */ "~/premium/collaboration/schema");
      const { eq } = await import("drizzle-orm");

      const pdfAnalysis = {
        pageCount: input.pageCount ?? 0,
        title: input.title,
        sections: input.sections ?? [],
        rawText: input.rawText ?? "",
      };

      /* eslint-disable @typescript-eslint/no-unsafe-member-access */
      await ctx.db
        .update(collabSessions)
        .set({ pdfBlobUrl: input.pdfBlobUrl, pdfAnalysis })
        .where(eq(collabSessions.id, input.sessionId));
      /* eslint-enable @typescript-eslint/no-unsafe-member-access */

      return { ok: true, pdfAnalysis };
    }),
});
