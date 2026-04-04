import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeterministicReplayRecorder, analyzeTimedSignature, extractReplaySignatureAnalysis } from "../index";
import type { TimedSignatureStroke } from "../types";

describe("signature analysis", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives motion metrics from timed signature strokes", () => {
    const strokes: TimedSignatureStroke[] = [
      [
        { x: 12, y: 18, t: 0, force: 0.4 },
        { x: 18, y: 24, t: 16, force: 0.52 },
        { x: 16, y: 30, t: 36, force: 0.48 },
      ],
      [
        { x: 25, y: 28, t: 0, force: 0.47 },
        { x: 21, y: 33, t: 18, force: 0.5 },
        { x: 17, y: 39, t: 44, force: 0.42 },
      ],
    ];

    const analysis = analyzeTimedSignature(strokes);

    expect(analysis).not.toBeNull();
    expect(analysis?.strokeCount).toBe(2);
    expect(analysis?.pointCount).toBe(6);
    expect(analysis?.penLiftCount).toBe(1);
    expect(analysis?.boundingBox.width).toBe(13);
    expect(analysis?.boundingBox.height).toBe(21);
    expect(analysis?.directionChangeCount).toBeGreaterThanOrEqual(1);
    expect(analysis?.velocityCoefficientOfVariation).toBeGreaterThan(0);
    expect(analysis?.motionComplexityScore).toBeGreaterThan(0.15);
    expect(analysis?.motionUniformityScore).toBeGreaterThan(0.75);
  });

  it("extracts the latest replayed signature motion", async () => {
    const recorder = new DeterministicReplayRecorder();
    const stroke: TimedSignatureStroke = [
      { x: 10, y: 16, t: 0, force: 0.42 },
      { x: 20, y: 16, t: 16, force: 0.42 },
      { x: 30, y: 16, t: 32, force: 0.42 },
      { x: 40, y: 16, t: 48, force: 0.42 },
    ];

    const strokeId = recorder.recordSignatureStrokeStart("signature-pad", stroke[0]!.x, stroke[0]!.y, stroke[0]!.force);
    for (let index = 1; index < stroke.length; index += 1) {
      const point = stroke[index]!;
      const previous = stroke[index - 1]!;
      vi.advanceTimersByTime(point.t - previous.t);
      recorder.recordSignaturePoint(strokeId, point.x, point.y, point.force);
    }
    recorder.recordSignatureStrokeEnd(strokeId);
    recorder.recordSignatureCommit("signature-pad", [stroke]);

    const replay = await recorder.finalize();
    const analysis = extractReplaySignatureAnalysis(replay);

    expect(analysis).not.toBeNull();
    expect(analysis?.committed).toBe(true);
    expect(analysis?.strokeCount).toBe(1);
    expect(analysis?.pointCount).toBe(4);
    expect(analysis?.durationMs).toBe(48);
    expect(analysis?.boundingBox.aspectRatio).toBeGreaterThan(1);
  });
});
