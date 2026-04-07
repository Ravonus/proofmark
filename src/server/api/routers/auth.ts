import { z } from "zod";
import { randomBytes } from "crypto";
import { eq, and, gt, isNull } from "drizzle-orm";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  createOrUpdateMergeRequest,
  dismissMergeRequest,
  findUserByWallet,
  getBetterAuthSessionFromHeaders,
  linkWalletToUser,
  mergeCurrentIdentityAccounts,
  syncCurrentIdentityFromRequest,
} from "~/server/auth/auth-identity";
import { authChallenges, walletSessions } from "~/server/db/schema";
import { verifySignature } from "~/server/crypto/rust-engine";
import { normalizeAddress, type WalletChain } from "~/lib/crypto/chains";
import { getConfiguredProviders } from "~/server/auth/auth";

const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 min
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function buildChallengeMessage(nonce: string, address: string): string {
  return [
    "Proofmark — Wallet Verification",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    "",
    "Sign this message to prove wallet ownership.",
    "This does not trigger a blockchain transaction.",
  ].join("\n");
}

export const authRouter = createTRPCRouter({
  /** Return which SSO providers are configured so the login UI can show them. */
  providers: publicProcedure.query(() => {
    return { sso: getConfiguredProviders() };
  }),

  identityStatus: publicProcedure.query(async ({ ctx }) => {
    return syncCurrentIdentityFromRequest(ctx.req ?? null);
  }),

  mergeAccounts: publicProcedure.mutation(async ({ ctx }) => {
    return mergeCurrentIdentityAccounts(ctx.req ?? null);
  }),

  dismissMergePrompt: publicProcedure.mutation(async ({ ctx }) => {
    const status = await syncCurrentIdentityFromRequest(ctx.req ?? null);
    if (status.status !== "merge-required" || !status.authUser || !status.mergeRequest) {
      return { ok: true };
    }

    await dismissMergeRequest({
      currentUserId: status.authUser.id,
      conflictingUserId: status.mergeRequest.conflictingUser.id,
      walletAddress: status.mergeRequest.wallet.address,
      walletChain: status.mergeRequest.wallet.chain,
    });

    return { ok: true };
  }),

  challenge: publicProcedure
    .input(
      z.object({
        address: z.string().min(1),
        chain: z.enum(["ETH", "SOL", "BTC"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const address = normalizeAddress(input.chain as WalletChain, input.address);
      const nonce = randomBytes(32).toString("hex");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);

      await ctx.db.insert(authChallenges).values({
        nonce,
        address,
        chain: input.chain,
        createdAt: now,
        expiresAt,
      });

      return {
        nonce,
        message: buildChallengeMessage(nonce, address),
        expiresAt: expiresAt.toISOString(),
      };
    }),

  verify: publicProcedure
    .input(
      z.object({
        nonce: z.string(),
        address: z.string().min(1),
        chain: z.enum(["ETH", "SOL", "BTC"]),
        signature: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const address = normalizeAddress(input.chain as WalletChain, input.address);

      // Find unconsumed, unexpired challenge
      const [challenge] = await ctx.db
        .select()
        .from(authChallenges)
        .where(
          and(
            eq(authChallenges.nonce, input.nonce),
            eq(authChallenges.address, address),
            gt(authChallenges.expiresAt, new Date()),
            isNull(authChallenges.consumed),
          ),
        )
        .limit(1);

      if (!challenge) throw new Error("Challenge expired or invalid");

      const message = buildChallengeMessage(input.nonce, address);
      const result = await verifySignature({
        chain: input.chain as WalletChain,
        address,
        message,
        signature: input.signature,
      });

      if (!result.ok) {
        const debugInfo =
          result.debug.length > 0 ? `\n\n--- DEBUG (${input.chain} / ${address}) ---\n${result.debug.join("\n")}` : "";
        throw new Error(`Signature verification failed (scheme=${result.scheme})${debugInfo}`);
      }

      // Consume the challenge
      await ctx.db.update(authChallenges).set({ consumed: new Date() }).where(eq(authChallenges.id, challenge.id));

      // Create session token
      const token = randomBytes(48).toString("base64url");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

      const authSession = ctx.req ? await getBetterAuthSessionFromHeaders(ctx.req) : null;
      const walletOwner = await findUserByWallet({ address, chain: input.chain });

      let userId = walletOwner?.user.id ?? null;
      let mergeRequestId: string | null = null;
      let mergeRequired = false;

      if (authSession) {
        if (!walletOwner) {
          await linkWalletToUser({
            userId: authSession.user.id,
            address,
            chain: input.chain,
          });
          userId = authSession.user.id;
        } else if (walletOwner.user.id === authSession.user.id) {
          userId = authSession.user.id;
        } else {
          const mergeRequest = await createOrUpdateMergeRequest({
            currentUserId: authSession.user.id,
            conflictingUserId: walletOwner.user.id,
            walletAddress: address,
            walletChain: input.chain,
            email: authSession.user.email,
            reason: "This wallet is already attached to a different account.",
          });
          mergeRequestId = mergeRequest.id;
          mergeRequired = mergeRequest.status === "PENDING";
          userId = walletOwner.user.id;
        }
      }

      await ctx.db.insert(walletSessions).values({
        token,
        address,
        chain: input.chain,
        userId,
        createdAt: now,
        expiresAt,
      });

      return {
        token,
        expiresAt: expiresAt.toISOString(),
        mergeRequired,
        mergeRequestId,
      };
    }),

  me: publicProcedure.input(z.object({ token: z.string() })).query(async ({ ctx, input }) => {
    const [session] = await ctx.db
      .select({
        address: walletSessions.address,
        chain: walletSessions.chain,
        userId: walletSessions.userId,
      })
      .from(walletSessions)
      .where(and(eq(walletSessions.token, input.token), gt(walletSessions.expiresAt, new Date())))
      .limit(1);

    if (!session) return null;
    return { address: session.address, chain: session.chain, userId: session.userId };
  }),

  logout: publicProcedure.input(z.object({ token: z.string() })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(walletSessions).where(eq(walletSessions.token, input.token));
    return { ok: true };
  }),
});
