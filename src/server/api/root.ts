import { createTRPCRouter } from "~/server/api/trpc";
import { authRouter } from "~/server/api/routers/auth";
import { accountRouter } from "~/server/api/routers/account";
import { documentRouter } from "~/server/api/routers/document";
import { anchorRouter } from "~/server/api/routers/anchor";
import { vaultRouter } from "~/server/api/routers/vault";
import { searchRouter } from "~/server/api/routers/search";
import { connectorRouter } from "~/server/api/routers/connector";
import { aiRouter } from "~/server/api/routers/ai";
import { collabRouter } from "~/server/api/routers/collab";
import { escrowRouter } from "~/server/api/routers/escrow";
import { runtimeRouter } from "~/server/api/routers/runtime";

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
