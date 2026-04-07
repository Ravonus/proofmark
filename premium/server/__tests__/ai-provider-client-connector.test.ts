import { describe, expect, it, vi } from "vitest";

const completeViaConnector = vi.fn(async () => ({
  content: '{"verdict":"human"}',
  model: "local-codex",
  provider: "openai",
  usage: {
    inputTokens: 120,
    outputTokens: 40,
    totalTokens: 160,
  },
  finishReason: "stop" as const,
  latencyMs: 42,
  execution: {
    source: "connector" as const,
    requestedProvider: "openai" as const,
    requestedModel: "gpt-4o",
    actualProvider: "openai" as const,
    actualModel: "local-codex",
    tool: "codex",
    connectorSessionId: "session_1",
  },
}));

vi.mock("../../ai/connector-client", () => ({
  completeViaConnector,
}));

// Response shape returned by the provider-client complete() function
type CompletionResponse = {
  content: string;
  model: string;
  provider: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: string;
  latencyMs: number;
  execution: {
    source: string;
    requestedProvider: string;
    requestedModel: string;
    actualProvider: string;
    actualModel: string;
    tool: string;
    connectorSessionId: string;
  };
};

type CompleteFn = (request: unknown, key: unknown) => Promise<CompletionResponse>;

describe("AI provider client connector fallback", () => {
  it("routes connector-sourced completions through the local connector bridge", async () => {
    const mod = (await import("../../ai/provider-client")) as { complete: CompleteFn };
    const { complete } = mod;

    const request = {
      provider: "openai" as const,
      model: "gpt-4o",
      messages: [{ role: "user" as const, content: "Say hi" }],
      responseFormat: "json" as const,
    };
    const key = {
      apiKey: "connector:test",
      source: "connector" as const,
      provider: "openai" as const,
      ownerAddress: "0xabc",
      connectorSessionId: "session_1",
      connectorTool: "codex",
    };

    const response = await complete(request, key);

    expect(completeViaConnector).toHaveBeenCalledTimes(1);
    expect(completeViaConnector).toHaveBeenCalledWith(request, key);
    expect(response.model).toBe("local-codex");
    expect(response.usage.totalTokens).toBe(160);
    expect(response.execution.tool).toBe("codex");
    expect(response.execution.actualModel).toBe("local-codex");
  });
});
