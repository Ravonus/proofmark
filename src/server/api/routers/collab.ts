/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
/**
 * Collaboration router — OSS stub.
 * Full implementation: premium/server/routers/collab.ts
 */

import { isPremiumAvailable } from "~/lib/platform/premium";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const premiumRouter = isPremiumAvailable()
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    (require("../../../../premium/server/routers/collab") as { collabRouter: unknown }).collabRouter
  : null;

const stubRouter = createTRPCRouter({
  capabilities: publicProcedure.query(() => ({ available: false })),
});

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
export const collabRouter: any = premiumRouter ?? stubRouter;
