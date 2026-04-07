/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
/**
 * Escrow router — OSS stub.
 * Full implementation: premium/server/routers/escrow.ts
 */

import { isPremiumAvailable } from "~/lib/platform/premium";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const premiumRouter = isPremiumAvailable()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    (require("../../../../premium/server/routers/escrow") as { escrowRouter: unknown }).escrowRouter
  : null;

const stubRouter = createTRPCRouter({
  capabilities: publicProcedure.query(() => ({ available: false })),
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
export const escrowRouter: any = premiumRouter ?? stubRouter;
