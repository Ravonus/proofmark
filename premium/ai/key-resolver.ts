/**
 * BYOK key resolution.
 *
 * Resolution priority (per provider):
 *   1. User's BYOK config  (aiProviderConfigs table)
 *   2. Online connector     (active session with compatible tool)
 *   3. Platform env var     (admin-configured)
 *
 * resolveKey()             — exact provider, no fallback
 * resolveKeyWithFallback() — tries requested provider, then any available
 */

import { eq, and, desc } from "drizzle-orm";
import { db } from "../../src/server/db";
import { aiProviderConfigs, connectorSessions } from "../../src/server/db/schema";
import type { AiProviderName, AiPlatformProvider, ResolvedKey } from "./types";
import { getEndpoint, getDefaultModel, getPlatformEnvVar, FALLBACK_ORDER } from "./providers";
import { preferredConnectorToolForProvider, selectConnectorTool } from "./connector-client";

/** Resolved key + best model for that key. */
export interface ResolvedKeyWithModel {
  key: ResolvedKey;
  model: string;
}

// ── Source-specific resolvers (private) ──

async function fromByok(ownerAddress: string, provider: AiProviderName): Promise<ResolvedKeyWithModel | null> {
  const [config] = await db
    .select()
    .from(aiProviderConfigs)
    .where(and(eq(aiProviderConfigs.ownerAddress, ownerAddress), eq(aiProviderConfigs.provider, provider)))
    .orderBy(desc(aiProviderConfigs.isDefault))
    .limit(1);

  if (!config?.config?.apiKey || config.config.enabled === false) return null;

  return {
    key: {
      apiKey: config.config.apiKey,
      source: "byok",
      provider,
      ownerAddress,
      baseUrl: config.config.baseUrl,
      organizationId: config.config.organizationId,
    },
    model: config.config.defaultModel ?? getDefaultModel(provider),
  };
}

async function fromConnector(ownerAddress: string, provider: AiProviderName): Promise<ResolvedKeyWithModel | null> {
  const staleThreshold = new Date(Date.now() - 60_000);

  const sessions = await db
    .select()
    .from(connectorSessions)
    .where(and(eq(connectorSessions.ownerAddress, ownerAddress), eq(connectorSessions.status, "online")))
    .orderBy(desc(connectorSessions.lastHeartbeatAt))
    .limit(5);

  const active = sessions.filter((s) => s.lastHeartbeatAt && s.lastHeartbeatAt > staleThreshold);
  if (active.length === 0) return null;

  // Try to match a session with the preferred tool for this provider
  const preferred = preferredConnectorToolForProvider(provider);
  for (const session of active) {
    const tools = (session.capabilities as { supportedTools?: string[] } | null)?.supportedTools ?? [];
    const tool = selectConnectorTool(tools, preferred);
    if (tool) return buildConnectorKey(session, provider, ownerAddress, tool);
  }

  // No tool match — fall back to first active session with "auto"
  return buildConnectorKey(active[0]!, provider, ownerAddress, "auto");
}

function buildConnectorKey(
  session: { id: string; label: string | null },
  provider: AiProviderName,
  ownerAddress: string,
  tool: string,
): ResolvedKeyWithModel {
  return {
    key: {
      apiKey: `connector:${session.id}`,
      source: "connector",
      provider,
      ownerAddress,
      connectorSessionId: session.id,
      connectorTool: tool,
      connectorLabel: session.label ?? undefined,
    },
    model: getDefaultModel(provider),
  };
}

function fromPlatform(provider: AiProviderName): ResolvedKeyWithModel | null {
  const envVar = getPlatformEnvVar(provider);
  if (!envVar) return null;
  const apiKey = process.env[envVar];
  if (!apiKey) return null;

  return {
    key: { apiKey, source: "platform", provider },
    model: getDefaultModel(provider),
  };
}

// ── Resolution chain (private) — tries BYOK → Connector → Platform ──

async function resolveForProvider(
  ownerAddress: string,
  provider: AiProviderName,
): Promise<ResolvedKeyWithModel | null> {
  return (
    (await fromByok(ownerAddress, provider)) ??
    (await fromConnector(ownerAddress, provider)) ??
    fromPlatform(provider)
  );
}

// ── Public API ──

/** Resolve a key for the exact provider. No cross-provider fallback. */
export async function resolveKey(ownerAddress: string, provider: AiProviderName): Promise<ResolvedKey | null> {
  const result = await resolveForProvider(ownerAddress, provider);
  return result?.key ?? null;
}

/** Resolve a key with cross-provider fallback. Returns key + model. */
export async function resolveKeyWithFallback(
  ownerAddress: string,
  provider: AiProviderName,
): Promise<ResolvedKeyWithModel | null> {
  // 1. Try the requested provider
  const primary = await resolveForProvider(ownerAddress, provider);
  if (primary) return primary;

  // 2. Try any other BYOK config the user has
  const allConfigs = await db
    .select()
    .from(aiProviderConfigs)
    .where(eq(aiProviderConfigs.ownerAddress, ownerAddress))
    .orderBy(desc(aiProviderConfigs.isDefault));

  for (const config of allConfigs) {
    if (config.config?.apiKey && config.config.enabled !== false) {
      const p = config.provider as AiProviderName;
      return {
        key: {
          apiKey: config.config.apiKey,
          source: "byok",
          provider: p,
          ownerAddress,
          baseUrl: config.config.baseUrl,
          organizationId: config.config.organizationId,
        },
        model: config.config.defaultModel ?? getDefaultModel(p),
      };
    }
  }

  // 3. Try any platform key in priority order
  for (const fp of FALLBACK_ORDER) {
    if (fp === provider) continue;
    const pk = fromPlatform(fp);
    if (pk) return pk;
  }

  // 4. Try any connector
  const conn = await fromConnector(ownerAddress, "anthropic");
  return conn;
}

/** List platform providers with availability status. */
export function getPlatformProviders(): AiPlatformProvider[] {
  return FALLBACK_ORDER.map((name) => {
    const ep = getEndpoint(name);
    const envVar = getPlatformEnvVar(name);
    return {
      provider: name,
      available: !!envVar && !!process.env[envVar],
      label: ep?.label ?? name,
      defaultModel: getDefaultModel(name),
    };
  });
}

export function isPlatformProviderAvailable(provider: AiProviderName): boolean {
  const envVar = getPlatformEnvVar(provider);
  return !!envVar && !!process.env[envVar];
}
