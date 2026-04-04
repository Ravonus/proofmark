import { initTRPC, TRPCError } from "@trpc/server";
import { eq, and, gt } from "drizzle-orm";
import superjson from "superjson";
import { db } from "~/server/db";
import { walletSessions } from "~/server/db/schema";

export const createTRPCContext = async (opts?: { req?: Request }) => {
  let clientIp: string | null = null;
  let sessionToken: string | null = null;
  let apiKeyAuth: { address: string; chain: string } | null = null;

  if (opts?.req) {
    const hdrs = opts.req.headers;
    clientIp = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? hdrs.get("x-real-ip") ?? null;

    // Extract session token from cookie
    const cookie = hdrs.get("cookie") ?? "";
    const match = /(?:^|; )w3s_session=([^;]*)/.exec(cookie);
    if (match) sessionToken = decodeURIComponent(match[1] ?? "");

    // API key auth via x-api-key header (uses AUTOMATION_SECRET)
    const apiKey = hdrs.get("x-api-key");
    const automationSecret = process.env.AUTOMATION_SECRET;
    if (apiKey && automationSecret && apiKey === automationSecret) {
      const address = hdrs.get("x-wallet-address") ?? "0x0";
      const chain = hdrs.get("x-wallet-chain") ?? "ETH";
      apiKeyAuth = { address, chain };
    }
  }

  return { db, clientIp, sessionToken, apiKeyAuth, req: opts?.req };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

/**
 * Authenticated procedure — resolves wallet session token to address/chain.
 * Throws UNAUTHORIZED if no valid session.
 */
export const authedProcedure = t.procedure.use(async ({ ctx, next }) => {
  // API key auth (AUTOMATION_SECRET) — allows scripts/agents to act as a wallet
  if (ctx.apiKeyAuth) {
    return next({
      ctx: {
        ...ctx,
        session: { address: ctx.apiKeyAuth.address, chain: ctx.apiKeyAuth.chain, userId: null },
      },
    });
  }

  if (!ctx.sessionToken) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not signed in" });
  }

  const [session] = await ctx.db
    .select({
      address: walletSessions.address,
      chain: walletSessions.chain,
      userId: walletSessions.userId,
    })
    .from(walletSessions)
    .where(and(eq(walletSessions.token, ctx.sessionToken), gt(walletSessions.expiresAt, new Date())))
    .limit(1);

  if (!session) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Session expired" });
  }

  return next({
    ctx: {
      ...ctx,
      session: { address: session.address, chain: session.chain, userId: session.userId },
    },
  });
});
