/**
 * Provider registry — single source of truth for all AI provider configuration.
 *
 * Every provider's endpoint, models, pricing, default model, and platform env var
 * are defined here. Other modules import from this file instead of maintaining
 * their own copies.
 */

import type { AiProviderName, CompletionRequest } from "./types";

// ── Response parser type (internal to provider system) ──

export interface ParsedResponse {
  content: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: string;
}

export interface ProviderEndpoint {
  name: AiProviderName;
  label: string;
  isAggregator: boolean;
  baseUrl: string;
  chatPath: string;
  /** Header name for auth. Empty string = no header (e.g. Google uses URL param). */
  authHeader: string;
  /** If true, auth value is the raw key; otherwise it's "Bearer {key}". */
  rawAuthValue: boolean;
  /** Extra headers to include on every request. */
  extraHeaders?: Record<string, string>;
  defaultModel: string;
  platformEnvVar?: string;
  models: ProviderModel[];
  buildBody: (req: CompletionRequest) => Record<string, unknown>;
  parseResponse: (body: Record<string, unknown>) => ParsedResponse;
  /** Custom URL builder. When set, replaces the default `baseUrl + chatPath`. */
  buildUrl?: (baseUrl: string, model: string, apiKey: string) => string;
}

export interface ProviderModel {
  id: string;
  name: string;
  contextWindow: number;
  inputPricePer1k: number;
  outputPricePer1k: number;
}

// ── Shared body/parse for OpenAI-compatible APIs ──

