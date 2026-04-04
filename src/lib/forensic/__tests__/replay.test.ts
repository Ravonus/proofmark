import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DeterministicReplayRecorder,
  decodeForensicReplay,
  decodeTimedSignature,
  encodeTimedSignature,
} from "../replay";
import type { TimedSignatureStroke } from "../types";

describe("forensic replay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("encodes and decodes timed signatures deterministically", () => {
    const strokes: TimedSignatureStroke[] = [
      [
        { x: 12, y: 18, t: 0, force: 0.4 },
        { x: 19, y: 22, t: 16, force: 0.6 },
        { x: 24, y: 28, t: 32, force: 0.5 },
      ],
    ];

    const encodedA = encodeTimedSignature(strokes);
    const encodedB = encodeTimedSignature(strokes);
    const decoded = decodeTimedSignature(encodedA);

    expect(encodedA).toBe(encodedB);
    expect(decoded[0]?.map(({ x, y, t }) => ({ x, y, t }))).toEqual(
      strokes[0]?.map(({ x, y, t }) => ({ x, y, t })),
    );
    expect(decoded[0]?.[0]?.force).toBeCloseTo(0.4, 2);
    expect(decoded[0]?.[1]?.force).toBeCloseTo(0.6, 2);
    expect(decoded[0]?.[2]?.force).toBeCloseTo(0.5, 2);
  });

  it("produces a deterministic replay tape for the same event stream", async () => {
    const buildTape = async () => {
      const recorder = new DeterministicReplayRecorder();
      recorder.recordNavigation("next", "field:name", 1);
      vi.advanceTimersByTime(24);
      recorder.recordFieldValue("name", "Alice");
      vi.advanceTimersByTime(220);
      recorder.recordClipboard("paste", "field:name", "Alice");
      vi.advanceTimersByTime(24);
      const strokeId = recorder.recordSignatureStrokeStart("signature-pad", 10, 20, 0.5);
      vi.advanceTimersByTime(16);
      recorder.recordSignaturePoint(strokeId, 18, 26, 0.6);
      vi.advanceTimersByTime(16);
      recorder.recordSignatureStrokeEnd(strokeId);
      recorder.recordSignatureCommit("signature-pad", [
        [
          { x: 10, y: 20, t: 0, force: 0.5 },
          { x: 18, y: 26, t: 16, force: 0.6 },
        ],
      ]);
      return recorder.finalize();
    };

    const tapeA = await buildTape();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const tapeB = await buildTape();

    expect(tapeA.tapeBase64).toBe(tapeB.tapeBase64);
    expect(tapeA.tapeHash).toBe(tapeB.tapeHash);
    expect(tapeA.metrics.eventCount).toBe(7);

    const decoded = decodeForensicReplay(tapeA);
    expect(decoded.map((event) => event.type)).toEqual([
      "navigation",
      "fieldCommit",
      "clipboard",
      "signatureStart",
      "signaturePoint",
      "signatureEnd",
      "signatureCommit",
    ]);
    expect(decoded.find((event) => event.type === "clipboard")).toMatchObject({
      type: "clipboard",
      action: "paste",
    });
  });

  it("stores compact gaze anchor metadata without changing the binary gaze opcode", async () => {
    const anchorElement = {
      getAttribute(name: string) {
        if (name === "data-forensic-id") return "doc-token-12-text-body";
        return null;
      },
      parentElement: null,
      getBoundingClientRect() {
        return {
          left: 100,
          top: 200,
          width: 400,
          height: 300,
        };
      },
    };

    vi.stubGlobal("window", {
      innerWidth: 1000,
      innerHeight: 800,
      devicePixelRatio: 1,
    });
    vi.stubGlobal("document", {
      documentElement: {
        scrollWidth: 1000,
        scrollHeight: 2400,
      },
      elementFromPoint: vi.fn(() => anchorElement),
    });

    const recorder = new DeterministicReplayRecorder();
    recorder.recordGazePoint(0.3, 0.5, 0.8);
    vi.advanceTimersByTime(20);
    recorder.recordGazePoint(0.4, 0.6, 0.6);

    const tape = await recorder.finalize();

    expect(tape.metrics.gazePointCount).toBe(2);
    expect(decodeForensicReplay(tape).map((event) => event.type)).toEqual(["gazePoint", "gazePoint"]);
    expect(tape.gazeAnchors).toEqual({
      scale: 1000,
      anchors: [
        {
          id: 1,
          attribute: "data-forensic-id",
          value: "doc-token-12-text-body",
        },
      ],
      samples: [
        { anchorId: 1, offsetX: 500, offsetY: 667 },
        { anchorId: 1, offsetX: 750, offsetY: 933 },
      ],
    });
  });
});
