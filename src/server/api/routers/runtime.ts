/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI Runtime router — OSS stub.
 * Full implementation: premium/server/routers/runtime.ts
 */

import { isPremiumAvailable } from "~/lib/platform/premium";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

const premiumRouter = isPremiumAvailable()
  ? (
      require("../../../../premium/server/routers/runtime") as {
        runtimeRouter: unknown;
      }
    ).runtimeRouter
  : null;

const stubRouter = createTRPCRouter({
  capabilities: publicProcedure.query(() => ({ available: false })),
});

export const runtimeRouter: any = premiumRouter ?? stubRouter;