function openaiBody(req: CompletionRequest): Record<string, unknown> {
  return {
    model: req.model,
    messages: req.messages,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.7,
    ...(req.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
  };
}

function openaiParse(body: Record<string, unknown>): ParsedResponse {
  const choices = body.choices as Array<{ message: { content: string }; finish_reason: string }> | undefined;
  const usage = body.usage as { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
  return {
    content: choices?.[0]?.message?.content ?? "",
    model: (body.model as string) ?? "",
    usage: {
      inputTokens: usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    },
    finishReason: choices?.[0]?.finish_reason ?? "stop",
  };
}

// ── Anthropic ──

function anthropicBody(req: CompletionRequest): Record<string, unknown> {
  const systemMsg = req.messages.find((m) => m.role === "system")?.content;
  const messages = req.messages.filter((m) => m.role !== "system");
  return {
    model: req.model,
    messages,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.7,
    ...(systemMsg ? { system: systemMsg } : {}),
  };
}

function anthropicParse(body: Record<string, unknown>): ParsedResponse {
  const content = body.content as Array<{ type: string; text: string }> | undefined;
  const usage = body.usage as { input_tokens: number; output_tokens: number } | undefined;
  return {
    content: content?.filter((c) => c.type === "text").map((c) => c.text).join("") ?? "",
    model: (body.model as string) ?? "",
    usage: {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
    },
    finishReason: (body.stop_reason as string) ?? "end_turn",
  };
}

// ── Google AI ──

function googleBody(req: CompletionRequest): Record<string, unknown> {
  const systemMsg = req.messages.find((m) => m.role === "system")?.content;
  return {
    contents: req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    generationConfig: {
      maxOutputTokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
    },
    ...(systemMsg ? { systemInstruction: { parts: [{ text: systemMsg }] } } : {}),
  };
}

function googleParse(body: Record<string, unknown>): ParsedResponse {
  const candidates = body.candidates as Array<{
    content: { parts: Array<{ text: string }> };
    finishReason: string;
  }> | undefined;
  const usage = body.usageMetadata as {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  } | undefined;
  return {
    content: candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "",
    model: "",
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      totalTokens: usage?.totalTokenCount ?? 0,
    },
    finishReason: candidates?.[0]?.finishReason ?? "STOP",
  };
}

// ── Registry ──
// OpenAI-compatible providers share openaiBody/openaiParse. Only Anthropic and
// Google have custom formats. Adding a new OpenAI-compatible provider is a
// one-liner entry with the shared functions.

const PROVIDERS: ProviderEndpoint[] = [
  {
    name: "anthropic",
    label: "Anthropic",
    isAggregator: false,
    baseUrl: "https://api.anthropic.com",
    chatPath: "/v1/messages",
    authHeader: "x-api-key",
    rawAuthValue: true,
    extraHeaders: { "anthropic-version": "2023-06-01" },
    defaultModel: "claude-sonnet-4-20250514",
    platformEnvVar: "PROOFMARK_ANTHROPIC_API_KEY",
    models: [
      { id: "claude-opus-4-20250514", name: "Claude Opus 4", contextWindow: 200_000, inputPricePer1k: 0.015, outputPricePer1k: 0.075 },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", contextWindow: 200_000, inputPricePer1k: 0.003, outputPricePer1k: 0.015 },
      { id: "claude-haiku-4-20250506", name: "Claude Haiku 4", contextWindow: 200_000, inputPricePer1k: 0.0008, outputPricePer1k: 0.004 },
    ],
    buildBody: anthropicBody,
    parseResponse: anthropicParse,
  },
  {
    name: "openai",
    label: "OpenAI",
    isAggregator: false,
    baseUrl: "https://api.openai.com",
    chatPath: "/v1/chat/completions",
    authHeader: "Authorization",
    rawAuthValue: false,
    defaultModel: "gpt-4o",
    platformEnvVar: "PROOFMARK_OPENAI_API_KEY",
    models: [
      { id: "gpt-4o", name: "GPT-4o", contextWindow: 128_000, inputPricePer1k: 0.0025, outputPricePer1k: 0.01 },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128_000, inputPricePer1k: 0.00015, outputPricePer1k: 0.0006 },
      { id: "o3-mini", name: "o3-mini", contextWindow: 200_000, inputPricePer1k: 0.0011, outputPricePer1k: 0.0044 },
    ],
    buildBody: openaiBody,
    parseResponse: openaiParse,
  },
  {
    name: "google",
    label: "Google AI",
    isAggregator: false,
    baseUrl: "https://generativelanguage.googleapis.com",
    chatPath: "",
    authHeader: "",
    rawAuthValue: true,
    defaultModel: "gemini-2.5-flash",
    platformEnvVar: "PROOFMARK_GOOGLE_AI_KEY",
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 1_000_000, inputPricePer1k: 0.00125, outputPricePer1k: 0.01 },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1_000_000, inputPricePer1k: 0.00015, outputPricePer1k: 0.0006 },
    ],
    buildBody: googleBody,
    parseResponse: googleParse,
    buildUrl: (base, model, key) => `${base}/v1beta/models/${model}:generateContent?key=${key}`,
  },
  {
    name: "mistral",
    label: "Mistral AI",
    isAggregator: false,
    baseUrl: "https://api.mistral.ai",
    chatPath: "/v1/chat/completions",
    authHeader: "Authorization",
    rawAuthValue: false,
    defaultModel: "mistral-large-latest",
    platformEnvVar: "PROOFMARK_MISTRAL_API_KEY",
    models: [
      { id: "mistral-large-latest", name: "Mistral Large", contextWindow: 128_000, inputPricePer1k: 0.002, outputPricePer1k: 0.006 },
      { id: "mistral-small-latest", name: "Mistral Small", contextWindow: 128_000, inputPricePer1k: 0.0002, outputPricePer1k: 0.0006 },
    ],
    buildBody: openaiBody,
    parseResponse: openaiParse,
  },
  {
    name: "groq",
    label: "Groq",
    isAggregator: false,
    baseUrl: "https://api.groq.com/openai",
    chatPath: "/v1/chat/completions",
    authHeader: "Authorization",
    rawAuthValue: false,
    defaultModel: "llama-3.3-70b-versatile",
    platformEnvVar: "PROOFMARK_GROQ_API_KEY",
    models: [
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", contextWindow: 128_000, inputPricePer1k: 0.00059, outputPricePer1k: 0.00079 },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", contextWindow: 128_000, inputPricePer1k: 0.00005, outputPricePer1k: 0.00008 },
    ],
    buildBody: openaiBody,
    parseResponse: openaiParse,
  },
  {
    name: "together",
    label: "Together AI",
    isAggregator: true,
    baseUrl: "https://api.together.xyz",
    chatPath: "/v1/chat/completions",
    authHeader: "Authorization",
    rawAuthValue: false,
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    platformEnvVar: "PROOFMARK_TOGETHER_API_KEY",
    models: [
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B", contextWindow: 128_000, inputPricePer1k: 0.00088, outputPricePer1k: 0.00088 },
      { id: "Qwen/Qwen2.5-72B-Instruct-Turbo", name: "Qwen 2.5 72B", contextWindow: 128_000, inputPricePer1k: 0.0012, outputPricePer1k: 0.0012 },
    ],
    buildBody: openaiBody,
    parseResponse: openaiParse,
  },
  {
    name: "perplexity",
    label: "Perplexity",
    isAggregator: false,
    baseUrl: "https://api.perplexity.ai",
    chatPath: "/chat/completions",
    authHeader: "Authorization",
    rawAuthValue: false,
    defaultModel: "sonar",
    platformEnvVar: "PROOFMARK_PERPLEXITY_API_KEY",
    models: [
      { id: "sonar-pro", name: "Sonar Pro", contextWindow: 200_000, inputPricePer1k: 0.003, outputPricePer1k: 0.015 },
      { id: "sonar", name: "Sonar", contextWindow: 128_000, inputPricePer1k: 0.001, outputPricePer1k: 0.001 },
    ],
    buildBody: openaiBody,
    parseResponse: openaiParse,
  },
  {
    name: "xai",
    label: "xAI",
    isAggregator: false,
    baseUrl: "https://api.x.ai",
    chatPath: "/v1/chat/completions",
    authHeader: "Authorization",
    rawAuthValue: false,
    defaultModel: "grok-3-mini",
    platformEnvVar: "PROOFMARK_XAI_API_KEY",
    models: [
      { id: "grok-3", name: "Grok 3", contextWindow: 131_072, inputPricePer1k: 0.003, outputPricePer1k: 0.015 },
      { id: "grok-3-mini", name: "Grok 3 Mini", contextWindow: 131_072, inputPricePer1k: 0.0003, outputPricePer1k: 0.0005 },
    ],
    buildBody: openaiBody,
    parseResponse: openaiParse,
  },
  {
    name: "deepseek",
    label: "DeepSeek",
    isAggregator: false,
    baseUrl: "https://api.deepseek.com",
    chatPath: "/chat/completions",
    authHeader: "Authorization",
    rawAuthValue: false,
    defaultModel: "deepseek-chat",
    platformEnvVar: "PROOFMARK_DEEPSEEK_API_KEY",
    models: [
      { id: "deepseek-chat", name: "DeepSeek V3", contextWindow: 64_000, inputPricePer1k: 0.00014, outputPricePer1k: 0.00028 },
      { id: "deepseek-reasoner", name: "DeepSeek R1", contextWindow: 64_000, inputPricePer1k: 0.00055, outputPricePer1k: 0.00219 },
    ],
    buildBody: openaiBody,
    parseResponse: openaiParse,
  },
  {
    name: "openrouter",
    label: "OpenRouter",
    isAggregator: true,
    baseUrl: "https://openrouter.ai/api",
    chatPath: "/v1/chat/completions",
    authHeader: "Authorization",
    rawAuthValue: false,
    defaultModel: "anthropic/claude-sonnet-4",
    platformEnvVar: "PROOFMARK_OPENROUTER_API_KEY",
    models: [
      { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4 (via OR)", contextWindow: 200_000, inputPricePer1k: 0.003, outputPricePer1k: 0.015 },
      { id: "openai/gpt-4o", name: "GPT-4o (via OR)", contextWindow: 128_000, inputPricePer1k: 0.0025, outputPricePer1k: 0.01 },
    ],
    buildBody: openaiBody,
    parseResponse: openaiParse,
  },
  {
    name: "cohere",
    label: "Cohere",
    isAggregator: false,
    baseUrl: "https://api.cohere.com",
    chatPath: "/v2/chat",
    authHeader: "Authorization",
    rawAuthValue: false,
    defaultModel: "command-r-plus-08-2024",
    platformEnvVar: "PROOFMARK_COHERE_API_KEY",
    models: [
      { id: "command-r-plus-08-2024", name: "Command R+", contextWindow: 128_000, inputPricePer1k: 0.0025, outputPricePer1k: 0.01 },
      { id: "command-r-08-2024", name: "Command R", contextWindow: 128_000, inputPricePer1k: 0.00015, outputPricePer1k: 0.0006 },
    ],
    buildBody: openaiBody,
    parseResponse: openaiParse,
  },
  {
    name: "litellm",
    label: "LiteLLM Proxy",
    isAggregator: true,
    baseUrl: "http://localhost:4000",
    chatPath: "/chat/completions",
    authHeader: "Authorization",
    rawAuthValue: false,
    defaultModel: "gpt-4o",
    models: [],
    buildBody: openaiBody,
    parseResponse: openaiParse,
  },
];

