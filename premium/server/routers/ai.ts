/**
 * AI tRPC router.
 *
 * In the FREE version: all procedures return { available: false } or throw FORBIDDEN.
 * In the PREMIUM version: loads premium/ai/ at runtime.
 *
 * Rate limiting, usage logging, and conversation persistence are handled here,
 * not in the feature modules — features are pure AI logic.
 */

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { loadPremiumAi, getPremiumFeatures } from "~/lib/platform/premium";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { documents, signers, aiProviderConfigs, aiConversations } from "~/server/db/schema";
import type { AiChatMessage, AiEditOperation, SignerField } from "~/server/db/schema";
import { requireFeatureForWallet, resolveWalletIdentity } from "~/server/crypto/operator-access";
import type { EnhancedForensicEvidence } from "~/lib/forensic/premium";
import { getOwnedWalletContextFromRequest, requireOwnedWalletActor } from "~/server/crypto/owned-wallet-context";
import { normalizeOwnerAddress } from "~/server/workspace/workspace";
import type { db as _dbType } from "~/server/db";

type DbClient = typeof _dbType;

// Inline types to avoid hard import from premium/ — these match premium/ai/types.ts
type AiProviderName =
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
type ResolvedKey = {
  apiKey: string;
  source: string;
  provider: AiProviderName;
  ownerAddress?: string;
  baseUrl?: string;
  organizationId?: string;
  connectorSessionId?: string;
  connectorTool?: string;
  connectorLabel?: string;
};

type AiFeature = "scraper_fix" | "editor_assistant" | "signer_qa" | "general";

// ── Types for document/signer DB rows ──
type DocumentRow = InferSelectModel<typeof documents>;
type SignerRow = InferSelectModel<typeof signers>;

// ── Types for premium AI module results ──
// These mirror the shapes returned by premium/ai/ — kept minimal to what this router uses.
interface AiRawResponse {
  usage?: unknown;
  latencyMs?: number;
  execution: {
    source?: string;
    requestedProvider?: string;
    requestedModel?: string;
    actualProvider?: string;
    actualModel?: string;
    tool?: string;
    connectorSessionId?: string;
    connectorLabel?: string;
  };
  [key: string]: unknown;
}

interface AiCompleteResponse {
  content: string;
  latencyMs: number;
  [key: string]: unknown;
}

interface AiReviewResult {
  review: {
    verdict: string;
    [key: string]: unknown;
  };
  raw: AiRawResponse;
}

interface AiScraperResult {
  corrected: unknown;
  changes: unknown[];
  response: AiRawResponse;
}

interface AiChatResult {
  response: {
    text: string;
    editOperations?: AiEditOperation[];
    [key: string]: unknown;
  };
  raw: AiRawResponse;
}

interface AiAnswerResult {
  answer: string;
  raw: AiRawResponse;
}

interface AiSummaryResult {
  summary: string;
  raw: AiRawResponse;
}

interface AiConversationData {
  messages: AiChatMessage[];
  id: string | undefined;
}

