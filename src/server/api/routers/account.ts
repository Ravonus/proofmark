import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { FEATURE_IDS, getFeatureCatalog } from "~/lib/platform/feature-access";
import {
  authedProcedure,
  type createTRPCContext,
  createTRPCRouter,
  mergeRouters,
  publicProcedure,
} from "~/server/api/trpc";
import {
  getFeatureAccessForInput,
  getOperatorStatus,
  getOwnerWallet,
  invalidateDbOwnerCache,
  isDevAdmin,
  listKnownWallets,
  resolveWalletIdentity,
  saveFeatureOverrides,
} from "~/server/crypto/operator-access";
import {
  findOwnedOwnerWallet,
  getOwnedWalletContextFromRequest,
  requireOwnedWalletActor,
} from "~/server/crypto/owned-wallet-context";
import { platformConfig } from "~/server/db/schema";
import { searchAddressSuggestions } from "~/server/messaging/address-autocomplete";
import { getDefaultIntegration, getWorkspaceSummary } from "~/server/workspace/workspace";
import { accountAdminRouter } from "./account-admin";
import { accountWorkspaceRouter } from "./account-workspace";

const featureIdSchema = z.enum(FEATURE_IDS);

function requirePrimaryOwnerAddress(ownerAddress: string | null) {
  if (!ownerAddress) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Link a wallet to this account before managing wallet-owned workspace settings.",
    });
  }

  return ownerAddress;
}

async function getOperatorStatusForContext(ctx: Awaited<ReturnType<typeof createTRPCContext>>) {
  const ownedWalletContext = await getOwnedWalletContextFromRequest(ctx.req ?? null);
  const actor = requireOwnedWalletActor(
    ownedWalletContext,
    "Link a wallet to this account before managing operator settings.",
  );
  const linkedOwnerWallet = await findOwnedOwnerWallet(ownedWalletContext);
  const status = await getOperatorStatus(ctx.db, actor);

  return {
    ...status,
    isOwner: !!linkedOwnerWallet,
    canManageOthers: !!linkedOwnerWallet || isDevAdmin(),
    currentWallet: actor,
    linkedWallets: ownedWalletContext.wallets,
  };
}

const _accountCoreRouter = createTRPCRouter({
  /** Public: check if the platform has been set up (owner claimed). */
  setupStatus: publicProcedure.query(async () => {
    const owner = await getOwnerWallet();
    return {
      configured: !!owner,
      ownerChain: owner?.chain ?? null,
      ownerPreview: owner ? `${owner.address.slice(0, 6)}...${owner.address.slice(-4)}` : null,
    };
  }),

  /** Claim platform ownership — only works if no owner is configured yet. */
  claimOwnership: authedProcedure
    .input(
      z.object({
        signature: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await getOwnerWallet();
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Platform ownership has already been claimed.",
        });
      }

      const actor = resolveWalletIdentity(ctx.session.address, ctx.session.chain);

      try {
        await ctx.db
          .insert(platformConfig)
          .values({
            id: "singleton",
            ownerAddress: actor.address,
            ownerChain: actor.chain,
            setupSignature: input.signature,
            claimedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: platformConfig.id,
            set: {
              ownerAddress: actor.address,
              ownerChain: actor.chain,
              setupSignature: input.signature,
              claimedAt: new Date(),
            },
          });
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to store ownership claim. You may need to run `npm run db:push` first.",
        });
      }

      invalidateDbOwnerCache();

      return {
        address: actor.address,
        chain: actor.chain,
      };
    }),

  featureCatalog: publicProcedure.query(() => {
    return getFeatureCatalog();
  }),

  workspace: publicProcedure.query(async ({ ctx }) => {
    const ownedWalletContext = await getOwnedWalletContextFromRequest(ctx.req ?? null);
    return getWorkspaceSummary(ownedWalletContext.ownedAddresses);
  }),

  operatorStatus: publicProcedure.query(async ({ ctx }) => {
    return getOperatorStatusForContext(ctx);
  }),

  featureAccess: publicProcedure
    .input(
      z
        .object({
          address: z.string().min(1).optional(),
          chain: z.enum(["ETH", "SOL", "BTC"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const ownedWalletContext = await getOwnedWalletContextFromRequest(ctx.req ?? null);
      const actor = requireOwnedWalletActor(
        ownedWalletContext,
        "Link a wallet to this account before viewing feature access.",
      );

      return getFeatureAccessForInput(ctx.db, actor, input?.address, input?.chain);
    }),

  setFeatureOverrides: publicProcedure
    .input(
      z.object({
        address: z.string().min(1).optional(),
        chain: z.enum(["ETH", "SOL", "BTC"]).optional(),
        overrides: z
          .array(
            z.object({
              featureId: featureIdSchema,
              enabled: z.boolean().nullable(),
            }),
          )
          .min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ownedWalletContext = await getOwnedWalletContextFromRequest(ctx.req ?? null);
      const actor = requireOwnedWalletActor(
        ownedWalletContext,
        "Link a wallet to this account before updating feature overrides.",
      );
      const target = input.address ? resolveWalletIdentity(input.address, input.chain) : actor;

      const featureStates = await saveFeatureOverrides(ctx.db, actor, target, input.overrides);
      return { target, featureStates };
    }),

  knownWallets: publicProcedure.query(async ({ ctx }) => {
    const status = await getOperatorStatusForContext(ctx);
    if (!status.canManageOthers) return [];
    return listKnownWallets(ctx.db);
  }),

  addressSuggestions: publicProcedure
    .input(
      z.object({
        query: z.string().min(3).max(120),
        limit: z.number().int().min(1).max(10).default(5),
        countryCodes: z.array(z.string().min(2).max(3)).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ownedWalletContext = await getOwnedWalletContextFromRequest(ctx.req ?? null);
      const ownerAddress = requirePrimaryOwnerAddress(ownedWalletContext.primaryOwnerAddress);
      const config = await getDefaultIntegration(ownerAddress, "ADDRESS");
      if (!config || config.enabled === false) {
        return { suggestions: [] };
      }

      const suggestions = await searchAddressSuggestions({
        config,
        query: input.query,
        limit: input.limit,
        countryCodes: input.countryCodes,
      });
      return { suggestions };
    }),
});

export const accountRouter = mergeRouters(_accountCoreRouter, accountWorkspaceRouter, accountAdminRouter);
