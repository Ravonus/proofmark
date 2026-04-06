/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
/**
 * AI router — OSS stub.
 *
 * In premium builds, the full router is loaded from premium/server/routers/ai.ts.
 * In OSS builds, all procedures return { available: false } or FORBIDDEN.
 *
 * The premium router is re-exported to preserve the type surface for tRPC clients.
 */

import { isPremiumAvailable } from "~/lib/premium";

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const premiumRouter = isPremiumAvailable()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    (require("../../../../premium/server/routers/ai") as { aiRouter: unknown }).aiRouter
  : null;

// Fall back to a minimal stub if premium is not available
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

const stubRouter = createTRPCRouter({
  capabilities: publicProcedure.query(() => ({ available: false })),
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
export const aiRouter: any = premiumRouter ?? stubRouter;
