/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AI Runtime router — OSS stub.
 * Full implementation: premium/server/routers/runtime.ts
 */

import { runtimeRouter as premiumRouter } from "~/generated/premium/server/routers/runtime";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

const stubRouter = createTRPCRouter({
  capabilities: publicProcedure.query(() => ({ available: false })),
});

export const runtimeRouter: any = premiumRouter ?? stubRouter;
