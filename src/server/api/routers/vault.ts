/**
 * User vault & managed wallet tRPC router.
 *
 * Handles zero-knowledge encrypted vault operations:
 * - Store/retrieve wrapped DEKs (server never sees raw DEK)
 * - Register unlock methods (password, device, hardware key, 2FA)
 * - Store/retrieve managed wallet encrypted private keys
 *
 * All encryption/decryption happens CLIENT-SIDE.
 * The server only stores encrypted blobs.
 */

import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { createTRPCRouter, authedProcedure } from "~/server/api/trpc";
import { users, userVaults, managedWallets, documentKeyShares } from "~/server/db/schema";
import { TRPCError } from "@trpc/server";

const kdfParamsSchema = z.object({
  algorithm: z.string(),
  salt: z.string(),
  iterations: z.number().optional(),
  memory: z.number().optional(),
  credentialId: z.string().optional(),
});

export const vaultRouter = createTRPCRouter({
  /** Store a wrapped DEK for a specific unlock method. */
  storeWrappedDek: authedProcedure
    .input(
      z.object({
        unlockMethod: z.enum(["PASSWORD", "DEVICE_PASSCODE", "HARDWARE_KEY", "TOTP_2FA"]),
        wrappedDek: z.string().min(1),
        kdfParams: kdfParamsSchema,
        label: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Find the user by wallet address
      const [user] = await ctx.db.select().from(users).where(eq(users.walletAddress, ctx.session.address)).limit(1);

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found — create an account first" });
      }

      // Check if this method already exists
      const [existing] = await ctx.db
        .select()
        .from(userVaults)
        .where(and(eq(userVaults.userId, user.id), eq(userVaults.unlockMethod, input.unlockMethod)))
        .limit(1);

      if (existing) {
        // Update existing
        await ctx.db
          .update(userVaults)
          .set({
            wrappedDek: input.wrappedDek,
            kdfParams: input.kdfParams,
            label: input.label ?? existing.label,
          })
          .where(eq(userVaults.id, existing.id));
        return { vaultId: existing.id, updated: true };
      }

      // Create new
      const { createId } = await import("~/server/db/utils");
      const id = createId();
      await ctx.db.insert(userVaults).values({
        id,
        userId: user.id,
        unlockMethod: input.unlockMethod,
        wrappedDek: input.wrappedDek,
        kdfParams: input.kdfParams,
        label: input.label,
      });

      return { vaultId: id, updated: false };
    }),

  /** Get all unlock methods for the current user (returns wrapped DEKs + KDF params). */
  getVaultMethods: authedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db.select().from(users).where(eq(users.walletAddress, ctx.session.address)).limit(1);

    if (!user) return { methods: [] };

    const vaults = await ctx.db
      .select({
        id: userVaults.id,
        unlockMethod: userVaults.unlockMethod,
        wrappedDek: userVaults.wrappedDek,
        kdfParams: userVaults.kdfParams,
        label: userVaults.label,
        lastUsedAt: userVaults.lastUsedAt,
      })
      .from(userVaults)
      .where(eq(userVaults.userId, user.id));

    return { methods: vaults };
  }),

  /** Store a managed wallet (encrypted private key — server never sees plaintext). */
  storeManagedWallet: authedProcedure
    .input(
      z.object({
        chain: z.enum(["BASE", "SOL", "BTC"]),
        address: z.string().min(1),
        publicKey: z.string().min(1),
        encryptedPrivateKey: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [user] = await ctx.db.select().from(users).where(eq(users.walletAddress, ctx.session.address)).limit(1);

      if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      const { createId } = await import("~/server/db/utils");
      const id = createId();

      await ctx.db
        .insert(managedWallets)
        .values({
          id,
          userId: user.id,
          chain: input.chain,
          address: input.address,
          publicKey: input.publicKey,
          encryptedPrivateKey: input.encryptedPrivateKey,
        })
        .onConflictDoUpdate({
          target: [managedWallets.userId, managedWallets.chain],
          set: {
            address: input.address,
            publicKey: input.publicKey,
            encryptedPrivateKey: input.encryptedPrivateKey,
          },
        });

      return { walletId: id, chain: input.chain, address: input.address };
    }),

  /** Get all managed wallets for the current user. */
  getManagedWallets: authedProcedure.query(async ({ ctx }) => {
    const [user] = await ctx.db.select().from(users).where(eq(users.walletAddress, ctx.session.address)).limit(1);

    if (!user) return { wallets: [] };

    const wallets = await ctx.db
      .select({
        id: managedWallets.id,
        chain: managedWallets.chain,
        address: managedWallets.address,
        publicKey: managedWallets.publicKey,
        encryptedPrivateKey: managedWallets.encryptedPrivateKey,
      })
      .from(managedWallets)
      .where(eq(managedWallets.userId, user.id));

    return { wallets };
  }),

  /** Store a document key share for a recipient. */
  storeDocumentKeyShare: authedProcedure
    .input(
      z.object({
        documentId: z.string().min(1),
        recipientAddress: z.string().min(1),
        recipientChain: z.enum(["BASE", "SOL", "BTC"]),
        encryptedDocumentKey: z.string().min(1),
        onChainRef: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { createId } = await import("~/server/db/utils");
      const id = createId();

      await ctx.db.insert(documentKeyShares).values({
        id,
        documentId: input.documentId,
        recipientAddress: input.recipientAddress,
        recipientChain: input.recipientChain,
        encryptedDocumentKey: input.encryptedDocumentKey,
        onChainRef: input.onChainRef,
      });

      return { shareId: id };
    }),

  /** Get document key shares for a document (only shares for the caller). */
  getMyDocumentKeyShares: authedProcedure.input(z.object({ documentId: z.string() })).query(async ({ ctx, input }) => {
    const shares = await ctx.db
      .select()
      .from(documentKeyShares)
      .where(
        and(
          eq(documentKeyShares.documentId, input.documentId),
          eq(documentKeyShares.recipientAddress, ctx.session.address.toLowerCase()),
        ),
      );

    return { shares };
  }),
});
