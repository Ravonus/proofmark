/**
 * Shared types for the premium AI module.
 *
 * Pure type definitions only — no runtime code, no provider data.
 * These mirror the inline types in src/server/api/routers/ai.ts;
 * the router defines them independently to avoid hard imports from premium/.
 */

// ── Provider & Key Types ──

export type AiProviderName =
  | "anthropic"
  | "openai"
  | "google"
  | "mistral"
  | "cohere"
  | "groq"
  | "together"
  | "perplexity"
  | "xai"
  | "deepseek"
  | "openrouter"
  | "litellm";

export type AiFeature = "scraper_fix" | "editor_assistant" | "signer_qa" | "general";

export type AiKeySource = "byok" | "platform" | "connector";

export interface ResolvedKey {
  apiKey: string;
  source: AiKeySource;
  provider: AiProviderName;
  ownerAddress?: string;
  baseUrl?: string;
  organizationId?: string;
  connectorSessionId?: string;
  connectorTool?: string;
  connectorLabel?: string;
}

// ── Request / Response Types ──

export interface AiRequestContext {
  ownerAddress: string;
  provider: AiProviderName;
  model: string;
  key: ResolvedKey;
  documentId?: string;
  userId?: string;
}

export interface CompletionRequest {
  provider: AiProviderName;
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: "text" | "json";
}

export interface CompletionResponse {
  content: string;
  model: string;
  provider: string;
  usage: TokenUsage;
  finishReason: string;
  latencyMs: number;
  execution: ExecutionTrace;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ExecutionTrace {
  source: string;
  requestedProvider: string;
  requestedModel: string;
  actualProvider: string;
  actualModel: string;
  tool?: string;
  connectorSessionId?: string;
  connectorLabel?: string;
}

export interface AiRawResponse {
  usage?: TokenUsage;
  latencyMs?: number;
  execution: Partial<ExecutionTrace>;
  [key: string]: unknown;
}

// ── Public-facing info types ──

export interface AiProviderInfo {
  name: string;
  label: string;
  isAggregator: boolean;
  models: Array<{
    id: string;
    name: string;
    contextWindow: number;
    inputPricePer1k: number;
    outputPricePer1k: number;
  }>;
}

export interface AiPlatformProvider {
  provider: AiProviderName;
  available: boolean;
  label: string;
  defaultModel: string;
}

// ── Forensic Evidence (shared across automation-review + forensic-queue) ──

export interface ForensicEvidence {
  deviceFingerprint?: Record<string, unknown>;
  behavioralSignals?: Record<string, unknown>;
  canvasChallenge?: Record<string, unknown>;
  signatureReplay?: Record<string, unknown>;
  gazeBehavior?: Record<string, unknown>;
  ipAnalysis?: Record<string, unknown>;
  policyOutcome?: Record<string, unknown>;
  automationReview?: Record<string, unknown>;
  [key: string]: unknown;
}

// ── Helpers ──

/** Extract the standard raw response shape from a CompletionResponse. */
export function toRawResponse(response: CompletionResponse): AiRawResponse {
  return {
    usage: response.usage,
    latencyMs: response.latencyMs,
    execution: response.execution,
  };
}
