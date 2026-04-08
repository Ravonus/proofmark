// @ts-nocheck -- tRPC context types break type inference; typed helpers in account.ts
/**
 * Workspace CRUD procedures (branding, templates, integrations, webhooks)
 * — split from account.ts for file-length compliance.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { type SaveTemplateInput, saveTemplateSchema } from "~/lib/schemas/document";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { getOwnedWalletContextFromRequest } from "~/server/crypto/owned-wallet-context";
import { isSchemaDriftError } from "~/server/db/compat";
import { brandingProfiles, documentTemplates, integrationConfigs, webhookEndpoints } from "~/server/db/schema";
import { createReminderConfig, DEFAULT_BRANDING_SETTINGS } from "~/server/workspace/workspace";

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

function requirePrimaryOwnerAddress(ownerAddress: string | null) {
  if (!ownerAddress) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Link a wallet to this account before managing wallet-owned workspace settings.",
    });
  }
  return ownerAddress;
}

function normalizeTemplateSigners(signers: SaveTemplateInput["signers"]) {
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

export const accountWorkspaceRouter = createTRPCRouter({
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
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Link a wallet to this account before deleting branding.",
      });
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

  saveTemplate: publicProcedure.input(saveTemplateSchema).mutation(async ({ ctx, input }) => {
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
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Link a wallet to this account before deleting templates.",
      });
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
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Link a wallet to this account before deleting webhooks.",
      });
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
});
