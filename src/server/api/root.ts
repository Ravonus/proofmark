import { createTRPCRouter } from "~/server/api/trpc";
import { authRouter } from "~/server/api/routers/auth";
import { accountRouter } from "~/server/api/routers/account";
import { documentRouter } from "~/server/api/routers/document";
import { anchorRouter } from "~/server/api/routers/anchor";
import { vaultRouter } from "~/server/api/routers/vault";
import { searchRouter } from "~/server/api/routers/search";
import { connectorRouter } from "~/server/api/routers/connector";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  account: accountRouter,
  document: documentRouter,
  anchor: anchorRouter,
  vault: vaultRouter,
  search: searchRouter,
  connector: connectorRouter,
});

export type AppRouter = typeof appRouter;