interface AiProviderInfo {
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

interface AiPlatformProvider {
  available: boolean;
  [key: string]: unknown;
}

interface AiRequestContext {
  ownerAddress: string;
  provider: AiProviderName;
  model: string;
  key: ResolvedKey;
  documentId?: string;
  userId?: string;
}

/** Shape of the premium AI module — only the methods used in this router. */
interface PremiumAiModule {
  resolveKeyWithFallback(
    ownerAddress: string,
    provider: AiProviderName,
  ): Promise<{ key: ResolvedKey; model: string } | null>;
  resolveKey(ownerAddress: string, provider: AiProviderName): Promise<ResolvedKey | null>;
  enforceRateLimit(ownerAddress: string, feature: AiFeature): Promise<void>;
  trackUsage(
    rCtx: AiRequestContext,
    feature: AiFeature,
    raw: AiRawResponse,
    meta?: Record<string, unknown>,
  ): Promise<void>;
  fixScraperOutput(rCtx: AiRequestContext, analysisResult: unknown, rawContent?: string): Promise<AiScraperResult>;
  chat(params: AiRequestContext & Record<string, unknown>): Promise<AiChatResult>;
  answerQuestion(params: AiRequestContext & Record<string, unknown>): Promise<AiAnswerResult>;
  generateSummary(params: AiRequestContext & Record<string, unknown>): Promise<AiSummaryResult>;
  reviewAutomationEvidence(params: AiRequestContext & Record<string, unknown>): Promise<AiReviewResult>;
  loadConversation(conversationId: string | undefined, ownerAddress: string): Promise<AiConversationData>;
  saveConversation(params: {
    conversationId: string | undefined;
    ownerAddress: string;
    documentId: string;
    feature: string;
    messages: AiChatMessage[];
    title: string;
  }): Promise<string>;
  syncPlatformProviderConfigs(ownerAddress: string): Promise<void>;
  getPlatformProviders(): AiPlatformProvider[];
  isPlatformProviderAvailable(provider: AiProviderName): boolean;
  getProviders(): AiProviderInfo[];
  complete(
    params: {
      provider: AiProviderName;
      model: string;
      messages: Array<{ role: string; content: string }>;
      maxTokens: number;
      temperature: number;
    },
    key: { apiKey: string; source: string; provider: AiProviderName; baseUrl?: string },
  ): Promise<AiCompleteResponse>;
  getUsageSummary(ownerAddress: string, from: Date, to: Date, userId?: string): Promise<unknown>;
  setAdminLimits(params: Record<string, unknown>): Promise<void>;
  getLimitStatus(ownerAddress: string, feature: AiFeature, userId?: string): Promise<unknown>;
}

const AI_FORBIDDEN = "Premium feature — upgrade to enable AI features";

const zAiFeature = z.enum(["scraper_fix", "editor_assistant", "signer_qa", "general"]);

// ── Shared helpers ──

async function requireAi(): Promise<PremiumAiModule> {
  const ai = (await loadPremiumAi()) as PremiumAiModule | null;
  if (!ai) throw new TRPCError({ code: "FORBIDDEN", message: AI_FORBIDDEN });
  return ai;
}

async function requireAiFeature(
  db: DbClient,
  ownerAddress: string,
  featureId: "ai_scraper_fix" | "ai_editor_assistant" | "ai_signer_qa" | "ai_automation_review",
): Promise<PremiumAiModule> {
  await requireFeatureForWallet(db, resolveWalletIdentity(ownerAddress), featureId, AI_FORBIDDEN);
  return requireAi();
}

async function getAiAccountContext(ctx: { req?: Request | null | undefined }) {
  const ownedWalletContext = await getOwnedWalletContextFromRequest(ctx.req ?? null);
  const actor = requireOwnedWalletActor(ownedWalletContext, "Link a wallet to this account before using AI settings.");

  return {
    ownedWalletContext,
    ownerAddress: actor.address,
    userId: ownedWalletContext.identity.userId ?? undefined,
  };
}

async function resolveOwnedDocumentOwnerAddress(db: DbClient, documentId: string, ownedAddresses: string[]) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  }

  const ownerAddress = normalizeOwnerAddress(doc.createdBy);
  if (!ownedAddresses.includes(ownerAddress)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the document creator can use AI for this document" });
  }

  return ownerAddress;
}

async function resolveProvider(ai: PremiumAiModule, ownerAddress: string, provider?: string) {
  const resolved = await ai.resolveKeyWithFallback(ownerAddress, (provider ?? "anthropic") as AiProviderName);
  if (!resolved) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "No AI provider or local connector is configured. Add an API key in settings, connect a local tool, or contact your admin.",
    });
  }
  return resolved;
}

