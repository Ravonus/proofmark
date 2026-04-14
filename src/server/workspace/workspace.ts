import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "~/server/db";
import { isSchemaDriftError } from "~/server/db/compat";
import {
  type BrandingProfile,
  type BrandingSettings,
  brandingProfiles,
  type DeliveryMethod,
  documentTemplates,
  type IntegrationConfig,
  type IntegrationRecord,
  integrationConfigs,
  type ReminderCadence,
  type ReminderConfig,
  webhookEndpoints,
} from "~/server/db/schema";

export const DEFAULT_BRANDING_SETTINGS: BrandingSettings = {
  brandName: "Proofmark",
  primaryColor: "#6366f1",
  accentColor: "#22c55e",
  emailFromName: "Proofmark",
  emailFooter: "Decentralized document signing with wallet and OTP verification.",
  signingIntro: "Review and sign with your preferred authentication flow.",
  emailIntro: "You have a document ready for review.",
};

export const REMINDER_INTERVAL_MS: Record<Exclude<ReminderCadence, "NONE">, number> = {
  DAILY: 24 * 60 * 60 * 1000,
  EVERY_2_DAYS: 2 * 24 * 60 * 60 * 1000,
  EVERY_3_DAYS: 3 * 24 * 60 * 60 * 1000,
  WEEKLY: 7 * 24 * 60 * 60 * 1000,
};

export function normalizeOwnerAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function createReminderConfig(
  cadence: ReminderCadence = "NONE",
  channels: DeliveryMethod[] = ["EMAIL"],
  now = new Date(),
): ReminderConfig | null {
  if (cadence === "NONE") return null;
  const interval = REMINDER_INTERVAL_MS[cadence];
  return {
    enabled: true,
    cadence,
    channels,
    maxSends: 6,
    sentCount: 0,
    lastSentAt: now.toISOString(),
    nextReminderAt: new Date(now.getTime() + interval).toISOString(),
  };
}

export function advanceReminderConfig(reminder: ReminderConfig, now = new Date()): ReminderConfig {
  if (!reminder.enabled || reminder.cadence === "NONE") return reminder;
  const interval = REMINDER_INTERVAL_MS[reminder.cadence];
  return {
    ...reminder,
    sentCount: (reminder.sentCount ?? 0) + 1,
    lastSentAt: now.toISOString(),
    nextReminderAt: new Date(now.getTime() + interval).toISOString(),
  };
}

export function getDefaultReminderChannels(email?: string | null, phone?: string | null): DeliveryMethod[] {
  const channels: DeliveryMethod[] = [];
  if (email) channels.push("EMAIL");
  if (phone) channels.push("SMS");
  return channels.length > 0 ? channels : ["EMAIL"];
}

export async function getBrandingProfile(ownerAddress: string, profileId?: string | null): Promise<BrandingSettings> {
  const owner = normalizeOwnerAddress(ownerAddress);

  let profile: BrandingProfile | undefined;
  try {
    if (profileId) {
      profile = await db.query.brandingProfiles.findFirst({
        where: and(eq(brandingProfiles.id, profileId), eq(brandingProfiles.ownerAddress, owner)),
      });
    }

    if (!profile) {
      profile = await db.query.brandingProfiles.findFirst({
        where: eq(brandingProfiles.ownerAddress, owner),
        orderBy: (t, { desc: orderDesc }) => [orderDesc(t.isDefault), orderDesc(t.updatedAt)],
      });
    }
  } catch (error) {
    if (!isSchemaDriftError(error)) throw error;
  }

  return {
    ...DEFAULT_BRANDING_SETTINGS,
    ...(profile?.settings ?? {}),
  };
}

export function sanitizeIntegrationConfig(config: IntegrationConfig): IntegrationConfig {
  return {
    ...config,
    authToken: config.authToken ? maskSecret(config.authToken) : undefined,
    apiSecret: config.apiSecret ? maskSecret(config.apiSecret) : undefined,
    apiKey: config.apiKey ? maskSecret(config.apiKey) : undefined,
    clientSecret: config.clientSecret ? maskSecret(config.clientSecret) : undefined,
  };
}

