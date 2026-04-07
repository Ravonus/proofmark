/**
 * Integration tests for the premium AI module.
 *
 * Tests the module's exports, type conformance, provider registry,
 * key resolution logic, and feature function structure — all without
 * hitting real APIs (mocked fetch).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock DB to avoid requiring real Postgres
vi.mock("../../../src/server/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "test-id" }]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

describe("premium AI module", () => {
  describe("module exports", () => {
    it("exports all required PremiumAiModule methods", async () => {
      const mod = await import("~/premium/ai/index");

      // Key resolution
      expect(typeof mod.resolveKey).toBe("function");
      expect(typeof mod.resolveKeyWithFallback).toBe("function");

      // Provider info
      expect(typeof mod.getProviders).toBe("function");
      expect(typeof mod.getPlatformProviders).toBe("function");
      expect(typeof mod.isPlatformProviderAvailable).toBe("function");

      // Completion
      expect(typeof mod.complete).toBe("function");

      // Rate limiting & usage
      expect(typeof mod.enforceRateLimit).toBe("function");
      expect(typeof mod.trackUsage).toBe("function");
      expect(typeof mod.getUsageSummary).toBe("function");
      expect(typeof mod.setAdminLimits).toBe("function");
      expect(typeof mod.getLimitStatus).toBe("function");

      // Conversation persistence
      expect(typeof mod.loadConversation).toBe("function");
      expect(typeof mod.saveConversation).toBe("function");

      // AI features
      expect(typeof mod.fixScraperOutput).toBe("function");
      expect(typeof mod.chat).toBe("function");
      expect(typeof mod.answerQuestion).toBe("function");
      expect(typeof mod.generateSummary).toBe("function");
      expect(typeof mod.reviewAutomationEvidence).toBe("function");

      // Forensic queue
      expect(typeof mod.enqueueForensicReview).toBe("function");
      expect(typeof mod.getJobStatus).toBe("function");
      expect(typeof mod.getJobsForSigner).toBe("function");
    });
  });

  describe("provider registry", () => {
    it("returns all 12 supported providers", async () => {
      const { getProviders } = await import("~/premium/ai/provider-client");
      const providers = getProviders();

      const names = providers.map((p) => p.name);
      expect(names).toContain("anthropic");
      expect(names).toContain("openai");
      expect(names).toContain("google");
      expect(names).toContain("mistral");
      expect(names).toContain("groq");
      expect(names).toContain("together");
      expect(names).toContain("perplexity");
      expect(names).toContain("xai");
      expect(names).toContain("deepseek");
      expect(names).toContain("openrouter");
      expect(names).toContain("cohere");
      expect(names).toContain("litellm");
      expect(providers.length).toBe(12);
    });

    it("each provider has at least a name, label, and models array", async () => {
      const { getProviders } = await import("~/premium/ai/provider-client");
      for (const p of getProviders()) {
        expect(p.name).toBeTruthy();
        expect(p.label).toBeTruthy();
        expect(Array.isArray(p.models)).toBe(true);
        expect(typeof p.isAggregator).toBe("boolean");
      }
    });

    it("model entries have pricing and context window", async () => {
      const { getProviders } = await import("~/premium/ai/provider-client");
      const anthropic = getProviders().find((p) => p.name === "anthropic")!;
      expect(anthropic.models.length).toBeGreaterThan(0);
      for (const m of anthropic.models) {
        expect(m.id).toBeTruthy();
        expect(m.contextWindow).toBeGreaterThan(0);
        expect(typeof m.inputPricePer1k).toBe("number");
        expect(typeof m.outputPricePer1k).toBe("number");
      }
    });
  });

  describe("provider-client complete()", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("sends correct headers for Anthropic", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "Hello!" }],
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: "end_turn",
        }),
      });

      const { complete } = await import("~/premium/ai/provider-client");
      const response = await complete(
        { provider: "anthropic", model: "claude-sonnet-4-20250514", messages: [{ role: "user", content: "Hi" }] },
        { apiKey: "sk-test", source: "byok", provider: "anthropic" },
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0]!;
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(opts.headers["x-api-key"]).toBe("sk-test");
      expect(opts.headers["anthropic-version"]).toBe("2023-06-01");
      expect(response.content).toBe("Hello!");
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(5);
      expect(response.execution.source).toBe("byok");
    });

    it("sends correct headers for OpenAI", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Hi there" }, finish_reason: "stop" }],
          model: "gpt-4o",
          usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
        }),
      });

      const { complete } = await import("~/premium/ai/provider-client");
      const response = await complete(
        { provider: "openai", model: "gpt-4o", messages: [{ role: "user", content: "Hi" }] },
        { apiKey: "sk-openai-test", source: "byok", provider: "openai", organizationId: "org-123" },
      );

      const [url, opts] = fetchSpy.mock.calls[0]!;
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(opts.headers["Authorization"]).toBe("Bearer sk-openai-test");
      expect(opts.headers["OpenAI-Organization"]).toBe("org-123");
      expect(response.content).toBe("Hi there");
      expect(response.usage.totalTokens).toBe(11);
    });

    it("sends correct request for Google AI", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "From Gemini" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
        }),
      });

      const { complete } = await import("~/premium/ai/provider-client");
      const response = await complete(
        { provider: "google", model: "gemini-2.5-flash", messages: [{ role: "user", content: "Hi" }] },
        { apiKey: "google-key", source: "platform", provider: "google" },
      );

      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toContain("generativelanguage.googleapis.com");
      expect(url).toContain("gemini-2.5-flash");
      expect(url).toContain("key=google-key");
      expect(response.content).toBe("From Gemini");
      expect(response.usage.totalTokens).toBe(8);
    });

    it("throws on non-ok response", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: async () => "Rate limited",
      });

      const { complete } = await import("~/premium/ai/provider-client");
      await expect(
        complete(
          { provider: "openai", model: "gpt-4o", messages: [{ role: "user", content: "Hi" }] },
          { apiKey: "test", source: "byok", provider: "openai" },
        ),
      ).rejects.toThrow("openai API error (429)");
    });

    it("respects custom baseUrl from key", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "proxy response" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      });

      const { complete } = await import("~/premium/ai/provider-client");
      await complete(
        { provider: "openai", model: "gpt-4o", messages: [{ role: "user", content: "Hi" }] },
        { apiKey: "test", source: "byok", provider: "openai", baseUrl: "https://my-proxy.example.com" },
      );

      const [url] = fetchSpy.mock.calls[0]!;
      expect(url).toBe("https://my-proxy.example.com/v1/chat/completions");
    });
  });

  describe("platform providers", () => {
    it("detects env-var-based platform keys", async () => {
      process.env.PROOFMARK_ANTHROPIC_API_KEY = "test-key";
      const { getPlatformProviders, isPlatformProviderAvailable } = await import("~/premium/ai/key-resolver");

      const providers = getPlatformProviders();
      const anthropic = providers.find((p) => p.provider === "anthropic");
      expect(anthropic?.available).toBe(true);
      expect(isPlatformProviderAvailable("anthropic")).toBe(true);
      expect(isPlatformProviderAvailable("openai")).toBe(false);

      delete process.env.PROOFMARK_ANTHROPIC_API_KEY;
    });
  });

  describe("conversation persistence", () => {
    it("returns empty for no conversationId", async () => {
      const { loadConversation } = await import("~/premium/ai/conversation-persistence");
      const result = await loadConversation(undefined, "0xabc");
      expect(result.messages).toEqual([]);
      expect(result.id).toBeUndefined();
    });
  });

  describe("forensic queue", () => {
    it("enqueues and retrieves jobs", async () => {
      const { enqueueForensicReview, getJobStatus, getJobsForSigner } = await import(
        "~/premium/ai/forensic-queue"
      );

      const jobId = enqueueForensicReview({
        ownerAddress: "0xabc",
        documentId: "doc-1",
        signerId: "signer-1",
        documentTitle: "Test NDA",
        signerLabel: "Alice",
        evidence: { behavioralSignals: { mouseMovements: 42 } },
      });

      expect(jobId).toBeTruthy();
      expect(jobId.startsWith("fq_")).toBe(true);

      const job = getJobStatus(jobId);
      expect(job).toBeTruthy();
      expect(job!.documentId).toBe("doc-1");

      const jobs = getJobsForSigner("doc-1", "signer-1");
      expect(jobs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("automation review prompt", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("builds a structured review and parses JSON response", async () => {
      const reviewResult = {
        verdict: "human",
        confidence: 85,
        reasoning: "Natural mouse movements and signature timing variance suggest human signer.",
        signals: [
          { signal: "signature_timing", weight: "strong", direction: "human", detail: "High velocity variance" },
        ],
        recommendation: "Accept signing",
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: JSON.stringify(reviewResult) }],
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 500, output_tokens: 100 },
          stop_reason: "end_turn",
        }),
      });

      const { reviewAutomationEvidence } = await import("~/premium/ai/automation-review");
      const result = await reviewAutomationEvidence({
        ownerAddress: "0xabc",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        key: { apiKey: "test", source: "byok", provider: "anthropic" },
        documentTitle: "Test NDA",
        signerLabel: "Alice",
        evidence: {
          behavioralSignals: { mouseMovements: 42, keystrokes: 10 },
          deviceFingerprint: { userAgent: "Chrome/120", platform: "MacIntel" },
        },
      });

      expect(result.review.verdict).toBe("human");
      expect(result.review.confidence).toBe(85);
      expect(result.review.signals.length).toBeGreaterThan(0);
      expect(result.raw.usage).toBeTruthy();
    });

    it("handles unparseable AI response gracefully", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "I cannot determine this in JSON format." }],
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 500, output_tokens: 50 },
          stop_reason: "end_turn",
        }),
      });

      const { reviewAutomationEvidence } = await import("~/premium/ai/automation-review");
      const result = await reviewAutomationEvidence({
        ownerAddress: "0xabc",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        key: { apiKey: "test", source: "byok", provider: "anthropic" },
        documentTitle: "Test",
        signerLabel: "Bob",
        evidence: {},
      });

      // Should fallback to inconclusive, not throw
      expect(result.review.verdict).toBe("inconclusive");
      expect(result.review.confidence).toBe(0);
    });
  });

  describe("features", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("chat() parses edit operations from response", async () => {
      const editOps = [{ op: "update_token", index: 3, updates: { text: "improved" } }];
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: `Here's my suggestion:\n<edits>${JSON.stringify(editOps)}</edits>` }],
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 200, output_tokens: 50 },
          stop_reason: "end_turn",
        }),
      });

      const { chat } = await import("~/premium/ai/features");
      const result = await chat({
        ownerAddress: "0xabc",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        key: { apiKey: "test", source: "byok", provider: "anthropic" },
        documentTitle: "NDA",
        tokens: [],
        signerCount: 2,
        signerLabels: ["Alice", "Bob"],
        userMessage: "Make this more formal",
        conversationHistory: [],
      });

      expect(result.response.text).toBe("Here's my suggestion:");
      expect(result.response.editOperations).toEqual(editOps);
    });

    it("answerQuestion() returns answer text", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "This NDA prevents you from sharing confidential information." }],
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 300, output_tokens: 20 },
          stop_reason: "end_turn",
        }),
      });

      const { answerQuestion } = await import("~/premium/ai/features");
      const result = await answerQuestion({
        ownerAddress: "0xabc",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        key: { apiKey: "test", source: "byok", provider: "anthropic" },
        documentTitle: "NDA",
        documentContent: "This Non-Disclosure Agreement...",
        signerLabel: "Bob",
        signerFields: [{ type: "signature", label: "Signature", required: true }],
        allSignerLabels: ["Alice", "Bob"],
        question: "What does this NDA prevent me from doing?",
        conversationHistory: [],
      });

      expect(result.answer).toContain("confidential information");
      expect(result.raw.usage).toBeTruthy();
    });

    it("generateSummary() returns summary text", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "This is a standard NDA between two parties..." }],
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 400, output_tokens: 100 },
          stop_reason: "end_turn",
        }),
      });

      const { generateSummary } = await import("~/premium/ai/features");
      const result = await generateSummary({
        ownerAddress: "0xabc",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        key: { apiKey: "test", source: "byok", provider: "anthropic" },
        documentTitle: "NDA",
        documentContent: "This Non-Disclosure Agreement...",
        signerLabel: "Bob",
        signerFields: [],
        allSignerLabels: ["Alice", "Bob"],
        conversationHistory: [],
      });

      expect(result.summary).toContain("NDA");
      expect(result.raw.usage).toBeTruthy();
    });

    it("fixScraperOutput() returns corrected analysis", async () => {
      const corrected = { documentType: "nda", fields: [{ type: "signature" }] };
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            {
              type: "text",
              text: JSON.stringify({
                corrected,
                changes: [{ field: "documentType", before: "unknown", after: "nda", reason: "Content indicates NDA" }],
              }),
            },
          ],
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 500, output_tokens: 100 },
          stop_reason: "end_turn",
        }),
      });

      const { fixScraperOutput } = await import("~/premium/ai/features");
      const result = await fixScraperOutput(
        {
          ownerAddress: "0xabc",
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          key: { apiKey: "test", source: "byok", provider: "anthropic" },
        },
        { documentType: "unknown", fields: [] },
        "This Non-Disclosure Agreement...",
      );

      expect(result.corrected).toEqual(corrected);
      expect(result.changes.length).toBe(1);
      expect(result.changes[0]!.field).toBe("documentType");
    });
  });
});