// ── Lookup indexes (built once at import time) ──

const byName = new Map(PROVIDERS.map((p) => [p.name, p]));

const pricingIndex: Map<string, { inputPer1k: number; outputPer1k: number }> = new Map();
for (const p of PROVIDERS) {
  for (const m of p.models) {
    pricingIndex.set(m.id, { inputPer1k: m.inputPricePer1k, outputPer1k: m.outputPricePer1k });
  }
}

// ── Public API ──

export function getEndpoint(name: AiProviderName): ProviderEndpoint | undefined {
  return byName.get(name);
}

export function getAllEndpoints(): readonly ProviderEndpoint[] {
  return PROVIDERS;
}

export function getDefaultModel(provider: string): string {
  return byName.get(provider as AiProviderName)?.defaultModel ?? "";
}

export function getPlatformEnvVar(provider: string): string | undefined {
  return byName.get(provider as AiProviderName)?.platformEnvVar;
}

/** Estimate cost in cents from model-level pricing. Returns 0 for unknown models. */
export function estimateCostCents(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = pricingIndex.get(model);
  if (!pricing) return 0;
  const dollars = (inputTokens / 1000) * pricing.inputPer1k + (outputTokens / 1000) * pricing.outputPer1k;
  return Math.round(dollars * 100);
}

/**
 * All providers that have a platform env var.
 * Used by key-resolver to know the fallback order.
 */
export const FALLBACK_ORDER: AiProviderName[] = PROVIDERS
  .filter((p) => p.platformEnvVar)
  .map((p) => p.name);
