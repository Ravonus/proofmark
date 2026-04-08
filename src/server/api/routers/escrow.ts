/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Escrow router — OSS stub.
 * Full implementation: premium/server/routers/escrow.ts
 */

import { isPremiumAvailable } from "~/lib/platform/premium";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

const premiumRouter = isPremiumAvailable()
  ? (
      require("../../../../premium/server/routers/escrow") as {
        escrowRouter: unknown;
      }
    ).escrowRouter
  : null;

const stubRouter = createTRPCRouter({
  capabilities: publicProcedure.query(() => ({ available: false })),
});

export const escrowRouter: any = premiumRouter ?? stubRouter;
