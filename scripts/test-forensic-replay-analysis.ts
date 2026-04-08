/**
 * Forensic replay analysis helpers — extracted from test-forensic-replay.ts
 * for file-length compliance.
 */

import { decodeReplayEventsSync, type ForensicReplayEncodedEvent } from "~/lib/forensic/replay-codec";
import { REPLAY_FORMAT_LIMITS } from "~/lib/forensic/replay-format";
import type { ForensicReplayTape } from "~/lib/forensic/types";
import {
  extractBehaviorFeatures,
  type ReplayBehaviorFeatures,
  type SignatureMotionFeatures,
} from "~/premium/ai/replay-analysis";

const TIME_Q = REPLAY_FORMAT_LIMITS.timeQuantumMs;

// ── Types ───────────��───────────────────────────────────────

type StrokePoint = { x: number; y: number; t: number; force: number };

type VerdictAccum = {
  score: number;
  flags: string[];
  stats: Record<string, number>;
};

export type VerdictResult = {
  verdict: string;
  confidence: number;
  automationScore: number;
  flags: string[];
  stats: Record<string, number>;
};

// ── Math helpers ────────────────────────────────────────────

/** Compute mean + stdDev for a numeric array */
function meanStdDev(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return { mean, stdDev };
}

function shannonEntropy(values: number[], bins = 10): number {
  if (values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0]!,
    max = sorted[sorted.length - 1]!;
  const range = max - min || 1;
  const counts = new Array(bins).fill(0) as number[];
  for (const v of values) counts[Math.min(bins - 1, Math.floor(((v - min) / range) * bins))]!++;
  const probs = counts.map((c) => c / values.length).filter((p) => p > 0);
  const entropy = -probs.reduce((s, p) => s + p * Math.log2(p), 0);
  return entropy / Math.log2(bins);
}

function lag1Autocorrelation(values: number[]): number {
  if (values.length < 3) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const diffs = values.map((v) => v - mean);
  let num = 0;
  for (let i = 0; i < diffs.length - 1; i++) num += diffs[i]! * diffs[i + 1]!;
  const den = diffs.reduce((s, v) => s + v * v, 0);
  return den > 0 ? num / den : 0;
}

function cdvr(values: number[]): number {
  if (values.length < 3) return 1;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const rawVar = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  if (rawVar === 0) return 1;
  const consec: number[] = [];
  for (let i = 1; i < values.length; i++) consec.push(values[i]! - values[i - 1]!);
  const cdVar = consec.reduce((s, v) => s + v * v, 0) / consec.length;
  return cdVar / (2 * rawVar);
}

function quantizationRatio(values: number[], quantum: number): number {
  if (values.length === 0) return 0;
  let onGrid = 0;
  for (const v of values) {
    if (v % quantum === 0 || Math.abs(v % quantum) < 2) onGrid++;
  }
  return onGrid / values.length;
}

function uniqueRatio(values: number[]): number {
  if (values.length === 0) return 0;
  return new Set(values).size / values.length;
}

// ── Stroke extraction ──────���────────────────────────────────

function extractSigStrokes(events: ForensicReplayEncodedEvent[]): StrokePoint[][] {
  const strokes: StrokePoint[][] = [];
  let current: StrokePoint[] = [];
  let atMs = 0;
  for (const e of events) {
    atMs += e.delta * TIME_Q;
    if (e.type === "signatureStart") {
      current = [{ x: e.x, y: e.y, t: atMs, force: e.pressure / 255 }];
    } else if (e.type === "signaturePoint") {
      current.push({ x: e.x, y: e.y, t: atMs, force: e.pressure / 255 });
    } else if (e.type === "signatureEnd") {
      if (current.length > 0) strokes.push(current);
      current = [];
    }
  }
  return strokes;
}

