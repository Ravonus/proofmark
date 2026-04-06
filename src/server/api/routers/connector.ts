/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Connector router — OSS stub.
 * Full implementation: premium/server/routers/connector.ts
 */

import { isPremiumAvailable } from "~/lib/premium";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

 
const premiumRouter = isPremiumAvailable()
  ?  
    (require("../../../../premium/server/routers/connector") as { connectorRouter: unknown }).connectorRouter
  : null;

const stubRouter = createTRPCRouter({
  listSessions: publicProcedure.query(() => []),
});

 
export const connectorRouter: any = premiumRouter ?? stubRouter;
