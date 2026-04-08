import { afterEach, describe, expect, it } from "vitest";
import {
  configureForensicReplayWasmLoader,
  createTypeScriptReplayCore,
  loadForensicReplayCore,
  resetForensicReplayCore,
  resolveForensicReplayCore,
} from "../replay-core";

describe("forensic replay core", () => {
  afterEach(() => {
    resetForensicReplayCore();
  });

  it("falls back to the TS core when the wasm loader fails", async () => {
    const core = await loadForensicReplayCore(async () => {
      throw new Error("boom");
    });

    expect(core.kind).toBe("ts");
    expect(
      await core.encodeSignature([
        [
          { x: 10, y: 20, t: 0, force: 0.4 },
          { x: 18, y: 26, t: 16, force: 0.6 },
        ],
      ]),
    ).toMatch(/^pm-sig-v1:/);
  });

  it("uses the configured loader when wasm initializes successfully", async () => {
    const wasmLikeCore = {
      ...createTypeScriptReplayCore(),
      kind: "wasm" as const,
    };
    configureForensicReplayWasmLoader(async () => wasmLikeCore);

    const core = await resolveForensicReplayCore();

    expect(core.kind).toBe("wasm");
  });
});
