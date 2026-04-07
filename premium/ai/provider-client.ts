/**
 * Multi-provider AI completion client.
 *
 * Thin orchestration layer — provider config lives in providers.ts,
 * connector routing in connector-client.ts. This file only handles
 * the fetch call and response mapping.
 */

import type { AiProviderInfo, CompletionRequest, CompletionResponse, ResolvedKey } from "./types";
import { getEndpoint, getAllEndpoints } from "./providers";
import { completeViaConnector } from "./connector-client";

/** Public provider info (no internal implementation details). */
export function getProviders(): AiProviderInfo[] {
  return getAllEndpoints().map((p) => ({
    name: p.name,
    label: p.label,
    isAggregator: p.isAggregator,
    models: p.models,
  }));
}

/**
 * Execute a completion against the specified provider.
 * Routes through the connector bridge when key.source === "connector".
 */
export async function complete(request: CompletionRequest, key: ResolvedKey): Promise<CompletionResponse> {
  if (key.source === "connector") {
    return completeViaConnector(request, key);
  }

  const endpoint = getEndpoint(request.provider);
  if (!endpoint) throw new Error(`Unsupported AI provider: ${request.provider}`);

  const baseUrl = key.baseUrl ?? endpoint.baseUrl;

  // Build URL — providers with custom URL builders (e.g. Google) handle it themselves
  const url = endpoint.buildUrl
    ? endpoint.buildUrl(baseUrl, request.model, key.apiKey)
    : `${baseUrl}${endpoint.chatPath}`;

  // Build headers — auth style is configured per-provider, not hardcoded
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (endpoint.authHeader) {
    headers[endpoint.authHeader] = endpoint.rawAuthValue ? key.apiKey : `Bearer ${key.apiKey}`;
  }
  if (key.organizationId && request.provider === "openai") {
    headers["OpenAI-Organization"] = key.organizationId;
  }
  if (endpoint.extraHeaders) Object.assign(headers, endpoint.extraHeaders);

  const body = endpoint.buildBody(request);
  const start = Date.now();

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`${request.provider} API error (${response.status}): ${errorText || response.statusText}`);
  }

  const parsed = endpoint.parseResponse((await response.json()) as Record<string, unknown>);

  return {
    content: parsed.content,
    model: parsed.model || request.model,
    provider: request.provider,
    usage: parsed.usage,
    finishReason: parsed.finishReason,
    latencyMs: Date.now() - start,
    execution: {
      source: key.source,
      requestedProvider: request.provider,
      requestedModel: request.model,
      actualProvider: request.provider,
      actualModel: parsed.model || request.model,
    },
  };
}
