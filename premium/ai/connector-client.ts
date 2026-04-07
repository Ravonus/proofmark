/**
 * Connector client — routes AI completions through locally-running tools
 * (codex, claude-code, openclaw, etc.) via the connector task queue.
 *
 * When a user has a local connector session active, we can route completions
 * through their machine instead of hitting cloud APIs. This enables:
 * - Zero-cost AI usage (local models)
 * - Privacy (data never leaves the machine)
 * - BYOM (bring your own model) flexibility
 */

import type { CompletionRequest, CompletionResponse, ResolvedKey } from "./types";

/** Map each cloud provider to its preferred local tool equivalent. */
const PROVIDER_TOOL_MAP: Record<string, string> = {
  anthropic: "claude-code",
  openai: "codex",
  google: "auto",
  mistral: "auto",
  cohere: "auto",
  groq: "auto",
  together: "auto",
  perplexity: "auto",
  xai: "auto",
  deepseek: "auto",
  openrouter: "auto",
  litellm: "auto",
};

const KNOWN_TOOLS = new Set(["codex", "claude-code", "claude", "openclaw"]);

/**
 * Given a cloud provider name, return the preferred local connector tool.
 * Falls back to "auto" for providers without a known local equivalent.
 */
export function preferredConnectorToolForProvider(provider: string): string {
  return PROVIDER_TOOL_MAP[provider] ?? "auto";
}

/**
 * Select the best local tool from the installed set.
 * Prefers the requested tool if installed, otherwise falls back to the
 * first known tool in the installed list.
 */
export function selectConnectorTool(installed: string[], preferred: string): string | null {
  if (installed.length === 0) return null;
  if (installed.includes(preferred)) return preferred;
  // Fallback to the first recognized tool
  const known = installed.find((t) => KNOWN_TOOLS.has(t));
  if (known) return known;
  // If nothing recognized, try the first one anyway
  return installed[0] ?? null;
}

/**
 * Route a completion through the local connector bridge.
 *
 * The connector task queue works as follows:
 * 1. We submit a task to the connector session's queue (via DB)
 * 2. The connector's heartbeat poll picks it up
 * 3. The connector runs it locally and reports back via completeTask
 *
 * For now, we use a simpler direct HTTP approach — the connector
 * exposes a local HTTP endpoint that we can call directly if it's
 * on the same network, or we fall back to the task queue.
 */
export async function completeViaConnector(
  request: CompletionRequest,
  key: ResolvedKey,
): Promise<CompletionResponse> {
  const tool = key.connectorTool ?? "auto";
  const sessionId = key.connectorSessionId;

  // Try the connector's local HTTP bridge if available
  // The connector registers its local endpoint in the session capabilities
  const baseUrl = key.baseUrl ?? `http://localhost:9100`;
  const url = `${baseUrl}/api/complete`;

  const start = Date.now();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key.apiKey ? { Authorization: `Bearer ${key.apiKey}` } : {}),
    },
    body: JSON.stringify({
      tool,
      provider: request.provider,
      model: request.model,
      messages: request.messages,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      responseFormat: request.responseFormat,
    }),
    signal: AbortSignal.timeout(120_000), // 2 min timeout for local tools
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Connector bridge error (${response.status}): ${text || response.statusText}`);
  }

  const body = (await response.json()) as {
    content?: string;
    model?: string;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    finishReason?: string;
  };

  const latencyMs = Date.now() - start;
  const usage = {
    inputTokens: body.usage?.inputTokens ?? 0,
    outputTokens: body.usage?.outputTokens ?? 0,
    totalTokens: body.usage?.totalTokens ?? (body.usage?.inputTokens ?? 0) + (body.usage?.outputTokens ?? 0),
  };

  return {
    content: body.content ?? "",
    model: body.model ?? `local-${tool}`,
    provider: request.provider,
    usage,
    finishReason: body.finishReason ?? "stop",
    latencyMs,
    execution: {
      source: "connector",
      requestedProvider: request.provider,
      requestedModel: request.model,
      actualProvider: request.provider,
      actualModel: body.model ?? `local-${tool}`,
      tool,
      connectorSessionId: sessionId,
      connectorLabel: key.connectorLabel,
    },
  };
}
