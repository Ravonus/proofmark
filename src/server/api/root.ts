import { accountRouter } from "~/server/api/routers/account";
import { aiRouter } from "~/server/api/routers/ai";
import { anchorRouter } from "~/server/api/routers/anchor";
import { authRouter } from "~/server/api/routers/auth";
import { collabRouter } from "~/server/api/routers/collab";
import { connectorRouter } from "~/server/api/routers/connector";
import { documentRouter } from "~/server/api/routers/document";
import { escrowRouter } from "~/server/api/routers/escrow";
import { runtimeRouter } from "~/server/api/routers/runtime";
import { searchRouter } from "~/server/api/routers/search";
import { vaultRouter } from "~/server/api/routers/vault";
import { createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  account: accountRouter,
  document: documentRouter,
  anchor: anchorRouter,
  vault: vaultRouter,
  search: searchRouter,
  connector: connectorRouter,
  ai: aiRouter,
  collab: collabRouter,
  escrow: escrowRouter as ReturnType<typeof createTRPCRouter>,
  runtime: runtimeRouter as ReturnType<typeof createTRPCRouter>,
});

export type AppRouter = typeof appRouter;
