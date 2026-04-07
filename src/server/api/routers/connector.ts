/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Connector router — OSS stub.
 * Full implementation: premium/server/routers/connector.ts
 */

import { z } from "zod";
import { isPremiumAvailable } from "~/lib/platform/premium";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

const premiumRouter = isPremiumAvailable()
  ? (require("../../../../premium/server/routers/connector") as { connectorRouter: unknown }).connectorRouter
  : null;

const stubRouter = createTRPCRouter({
  listSessions: publicProcedure.input(z.any().optional()).query((): any => []),
  listTokens: publicProcedure.input(z.any().optional()).query((): any => []),
  createToken: publicProcedure.input(z.any()).mutation((): any => ({
    token: "",
    label: "",
    expiresAt: null,
  })),
  revokeToken: publicProcedure.input(z.any()).mutation((): any => ({ success: false })),
  removeSession: publicProcedure.input(z.any()).mutation((): any => ({ success: false })),
});

export const connectorRouter = (premiumRouter ?? stubRouter) as typeof stubRouter;
