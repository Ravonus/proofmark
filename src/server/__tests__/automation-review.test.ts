import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeterministicReplayRecorder } from "~/lib/forensic";
import { applyAutomationPolicy, reviewForensicAutomation } from "~/server/automation-review";
import type { EnhancedForensicEvidence } from "~/lib/forensic/premium";
import type { TimedSignatureStroke } from "~/lib/forensic/types";

function buildEvidence(overrides: Partial<EnhancedForensicEvidence> = {}): EnhancedForensicEvidence {
  return {
    version: 1,
    collectedAt: "2026-03-28T00:00:00.000Z",
    fingerprint: {
      visitorId: "visitor",
      canvasHash: "canvas",
      webglHash: "webgl",
      audioHash: "audio",
      screen: "1920x1080x24@2",
      timezone: "America/Denver",
      languages: ["en-US"],
      cpuCores: 8,
      deviceMemory: 16,
      platform: "MacIntel",
      touchPoints: 0,
      webdriver: false,
      fontsHash: "fonts",
      pluginsHash: "plugins",
      doNotTrack: null,
      cookieEnabled: true,
      persistentId: "persist",
      firstSeen: "2026-03-28T00:00:00.000Z",
      visitCount: 2,
      batteryLevel: null,
      batteryCharging: null,
      connectionType: "4g",
      connectionDownlink: 12,
      colorGamut: "p3",
      hdr: false,
      reducedMotion: false,
      darkMode: false,
      devicePixelRatio: 2,
      gpuVendor: "Apple",
      gpuRenderer: "Apple GPU",
      browserMajor: "Chrome/136",
      mathFingerprint: "math",
      webRtcLocalIps: [],
    },
    behavioral: {
      timeOnPage: 18_000,
      scrolledToBottom: true,
      maxScrollDepth: 100,
      mouseMoveCount: 20,
      clickCount: 4,
      keyPressCount: 12,
      pageWasHidden: false,
      hiddenDuration: 0,
      interactionTimeline: [],
      typingCadence: [110, 150, 130, 190, 170],
      mouseVelocityAvg: 0.4,
      mouseAccelerationPattern: "pattern",
      touchPressureAvg: null,
      scrollPattern: [0.18, 0.2],
      focusChanges: 4,
      pasteEvents: 0,
      copyEvents: 0,
      cutEvents: 0,
      rightClicks: 0,
      replay: {
        version: 1,
        encoding: "pm-replay-v1",
        timeQuantumMs: 8,
        viewport: {
          width: 1440,
          height: 900,
          devicePixelRatio: 2,
          scrollWidth: 1440,
          scrollHeight: 2500,
        },
        targets: [],
        strings: [],
        tapeBase64: "ZmFrZQ==",
        tapeHash: "hash",
        capabilities: ["field", "signature"],
        metrics: {
          eventCount: 14,
          byteLength: 220,
          targetCount: 3,
          stringCount: 3,
          signatureStrokeCount: 2,
          signaturePointCount: 20,
          clipboardEventCount: 0,
          maxTimestampMs: 18000,
        },
      },
    },
    geo: null,
    tls: null,
    userAgent: "Mozilla/5.0",
    ip: "8.8.8.8",
    evidenceHash: "",
    flags: [],
    reverseDns: null,
    headerFingerprint: "headers",
    acceptLanguage: "en-US",
    forwardedChain: null,
    ...overrides,
  };
}

async function buildSignatureReplay(strokes: TimedSignatureStroke[]) {
  const recorder = new DeterministicReplayRecorder();

  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    const start = stroke[0]!;
    const strokeId = recorder.recordSignatureStrokeStart("signature-pad", start.x, start.y, start.force);
    for (let index = 1; index < stroke.length; index += 1) {
      const point = stroke[index]!;
      const previous = stroke[index - 1]!;
      vi.advanceTimersByTime(Math.max(1, point.t - previous.t));
      recorder.recordSignaturePoint(strokeId, point.x, point.y, point.force);
    }
    recorder.recordSignatureStrokeEnd(strokeId);
    vi.advanceTimersByTime(80);
  }

  recorder.recordSignatureCommit("signature-pad", strokes);
  return recorder.finalize();
}