function countDirectionChanges(stroke: StrokePoint[]): number {
  let changes = 0;
  for (let i = 2; i < stroke.length; i++) {
    const a = stroke[i - 2]!;
    const b = stroke[i - 1]!;
    const c = stroke[i]!;
    const ax = b.x - a.x,
      ay = b.y - a.y;
    const bx = c.x - b.x,
      by = c.y - b.y;
    const la = Math.sqrt(ax * ax + ay * ay);
    const lb = Math.sqrt(bx * bx + by * by);
    if (la > 0 && lb > 0) {
      const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
      if (Math.acos(cos) * (180 / Math.PI) > 35) changes++;
    }
  }
  return changes;
}

function buildSignatureMotion(sigStrokes: StrokePoint[][]): SignatureMotionFeatures | null {
  if (sigStrokes.length === 0) return null;

  let totalPoints = 0;
  let totalDuration = 0;
  let totalPathLength = 0;
  const speeds: number[] = [];
  const pressures: number[] = [];
  let dirChanges = 0;

  for (const stroke of sigStrokes) {
    totalPoints += stroke.length;
    if (stroke.length < 2) continue;
    const first = stroke[0]!;
    const last = stroke[stroke.length - 1]!;
    totalDuration += last.t - first.t;

    for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1]!;
      const b = stroke[i]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dt = b.t - a.t;
      totalPathLength += dist;
      if (dt > 0) speeds.push(dist / dt);
      pressures.push(b.force);
    }
    dirChanges += countDirectionChanges(stroke);
  }

  const { mean: avgSpeed, stdDev: speedStdDev } = meanStdDev(speeds);
  const { mean: avgPressure, stdDev: pressureStdDev } = meanStdDev(pressures);

  const allPoints = sigStrokes.flat();
  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);
  const bbW = Math.max(...xs) - Math.min(...xs);
  const bbH = Math.max(...ys) - Math.min(...ys);

  return {
    strokeCount: sigStrokes.length,
    pointCount: totalPoints,
    totalDurationMs: totalDuration,
    totalPathLengthPx: totalPathLength,
    pathEfficiency:
      totalPathLength > 0
        ? Math.sqrt(
            (allPoints[allPoints.length - 1]!.x - allPoints[0]!.x) ** 2 +
              (allPoints[allPoints.length - 1]!.y - allPoints[0]!.y) ** 2,
          ) / totalPathLength
        : 0,
    averageSpeedPxPerMs: avgSpeed,
    speedStdDev,
    maxSpeed: speeds.length > 0 ? Math.max(...speeds) : 0,
    averagePressure: avgPressure,
    pressureStdDev,
    pressureRange: pressures.length > 0 ? [Math.min(...pressures), Math.max(...pressures)] : [0, 0],
    directionChanges: dirChanges,
    pauseCount: 0,
    pauseDurationMs: 0,
    boundingBox: {
      width: bbW,
      height: bbH,
      aspectRatio: bbH > 0 ? bbW / bbH : bbW,
    },
  };
}

// ── Heuristic sub-analyzers ──────���──────────────────────────