function toRequestContext(
  ownerAddress: string,
  resolved: { key: ResolvedKey; model: string },
  modelOverride?: string,
  documentId?: string,
  userId?: string,
): AiRequestContext {
  return {
    ownerAddress,
    provider: resolved.key.provider,
    model: modelOverride ?? resolved.model,
    key: resolved.key,
    documentId,
    userId,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableAutomationReviewError(error: unknown, key: ResolvedKey | null): boolean {
  if (key?.source !== "connector") return false;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|timed out|timeout|no online local ai connector|empty response|connector/i.test(message);
}

async function runAutomationReviewTarget(params: {
  ai: PremiumAiModule;
  ownerAddress: string;
  documentId: string;
  signerId: string;
  documentTitle: string;
  signerLabel: string;
  evidence: EnhancedForensicEvidence;
  policy: Record<string, unknown> | undefined;
  target: { provider: string; model: string };
}) {
  const requested = {
    provider: params.target.provider,
    model: params.target.model,
  };

  let lastKey: ResolvedKey | null = null;
  let lastError: Error | null = null;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const key = await params.ai.resolveKey(params.ownerAddress, params.target.provider as AiProviderName);
      lastKey = key;
      if (!key) {
        return {
          status: "error" as const,
          requested,
          attempts: attempt,
          error: `No AI provider or local connector is configured for provider "${params.target.provider}"`,
        };
      }

      const rCtx = {
        ownerAddress: params.ownerAddress,
        provider: key.provider,
        model: params.target.model,
        key,
        documentId: params.documentId,
      };

      const result = await params.ai.reviewAutomationEvidence({
        ...rCtx,
        documentTitle: params.documentTitle,
        signerLabel: params.signerLabel,
        evidence: params.evidence,
        policy: params.policy,
      });

      await params.ai.trackUsage(rCtx, "general", result.raw, {
        kind: "automation_review_matrix",
        signerId: params.signerId,
        requestedProvider: params.target.provider,
        requestedModel: params.target.model,
        actualProvider: result.raw.execution.actualProvider,
        actualModel: result.raw.execution.actualModel,
        executionTool: result.raw.execution.tool,
        verdict: result.review.verdict,
        attempts: attempt,
      });

      return {
        status: "ok" as const,
        requested,
        execution: result.raw.execution,
        attempts: attempt,
        review: result.review,
        usage: result.raw.usage,
        latencyMs: result.raw.latencyMs,
      };
    } catch (error) {
      lastError = error as Error;
      const retryable = isRetryableAutomationReviewError(error, lastKey);
      if (!retryable || attempt === maxAttempts) {
        return {
          status: "error" as const,
          requested,
          execution: lastKey
            ? {
                source: lastKey.source,
                requestedProvider: lastKey.provider,
                requestedModel: params.target.model,
                actualProvider: lastKey.provider,
                actualModel: params.target.model,
                tool: lastKey.connectorTool,
                connectorSessionId: lastKey.connectorSessionId,
                connectorLabel: lastKey.connectorLabel,
              }
            : undefined,
          attempts: attempt,
          error: lastError.message,
        };
      }

      await sleep(750 * attempt);
    }
  }

  return {
    status: "error" as const,
    requested,
    attempts: maxAttempts,
    error: lastError?.message ?? "Unknown automation review failure",
  };
}

async function loadSignerContext(
  db: DbClient,
  documentId: string,
  claimToken: string,
): Promise<{ signer: SignerRow; doc: DocumentRow; allSigners: SignerRow[] }> {
  const [signer] = await db
    .select()
    .from(signers)
    .where(and(eq(signers.documentId, documentId), eq(signers.claimToken, claimToken)))
    .limit(1);
  if (!signer) throw new TRPCError({ code: "NOT_FOUND", message: "Invalid signer access" });

  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });

  const allSigners = await db.select().from(signers).where(eq(signers.documentId, documentId));

  return { signer, doc, allSigners };
}

function mapSignerFields(signer: SignerRow) {
  return (signer.fields ?? []).map((f: SignerField) => ({ type: f.type, label: f.label, required: f.required }));
}

