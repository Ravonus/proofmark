// @ts-nocheck -- tRPC context types break type inference; typed helpers in account.ts
/**
 * Admin & PDF style template procedures — split from account.ts for file-length compliance.
 */
import { TRPCError } from "@trpc/server";
import { execFile } from "child_process";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { existsSync } from "fs";
import { z } from "zod";
import { type createTRPCContext, createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { isDevAdmin } from "~/server/crypto/operator-access";
import { getOwnedWalletContextFromRequest, resolveOwnedAdminAccess } from "~/server/crypto/owned-wallet-context";
import {
  aiRateLimits,
  aiUsageLogs,
  auditEvents,
  documents,
  pdfStyleTemplates,
  signers,
  users,
  walletSessions,
} from "~/server/db/schema";

const pdfStyleSettingsSchema = z.object({
  themePreset: z.string(),
  customOverrides: z.record(z.unknown()).optional(),
  tocEnabled: z.boolean().optional(),
  tocPageThreshold: z.number().min(1).max(50).optional(),
  fieldSummaryStyle: z.enum(["hybrid", "cards", "table"]).optional(),
  fieldIndexEnabled: z.boolean().optional(),
  fieldIndexPerSigner: z.boolean().optional(),
  fieldIndexCombined: z.boolean().optional(),
});

async function requireAdminAccess(ctx: Awaited<ReturnType<typeof createTRPCContext>>) {
  const ownedWalletContext = await getOwnedWalletContextFromRequest(ctx.req ?? null);
  const adminAccess = await resolveOwnedAdminAccess(ownedWalletContext);

  if (!adminAccess.adminWallet && !isDevAdmin()) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }

  return { ownedWalletContext, linkedOwnerWallet: adminAccess.adminWallet };
}

function requirePrimaryOwnerAddress(ownerAddress: string | null) {
  if (!ownerAddress) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Link a wallet to this account before managing wallet-owned workspace settings.",
    });
  }

  return ownerAddress;
}

