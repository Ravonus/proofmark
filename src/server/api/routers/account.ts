import { z } from "zod";
import { execFile } from "child_process";
import { existsSync } from "fs";
import { and, eq, sql, count, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { type createTRPCContext, createTRPCRouter, authedProcedure, publicProcedure } from "~/server/api/trpc";
import {
  brandingProfiles,
  documentTemplates,
  integrationConfigs,
  webhookEndpoints,
  pdfStyleTemplates,
  documents,
  signers,
  users,
  auditEvents,
  aiRateLimits,
  aiUsageLogs,
  platformConfig,
  walletSessions,
} from "~/server/db/schema";
import { FEATURE_IDS, getFeatureCatalog } from "~/lib/feature-access";
import {
  DEFAULT_BRANDING_SETTINGS,
  createReminderConfig,
  getDefaultIntegration,
  getWorkspaceSummary,
} from "~/server/workspace";
import { isSchemaDriftError } from "~/server/db/compat";
import { searchAddressSuggestions } from "~/server/address-autocomplete";
import {
  getFeatureAccessForInput,
  getOperatorStatus,
  getOwnerWallet,
  invalidateDbOwnerCache,
  isDevAdmin,
  listKnownWallets,
  resolveWalletIdentity,
  saveFeatureOverrides,
} from "~/server/operator-access";
import {
  findOwnedOwnerWallet,
  getOwnedWalletContextFromRequest,
  requireOwnedWalletActor,
} from "~/server/owned-wallet-context";
import { optionalSignerTokenGateSchema } from "~/lib/token-gates";

const deliveryMethodSchema = z.enum(["EMAIL", "SMS"]);

const reminderSchema = z.object({
  cadence: z.enum(["NONE", "DAILY", "EVERY_2_DAYS", "EVERY_3_DAYS", "WEEKLY"]).default("NONE"),
  channels: z.array(deliveryMethodSchema).default(["EMAIL"]),
});

const brandingSchema = z.object({
  brandName: z.string().min(1).max(80).optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  primaryColor: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/)
    .optional()
    .or(z.literal("")),
  accentColor: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/)
    .optional()
    .or(z.literal("")),
  emailFromName: z.string().max(80).optional(),
  emailReplyTo: z.string().email().optional().or(z.literal("")),
  emailFooter: z.string().max(300).optional(),
  signingIntro: z.string().max(180).optional(),
  emailIntro: z.string().max(180).optional(),
});

const featureIdSchema = z.enum(FEATURE_IDS);
const pdfStyleSettingsSchema = z.object({
  themePreset: z.string(),
  customOverrides: z.record(z.unknown()).optional(),
  tocEnabled: z.boolean().optional(),
  tocPageThreshold: z.number().min(1).max(50).optional(),
  fieldSummaryStyle: z.enum(["hybrid", "cards", "table"]).optional(),
  fieldIndexEnabled: z.boolean().optional(),
  fieldIndexPerSigner: z.boolean().optional(),
  fieldIndexCombined: z.boolean().optional(),
});

const templateSignerSchema = z.object({
  label: z.string().min(1).max(100),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  role: z.enum(["SIGNER", "APPROVER", "CC", "WITNESS", "OBSERVER"]).default("SIGNER"),
  deliveryMethods: z.array(deliveryMethodSchema).default(["EMAIL"]),
  tokenGates: optionalSignerTokenGateSchema,
  fields: z
    .array(
      z.object({
        id: z.string().optional(),
        type: z.string().min(1),
        label: z.string().min(1),
        value: z.string().nullable().optional(),
        required: z.boolean().default(true),
        options: z.array(z.string().min(1)).optional(),
        settings: z.record(z.unknown()).optional(),
      }),
    )
    .default([]),
});

