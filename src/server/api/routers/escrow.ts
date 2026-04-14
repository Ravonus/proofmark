/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Escrow router — OSS stub.
 * Full implementation: premium/server/routers/escrow.ts
 */

import { escrowRouter as premiumRouter } from "~/generated/premium/server/routers/escrow";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

const stubRouter = createTRPCRouter({
  capabilities: publicProcedure.query(() => ({ available: false })),
});

export const escrowRouter: any = premiumRouter ?? stubRouter;