export const accountAdminRouter = createTRPCRouter({
  /** Aggregated admin stats for the overview dashboard. */
  adminStats: publicProcedure.query(async ({ ctx }) => {
    await requireAdminAccess(ctx);

    const [docRows, signerRows, sessionRows, userRows, auditRows] = await Promise.all([
      ctx.db
        .select({
          total: count(),
          pending: count(sql`CASE WHEN ${documents.status} = 'PENDING' THEN 1 END`),
          completed: count(sql`CASE WHEN ${documents.status} = 'COMPLETED' THEN 1 END`),
          expired: count(sql`CASE WHEN ${documents.status} = 'EXPIRED' THEN 1 END`),
          voided: count(sql`CASE WHEN ${documents.status} = 'VOIDED' THEN 1 END`),
        })
        .from(documents)
        .catch(() => [{ total: 0, pending: 0, completed: 0, expired: 0, voided: 0 }]),
      ctx.db
        .select({
          total: count(),
          signed: count(sql`CASE WHEN ${signers.status} = 'SIGNED' THEN 1 END`),
          declined: count(sql`CASE WHEN ${signers.status} = 'DECLINED' THEN 1 END`),
        })
        .from(signers)
        .catch(() => [{ total: 0, signed: 0, declined: 0 }]),
      ctx.db
        .select({ total: count() })
        .from(walletSessions)
        .catch(() => [{ total: 0 }]),
      ctx.db
        .select({ total: count() })
        .from(users)
        .catch(() => [{ total: 0 }]),
      ctx.db
        .select({ total: count() })
        .from(auditEvents)
        .catch(() => [{ total: 0 }]),
    ]);

    return {
      documents: docRows[0] ?? {
        total: 0,
        pending: 0,
        completed: 0,
        expired: 0,
        voided: 0,
      },
      signers: signerRows[0] ?? { total: 0, signed: 0, declined: 0 },
      sessions: sessionRows[0]?.total ?? 0,
      users: userRows[0]?.total ?? 0,
      auditEvents: auditRows[0]?.total ?? 0,
    };
  }),

  /** List AI rate limit records (admin only). */
  adminListAiLimits: publicProcedure.query(async ({ ctx }) => {
    await requireAdminAccess(ctx);

    try {
      return await ctx.db.query.aiRateLimits.findMany({
        orderBy: (t, { desc: orderDesc }) => [orderDesc(t.updatedAt)],
        limit: 50,
      });
    } catch {
      return [];
    }
  }),

  /** Set AI rate limits for a user (admin only). */
  adminSetAiLimits: publicProcedure
    .input(
      z.object({
        ownerAddress: z.string().min(1),
        userId: z.string().nullable().optional(),
        feature: z.enum(["scraper_fix", "editor_assistant", "signer_qa", "general"]).nullable().optional(),
        mode: z.enum(["platform", "admin"]).default("platform"),
        requestsPerMonth: z.number().int().min(0).max(100000).optional(),
        tokensPerMonth: z.number().int().min(0).max(100000000).optional(),
        maxRequestsPerHour: z.number().int().min(0).max(10000).optional(),
        maxRequestsPerWeek: z.number().int().min(0).max(100000).optional(),
        adminRequestsPerHour: z.number().int().min(0).max(10000).nullable().optional(),
        adminRequestsPerDay: z.number().int().min(0).max(100000).nullable().optional(),
        adminRequestsPerMonth: z.number().int().min(0).max(1000000).nullable().optional(),
        adminTokensPerHour: z.number().int().min(0).max(100000000).nullable().optional(),
        adminTokensPerDay: z.number().int().min(0).max(100000000).nullable().optional(),
        adminTokensPerMonth: z.number().int().min(0).max(1000000000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdminAccess(ctx);

      const [record] = await ctx.db
        .insert(aiRateLimits)
        .values({
          ownerAddress: input.ownerAddress.trim().toLowerCase(),
          userId: input.userId ?? null,
          feature: input.feature ?? null,
          mode: input.mode,
          requestsPerMonth: input.requestsPerMonth ?? 500,
          tokensPerMonth: input.tokensPerMonth ?? 1000000,
          maxRequestsPerHour: input.maxRequestsPerHour ?? 30,
          maxRequestsPerWeek: input.maxRequestsPerWeek ?? 200,
          adminRequestsPerHour: input.adminRequestsPerHour ?? null,
          adminRequestsPerDay: input.adminRequestsPerDay ?? null,
          adminRequestsPerMonth: input.adminRequestsPerMonth ?? null,
          adminTokensPerHour: input.adminTokensPerHour ?? null,
          adminTokensPerDay: input.adminTokensPerDay ?? null,
          adminTokensPerMonth: input.adminTokensPerMonth ?? null,
        })
        .returning();
      return record;
    }),

  /** Delete an AI rate limit record (admin only). */
  adminDeleteAiLimit: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await requireAdminAccess(ctx);

    await ctx.db.delete(aiRateLimits).where(eq(aiRateLimits.id, input.id));
    return { ok: true };
  }),

  /** AI usage summary for admin dashboard. */
  adminAiUsage: publicProcedure.query(async ({ ctx }) => {
    await requireAdminAccess(ctx);

    try {
      const [totals] = await ctx.db
        .select({
          totalRequests: count(),
          totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.inputTokens}), 0)`,
          totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.outputTokens}), 0)`,
          totalCostCents: sql<number>`COALESCE(SUM(${aiUsageLogs.costCents}), 0)`,
        })
        .from(aiUsageLogs);

      return (
        totals ?? {
          totalRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCostCents: 0,
        }
      );
    } catch {
      return {
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostCents: 0,
      };
    }
  }),

  /** Detect AI CLI tools installed on the server. */
  detectAiTools: publicProcedure.query(async ({ ctx }) => {
    await requireAdminAccess(ctx);

    const TOOL_CANDIDATES: Array<{
      name: string;
      binary: string;
      paths: string[];
      versionFlag: string;
    }> = [
      {
        name: "Claude Code",
        binary: "claude",
        paths: [
          `${process.env.HOME}/.local/bin/claude`,
          `${process.env.HOME}/.claude/bin/claude`,
          "/usr/local/bin/claude",
          "/opt/homebrew/bin/claude",
        ],
        versionFlag: "--version",
      },
      {
        name: "Codex",
        binary: "codex",
        paths: [
          `${process.env.HOME}/.local/bin/codex`,
          "/usr/local/bin/codex",
          "/opt/homebrew/bin/codex",
          `${process.env.HOME}/.npm-global/bin/codex`,
        ],
        versionFlag: "--version",
      },
      {
        name: "OpenClaw",
        binary: "openclaw",
        paths: [
          `${process.env.HOME}/.local/bin/openclaw`,
          `${process.env.HOME}/.cargo/bin/openclaw`,
          "/usr/local/bin/openclaw",
          "/opt/homebrew/bin/openclaw",
        ],
        versionFlag: "--version",
      },
    ];

    const results: Array<{
      name: string;
      binary: string;
      found: boolean;
      path: string | null;
      version: string | null;
    }> = [];

    for (const tool of TOOL_CANDIDATES) {
      let foundPath: string | null = null;

      // Check known paths
      for (const p of tool.paths) {
        if (existsSync(p)) {
          foundPath = p;
          break;
        }
      }

      // Fall back to which
      if (!foundPath) {
        foundPath = await new Promise<string | null>((resolve) => {
          execFile("which", [tool.binary], { timeout: 3000 }, (err, stdout) => {
            if (err || !stdout.trim()) return resolve(null);
            resolve(stdout.trim());
          });
        });
      }

      // Get version if found
      let version: string | null = null;
      if (foundPath) {
        version = await new Promise<string | null>((resolve) => {
          execFile(foundPath, [tool.versionFlag], { timeout: 5000 }, (err, stdout, stderr) => {
            if (err) return resolve(null);
            const output = (stdout || stderr || "").trim();
            // Extract first line / version number
            const match = /\d+\.\d+[\.\d]*/m.exec(output);
            resolve(match ? match[0] : output.split("\n")[0]?.slice(0, 80) || null);
          });
        });
      }

      results.push({
        name: tool.name,
        binary: tool.binary,
        found: !!foundPath,
        path: foundPath,
        version,
      });
    }

    return results;
  }),

  // ═══ PDF Style Templates ═══════════════════════════════════════════════

  listPdfStyleTemplates: publicProcedure.query(async ({ ctx }) => {
    const { ownedAddresses } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
    if (ownedAddresses.length === 0) return [];

    const templates = await ctx.db.query.pdfStyleTemplates.findMany({
      where:
        ownedAddresses.length === 1
          ? eq(pdfStyleTemplates.ownerAddress, ownedAddresses[0]!)
          : inArray(pdfStyleTemplates.ownerAddress, ownedAddresses),
      orderBy: (t, { desc }) => [desc(t.isDefault), desc(t.createdAt)],
    });
    return templates;
  }),

  createPdfStyleTemplate: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        settings: pdfStyleSettingsSchema,
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { primaryOwnerAddress } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
      const owner = requirePrimaryOwnerAddress(primaryOwnerAddress);

      // If setting as default, clear existing default
      if (input.isDefault) {
        await ctx.db
          .update(pdfStyleTemplates)
          .set({ isDefault: false })
          .where(and(eq(pdfStyleTemplates.ownerAddress, owner), eq(pdfStyleTemplates.isDefault, true)));
      }

      const [created] = await ctx.db
        .insert(pdfStyleTemplates)
        .values({
          ownerAddress: owner,
          name: input.name,
          description: input.description ?? null,
          settings: input.settings,
          isDefault: input.isDefault ?? false,
          isBuiltIn: false,
        })
        .returning();

      return created!;
    }),

  updatePdfStyleTemplate: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        settings: pdfStyleSettingsSchema.optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedAddresses } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
      if (ownedAddresses.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

      // Verify ownership
      const existing = await ctx.db.query.pdfStyleTemplates.findFirst({
        where:
          ownedAddresses.length === 1
            ? and(eq(pdfStyleTemplates.id, input.id), eq(pdfStyleTemplates.ownerAddress, ownedAddresses[0]!))
            : and(eq(pdfStyleTemplates.id, input.id), inArray(pdfStyleTemplates.ownerAddress, ownedAddresses)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.isBuiltIn)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot edit built-in templates",
        });

      if (input.isDefault) {
        await ctx.db
          .update(pdfStyleTemplates)
          .set({ isDefault: false })
          .where(and(eq(pdfStyleTemplates.ownerAddress, existing.ownerAddress), eq(pdfStyleTemplates.isDefault, true)));
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.settings) updates.settings = input.settings;
      if (input.isDefault !== undefined) updates.isDefault = input.isDefault;

      const [updated] = await ctx.db
        .update(pdfStyleTemplates)
        .set(updates)
        .where(eq(pdfStyleTemplates.id, input.id))
        .returning();

      return updated!;
    }),

  deletePdfStyleTemplate: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { ownedAddresses } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
    if (ownedAddresses.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

    const existing = await ctx.db.query.pdfStyleTemplates.findFirst({
      where:
        ownedAddresses.length === 1
          ? and(eq(pdfStyleTemplates.id, input.id), eq(pdfStyleTemplates.ownerAddress, ownedAddresses[0]!))
          : and(eq(pdfStyleTemplates.id, input.id), inArray(pdfStyleTemplates.ownerAddress, ownedAddresses)),
    });
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    if (existing.isBuiltIn)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Cannot delete built-in templates",
      });

    await ctx.db.delete(pdfStyleTemplates).where(eq(pdfStyleTemplates.id, input.id));
    return { success: true };
  }),
});