function analyzeKeystrokeHeuristics(b: ReplayBehaviorFeatures, acc: VerdictAccum) {
  if (b.keystrokeCount <= 5 || b.averageKeystrokeIntervalMs <= 0) return;
  const delays = b.interKeystrokeDelaysMs;
  if (delays.length <= 3) return;

  const { mean: avg, stdDev } = meanStdDev(delays);
  const cv = avg > 0 ? stdDev / avg : 0;
  const entropy = shannonEntropy(delays);
  const autoCorr = lag1Autocorrelation(delays);
  const cdvrVal = cdvr(delays);
  const quantRatio = quantizationRatio(delays, TIME_Q);
  const uniqRatio = uniqueRatio(delays);

  Object.assign(acc.stats, {
    keystrokeCv: cv,
    keystrokeEntropy: entropy,
    keystrokeAutoCorr: autoCorr,
    keystrokeCdvr: cdvrVal,
    keystrokeQuantRatio: quantRatio,
    keystrokeUniqueRatio: uniqRatio,
  });

  if (cv < 0.15) {
    acc.score += 22;
    acc.flags.push(`KEYSTROKE_UNIFORM: cv=${cv.toFixed(3)} — robotic cadence (human range: 0.3–0.8)`);
  }
  if (entropy < 0.3) {
    acc.score += 18;
    acc.flags.push(`KEYSTROKE_LOW_ENTROPY: ${entropy.toFixed(3)} — too few distinct patterns (human: 0.4+)`);
  }
  if (delays.length > 5 && Math.abs(autoCorr) < 0.1) {
    acc.score += 16;
    acc.flags.push(
      `KEYSTROKE_NO_MOTOR_PERSISTENCE: lag1=${autoCorr.toFixed(3)} — no correlation between consecutive delays (human: 0.12+)`,
    );
  }
  if (delays.length > 5 && cdvrVal > 0.85) {
    acc.score += 14;
    acc.flags.push(
      `KEYSTROKE_SYNTHETIC_TIMING: cdvr=${cdvrVal.toFixed(3)} — consecutive delays uncorrelated (human: <0.85)`,
    );
  }
  if (quantRatio > 0.6) {
    acc.score += 16;
    acc.flags.push(
      `KEYSTROKE_QUANTIZED: ${(quantRatio * 100).toFixed(0)}% on ${TIME_Q}ms grid — programmatic (human: <30%)`,
    );
  }
  if (avg < 55) {
    acc.score += 14;
    acc.flags.push(`KEYSTROKE_SUPERHUMAN: avg=${avg.toFixed(0)}ms — below human motor limit (~55ms)`);
  }
}

function analyzeSignatureHeuristics(sig: SignatureMotionFeatures, acc: VerdictAccum) {
  acc.stats.sigPressureStdDev = sig.pressureStdDev;
  acc.stats.sigSpeedStdDev = sig.speedStdDev;
  acc.stats.sigDirChanges = sig.directionChanges;
  acc.stats.sigPathEfficiency = sig.pathEfficiency;

  if (sig.pressureStdDev < 0.005) {
    acc.score += 20;
    acc.flags.push(`SIG_UNIFORM_PRESSURE: std=${sig.pressureStdDev.toFixed(4)} — zero pressure variation`);
  } else if (sig.pressureStdDev < 0.03) {
    acc.score += 12;
    acc.flags.push(
      `SIG_SYNTHETIC_PRESSURE: std=${sig.pressureStdDev.toFixed(4)} — suspiciously narrow pressure variation`,
    );
  }
  if (sig.speedStdDev < 0.01 && sig.pointCount > 10) {
    acc.score += 15;
    acc.flags.push(
      `SIG_UNIFORM_SPEED: std=${sig.speedStdDev.toFixed(4)} — constant velocity (no acceleration/deceleration)`,
    );
  }
  if (sig.directionChanges === 0 && sig.pointCount > 10) {
    acc.score += 15;
    acc.flags.push("SIG_NO_DIRECTION_CHANGE: perfectly straight strokes — no natural tremor");
  }
  if (sig.pathEfficiency > 0.95) {
    acc.score += 12;
    acc.flags.push(`SIG_PERFECT_PATH: efficiency=${(sig.pathEfficiency * 100).toFixed(1)}% — unnaturally direct`);
  }
  if (sig.pressureStdDev > 0.02 && sig.pressureStdDev < 0.06 && sig.pointCount > 10) {
    acc.score += 8;
    acc.flags.push(`SIG_PRESSURE_BAND: std in synthetic range (0.02–0.06)`);
  }
}

// ── Exported functions ──────────────────────────────────────

export function analyzeSession(
  label: string,
  tape: ForensicReplayTape,
): {
  behavior: ReplayBehaviorFeatures;
  signatureMotion: SignatureMotionFeatures | null;
} {
  const behavior = extractBehaviorFeatures(tape);
  const events = decodeReplayEventsSync(tape.tapeBase64);
  const sigStrokes = extractSigStrokes(events);
  const signatureMotion = buildSignatureMotion(sigStrokes);
  return { behavior, signatureMotion };
}

