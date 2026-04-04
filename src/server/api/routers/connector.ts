/**
 * OpenClaw Connector tRPC router.
 *
 * Manages connector sessions, access tokens, and the task queue
 * for the open-source Rust connector app.
 */

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { loadPremiumAi } from "~/lib/premium";
import { TRPCError } from "@trpc/server";
import { eq, and, lt, desc, inArray } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { connectorSessions, connectorAccessTokens, connectorTasks } from "~/server/db/schema";
import { getOwnedWalletContextFromRequest, requireOwnedWalletActor } from "~/server/owned-wallet-context";
import type { db as _dbInstance } from "~/server/db";

type Db = typeof _dbInstance;

const CONNECTOR_FORBIDDEN = "Premium feature — upgrade to enable the OpenClaw connector";

async function getConnectorAccountContext(ctx: { req?: Request | null | undefined }) {
  const ownedWalletContext = await getOwnedWalletContextFromRequest(ctx.req ?? null);
  const actor = requireOwnedWalletActor(
    ownedWalletContext,
    "Link a wallet to this account before using connector settings.",
  );

  return {
    ownedWalletContext,
    ownerAddress: actor.address,
    userId: ownedWalletContext.identity.userId ?? null,
  };
}

async function findOwnedConnectorSession(db: Db, sessionId: string, ownedAddresses: string[]) {
  const [session] = await db
    .select()
    .from(connectorSessions)
    .where(
      ownedAddresses.length === 1
        ? and(eq(connectorSessions.id, sessionId), eq(connectorSessions.ownerAddress, ownedAddresses[0]!))
        : and(eq(connectorSessions.id, sessionId), inArray(connectorSessions.ownerAddress, ownedAddresses)),
    )
    .limit(1);

  if (!session) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Connector session not found" });
  }

  return session;
}

