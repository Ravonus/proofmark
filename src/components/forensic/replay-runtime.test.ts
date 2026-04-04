import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeterministicReplayRecorder } from "~/lib/forensic";
import { buildReplayLaneSnapshot, prepareReplaySession } from "./replay-runtime";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-28T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("forensic replay runtime", () => {
  it("builds a deterministic fallback lane and reconstructs its snapshot", async () => {
    const recorder = new DeterministicReplayRecorder();

    recorder.recordScroll(420, 1200);
    vi.advanceTimersByTime(32);

    const strokeId = recorder.recordSignatureStrokeStart("signature-pad", 10, 14, 0.4);
    vi.advanceTimersByTime(16);
    recorder.recordSignaturePoint(strokeId, 24, 18, 0.5);
    vi.advanceTimersByTime(16);
    recorder.recordSignaturePoint(strokeId, 42, 24, 0.6);
    recorder.recordSignatureStrokeEnd(strokeId);
    recorder.recordSignatureCommit("signature-pad", [
      [
        { x: 10, y: 14, t: 0, force: 0.4 },
        { x: 24, y: 18, t: 16, force: 0.5 },
        { x: 42, y: 24, t: 32, force: 0.6 },
      ],
    ]);

    recorder.recordFieldValue("reference-code", "PM-AUTO-20260328-AX9");
    vi.advanceTimersByTime(220);
    recorder.recordClipboard("paste", "field:reference-code", "PM-AUTO-20260328-AX9");
    recorder.recordPage(2, 3);

    const replay = await recorder.finalize();
    const session = await prepareReplaySession([
      {
        signerId: "signer-1",
        label: "Signer One",
        replay,
      },
    ]);

    expect(session.source).toBe("ts");
    expect(session.durationMs).toBeGreaterThan(0);
    expect(session.lanes).toHaveLength(1);
    expect(session.lanes[0]?.events.some((event) => event.type === "signatureCommit")).toBe(true);

    const snapshot = buildReplayLaneSnapshot(session.lanes[0]!, session.durationMs);
    expect(snapshot.scrollRatio).toBeCloseTo(0.35, 2);
    expect(snapshot.page).toBe(2);
    expect(snapshot.signatureStrokes[0]?.length).toBe(3);
    expect(snapshot.recentFields[0]?.value).toContain("PM-AUTO");
    expect(snapshot.recentClipboard[0]?.action).toBe("paste");
  });

  it("merges multiple fallback lanes by timeline order", async () => {
    const first = new DeterministicReplayRecorder();
    first.recordPage(1, 2);
    vi.advanceTimersByTime(20);
    first.recordNavigation("next", "nav:next", 2);

    const second = new DeterministicReplayRecorder();
    second.recordPage(1, 2);
    vi.advanceTimersByTime(10);
    second.recordScroll(800, 1600);

    const session = await prepareReplaySession([
      { signerId: "a", label: "Signer A", replay: await first.finalize() },
      { signerId: "b", label: "Signer B", replay: await second.finalize() },
    ]);

    expect(session.mergedEvents.length).toBeGreaterThanOrEqual(4);
    expect(session.mergedEvents[0]?.lane).toBe(1);
    expect(session.mergedEvents.some((event) => event.lane === 2 && event.type === "scroll")).toBe(true);
  });
});
