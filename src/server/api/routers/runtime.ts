/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
/**
 * AI Runtime router — OSS stub.
 * Full implementation: premium/server/routers/runtime.ts
 */

import { isPremiumAvailable } from "~/lib/platform/premium";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const premiumRouter = isPremiumAvailable()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    (require("../../../../premium/server/routers/runtime") as { runtimeRouter: unknown }).runtimeRouter
  : null;

const stubRouter = createTRPCRouter({
  capabilities: publicProcedure.query(() => ({ available: false })),
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
export const runtimeRouter: any = premiumRouter ?? stubRouter;