async function loadCreatorSignerEvidence(db: DbClient, documentId: string, signerId: string, ownedAddresses: string[]) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
  const ownerAddress = normalizeOwnerAddress(doc.createdBy);
  if (!ownedAddresses.includes(ownerAddress)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only the document creator can review signer automation evidence",
    });
  }

  const [signer] = await db
    .select()
    .from(signers)
    .where(and(eq(signers.documentId, documentId), eq(signers.id, signerId)))
    .limit(1);
  if (!signer) throw new TRPCError({ code: "NOT_FOUND", message: "Signer not found" });
  if (!signer.forensicEvidence) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This signer does not have forensic evidence yet" });
  }

  return {
    doc,
    signer,
    ownerAddress,
    evidence: signer.forensicEvidence as EnhancedForensicEvidence,
  };
}

// ── Router ──

export const aiRouter = createTRPCRouter({
  capabilities: publicProcedure.query(async () => {
    return { available: getPremiumFeatures().ai };
  }),

  // ── Scraper Fix ──

  scraperFix: publicProcedure
    .input(
      z.object({
        documentId: z.string().optional(),
        analysisResult: z.any(),
        rawContent: z.string().optional(),
        provider: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedWalletContext, ownerAddress: fallbackOwnerAddress, userId } = await getAiAccountContext(ctx);
      const ownerAddress = input.documentId
        ? await resolveOwnedDocumentOwnerAddress(ctx.db, input.documentId, ownedWalletContext.ownedAddresses)
        : fallbackOwnerAddress;
      const ai = await requireAiFeature(ctx.db, ownerAddress, "ai_scraper_fix");
      const resolved = await resolveProvider(ai, ownerAddress, input.provider);
      const rCtx = toRequestContext(ownerAddress, resolved, input.model, input.documentId, userId);

      await ai.enforceRateLimit(ownerAddress, "scraper_fix");

      const result = await ai.fixScraperOutput(rCtx, input.analysisResult, input.rawContent);

      await ai.trackUsage(rCtx, "scraper_fix", result.response, { changesCount: result.changes.length });

      return {
        corrected: result.corrected,
        changes: result.changes,
        usage: result.response.usage,
        latencyMs: result.response.latencyMs,
      };
    }),

  // ── Editor Assistant ──

  editorChat: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        conversationId: z.string().optional(),
        documentTitle: z.string(),
        tokens: z.array(z.any()),
        signerCount: z.number(),
        signerLabels: z.array(z.string()),
        selectedRange: z.object({ start: z.number(), end: z.number() }).optional(),
        message: z.string().min(1).max(5000),
        provider: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedWalletContext, userId } = await getAiAccountContext(ctx);
      const ownerAddress = await resolveOwnedDocumentOwnerAddress(
        ctx.db,
        input.documentId,
        ownedWalletContext.ownedAddresses,
      );
      const ai = await requireAiFeature(ctx.db, ownerAddress, "ai_editor_assistant");
      const resolved = await resolveProvider(ai, ownerAddress, input.provider);
      const rCtx = toRequestContext(ownerAddress, resolved, input.model, input.documentId, userId);

      await ai.enforceRateLimit(ownerAddress, "editor_assistant");

      const { messages: history, id: existingId } = await ai.loadConversation(input.conversationId, ownerAddress);

      const result = await ai.chat({
        ...rCtx,
        documentTitle: input.documentTitle,
        tokens: input.tokens,
        signerCount: input.signerCount,
        signerLabels: input.signerLabels,
        selectedRange: input.selectedRange,
        userMessage: input.message,
        conversationHistory: history,
      });

      await ai.trackUsage(rCtx, "editor_assistant", result.raw, {
        hasEdits: !!result.response.editOperations?.length,
      });

      // Persist conversation
      const now = new Date().toISOString();
      const updatedMessages: AiChatMessage[] = [
        ...history,
        { role: "user", content: input.message, timestamp: now, metadata: { selectedRange: input.selectedRange } },
        {
          role: "assistant",
          content: result.response.text,
          timestamp: now,
          metadata: { editOperations: result.response.editOperations },
        },
      ];

      const conversationId = await ai.saveConversation({
        conversationId: existingId,
        ownerAddress,
        documentId: input.documentId,
        feature: "editor_assistant",
        messages: updatedMessages,
        title: input.message,
      });

      return {
        conversationId,
        text: result.response.text,
        editOperations: result.response.editOperations,
        usage: result.raw.usage,
        latencyMs: result.raw.latencyMs,
      };
    }),

  // ── Signer Q&A ──

  signerAsk: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        claimToken: z.string(),
        conversationId: z.string().optional(),
        question: z.string().min(1).max(3000),
        provider: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { signer, doc, allSigners } = await loadSignerContext(ctx.db, input.documentId, input.claimToken);
      const ownerAddress = doc.createdBy;
      const ai = await requireAiFeature(ctx.db, ownerAddress, "ai_signer_qa");
      const resolved = await resolveProvider(ai, ownerAddress, input.provider);
      const rCtx = toRequestContext(ownerAddress, resolved, input.model, input.documentId);

      await ai.enforceRateLimit(ownerAddress, "signer_qa");

      const { messages: history, id: existingId } = await ai.loadConversation(input.conversationId, ownerAddress);

      const result = await ai.answerQuestion({
        ...rCtx,
        documentTitle: doc.title,
        documentContent: doc.content,
        signerLabel: signer.label,
        signerRole: signer.role,
        signerFields: mapSignerFields(signer),
        allSignerLabels: allSigners.map((s: SignerRow) => s.label),
        question: input.question,
        conversationHistory: history,
      });

      await ai.trackUsage(rCtx, "signer_qa", result.raw);

      const now = new Date().toISOString();
      const updatedMessages: AiChatMessage[] = [
        ...history,
        { role: "user", content: input.question, timestamp: now },
        { role: "assistant", content: result.answer, timestamp: now },
      ];

      const conversationId = await ai.saveConversation({
        conversationId: existingId,
        ownerAddress,
        documentId: input.documentId,
        feature: "signer_qa",
        messages: updatedMessages,
        title: input.question,
      });

      return { conversationId, answer: result.answer };
    }),

  signerSummary: publicProcedure
    .input(z.object({ documentId: z.string(), claimToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { signer, doc, allSigners } = await loadSignerContext(ctx.db, input.documentId, input.claimToken);
      const ownerAddress = doc.createdBy;
      const ai = await requireAiFeature(ctx.db, ownerAddress, "ai_signer_qa");
      const resolved = await resolveProvider(ai, ownerAddress);
      const rCtx = toRequestContext(ownerAddress, resolved, undefined, input.documentId);

      await ai.enforceRateLimit(ownerAddress, "signer_qa");

      const result = await ai.generateSummary({
        ...rCtx,
        documentTitle: doc.title,
        documentContent: doc.content,
        signerLabel: signer.label,
        signerRole: signer.role,
        signerFields: mapSignerFields(signer),
        allSignerLabels: allSigners.map((s: SignerRow) => s.label),
        conversationHistory: [],
      });

      await ai.trackUsage(rCtx, "signer_qa", result.raw);

      return { summary: result.summary };
    }),

  automationReview: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        signerId: z.string(),
        provider: z.string().optional(),
        model: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedWalletContext, userId } = await getAiAccountContext(ctx);
      const { doc, signer, evidence, ownerAddress } = await loadCreatorSignerEvidence(
        ctx.db,
        input.documentId,
        input.signerId,
        ownedWalletContext.ownedAddresses,
      );
      const ai = await requireAiFeature(ctx.db, ownerAddress, "ai_automation_review");
      const resolved = await resolveProvider(ai, ownerAddress, input.provider);
      const rCtx = toRequestContext(ownerAddress, resolved, input.model, input.documentId, userId);

      await ai.enforceRateLimit(ownerAddress, "general");

      const result = await ai.reviewAutomationEvidence({
        ...rCtx,
        documentTitle: doc.title,
        signerLabel: signer.label,
        evidence,
        policy: (evidence.policyOutcome as { policy?: Record<string, unknown> } | undefined)?.policy,
      });

      await ai.trackUsage(rCtx, "general", result.raw, {
        kind: "automation_review",
        signerId: signer.id,
        verdict: result.review.verdict,
        actualProvider: result.raw.execution.actualProvider,
        actualModel: result.raw.execution.actualModel,
        executionTool: result.raw.execution.tool,
      });

      return {
        review: result.review,
        storedReview: evidence.automationReview ?? null,
        usage: result.raw.usage,
        latencyMs: result.raw.latencyMs,
        requested: {
          provider: input.provider ?? resolved.key.provider,
          model: input.model ?? resolved.model,
        },
        execution: result.raw.execution,
      };
    }),

  automationReviewMatrix: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        signerId: z.string(),
        models: z
          .array(
            z.object({
              provider: z.string(),
              model: z.string(),
            }),
          )
          .min(1)
          .max(4),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownedWalletContext } = await getAiAccountContext(ctx);
      const { doc, signer, evidence, ownerAddress } = await loadCreatorSignerEvidence(
        ctx.db,
        input.documentId,
        input.signerId,
        ownedWalletContext.ownedAddresses,
      );
      const ai = await requireAiFeature(ctx.db, ownerAddress, "ai_automation_review");
      const policy = (evidence.policyOutcome as { policy?: Record<string, unknown> } | undefined)?.policy;

      const results = [];
      for (const target of input.models) {
        const result = await runAutomationReviewTarget({
          ai,
          ownerAddress,
          documentId: input.documentId,
          signerId: signer.id,
          documentTitle: doc.title,
          signerLabel: signer.label,
          evidence,
          policy,
          target,
        });
        results.push(result);
      }

      return {
        storedReview: evidence.automationReview ?? null,
        results,
      };
    }),

  // ── Provider Config ──

  listProviders: publicProcedure.query(async ({ ctx }) => {
    const { ownedWalletContext, ownerAddress } = await getAiAccountContext(ctx);
    const ai = (await loadPremiumAi()) as PremiumAiModule | null;
    if (!ai) return { available: false, providers: [], registry: [], platform: [] } as const;

    await ai.syncPlatformProviderConfigs(ownerAddress);

    const configs = await ctx.db
      .select()
      .from(aiProviderConfigs)
      .where(
        ownedWalletContext.ownedAddresses.length === 1
          ? eq(aiProviderConfigs.ownerAddress, ownedWalletContext.ownedAddresses[0]!)
          : inArray(aiProviderConfigs.ownerAddress, ownedWalletContext.ownedAddresses),
      );

    // Platform-managed providers (admin sets env vars — users just toggle on)
    const platform = ai.getPlatformProviders().filter((p) => p.available);

    return {
      available: true,
      // User's BYOK configs
      providers: configs.map((c) => ({
        id: c.id,
        provider: c.provider,
        label: c.label,
        keySource: c.keySource,
        isDefault: c.isDefault,
        hasKey:
          c.keySource === "platform"
            ? ai.isPlatformProviderAvailable(c.provider as AiProviderName)
            : !!c.config?.apiKey,
        defaultModel: c.config?.defaultModel,
        enabled: c.config?.enabled !== false,
      })),
      // Platform-provided AI (no key needed — included with premium)
      platform,
      // Full registry of all supported providers
      registry: ai.getProviders().map((p) => ({
        name: p.name,
        label: p.label,
        isAggregator: p.isAggregator,
        models: p.models.map((m) => ({
          id: m.id,
          name: m.name,
          contextWindow: m.contextWindow,
          inputPricePer1k: m.inputPricePer1k,
          outputPricePer1k: m.outputPricePer1k,
        })),
      })),
    };
  }),

  upsertProvider: publicProcedure
    .input(
      z.object({
        id: z.string().optional(),
        provider: z.string(),
        label: z.string(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        defaultModel: z.string().optional(),
        temperature: z.number().optional(),
        maxTokens: z.number().optional(),
        isDefault: z.boolean().optional(),
        organizationId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAi();
      const { ownedWalletContext, ownerAddress } = await getAiAccountContext(ctx);

      if (input.id) {
        const [existing] = await ctx.db
          .select()
          .from(aiProviderConfigs)
          .where(
            ownedWalletContext.ownedAddresses.length === 1
              ? and(
                  eq(aiProviderConfigs.id, input.id),
                  eq(aiProviderConfigs.ownerAddress, ownedWalletContext.ownedAddresses[0]!),
                )
              : and(
                  eq(aiProviderConfigs.id, input.id),
                  inArray(aiProviderConfigs.ownerAddress, ownedWalletContext.ownedAddresses),
                ),
          )
          .limit(1);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Provider config not found" });
        }

        const config = {
          ...existing.config,
          apiKey: input.apiKey ?? existing.config?.apiKey,
          baseUrl: input.baseUrl ?? existing.config?.baseUrl,
          defaultModel: input.defaultModel ?? existing.config?.defaultModel,
          temperature: input.temperature ?? existing.config?.temperature,
          maxTokens: input.maxTokens ?? existing.config?.maxTokens,
          enabled: true,
          organizationId: input.organizationId ?? existing.config?.organizationId,
        };

        await ctx.db
          .update(aiProviderConfigs)
          .set({ label: input.label, config, isDefault: input.isDefault ?? false, updatedAt: new Date() })
          .where(eq(aiProviderConfigs.id, input.id));
        return { id: input.id };
      }

      const config = {
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        defaultModel: input.defaultModel,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        enabled: true,
        organizationId: input.organizationId,
      };

      const [created] = await ctx.db
        .insert(aiProviderConfigs)
        .values({
          ownerAddress,
          provider: input.provider as AiProviderName,
          label: input.label,
          keySource: "byok",
          config,
          isDefault: input.isDefault ?? false,
        })
        .returning();
      return { id: created!.id };
    }),

  deleteProvider: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const { ownedWalletContext } = await getAiAccountContext(ctx);
    await ctx.db
      .delete(aiProviderConfigs)
      .where(
        ownedWalletContext.ownedAddresses.length === 1
          ? and(
              eq(aiProviderConfigs.id, input.id),
              eq(aiProviderConfigs.ownerAddress, ownedWalletContext.ownedAddresses[0]!),
            )
          : and(
              eq(aiProviderConfigs.id, input.id),
              inArray(aiProviderConfigs.ownerAddress, ownedWalletContext.ownedAddresses),
            ),
      );
  }),

  testProvider: publicProcedure
    .input(z.object({ provider: z.string(), model: z.string(), apiKey: z.string(), baseUrl: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await getAiAccountContext(ctx);
      const ai = await requireAi();
      try {
        const response = await ai.complete(
          {
            provider: input.provider as AiProviderName,
            model: input.model,
            messages: [{ role: "user", content: "Say 'Hello from Proofmark!' — nothing else." }],
            maxTokens: 20,
            temperature: 0,
          },
          { apiKey: input.apiKey, source: "byok", provider: input.provider as AiProviderName, baseUrl: input.baseUrl },
        );
        return { success: true, response: response.content, latencyMs: response.latencyMs };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }),

  // ── Usage & Rate Limits ──

  usageSummary: publicProcedure
    .input(z.object({ from: z.date().optional(), to: z.date().optional(), userId: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { ownerAddress } = await getAiAccountContext(ctx);
      const ai = (await loadPremiumAi()) as PremiumAiModule | null;
      if (!ai) return null;
      return ai.getUsageSummary(
        ownerAddress,
        input.from ?? new Date(Date.now() - 30 * 86400000),
        input.to ?? new Date(),
        input.userId,
      );
    }),

  /** Set account-wide default limits (applies to all users who don't have per-user overrides). */
  setDefaultLimits: publicProcedure
    .input(
      z.object({
        requestsPerMonth: z.number().int().min(0).optional(),
        tokensPerMonth: z.number().int().min(0).optional(),
        maxRequestsPerHour: z.number().int().min(0).optional(),
        maxRequestsPerWeek: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownerAddress } = await getAiAccountContext(ctx);
      const ai = await requireAi();
      // Account-wide defaults = no userId, no feature
      await ai.setAdminLimits({
        ownerAddress,
        userId: "__default__",
        requestsPerMonth: input.requestsPerMonth,
        tokensPerMonth: input.tokensPerMonth,
        requestsPerHour: input.maxRequestsPerHour,
      });
      return { ok: true };
    }),

  /** Admin sets rate limits for a specific user. Per-token or per-request at any granularity. */
  setUserLimits: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        feature: zAiFeature.optional(),
        requestsPerHour: z.number().int().min(0).optional(),
        requestsPerDay: z.number().int().min(0).optional(),
        requestsPerMonth: z.number().int().min(0).optional(),
        tokensPerHour: z.number().int().min(0).optional(),
        tokensPerDay: z.number().int().min(0).optional(),
        tokensPerMonth: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { ownerAddress } = await getAiAccountContext(ctx);
      const ai = await requireAi();
      await ai.setAdminLimits({ ownerAddress, ...input, feature: (input.feature ?? "general") as AiFeature });
      return { ok: true };
    }),

  /** Get rate limit status — own account defaults, or a specific user's limits. */
  getUserLimitStatus: publicProcedure
    .input(z.object({ userId: z.string().optional(), feature: zAiFeature.optional() }))
    .query(async ({ ctx, input }) => {
      const { ownerAddress } = await getAiAccountContext(ctx);
      const ai = (await loadPremiumAi()) as PremiumAiModule | null;
      if (!ai) return null;
      return ai.getLimitStatus(ownerAddress, (input.feature ?? "general") as AiFeature, input.userId);
    }),

  // ── Conversations ──

  listConversations: publicProcedure
    .input(
      z.object({ documentId: z.string(), feature: z.enum(["editor_assistant", "signer_qa", "general"]).optional() }),
    )
    .query(async ({ ctx, input }) => {
      const { ownedWalletContext } = await getAiAccountContext(ctx);
      const conditions = [
        ownedWalletContext.ownedAddresses.length === 1
          ? eq(aiConversations.ownerAddress, ownedWalletContext.ownedAddresses[0]!)
          : inArray(aiConversations.ownerAddress, ownedWalletContext.ownedAddresses),
        eq(aiConversations.documentId, input.documentId),
      ];
      if (input.feature) conditions.push(eq(aiConversations.feature, input.feature));

      return ctx.db
        .select({
          id: aiConversations.id,
          title: aiConversations.title,
          feature: aiConversations.feature,
          messageCount: aiConversations.messages,
          createdAt: aiConversations.createdAt,
          updatedAt: aiConversations.updatedAt,
        })
        .from(aiConversations)
        .where(and(...conditions))
        .orderBy(desc(aiConversations.updatedAt));
    }),

  getConversation: publicProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { ownedWalletContext } = await getAiAccountContext(ctx);
    const [conv] = await ctx.db
      .select()
      .from(aiConversations)
      .where(
        ownedWalletContext.ownedAddresses.length === 1
          ? and(
              eq(aiConversations.id, input.id),
              eq(aiConversations.ownerAddress, ownedWalletContext.ownedAddresses[0]!),
            )
          : and(
              eq(aiConversations.id, input.id),
              inArray(aiConversations.ownerAddress, ownedWalletContext.ownedAddresses),
            ),
      )
      .limit(1);
    if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
    return conv;
  }),
});
