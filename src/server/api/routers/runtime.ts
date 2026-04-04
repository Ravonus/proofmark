// @ts-nocheck
/**
 * Server-side AI runtime tRPC router.
 *
 * Admin-only procedures for installing, authorizing, and managing
 * Claude Code / Codex / OpenClaw CLIs on the hosting server.
 * Premium feature — returns FORBIDDEN in OSS builds.
 */

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { loadPremiumAi } from "~/lib/premium";
import { TRPCError } from "@trpc/server";
import { getOwnedWalletContextFromRequest, requireOwnedWalletActor } from "~/server/owned-wallet-context";

const RUNTIME_FORBIDDEN = "Premium feature — upgrade to enable server-side AI runtime";

const zTool = z.enum(["claude-code", "codex", "openclaw"]);

async function requireRuntimeAdmin(ctx: { req?: Request | null | undefined }) {
  const ai = await loadPremiumAi();
  if (!ai) throw new TRPCError({ code: "FORBIDDEN", message: RUNTIME_FORBIDDEN });

  const ownedWalletContext = await getOwnedWalletContextFromRequest(ctx.req ?? null);
  const actor = requireOwnedWalletActor(
    ownedWalletContext,
    "Link a wallet to this account before managing the AI runtime.",
  );

  return { ai, ownerAddress: actor.address, userId: ownedWalletContext.identity.userId ?? undefined };
}

export const runtimeRouter = createTRPCRouter({
  // ── Status ──

  /** Get full runtime status: installed tools, auth, active sessions, routing. */
  getStatus: publicProcedure.query(async ({ ctx }) => {
    const { ai, ownerAddress } = await requireRuntimeAdmin(ctx);

    const [tools, prereqs, sessions, routing] = await Promise.all([
      ai.getInstalledTools(),
      ai.detectSystemPrereqs(),
      ai.getActiveSessions(),
      ai.getRoutingStatus(ownerAddress),
    ]);

    return {
      tools: tools.map((t) => ({
        tool: t.tool,
        status: t.status,
        version: t.version,
        binaryPath: t.binaryPath,
        authStatus: t.authStatus,
        lastHealthCheck: t.lastHealthCheckAt,
        errorMessage: t.errorMessage,
        config: t.config,
      })),
      prereqs,
      sessions: sessions.map((s) => ({
        id: s.id,
        tool: s.tool,
        status: s.status,
        startedAt: s.startedAt,
        lastActivityAt: s.lastActivityAt,
        requestCount: s.requestCount,
        errorCount: s.errorCount,
      })),
      routing,
    };
  }),

  // ── Installation ──

  /** Install a CLI tool on the server. */
  install: publicProcedure.input(z.object({ tool: zTool })).mutation(async ({ ctx, input }) => {
    const { ai } = await requireRuntimeAdmin(ctx);
    const result = await ai.installTool(input.tool);
    return result;
  }),

  /** Uninstall a CLI tool. */
  uninstall: publicProcedure.input(z.object({ tool: zTool })).mutation(async ({ ctx, input }) => {
    const { ai } = await requireRuntimeAdmin(ctx);
    await ai.uninstallTool(input.tool);
    return { success: true };
  }),

  // ── Authorization ──

  /** Authorize a tool with an API key. */
  authorize: publicProcedure
    .input(z.object({ tool: zTool, apiKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { ai } = await requireRuntimeAdmin(ctx);
      await ai.authorizeToolWithApiKey(input.tool, input.apiKey);
      return { success: true };
    }),

  /** Revoke authorization for a tool. */
  revokeAuth: publicProcedure.input(z.object({ tool: zTool })).mutation(async ({ ctx, input }) => {
    const { ai } = await requireRuntimeAdmin(ctx);
    await ai.revokeAuth(input.tool);
    return { success: true };
  }),

  // ── Health ──

  /** Run health check on a specific tool or all installed tools. */
  healthCheck: publicProcedure.input(z.object({ tool: zTool.optional() })).mutation(async ({ ctx, input }) => {
    const { ai } = await requireRuntimeAdmin(ctx);

    if (input.tool) {
      const health = await ai.checkToolHealth(input.tool);
      return { tools: [health] };
    }

    const tools = await ai.getInstalledTools();
    const results = await Promise.all(
      tools
        .filter((t) => t.status !== "not_installed")
        .map((t) => ai.checkToolHealth(t.tool as "claude-code" | "codex" | "openclaw")),
    );

    return { tools: results };
  }),

  // ── Sessions ──

  /** Get active pipe sessions. */
  getActiveSessions: publicProcedure.query(async ({ ctx }) => {
    await requireRuntimeAdmin(ctx);
    const { ai } = await requireRuntimeAdmin(ctx);
    const sessions = ai.getActiveSessions();
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        tool: s.tool,
        status: s.status,
        startedAt: s.startedAt,
        lastActivityAt: s.lastActivityAt,
        requestCount: s.requestCount,
        errorCount: s.errorCount,
      })),
    };
  }),

  /** Shutdown all pipe sessions. */
  shutdownSessions: publicProcedure.mutation(async ({ ctx }) => {
    const { ai } = await requireRuntimeAdmin(ctx);
    await ai.shutdownAll();
    return { success: true };
  }),

  // ── Routing ──

  /** Get current routing status and priority chain. */
  getRoutingStatus: publicProcedure.query(async ({ ctx }) => {
    const { ai, ownerAddress } = await requireRuntimeAdmin(ctx);
    return ai.getRoutingStatus(ownerAddress);
  }),

  // ── Configuration ──

  /** Update runtime configuration for a tool. */
  setConfig: publicProcedure
    .input(
      z.object({
        tool: zTool,
        config: z.object({
          maxSessionsPerTool: z.number().min(1).max(10).optional(),
          idleTimeoutMs: z.number().min(60000).max(3600000).optional(),
          requestTimeoutMs: z.number().min(30000).max(600000).optional(),
          enabledForUsers: z.boolean().optional(),
          fiveHourMaxRequests: z.number().min(1).max(1000).optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireRuntimeAdmin(ctx);

      const { eq } = await import("drizzle-orm");
      const { aiRuntimeInstalls } = await import("~/server/db/schema");

      const [existing] = await ctx.db
        .select()
        .from(aiRuntimeInstalls)
        .where(eq(aiRuntimeInstalls.tool, input.tool))
        .limit(1);

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: `${input.tool} is not installed` });
      }

      await ctx.db
        .update(aiRuntimeInstalls)
        .set({
          config: { ...existing.config, ...input.config },
          updatedAt: new Date(),
        })
        .where(eq(aiRuntimeInstalls.id, existing.id));

      return { success: true };
    }),

  // ── System prerequisites ──

  /** Check system prerequisites (npm, node, cargo). */
  checkPrereqs: publicProcedure.query(async ({ ctx }) => {
    const { ai } = await requireRuntimeAdmin(ctx);
    return ai.detectSystemPrereqs();
  }),
});