function normalizeTemplateSigners(signers: Array<z.infer<typeof templateSignerSchema>>) {
  return signers.map((signer) => ({
    label: signer.label,
    email: signer.email || undefined,
    phone: signer.phone || undefined,
    role: signer.role,
    deliveryMethods: signer.deliveryMethods,
    tokenGates: signer.tokenGates ?? null,
    fields: signer.fields.map((field) => ({
      id: field.id,
      type: field.type,
      label: field.label,
      value: field.value ?? null,
      required: field.required,
      options: field.options,
      settings: field.settings,
    })),
  }));
}

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

async function requireAdminAccess(ctx: Awaited<ReturnType<typeof createTRPCContext>>) {
  const ownedWalletContext = await getOwnedWalletContextFromRequest(ctx.req ?? null);
  const linkedOwnerWallet = await findOwnedOwnerWallet(ownedWalletContext);

  if (!linkedOwnerWallet && !isDevAdmin()) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }

  return { ownedWalletContext, linkedOwnerWallet };
}

export const accountRouter = createTRPCRouter({
  /** Public: check if the platform has been set up (owner claimed). */
  setupStatus: publicProcedure.query(async () => {
    const owner = await getOwnerWallet();
    return {
      configured: !!owner,
      ownerChain: owner?.chain ?? null,
      // Don't leak full address publicly — just enough to show "setup done"
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
      // Check if already claimed
      const existing = await getOwnerWallet();
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Platform ownership has already been claimed.",
        });
      }

      const actor = resolveWalletIdentity(ctx.session.address, ctx.session.chain);

      // Store in DB
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

      // Clear the cache so getOwnerWallet picks up the new claim
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

  listTemplates: publicProcedure.query(async ({ ctx }) => {
    const { ownedAddresses } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
    if (ownedAddresses.length === 0) return [];

    try {
      return await ctx.db.query.documentTemplates.findMany({
        where:
          ownedAddresses.length === 1
            ? eq(documentTemplates.ownerAddress, ownedAddresses[0]!)
            : inArray(documentTemplates.ownerAddress, ownedAddresses),
        orderBy: (t, { desc }) => [desc(t.updatedAt)],
      });
    } catch (error) {
      if (!isSchemaDriftError(error)) throw error;
      return [];
    }
  }),

  upsertBranding: publicProcedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1).max(80),
        settings: brandingSchema,
        isDefault: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedAddresses, primaryOwnerAddress } = await getOwnedWalletContextFromRequest(ctx.req ?? null);

      const settings = {
        ...DEFAULT_BRANDING_SETTINGS,
        ...input.settings,
      };

      if (input.id) {
        if (ownedAddresses.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

        const existing = await ctx.db.query.brandingProfiles.findFirst({
          where:
            ownedAddresses.length === 1
              ? and(eq(brandingProfiles.id, input.id), eq(brandingProfiles.ownerAddress, ownedAddresses[0]!))
              : and(eq(brandingProfiles.id, input.id), inArray(brandingProfiles.ownerAddress, ownedAddresses)),
        });
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

        if (input.isDefault) {
          await ctx.db
            .update(brandingProfiles)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(eq(brandingProfiles.ownerAddress, existing.ownerAddress));
        }

        const [profile] = await ctx.db
          .update(brandingProfiles)
          .set({
            name: input.name,
            settings,
            isDefault: input.isDefault,
            updatedAt: new Date(),
          })
          .where(eq(brandingProfiles.id, input.id))
          .returning();
        return profile;
      }

      const ownerAddress = requirePrimaryOwnerAddress(primaryOwnerAddress);
      if (input.isDefault) {
        await ctx.db
          .update(brandingProfiles)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(brandingProfiles.ownerAddress, ownerAddress));
      }

      const [profile] = await ctx.db
        .insert(brandingProfiles)
        .values({
          ownerAddress,
          name: input.name,
          settings,
          isDefault: input.isDefault,
        })
        .returning();
      return profile;
    }),

  deleteBranding: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { ownedAddresses } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
    if (ownedAddresses.length === 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Link a wallet to this account before deleting branding." });
    }

    await ctx.db
      .delete(brandingProfiles)
      .where(
        ownedAddresses.length === 1
          ? and(eq(brandingProfiles.id, input.id), eq(brandingProfiles.ownerAddress, ownedAddresses[0]!))
          : and(eq(brandingProfiles.id, input.id), inArray(brandingProfiles.ownerAddress, ownedAddresses)),
      );
    return { ok: true };
  }),

  saveTemplate: publicProcedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1).max(100),
        description: z.string().max(240).optional(),
        title: z.string().min(1).max(200),
        content: z.string().min(1),
        signers: z.array(templateSignerSchema).min(1).max(20),
        defaults: z
          .object({
            proofMode: z.enum(["PRIVATE", "HYBRID", "CRYPTO_NATIVE"]).default("HYBRID").optional(),
            signingOrder: z.enum(["parallel", "sequential"]).default("parallel").optional(),
            expiresInDays: z.number().int().min(1).max(365).optional(),
            reminder: reminderSchema.optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedAddresses, primaryOwnerAddress } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
      const normalizedSigners = normalizeTemplateSigners(input.signers);
      const defaults = input.defaults
        ? {
            ...input.defaults,
            reminder: input.defaults.reminder
              ? (createReminderConfig(input.defaults.reminder.cadence, input.defaults.reminder.channels) ?? undefined)
              : undefined,
          }
        : null;

      if (input.id) {
        if (ownedAddresses.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

        const existing = await ctx.db.query.documentTemplates.findFirst({
          where:
            ownedAddresses.length === 1
              ? and(eq(documentTemplates.id, input.id), eq(documentTemplates.ownerAddress, ownedAddresses[0]!))
              : and(eq(documentTemplates.id, input.id), inArray(documentTemplates.ownerAddress, ownedAddresses)),
        });
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

        const [template] = await ctx.db
          .update(documentTemplates)
          .set({
            name: input.name,
            description: input.description ?? null,
            title: input.title,
            content: input.content,
            signers: normalizedSigners,
            defaults,
            updatedAt: new Date(),
          })
          .where(eq(documentTemplates.id, input.id))
          .returning();
        return template;
      }

      const ownerAddress = requirePrimaryOwnerAddress(primaryOwnerAddress);

      const [template] = await ctx.db
        .insert(documentTemplates)
        .values({
          ownerAddress,
          name: input.name,
          description: input.description ?? null,
          title: input.title,
          content: input.content,
          signers: normalizedSigners,
          defaults,
        })
        .returning();
      return template;
    }),

  deleteTemplate: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { ownedAddresses } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
    if (ownedAddresses.length === 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Link a wallet to this account before deleting templates." });
    }

    await ctx.db
      .delete(documentTemplates)
      .where(
        ownedAddresses.length === 1
          ? and(eq(documentTemplates.id, input.id), eq(documentTemplates.ownerAddress, ownedAddresses[0]!))
          : and(eq(documentTemplates.id, input.id), inArray(documentTemplates.ownerAddress, ownedAddresses)),
      );
    return { ok: true };
  }),

  upsertIntegration: publicProcedure
    .input(
      z.object({
        id: z.string().optional(),
        kind: z.enum(["SMS", "PAYMENT", "IDV", "SSO", "ADDRESS"]),
        provider: z.string().min(1).max(40),
        label: z.string().min(1).max(80),
        isDefault: z.boolean().default(false),
        config: z.object({
          provider: z.string().min(1).max(40),
          enabled: z.boolean().default(true),
          from: z.string().optional(),
          senderId: z.string().optional(),
          accountSid: z.string().optional(),
          authToken: z.string().optional(),
          apiKey: z.string().optional(),
          apiSecret: z.string().optional(),
          clientId: z.string().optional(),
          clientSecret: z.string().optional(),
          profileId: z.string().optional(),
          endpoint: z.string().url().optional(),
          issuer: z.string().url().optional(),
          scopes: z.array(z.string().min(1)).optional(),
          headers: z.record(z.string()).optional(),
          metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedAddresses, primaryOwnerAddress } = await getOwnedWalletContextFromRequest(ctx.req ?? null);

      if (input.id) {
        if (ownedAddresses.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

        const existing = await ctx.db.query.integrationConfigs.findFirst({
          where:
            ownedAddresses.length === 1
              ? and(eq(integrationConfigs.id, input.id), eq(integrationConfigs.ownerAddress, ownedAddresses[0]!))
              : and(eq(integrationConfigs.id, input.id), inArray(integrationConfigs.ownerAddress, ownedAddresses)),
        });
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

        if (input.isDefault) {
          await ctx.db
            .update(integrationConfigs)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(
              and(eq(integrationConfigs.ownerAddress, existing.ownerAddress), eq(integrationConfigs.kind, input.kind)),
            );
        }

        const [integration] = await ctx.db
          .update(integrationConfigs)
          .set({
            kind: input.kind,
            provider: input.provider,
            label: input.label,
            config: input.config,
            isDefault: input.isDefault,
            updatedAt: new Date(),
          })
          .where(eq(integrationConfigs.id, input.id))
          .returning();
        return integration;
      }

      const ownerAddress = requirePrimaryOwnerAddress(primaryOwnerAddress);
      if (input.isDefault) {
        await ctx.db
          .update(integrationConfigs)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(and(eq(integrationConfigs.ownerAddress, ownerAddress), eq(integrationConfigs.kind, input.kind)));
      }

      const [integration] = await ctx.db
        .insert(integrationConfigs)
        .values({
          ownerAddress,
          kind: input.kind,
          provider: input.provider,
          label: input.label,
          config: input.config,
          isDefault: input.isDefault,
        })
        .returning();
      return integration;
    }),

  deleteIntegration: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { ownedAddresses } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
    if (ownedAddresses.length === 0) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Link a wallet to this account before deleting integrations.",
      });
    }

    await ctx.db
      .delete(integrationConfigs)
      .where(
        ownedAddresses.length === 1
          ? and(eq(integrationConfigs.id, input.id), eq(integrationConfigs.ownerAddress, ownedAddresses[0]!))
          : and(eq(integrationConfigs.id, input.id), inArray(integrationConfigs.ownerAddress, ownedAddresses)),
      );
    return { ok: true };
  }),

  upsertWebhook: publicProcedure
    .input(
      z.object({
        id: z.string().optional(),
        label: z.string().min(1).max(80),
        url: z.string().url(),
        secret: z.string().max(200).optional(),
        active: z.boolean().default(true),
        events: z.array(z.string().min(1)).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedAddresses, primaryOwnerAddress } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
      if (input.id) {
        if (ownedAddresses.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

        const existing = await ctx.db.query.webhookEndpoints.findFirst({
          where:
            ownedAddresses.length === 1
              ? and(eq(webhookEndpoints.id, input.id), eq(webhookEndpoints.ownerAddress, ownedAddresses[0]!))
              : and(eq(webhookEndpoints.id, input.id), inArray(webhookEndpoints.ownerAddress, ownedAddresses)),
        });
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

        const [endpoint] = await ctx.db
          .update(webhookEndpoints)
          .set({
            label: input.label,
            url: input.url,
            secret: input.secret ?? null,
            active: input.active,
            events: input.events,
            updatedAt: new Date(),
          })
          .where(eq(webhookEndpoints.id, input.id))
          .returning();
        return endpoint;
      }

      const ownerAddress = requirePrimaryOwnerAddress(primaryOwnerAddress);

      const [endpoint] = await ctx.db
        .insert(webhookEndpoints)
        .values({
          ownerAddress,
          label: input.label,
          url: input.url,
          secret: input.secret ?? null,
          active: input.active,
          events: input.events,
        })
        .returning();
      return endpoint;
    }),

  deleteWebhook: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { ownedAddresses } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
    if (ownedAddresses.length === 0) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Link a wallet to this account before deleting webhooks." });
    }

    await ctx.db
      .delete(webhookEndpoints)
      .where(
        ownedAddresses.length === 1
          ? and(eq(webhookEndpoints.id, input.id), eq(webhookEndpoints.ownerAddress, ownedAddresses[0]!))
          : and(eq(webhookEndpoints.id, input.id), inArray(webhookEndpoints.ownerAddress, ownedAddresses)),
      );
    return { ok: true };
  }),

  /** Aggregated admin stats for the overview dashboard. */
  adminStats: publicProcedure.query(async ({ ctx }) => {
    await requireAdminAccess(ctx);

    const [docRows, signerRows, sessionRows, userRows, auditRows] = await Promise.all([
      ctx.db
        .select({
          total: count(),
          pending: count(sql`CASE WHEN ${documents.status} = 'PENDING' THEN 1 END`),
          completed: count(sql`CASE WHEN ${documents.status} = 'COMPLETED' THEN 1 END`),
          expired: count(sql`CASE WHEN ${documents.status} = 'EXPIRED' THEN 1 END`),
          voided: count(sql`CASE WHEN ${documents.status} = 'VOIDED' THEN 1 END`),
        })
        .from(documents)
        .catch(() => [{ total: 0, pending: 0, completed: 0, expired: 0, voided: 0 }]),
      ctx.db
        .select({
          total: count(),
          signed: count(sql`CASE WHEN ${signers.status} = 'SIGNED' THEN 1 END`),
          declined: count(sql`CASE WHEN ${signers.status} = 'DECLINED' THEN 1 END`),
        })
        .from(signers)
        .catch(() => [{ total: 0, signed: 0, declined: 0 }]),
      ctx.db
        .select({ total: count() })
        .from(walletSessions)
        .catch(() => [{ total: 0 }]),
      ctx.db
        .select({ total: count() })
        .from(users)
        .catch(() => [{ total: 0 }]),
      ctx.db
        .select({ total: count() })
        .from(auditEvents)
        .catch(() => [{ total: 0 }]),
    ]);

    return {
      documents: docRows[0] ?? { total: 0, pending: 0, completed: 0, expired: 0, voided: 0 },
      signers: signerRows[0] ?? { total: 0, signed: 0, declined: 0 },
      sessions: sessionRows[0]?.total ?? 0,
      users: userRows[0]?.total ?? 0,
      auditEvents: auditRows[0]?.total ?? 0,
    };
  }),

  /** List AI rate limit records (admin only). */
  adminListAiLimits: publicProcedure.query(async ({ ctx }) => {
    await requireAdminAccess(ctx);

    try {
      return await ctx.db.query.aiRateLimits.findMany({
        orderBy: (t, { desc: orderDesc }) => [orderDesc(t.updatedAt)],
        limit: 50,
      });
    } catch {
      return [];
    }
  }),

  /** Set AI rate limits for a user (admin only). */
  adminSetAiLimits: publicProcedure
    .input(
      z.object({
        ownerAddress: z.string().min(1),
        userId: z.string().nullable().optional(),
        feature: z.enum(["scraper_fix", "editor_assistant", "signer_qa", "general"]).nullable().optional(),
        mode: z.enum(["platform", "admin"]).default("platform"),
        requestsPerMonth: z.number().int().min(0).max(100000).optional(),
        tokensPerMonth: z.number().int().min(0).max(100000000).optional(),
        maxRequestsPerHour: z.number().int().min(0).max(10000).optional(),
        maxRequestsPerWeek: z.number().int().min(0).max(100000).optional(),
        adminRequestsPerHour: z.number().int().min(0).max(10000).nullable().optional(),
        adminRequestsPerDay: z.number().int().min(0).max(100000).nullable().optional(),
        adminRequestsPerMonth: z.number().int().min(0).max(1000000).nullable().optional(),
        adminTokensPerHour: z.number().int().min(0).max(100000000).nullable().optional(),
        adminTokensPerDay: z.number().int().min(0).max(100000000).nullable().optional(),
        adminTokensPerMonth: z.number().int().min(0).max(1000000000).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAdminAccess(ctx);

      const [record] = await ctx.db
        .insert(aiRateLimits)
        .values({
          ownerAddress: input.ownerAddress.trim().toLowerCase(),
          userId: input.userId ?? null,
          feature: input.feature ?? null,
          mode: input.mode,
          requestsPerMonth: input.requestsPerMonth ?? 500,
          tokensPerMonth: input.tokensPerMonth ?? 1000000,
          maxRequestsPerHour: input.maxRequestsPerHour ?? 30,
          maxRequestsPerWeek: input.maxRequestsPerWeek ?? 200,
          adminRequestsPerHour: input.adminRequestsPerHour ?? null,
          adminRequestsPerDay: input.adminRequestsPerDay ?? null,
          adminRequestsPerMonth: input.adminRequestsPerMonth ?? null,
          adminTokensPerHour: input.adminTokensPerHour ?? null,
          adminTokensPerDay: input.adminTokensPerDay ?? null,
          adminTokensPerMonth: input.adminTokensPerMonth ?? null,
        })
        .returning();
      return record;
    }),

  /** Delete an AI rate limit record (admin only). */
  adminDeleteAiLimit: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    await requireAdminAccess(ctx);

    await ctx.db.delete(aiRateLimits).where(eq(aiRateLimits.id, input.id));
    return { ok: true };
  }),

  /** AI usage summary for admin dashboard. */
  adminAiUsage: publicProcedure.query(async ({ ctx }) => {
    await requireAdminAccess(ctx);

    try {
      const [totals] = await ctx.db
        .select({
          totalRequests: count(),
          totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.inputTokens}), 0)`,
          totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageLogs.outputTokens}), 0)`,
          totalCostCents: sql<number>`COALESCE(SUM(${aiUsageLogs.costCents}), 0)`,
        })
        .from(aiUsageLogs);

      return totals ?? { totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostCents: 0 };
    } catch {
      return { totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCostCents: 0 };
    }
  }),

  /** Detect AI CLI tools installed on the server. */
  detectAiTools: publicProcedure.query(async ({ ctx }) => {
    await requireAdminAccess(ctx);

    const TOOL_CANDIDATES: Array<{
      name: string;
      binary: string;
      paths: string[];
      versionFlag: string;
    }> = [
      {
        name: "Claude Code",
        binary: "claude",
        paths: [
          `${process.env.HOME}/.local/bin/claude`,
          `${process.env.HOME}/.claude/bin/claude`,
          "/usr/local/bin/claude",
          "/opt/homebrew/bin/claude",
        ],
        versionFlag: "--version",
      },
      {
        name: "Codex",
        binary: "codex",
        paths: [
          `${process.env.HOME}/.local/bin/codex`,
          "/usr/local/bin/codex",
          "/opt/homebrew/bin/codex",
          `${process.env.HOME}/.npm-global/bin/codex`,
        ],
        versionFlag: "--version",
      },
      {
        name: "OpenClaw",
        binary: "openclaw",
        paths: [
          `${process.env.HOME}/.local/bin/openclaw`,
          `${process.env.HOME}/.cargo/bin/openclaw`,
          "/usr/local/bin/openclaw",
          "/opt/homebrew/bin/openclaw",
        ],
        versionFlag: "--version",
      },
    ];

    const results: Array<{
      name: string;
      binary: string;
      found: boolean;
      path: string | null;
      version: string | null;
    }> = [];

    for (const tool of TOOL_CANDIDATES) {
      let foundPath: string | null = null;

      // Check known paths
      for (const p of tool.paths) {
        if (existsSync(p)) {
          foundPath = p;
          break;
        }
      }

      // Fall back to which
      if (!foundPath) {
        foundPath = await new Promise<string | null>((resolve) => {
          execFile("which", [tool.binary], { timeout: 3000 }, (err, stdout) => {
            if (err || !stdout.trim()) return resolve(null);
            resolve(stdout.trim());
          });
        });
      }

      // Get version if found
      let version: string | null = null;
      if (foundPath) {
        version = await new Promise<string | null>((resolve) => {
          execFile(foundPath, [tool.versionFlag], { timeout: 5000 }, (err, stdout, stderr) => {
            if (err) return resolve(null);
            const output = (stdout || stderr || "").trim();
            // Extract first line / version number
            const match = /\d+\.\d+[\.\d]*/m.exec(output);
            resolve(match ? match[0] : output.split("\n")[0]?.slice(0, 80) || null);
          });
        });
      }

      results.push({
        name: tool.name,
        binary: tool.binary,
        found: !!foundPath,
        path: foundPath,
        version,
      });
    }

    return results;
  }),

  // ═══ PDF Style Templates ═══════════════════════════════════════════════

  listPdfStyleTemplates: publicProcedure.query(async ({ ctx }) => {
    const { ownedAddresses } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
    if (ownedAddresses.length === 0) return [];

    const templates = await ctx.db.query.pdfStyleTemplates.findMany({
      where:
        ownedAddresses.length === 1
          ? eq(pdfStyleTemplates.ownerAddress, ownedAddresses[0]!)
          : inArray(pdfStyleTemplates.ownerAddress, ownedAddresses),
      orderBy: (t, { desc }) => [desc(t.isDefault), desc(t.createdAt)],
    });
    return templates;
  }),

  createPdfStyleTemplate: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        settings: pdfStyleSettingsSchema,
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { primaryOwnerAddress } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
      const owner = requirePrimaryOwnerAddress(primaryOwnerAddress);

      // If setting as default, clear existing default
      if (input.isDefault) {
        await ctx.db
          .update(pdfStyleTemplates)
          .set({ isDefault: false })
          .where(and(eq(pdfStyleTemplates.ownerAddress, owner), eq(pdfStyleTemplates.isDefault, true)));
      }

      const [created] = await ctx.db
        .insert(pdfStyleTemplates)
        .values({
          ownerAddress: owner,
          name: input.name,
          description: input.description ?? null,
          settings: input.settings,
          isDefault: input.isDefault ?? false,
          isBuiltIn: false,
        })
        .returning();

      return created!;
    }),

  updatePdfStyleTemplate: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        settings: pdfStyleSettingsSchema.optional(),
        isDefault: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedAddresses } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
      if (ownedAddresses.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

      // Verify ownership
      const existing = await ctx.db.query.pdfStyleTemplates.findFirst({
        where:
          ownedAddresses.length === 1
            ? and(eq(pdfStyleTemplates.id, input.id), eq(pdfStyleTemplates.ownerAddress, ownedAddresses[0]!))
            : and(eq(pdfStyleTemplates.id, input.id), inArray(pdfStyleTemplates.ownerAddress, ownedAddresses)),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.isBuiltIn) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot edit built-in templates" });

      if (input.isDefault) {
        await ctx.db
          .update(pdfStyleTemplates)
          .set({ isDefault: false })
          .where(and(eq(pdfStyleTemplates.ownerAddress, existing.ownerAddress), eq(pdfStyleTemplates.isDefault, true)));
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.settings) updates.settings = input.settings;
      if (input.isDefault !== undefined) updates.isDefault = input.isDefault;

      const [updated] = await ctx.db
        .update(pdfStyleTemplates)
        .set(updates)
        .where(eq(pdfStyleTemplates.id, input.id))
        .returning();

      return updated!;
    }),

  deletePdfStyleTemplate: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { ownedAddresses } = await getOwnedWalletContextFromRequest(ctx.req ?? null);
    if (ownedAddresses.length === 0) throw new TRPCError({ code: "NOT_FOUND" });

    const existing = await ctx.db.query.pdfStyleTemplates.findFirst({
      where:
        ownedAddresses.length === 1
          ? and(eq(pdfStyleTemplates.id, input.id), eq(pdfStyleTemplates.ownerAddress, ownedAddresses[0]!))
          : and(eq(pdfStyleTemplates.id, input.id), inArray(pdfStyleTemplates.ownerAddress, ownedAddresses)),
    });
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
    if (existing.isBuiltIn) throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete built-in templates" });

    await ctx.db.delete(pdfStyleTemplates).where(eq(pdfStyleTemplates.id, input.id));
    return { success: true };
  }),
});