async function buildGazeReplay(mode: "natural" | "synthetic") {
  const recorder = new DeterministicReplayRecorder();
  const fixationDurations: number[] = [];
  let blinkCount = 0;

  if (mode === "natural") {
    const lineYs = [0.18, 0.24, 0.3, 0.36, 0.42, 0.48];
    const lineXs = [0.14, 0.24, 0.34, 0.46, 0.58, 0.7, 0.82];
    for (let line = 0; line < lineYs.length; line += 1) {
      const y = lineYs[line]!;
      let previousX = lineXs[0]!;
      let previousY = y;
      recorder.recordGazePoint(previousX, previousY, 0.88);
      vi.advanceTimersByTime(150);
      for (let index = 1; index < lineXs.length; index += 1) {
        const x = lineXs[index]!;
        recorder.recordGazeSaccade(previousX, previousY, x, y, 180 + index * 8);
        recorder.recordGazePoint(x, y, 0.9);
        previousX = x;
        previousY = y;
        vi.advanceTimersByTime(170);
      }
      const fixation = 190 + line * 28;
      fixationDurations.push(fixation);
      recorder.recordGazeFixation(0.82, y, fixation, null);
      vi.advanceTimersByTime(fixation);

      if (line < lineYs.length - 1) {
        const nextY = lineYs[line + 1]!;
        recorder.recordGazeSaccade(0.82, y, 0.16, nextY, 220 + line * 10);
        if (line % 2 === 0) {
          blinkCount += 1;
          recorder.recordGazeBlink(130 + line * 10);
        }
        recorder.recordGazePoint(0.16, nextY, 0.87);
        vi.advanceTimersByTime(900);
      }
    }
  } else {
    const path: Array<[number, number]> = [
      [0.12, 0.18],
      [0.86, 0.72],
      [0.22, 0.65],
      [0.76, 0.24],
      [0.18, 0.84],
      [0.9, 0.16],
      [0.28, 0.48],
      [0.7, 0.88],
      [0.1, 0.38],
      [0.84, 0.56],
    ];
    let previous = path[0]!;
    recorder.recordGazePoint(previous[0], previous[1], 0.92);
    vi.advanceTimersByTime(120);
    for (let index = 1; index < 90; index += 1) {
      const next = path[index % path.length]!;
      recorder.recordGazeSaccade(previous[0], previous[1], next[0], next[1], 460 + (index % 6) * 25);
      recorder.recordGazePoint(next[0], next[1], 0.93);
      if (index % 12 === 0) {
        fixationDurations.push(55);
        recorder.recordGazeFixation(next[0], next[1], 55, null);
      }
      previous = next;
      vi.advanceTimersByTime(110);
    }
  }

  return {
    replay: await recorder.finalize(),
    summary: {
      gazePointCount: mode === "natural" ? 47 : 90,
      gazeFixationCount: fixationDurations.length,
      gazeFixationAvgMs:
        fixationDurations.length > 0
          ? fixationDurations.reduce((sum, value) => sum + value, 0) / fixationDurations.length
          : 0,
      gazeBlinkCount: blinkCount,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-03-28T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("automation review heuristics", () => {
  it("flags mixed sessions when prep looks automated but signature motion looks human", () => {
    const evidence = buildEvidence({
      behavioral: {
        ...buildEvidence().behavioral,
        mouseMoveCount: 0,
        clickCount: 1,
        keyPressCount: 2,
        pasteEvents: 3,
        copyEvents: 2,
        focusChanges: 1,
      },
    });

    const review = reviewForensicAutomation(evidence, { signMethod: "WALLET", hasHandSignature: true });
    const outcome = applyAutomationPolicy(review, {
      enabled: true,
      onPreparationAutomation: "FLAG",
      onCriticalAutomation: "DENY",
      notifyCreator: true,
      requireHumanSteps: ["signature", "consent", "final_submit", "wallet_auth"],
    });

    expect(review.verdict).toBe("mixed");
    expect(review.stages.find((stage) => stage.stage === "preparation")?.score).toBeGreaterThanOrEqual(0.55);
    expect(review.stages.find((stage) => stage.stage === "critical")?.score).toBeLessThan(0.4);
    expect(outcome.action).toBe("FLAG");
    expect(outcome.blocked).toBe(false);
  });

  it("blocks sessions with strong critical automation signals", () => {
    const evidence = buildEvidence({
      fingerprint: {
        ...buildEvidence().fingerprint,
        webdriver: true,
      },
      behavioral: {
        ...buildEvidence().behavioral,
        timeOnPage: 1200,
        mouseMoveCount: 0,
        clickCount: 0,
        keyPressCount: 0,
        pasteEvents: 2,
        replay: null,
      },
      flags: [{ code: "WEBDRIVER_DETECTED", severity: "critical", message: "webdriver" }],
    });

    const review = reviewForensicAutomation(evidence, { signMethod: "EMAIL_OTP", hasHandSignature: true });
    const outcome = applyAutomationPolicy(review, {
      enabled: true,
      onPreparationAutomation: "ALLOW",
      onCriticalAutomation: "DENY",
      notifyCreator: true,
      requireHumanSteps: ["signature", "consent", "final_submit", "wallet_auth"],
    });

    expect(review.verdict).toBe("agent");
    expect(review.recommendedAction).toBe("FLAG");
    expect(outcome.action).toBe("DENY");
    expect(outcome.blocked).toBe(true);
  });

  it("uses richer signature motion metrics when assessing replayed signatures", async () => {
    const replay = await buildSignatureReplay([
      [
        { x: 10, y: 16, t: 0, force: 0.42 },
        { x: 20, y: 16, t: 16, force: 0.42 },
        { x: 30, y: 16, t: 32, force: 0.42 },
        { x: 40, y: 16, t: 48, force: 0.42 },
        { x: 50, y: 16, t: 64, force: 0.42 },
        { x: 60, y: 16, t: 80, force: 0.42 },
        { x: 70, y: 16, t: 96, force: 0.42 },
        { x: 80, y: 16, t: 112, force: 0.42 },
      ],
    ]);

    const evidence = buildEvidence({
      behavioral: {
        ...buildEvidence().behavioral,
        replay,
      },
    });

    const review = reviewForensicAutomation(evidence, { signMethod: "WALLET", hasHandSignature: true });

    expect(review.indicators.some((indicator) => indicator.code === "SIGNATURE_MOTION_TOO_UNIFORM")).toBe(true);
    expect(review.indicators.some((indicator) => indicator.code === "SIGNATURE_MOTION_TOO_FAST")).toBe(true);
    expect(review.stages.find((stage) => stage.stage === "critical")?.score).toBeGreaterThan(0.25);
  });

  it("flags synthetic gaze patterns during critical signing", async () => {
    const { replay, summary } = await buildGazeReplay("synthetic");
    const evidence = buildEvidence({
      behavioral: {
        ...buildEvidence().behavioral,
        replay,
        gazeTrackingActive: true,
        gazePointCount: summary.gazePointCount,
        gazeFixationCount: summary.gazeFixationCount,
        gazeFixationAvgMs: summary.gazeFixationAvgMs,
        gazeBlinkCount: summary.gazeBlinkCount,
        gazeBlinkRate: 0,
        gazeTrackingCoverage: 0.95,
      },
    });

    const review = reviewForensicAutomation(evidence, { signMethod: "EMAIL_OTP", hasHandSignature: false });

    expect(review.indicators.some((indicator) => indicator.code === "SYNTHETIC_GAZE_CRITICAL")).toBe(true);
    expect(review.stages.find((stage) => stage.stage === "critical")?.score).toBeGreaterThan(0.3);
  });

  it("credits natural gaze engagement as strong human evidence", async () => {
    const { replay, summary } = await buildGazeReplay("natural");
    const sessionMs = replay.metrics.maxTimestampMs;
    const evidence = buildEvidence({
      behavioral: {
        ...buildEvidence().behavioral,
        replay,
        gazeTrackingActive: true,
        gazePointCount: summary.gazePointCount,
        gazeFixationCount: summary.gazeFixationCount,
        gazeFixationAvgMs: summary.gazeFixationAvgMs,
        gazeBlinkCount: summary.gazeBlinkCount,
        gazeBlinkRate: sessionMs > 0 ? (summary.gazeBlinkCount / sessionMs) * 60000 : 0,
        gazeTrackingCoverage: 1,
      },
    });

    const review = reviewForensicAutomation(evidence, { signMethod: "EMAIL_OTP", hasHandSignature: false });

    expect(review.indicators.some((indicator) => indicator.code === "NATURAL_GAZE_CRITICAL")).toBe(true);
    expect(review.stages.find((stage) => stage.stage === "critical")?.score).toBeLessThan(0.25);
  });

  it("treats failed active liveness as critical automation evidence", () => {
    const evidence = buildEvidence({
      behavioral: {
        ...buildEvidence().behavioral,
        gazeTrackingActive: true,
        gazeLiveness: {
          required: true,
          completed: true,
          challengeCount: 4,
          passedCount: 1,
          failedCount: 3,
          passRatio: 0.25,
          averageReactionMs: 1750,
          suspicious: true,
          steps: [],
        },
      },
    });

    const review = reviewForensicAutomation(evidence, { signMethod: "WALLET", hasHandSignature: true });

    expect(review.indicators.some((indicator) => indicator.code === "GAZE_LIVENESS_FAILED")).toBe(true);
    expect(review.stages.find((stage) => stage.stage === "critical")?.score).toBeGreaterThan(0.3);
  });

  it("flags signer-baseline deviations during critical signing", () => {
    const evidence = buildEvidence({
      signerBaseline: {
        sampleCount: 3,
        verdict: "deviates",
        deviationScore: 0.58,
        indicators: ["Signature complexity deviated sharply from prior signer sessions."],
        comparisons: [
          {
            metric: "signature.motionComplexityScore",
            stage: "critical",
            current: 0.08,
            baselineMean: 0.62,
            baselineStdDev: 0.09,
            zScore: -6,
            relativeDeviation: 0.87,
            deviates: true,
            message: "Critical signature motion diverged sharply from the signer's historical baseline.",
          },
        ],
      },
    });

    const review = reviewForensicAutomation(evidence, { signMethod: "WALLET", hasHandSignature: true });

    expect(review.indicators.some((indicator) => indicator.code === "SIGNER_BASELINE_DEVIATION_CRITICAL")).toBe(true);
    expect(review.stages.find((stage) => stage.stage === "critical")?.score).toBeGreaterThan(0.05);
  });
});