function maskSecret(value: string): string {
  if (value.length <= 6) return "*".repeat(value.length);
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

export async function getIntegrationsByKind(
  ownerAddress: string,
  kind: IntegrationRecord["kind"],
): Promise<IntegrationRecord[]> {
  try {
    return await db.query.integrationConfigs.findMany({
      where: and(
        eq(integrationConfigs.ownerAddress, normalizeOwnerAddress(ownerAddress)),
        eq(integrationConfigs.kind, kind),
      ),
      orderBy: (t, { desc: orderDesc }) => [orderDesc(t.isDefault), desc(t.updatedAt)],
    });
  } catch (error) {
    if (!isSchemaDriftError(error)) throw error;
    return [];
  }
}

export async function getDefaultIntegration(
  ownerAddress: string,
  kind: IntegrationRecord["kind"],
): Promise<IntegrationConfig | null> {
  const integrations = await getIntegrationsByKind(ownerAddress, kind);
  const selected = integrations.find((entry) => entry.isDefault) ?? integrations[0];
  return selected?.config ?? null;
}

export async function getWorkspaceSummary(ownerAddress: string | string[]) {
  const owners = [
    ...new Set((Array.isArray(ownerAddress) ? ownerAddress : [ownerAddress]).map(normalizeOwnerAddress)),
  ].filter(Boolean);

  if (owners.length === 0) {
    return {
      branding: [],
      integrations: [],
      templates: [],
      webhooks: [],
      defaultBranding: DEFAULT_BRANDING_SETTINGS,
    };
  }

  const primaryOwner = owners[0]!;
  const [branding, integrations, templates, webhooks] = await Promise.all([
    db.query.brandingProfiles
      .findMany({
        where:
          owners.length === 1
            ? eq(brandingProfiles.ownerAddress, primaryOwner)
            : inArray(brandingProfiles.ownerAddress, owners),
        orderBy: (t, { desc: orderDesc }) => [orderDesc(t.isDefault), orderDesc(t.updatedAt)],
      })
      .catch((error) => {
        if (!isSchemaDriftError(error)) throw error;
        return [];
      }),
    db.query.integrationConfigs
      .findMany({
        where:
          owners.length === 1
            ? eq(integrationConfigs.ownerAddress, primaryOwner)
            : inArray(integrationConfigs.ownerAddress, owners),
        orderBy: (t, { desc: orderDesc }) => [orderDesc(t.isDefault), orderDesc(t.updatedAt)],
      })
      .catch((error) => {
        if (!isSchemaDriftError(error)) throw error;
        return [];
      }),
    db.query.documentTemplates
      .findMany({
        where:
          owners.length === 1
            ? eq(documentTemplates.ownerAddress, primaryOwner)
            : inArray(documentTemplates.ownerAddress, owners),
        orderBy: (t, { desc: orderDesc }) => [orderDesc(t.updatedAt)],
      })
      .catch((error) => {
        if (!isSchemaDriftError(error)) throw error;
        return [];
      }),
    db.query.webhookEndpoints
      .findMany({
        where:
          owners.length === 1
            ? eq(webhookEndpoints.ownerAddress, primaryOwner)
            : inArray(webhookEndpoints.ownerAddress, owners),
        orderBy: (t, { desc: orderDesc }) => [orderDesc(t.updatedAt)],
      })
      .catch((error) => {
        if (!isSchemaDriftError(error)) throw error;
        return [];
      }),
  ]);

  return {
    branding: branding.map((profile) => ({
      ...profile,
      settings: {
        ...DEFAULT_BRANDING_SETTINGS,
        ...(profile.settings ?? {}),
      },
    })),
    integrations: integrations.map((entry) => ({
      ...entry,
      config: sanitizeIntegrationConfig(entry.config),
    })),
    templates,
    webhooks,
    defaultBranding: await getBrandingProfile(primaryOwner),
  };
}
