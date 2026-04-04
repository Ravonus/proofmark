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

const COLLAB_FORBIDDEN = "Premium feature — upgrade to enable collaboration";

async function requireCollab() {
  const collab = await loadPremiumCollab();
  if (!collab) throw new TRPCError({ code: "FORBIDDEN", message: COLLAB_FORBIDDEN });
  return collab;
}

async function requireCollabForSession(ctx: {
  db: typeof import("~/server/db").db;
  session: { address: string; chain: string };
}) {
  return requireCollabFeatureForSession(ctx, "collab_live_sessions");
}

async function requireCollabFeatureForSession(
  ctx: { db: typeof import("~/server/db").db; session: { address: string; chain: string } },
  featureId:
    | "collab_live_sessions"
    | "collab_review_mode"
    | "collab_shared_ai"
    | "collab_shareable_links"
    | "collab_pdf_review",
) {
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
      const collab = await requireCollabForSession(ctx);
      const result = await collab.createSession(ctx.db, {
        hostUserId: ctx.session.address,
        hostDisplayName: input.displayName,
        title: input.title,
        documentId: input.documentId,
        pdfBlobUrl: input.pdfBlobUrl,
        settings: input.settings,
      });
      return {
        sessionId: result.session.id,
        joinToken: result.session.joinToken,
        session: result.session,
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
      const collab = await requireCollabForSession(ctx);
      const result = await collab.joinSession(
        ctx.db,
        input.joinToken,
        ctx.session.address,
        input.displayName,
        input.role,
      );
      return {
        sessionId: result.session.id,
        session: result.session,
        participants: result.participants,
      };
    }),

  leave: authedProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ ctx, input }) => {
    const collab = await requireCollabForSession(ctx);
    await collab.leaveSession(ctx.db, input.sessionId, ctx.session.address);
    return { ok: true };
  }),

  close: authedProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ ctx, input }) => {
    const collab = await requireCollabForSession(ctx);
    await collab.closeSession(ctx.db, input.sessionId, ctx.session.address);
    return { ok: true };
  }),

  togglePause: authedProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ ctx, input }) => {
    const collab = await requireCollabForSession(ctx);
    const newStatus = await collab.toggleSessionPause(ctx.db, input.sessionId, ctx.session.address);
    return { status: newStatus };
  }),

  saveToDocument: authedProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ ctx, input }) => {
    await requireCollabForSession(ctx);
    const { saveToDocument } = await import("~/premium/collaboration/yjs-persistence");
    await saveToDocument(ctx.db, input.sessionId);
    return { ok: true };
  }),

  get: authedProcedure.input(z.object({ sessionId: z.string() })).query(async ({ ctx, input }) => {
    const collab = await requireCollabForSession(ctx);
    const result = await collab.getSession(ctx.db, input.sessionId);
    if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
    const myParticipant = result.participants.find((p: any) => p.userId === ctx.session.address);
    return {
      ...result,
      myRole: myParticipant?.role ?? null,
      permissions: myParticipant ? collab.getPermissionsForRole(myParticipant.role) : {},
    };
  }),

  list: authedProcedure
    .input(z.object({ status: z.enum(["active", "paused", "closed"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const collab = await requireCollabForSession(ctx);
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
      const collab = await requireCollabForSession(ctx);
      await collab.updateParticipantRole(ctx.db, input.sessionId, ctx.session.address, input.targetUserId, input.role);
      return { ok: true };
    }),

  removeParticipant: authedProcedure
    .input(z.object({ sessionId: z.string(), targetUserId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const collab = await requireCollabForSession(ctx);
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
      const { createAnnotation } = await import("~/premium/collaboration/annotation-manager");
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
      const { getAnnotations } = await import("~/premium/collaboration/annotation-manager");
      return getAnnotations(ctx.db, input.sessionId, { type: input.type, resolved: input.resolved });
    }),

  resolveAnnotation: authedProcedure.input(z.object({ annotationId: z.string() })).mutation(async ({ ctx, input }) => {
    await requireCollabFeatureForSession(ctx, "collab_review_mode");
    const { resolveAnnotation } = await import("~/premium/collaboration/annotation-manager");
    return resolveAnnotation(ctx.db, input.annotationId, ctx.session.address);
  }),

  deleteAnnotation: authedProcedure
    .input(z.object({ annotationId: z.string(), sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireCollabFeatureForSession(ctx, "collab_review_mode");
      const { deleteAnnotation } = await import("~/premium/collaboration/annotation-manager");
      const collab = await requireCollabForSession(ctx);
      const session = await collab.getSession(ctx.db, input.sessionId);
      const isHost = session?.session.hostUserId === ctx.session.address;
      await deleteAnnotation(ctx.db, input.annotationId, ctx.session.address, isHost);
      return { ok: true };
    }),

  annotationCounts: authedProcedure.input(z.object({ sessionId: z.string() })).query(async ({ ctx, input }) => {
    await requireCollabFeatureForSession(ctx, "collab_review_mode");
    const { getAnnotationCounts } = await import("~/premium/collaboration/annotation-manager");
    return getAnnotationCounts(ctx.db, input.sessionId);
  }),

  // ── Shared AI ──

  getSharedThreads: authedProcedure.input(z.object({ sessionId: z.string() })).query(async ({ ctx, input }) => {
    await requireCollabFeatureForSession(ctx, "collab_shared_ai");
    const { getSharedThreads } = await import("~/premium/collaboration/ai-threads");
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
      const ai = await loadPremiumAi();
      if (!ai) throw new TRPCError({ code: "FORBIDDEN", message: "AI not available" });

      const resolved = await ai.resolveKeyWithFallback(ctx.session.address, (input.provider as any) ?? "anthropic");
      if (!resolved) throw new TRPCError({ code: "BAD_REQUEST", message: "No AI provider configured." });

      const { sendSharedMessage, getOrCreateDefaultSharedThread } = await import("~/premium/collaboration/ai-threads");
      const { getSession } = await import("~/premium/collaboration/session-manager");

      const session = await getSession(ctx.db, input.sessionId);
      const threadId = input.threadId ?? (await getOrCreateDefaultSharedThread(ctx.db, input.sessionId)).id;

      const result = await sendSharedMessage(ctx.db, {
        threadId,
        sessionId: input.sessionId,
        userId: ctx.session.address,
        displayName: input.displayName,
        content: input.message,
        pdfAnalysis: (session?.session as any)?.pdfAnalysis,
        complete: async (messages) => {
          const response = await ai.complete(
            {
              provider: resolved.key.provider,
              model: input.model ?? resolved.model,
              messages: messages as any,
              maxTokens: 4096,
            },
            resolved.key,
          );
          return {
            content: response.content,
            usage: response.usage,
            model: response.model,
            provider: response.provider,
          };
        },
      });

      return { threadId, userMessage: result.userMessage, aiMessage: result.aiMessage };
    }),

  // ── Private AI ──

  getPrivateThreads: authedProcedure.input(z.object({ sessionId: z.string() })).query(async ({ ctx, input }) => {
    await requireCollabFeatureForSession(ctx, "collab_shared_ai");
    const { getPrivateThreads } = await import("~/premium/collaboration/ai-threads");
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
      const ai = await loadPremiumAi();
      if (!ai) throw new TRPCError({ code: "FORBIDDEN", message: "AI not available" });

      const resolved = await ai.resolveKeyWithFallback(ctx.session.address, (input.provider as any) ?? "anthropic");
      if (!resolved) throw new TRPCError({ code: "BAD_REQUEST", message: "No AI provider configured." });

      const { sendPrivateMessage, getOrCreateDefaultPrivateThread } =
        await import("~/premium/collaboration/ai-threads");
      const { getSession } = await import("~/premium/collaboration/session-manager");

      const session = await getSession(ctx.db, input.sessionId);
      const threadId =
        input.threadId ?? (await getOrCreateDefaultPrivateThread(ctx.db, input.sessionId, ctx.session.address)).id;

      const result = await sendPrivateMessage(ctx.db, {
        threadId,
        sessionId: input.sessionId,
        userId: ctx.session.address,
        content: input.message,
        pdfAnalysis: (session?.session as any)?.pdfAnalysis,
        complete: async (messages) => {
          const response = await ai.complete(
            {
              provider: resolved.key.provider,
              model: input.model ?? resolved.model,
              messages: messages as any,
              maxTokens: 4096,
            },
            resolved.key,
          );
          return {
            content: response.content,
            usage: response.usage,
            model: response.model,
            provider: response.provider,
          };
        },
      });

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
      const { createShareableLink } = await import("~/premium/collaboration/shareable-links");
      return createShareableLink(ctx.db, {
        sessionId: input.sessionId,
        createdBy: ctx.session.address,
        anchor: input.anchor,
        expiresInHours: input.expiresInHours,
      });
    }),

  resolveLink: authedProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
    await requireCollabFeatureForSession(ctx, "collab_shareable_links");
    const { resolveShareableLink } = await import("~/premium/collaboration/shareable-links");
    const link = await resolveShareableLink(ctx.db, input.token);
    if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "Link not found or expired" });
    return link;
  }),

  sessionLinks: authedProcedure.input(z.object({ sessionId: z.string() })).query(async ({ ctx, input }) => {
    await requireCollabFeatureForSession(ctx, "collab_shareable_links");
    const { getLinksForSession } = await import("~/premium/collaboration/shareable-links");
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
      const { collabSessions } = await import("~/premium/collaboration/schema");
      const { eq } = await import("drizzle-orm");

      const pdfAnalysis = {
        pageCount: input.pageCount ?? 0,
        title: input.title,
        sections: input.sections ?? [],
        rawText: input.rawText ?? "",
      };

      await ctx.db
        .update(collabSessions)
        .set({ pdfBlobUrl: input.pdfBlobUrl, pdfAnalysis })
        .where(eq(collabSessions.id, input.sessionId));

      return { ok: true, pdfAnalysis };
    }),
});
