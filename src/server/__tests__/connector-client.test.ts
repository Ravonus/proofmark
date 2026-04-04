import { describe, expect, it } from "vitest";
import { preferredConnectorToolForProvider, selectConnectorTool } from "../../../premium/ai/connector-client";

describe("connector client helpers", () => {
  it("prefers Claude for Anthropic and Codex for OpenAI", () => {
    expect(preferredConnectorToolForProvider("anthropic")).toBe("claude-code");
    expect(preferredConnectorToolForProvider("openai")).toBe("codex");
    expect(preferredConnectorToolForProvider("google")).toBe("auto");
  });

  it("selects the preferred installed tool when available", () => {
    expect(selectConnectorTool(["codex", "claude-code"], "claude-code")).toBe("claude-code");
    expect(selectConnectorTool(["claude", "codex"], "codex")).toBe("codex");
  });

  it("falls back to the first supported local tool when the preferred one is absent", () => {
    expect(selectConnectorTool(["claude-code"], "codex")).toBe("claude-code");
    expect(selectConnectorTool(["openclaw"], "claude-code")).toBe("openclaw");
    expect(selectConnectorTool([], "codex")).toBeNull();
  });
});