export const connectorRouter = createTRPCRouter({
  // ── Session Management ──

  /** Register a new connector session. */
  register: publicProcedure
    .input(
      z.object({
        connectorVersion: z.string(),
        machineId: z.string(),
        label: z.string().optional(),
        capabilities: z
          .object({
            supportedTools: z.array(z.string()).optional(),
            localModels: z.array(z.string()).optional(),
            maxConcurrency: z.number().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownerAddress, userId } = await getConnectorAccountContext(ctx);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- premium module type unresolvable in OSS build
      const ai = await loadPremiumAi();
      if (!ai) throw new TRPCError({ code: "FORBIDDEN", message: CONNECTOR_FORBIDDEN });

      const [session] = await ctx.db
        .insert(connectorSessions)
        .values({
          ownerAddress,
          userId,
          connectorVersion: input.connectorVersion,
          machineId: input.machineId,
          label: input.label,
          status: "online",
          lastHeartbeatAt: new Date(),
          capabilities: input.capabilities ?? null,
        })
        .returning();

      return { sessionId: session!.id };
    }),

  /** Connector heartbeat — keeps session alive. */
  heartbeat: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        status: z.enum(["online", "offline", "error"]).optional(),
        capabilities: z
          .object({
            supportedTools: z.array(z.string()).optional(),
            localModels: z.array(z.string()).optional(),
            maxConcurrency: z.number().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedWalletContext } = await getConnectorAccountContext(ctx);
      const session = await findOwnedConnectorSession(ctx.db, input.sessionId, ownedWalletContext.ownedAddresses);

      await ctx.db
        .update(connectorSessions)
        .set({
          status: input.status ?? "online",
          lastHeartbeatAt: new Date(),
          ...(input.capabilities ? { capabilities: input.capabilities } : {}),
          updatedAt: new Date(),
        })
        .where(eq(connectorSessions.id, session.id));

      // Return any pending tasks
      const tasks = await ctx.db
        .select()
        .from(connectorTasks)
        .where(
          and(
            eq(connectorTasks.connectorSessionId, input.sessionId),
            eq(connectorTasks.ownerAddress, session.ownerAddress),
            eq(connectorTasks.status, "pending"),
          ),
        )
        .orderBy(connectorTasks.createdAt)
        .limit(5);

      return { tasks };
    }),

  /** List active connector sessions for the account. */
  listSessions: publicProcedure.query(async ({ ctx }) => {
    const { ownedWalletContext } = await getConnectorAccountContext(ctx);
    // Mark stale sessions (no heartbeat in 60s) as offline
    const staleThreshold = new Date(Date.now() - 60000);
    await ctx.db
      .update(connectorSessions)
      .set({ status: "offline", updatedAt: new Date() })
      .where(
        and(
          ownedWalletContext.ownedAddresses.length === 1
            ? eq(connectorSessions.ownerAddress, ownedWalletContext.ownedAddresses[0]!)
            : inArray(connectorSessions.ownerAddress, ownedWalletContext.ownedAddresses),
          eq(connectorSessions.status, "online"),
          lt(connectorSessions.lastHeartbeatAt, staleThreshold),
        ),
      );

    return ctx.db
      .select()
      .from(connectorSessions)
      .where(
        ownedWalletContext.ownedAddresses.length === 1
          ? eq(connectorSessions.ownerAddress, ownedWalletContext.ownedAddresses[0]!)
          : inArray(connectorSessions.ownerAddress, ownedWalletContext.ownedAddresses),
      )
      .orderBy(desc(connectorSessions.lastHeartbeatAt));
  }),

  /** Remove a connector session. */
  removeSession: publicProcedure.input(z.object({ sessionId: z.string() })).mutation(async ({ ctx, input }) => {
    const { ownedWalletContext } = await getConnectorAccountContext(ctx);
    await findOwnedConnectorSession(ctx.db, input.sessionId, ownedWalletContext.ownedAddresses);
    await ctx.db.delete(connectorSessions).where(eq(connectorSessions.id, input.sessionId));
  }),

  // ── Access Tokens ──

  /** Create a long-lived access token for a connector. */
  createToken: publicProcedure
    .input(
      z.object({
        label: z.string(),
        scopes: z.array(z.string()).optional(),
        expiresInDays: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownerAddress, userId } = await getConnectorAccountContext(ctx);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- premium module type unresolvable in OSS build
      const ai = await loadPremiumAi();
      if (!ai) throw new TRPCError({ code: "FORBIDDEN", message: CONNECTOR_FORBIDDEN });

      // Generate token
      const rawToken = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(rawToken).digest("hex");

      const expiresAt = input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400000) : null;

      await ctx.db.insert(connectorAccessTokens).values({
        ownerAddress,
        userId,
        tokenHash,
        label: input.label,
        scopes: input.scopes ?? ["ai:read", "ai:write", "connector:heartbeat"],
        expiresAt,
      });

      // Return the raw token ONCE — it can never be retrieved again
      return {
        token: rawToken,
        label: input.label,
        expiresAt: expiresAt?.toISOString() ?? null,
      };
    }),

  /** List access tokens (without the actual token values). */
  listTokens: publicProcedure.query(async ({ ctx }) => {
    const { ownedWalletContext } = await getConnectorAccountContext(ctx);
    return ctx.db
      .select({
        id: connectorAccessTokens.id,
        label: connectorAccessTokens.label,
        scopes: connectorAccessTokens.scopes,
        expiresAt: connectorAccessTokens.expiresAt,
        lastUsedAt: connectorAccessTokens.lastUsedAt,
        revokedAt: connectorAccessTokens.revokedAt,
        createdAt: connectorAccessTokens.createdAt,
      })
      .from(connectorAccessTokens)
      .where(
        ownedWalletContext.ownedAddresses.length === 1
          ? eq(connectorAccessTokens.ownerAddress, ownedWalletContext.ownedAddresses[0]!)
          : inArray(connectorAccessTokens.ownerAddress, ownedWalletContext.ownedAddresses),
      )
      .orderBy(desc(connectorAccessTokens.createdAt));
  }),

  /** Revoke an access token. */
  revokeToken: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { ownedWalletContext } = await getConnectorAccountContext(ctx);
    await ctx.db
      .update(connectorAccessTokens)
      .set({ revokedAt: new Date() })
      .where(
        ownedWalletContext.ownedAddresses.length === 1
          ? and(
              eq(connectorAccessTokens.id, input.id),
              eq(connectorAccessTokens.ownerAddress, ownedWalletContext.ownedAddresses[0]!),
            )
          : and(
              eq(connectorAccessTokens.id, input.id),
              inArray(connectorAccessTokens.ownerAddress, ownedWalletContext.ownedAddresses),
            ),
      );
  }),

  // ── Task Queue ──

  /** Submit a task for a connector to process. */
  submitTask: publicProcedure
    .input(
      z.object({
        connectorSessionId: z.string(),
        taskType: z.string(),
        payload: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedWalletContext } = await getConnectorAccountContext(ctx);
      const session = await findOwnedConnectorSession(
        ctx.db,
        input.connectorSessionId,
        ownedWalletContext.ownedAddresses,
      );

      const [task] = await ctx.db
        .insert(connectorTasks)
        .values({
          connectorSessionId: input.connectorSessionId,
          ownerAddress: session.ownerAddress,
          taskType: input.taskType,
          payload: input.payload,
        })
        .returning();

      return { taskId: task!.id };
    }),

  /** Connector reports task completion. */
  completeTask: publicProcedure
    .input(
      z.object({
        taskId: z.string(),
        result: z.unknown(),
        status: z.enum(["completed", "failed"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedWalletContext } = await getConnectorAccountContext(ctx);
      await ctx.db
        .update(connectorTasks)
        .set({
          status: input.status,
          result: input.result,
          completedAt: new Date(),
        })
        .where(
          ownedWalletContext.ownedAddresses.length === 1
            ? and(
                eq(connectorTasks.id, input.taskId),
                eq(connectorTasks.ownerAddress, ownedWalletContext.ownedAddresses[0]!),
              )
            : and(
                eq(connectorTasks.id, input.taskId),
                inArray(connectorTasks.ownerAddress, ownedWalletContext.ownedAddresses),
              ),
        );
    }),

  /** Get task status. */
  getTask: publicProcedure.input(z.object({ taskId: z.string() })).query(async ({ ctx, input }) => {
    const { ownedWalletContext } = await getConnectorAccountContext(ctx);
    const [task] = await ctx.db
      .select()
      .from(connectorTasks)
      .where(
        ownedWalletContext.ownedAddresses.length === 1
          ? and(
              eq(connectorTasks.id, input.taskId),
              eq(connectorTasks.ownerAddress, ownedWalletContext.ownedAddresses[0]!),
            )
          : and(
              eq(connectorTasks.id, input.taskId),
              inArray(connectorTasks.ownerAddress, ownedWalletContext.ownedAddresses),
            ),
      )
      .limit(1);

    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    return task;
  }),
});
