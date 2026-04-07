/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
/**
 * AI router — OSS stub.
 *
 * In premium builds, the full router is loaded from premium/server/routers/ai.ts.
 * In OSS builds, all procedures return { available: false } or FORBIDDEN.
 *
 * The premium router is re-exported to preserve the type surface for tRPC clients.
 */

import { z } from "zod";
import { isPremiumAvailable } from "~/lib/platform/premium";

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const premiumRouter = isPremiumAvailable()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    (require("../../../../premium/server/routers/ai") as { aiRouter: unknown }).aiRouter
  : null;

// Fall back to a minimal stub if premium is not available
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

const stubRouter = createTRPCRouter({
  capabilities: publicProcedure.query(() => ({ available: false })),
  listProviders: publicProcedure.query((): any => ({
    registry: [],
    providers: [],
    platform: [],
  })),
  upsertProvider: publicProcedure.input(z.any()).mutation((): any => ({ success: false })),
  deleteProvider: publicProcedure.input(z.any()).mutation((): any => ({ success: false })),
  testProvider: publicProcedure.input(z.any()).mutation((): any => ({
    success: false,
    error: "Premium feature unavailable",
    latencyMs: 0,
  })),
  usageSummary: publicProcedure.input(z.any().optional()).query((): any => ({
    totalRequests: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    byProvider: [],
  })),
  getUserLimitStatus: publicProcedure.input(z.any().optional()).query((): any => ({
    defaults: null,
    users: [],
  })),
  setDefaultLimits: publicProcedure.input(z.any()).mutation((): any => ({ success: false })),
  setUserLimits: publicProcedure.input(z.any()).mutation((): any => ({ success: false })),
  editorChat: publicProcedure.input(z.any()).mutation((): any => ({
    response: {
      text: "Premium feature unavailable",
      editOperations: [],
    },
  })),
  scraperFix: publicProcedure.input(z.any()).mutation((): any => ({
    corrected: null,
    changes: [],
    response: null,
  })),
  signerAsk: publicProcedure.input(z.any()).mutation((): any => ({
    answer: "Premium feature unavailable",
  })),
  signerSummary: publicProcedure.input(z.any()).mutation((): any => ({
    summary: "Premium feature unavailable",
  })),
});

export const aiRouter = (premiumRouter ?? stubRouter) as typeof stubRouter;
