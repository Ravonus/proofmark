import { describe, expect, it } from "vitest";
import { preferredConnectorToolForProvider, selectConnectorTool } from "../../ai/connector-client";

// Cast imported functions to known signatures (premium module may not exist in OSS builds)
const preferredFn = preferredConnectorToolForProvider as (provider: string) => string;
const selectFn = selectConnectorTool as (installed: string[], preferred: string) => string | null;

describe("connector client helpers", () => {
  it("prefers Claude for Anthropic and Codex for OpenAI", () => {
    expect(preferredFn("anthropic")).toBe("claude-code");
    expect(preferredFn("openai")).toBe("codex");
    expect(preferredFn("google")).toBe("auto");
  });

  it("selects the preferred installed tool when available", () => {
    expect(selectFn(["codex", "claude-code"], "claude-code")).toBe("claude-code");
    expect(selectFn(["claude", "codex"], "codex")).toBe("codex");
  });

  it("falls back to the first supported local tool when the preferred one is absent", () => {
    expect(selectFn(["claude-code"], "codex")).toBe("claude-code");
    expect(selectFn(["openclaw"], "claude-code")).toBe("openclaw");
    expect(selectFn([], "codex")).toBeNull();
  });
});