export function printBehaviorSummary(label: string, b: ReplayBehaviorFeatures) {
  console.log(`\n  📊 ${label} Behavior:`);
  console.log(`     Session: ${(b.sessionDurationMs / 1000).toFixed(1)}s | Events: ${b.eventCount}`);
  console.log(
    `     Scroll: ${b.scrollEventCount} events, ${(b.maxScrollDepthRatio * 100).toFixed(0)}% depth, ${b.scrollDirectionChanges} dir changes`,
  );
  console.log(`     Pages: ${b.pagesViewed.join(",")} | Changes: ${b.totalPageChanges}`);
  console.log(`     Keys: ${b.keystrokeCount} | Avg interval: ${b.averageKeystrokeIntervalMs.toFixed(0)}ms`);
  console.log(`     Fields: ${b.fieldCommitCount} | Clicks: ${b.clickCount} | Focus: ${b.focusChangeCount}`);
  console.log(`     Clipboard: copy=${b.copyCount} cut=${b.cutCount} paste=${b.pasteCount}`);
  console.log(
    `     Time to sig: ${b.timeToFirstSignatureMs != null ? (b.timeToFirstSignatureMs / 1000).toFixed(1) + "s" : "N/A"}`,
  );
  console.log(
    `     Sig duration: ${b.signatureDurationMs != null ? (b.signatureDurationMs / 1000).toFixed(1) + "s" : "N/A"}`,
  );
  console.log(`     Tab hidden: ${b.tabHiddenCount}x`);
}

export function printSignatureMotion(label: string, sig: SignatureMotionFeatures | null) {
  if (!sig) {
    console.log(`\n  🖊️  ${label} Signature: none`);
    return;
  }
  console.log(`\n  🖊️  ${label} Signature Motion:`);
  console.log(
    `     Strokes: ${sig.strokeCount} | Points: ${sig.pointCount} | Duration: ${sig.totalDurationMs.toFixed(0)}ms`,
  );
  console.log(
    `     Path: ${sig.totalPathLengthPx.toFixed(0)}px | Efficiency: ${(sig.pathEfficiency * 100).toFixed(1)}%`,
  );
  console.log(
    `     Speed: avg=${sig.averageSpeedPxPerMs.toFixed(3)} std=${sig.speedStdDev.toFixed(3)} max=${sig.maxSpeed.toFixed(3)}`,
  );
  console.log(
    `     Pressure: avg=${sig.averagePressure.toFixed(3)} std=${sig.pressureStdDev.toFixed(3)} range=[${sig.pressureRange[0]!.toFixed(2)},${sig.pressureRange[1]!.toFixed(2)}]`,
  );
  console.log(
    `     Direction changes: ${sig.directionChanges} | BBox: ${sig.boundingBox.width.toFixed(0)}x${sig.boundingBox.height.toFixed(0)}`,
  );
}

export function heuristicVerdict(b: ReplayBehaviorFeatures, sig: SignatureMotionFeatures | null): VerdictResult {
  const acc: VerdictAccum = { score: 0, flags: [], stats: {} };

  analyzeKeystrokeHeuristics(b, acc);

  if (b.scrollEventCount > 0 && b.scrollDirectionChanges === 0) {
    acc.score += 8;
    acc.flags.push("SCROLL_ONE_DIRECTION: never scrolled back — linear traversal");
  }
  if (b.sessionDurationMs > 0 && b.sessionDurationMs < 5000 && b.eventCount > 20) {
    acc.score += 15;
    acc.flags.push(
      `SESSION_FAST: ${b.eventCount} events in ${(b.sessionDurationMs / 1000).toFixed(1)}s — superhuman throughput`,
    );
  }

  if (sig) analyzeSignatureHeuristics(sig, acc);

  if (b.tabHiddenCount === 0 && b.copyCount === 0 && b.contextMenuCount === 0 && b.eventCount > 30) {
    acc.score += 5;
    acc.flags.push("SESSION_STERILE: no tab switches, clipboard, or context menu — unusually clean");
  }

  const score = Math.min(100, acc.score);
  const verdict = score >= 50 ? "agent" : score >= 25 ? "mixed" : "human";
  const confidence = Math.min(1, 0.2 + score / 100);

  return {
    verdict,
    confidence,
    automationScore: score,
    flags: acc.flags,
    stats: acc.stats,
  };
}
