/**
 * End-to-end forensic replay test
 *
 * Generates two signing sessions:
 *   1. "LLM Signer" — synthetic, robotic timing, uniform speed, perfect patterns
 *   2. "Human Signer" — interactive terminal-based capture (you!)
 *
 * Then compares both through the forensic replay analysis pipeline.
 *
 * Usage:
 *   npx tsx scripts/test-forensic-replay.ts
 *   npx tsx scripts/test-forensic-replay.ts --skip-human   (LLM-only, no interactive)
 */

import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import * as readline from "readline";

import {
  encodeReplayEventsSync,
  decodeReplayEventsSync,
  encodeTimedSignatureSync,
  type ForensicReplayEncodedEvent,
} from "~/lib/forensic/replay-codec";
import {
  TSPlaybackController,
  TSMultiSignerController,
} from "~/lib/forensic/playback-controller";
import {
  buildEmbeddedPayload,
  buildExternalPointer,
  shouldExternalize,
  estimateEmbeddedSize,
} from "~/lib/forensic/storage";
import { REPLAY_ENCODING, REPLAY_FORMAT_LIMITS } from "~/lib/forensic/replay-format";
import type { ForensicReplayTape } from "~/lib/forensic/types";
import type { CaptureResult, CaptureTarget, CaptureString, CapturedGeometry } from "~/lib/forensic/capture-adapter";

// Premium AI analysis (only imported for this test)
import {
  extractBehaviorFeatures,
  extractSignatureMotionFeatures,
  buildReplayAnalysisPrompt,
  type ReplayAnalysisInput,
  type ReplayBehaviorFeatures,
  type SignatureMotionFeatures,
} from "~/premium/ai/replay-analysis";

const TIME_Q = REPLAY_FORMAT_LIMITS.timeQuantumMs;
const OUTPUT_DIR = resolve(process.cwd(), "tmp/forensic-test");

// ── Helpers ─────────────────────────────────────────────────

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function makeTape(events: ForensicReplayEncodedEvent[]): ForensicReplayTape {
  const { tapeBase64, byteLength } = encodeReplayEventsSync(events);
  const targets: ForensicReplayTape["targets"] = [];
  const strings: ForensicReplayTape["strings"] = [];
  const targetIndex = new Map<number, boolean>();
  const stringIndex = new Map<number, boolean>();

  let sigStrokes = 0;
  let sigPoints = 0;
  let clipCount = 0;
  let maxTs = 0;
  const caps = new Set<string>();

  for (const e of events) {
    maxTs += e.delta * TIME_Q;
    switch (e.type) {
      case "scroll": caps.add("scroll"); break;
      case "click": caps.add("click"); if (!targetIndex.has(e.targetId)) { targetIndex.set(e.targetId, true); targets.push({ id: e.targetId, hash: fnv1a64(`t${e.targetId}`), descriptor: `target-${e.targetId}` }); } break;
      case "key": caps.add("key"); if (!targetIndex.has(e.targetId)) { targetIndex.set(e.targetId, true); targets.push({ id: e.targetId, hash: fnv1a64(`t${e.targetId}`), descriptor: `target-${e.targetId}` }); } if (!stringIndex.has(e.keyId)) { stringIndex.set(e.keyId, true); strings.push({ id: e.keyId, kind: "key", hash: fnv1a64(`k${e.keyId}`), value: `key-${e.keyId}` }); } break;
      case "focus": caps.add("focus"); break;
      case "blur": caps.add("blur"); break;
      case "visibility": caps.add("visibility"); break;
      case "highlight": caps.add("highlight"); break;
      case "navigation": caps.add("navigation"); break;
      case "page": caps.add("page"); break;
      case "modal": caps.add("modal"); break;
      case "signatureStart": caps.add("signature"); sigStrokes++; sigPoints++; break;
      case "signaturePoint": sigPoints++; break;
      case "signatureEnd": break;
      case "signatureCommit": if (!stringIndex.has(e.signatureId)) { stringIndex.set(e.signatureId, true); strings.push({ id: e.signatureId, kind: "signature", hash: fnv1a64(`sig${e.signatureId}`), value: `pm-sig-v1:encoded` }); } break;
      case "signatureClear": break;
      case "fieldCommit": caps.add("field"); if (!targetIndex.has(e.targetId)) { targetIndex.set(e.targetId, true); targets.push({ id: e.targetId, hash: fnv1a64(`t${e.targetId}`), descriptor: `field-${e.targetId}` }); } if (!stringIndex.has(e.valueId)) { stringIndex.set(e.valueId, true); strings.push({ id: e.valueId, kind: "value", hash: fnv1a64(`v${e.valueId}`), value: `value-${e.valueId}` }); } break;
      case "clipboard": caps.add("clipboard"); clipCount++; break;
      case "contextMenu": caps.add("contextmenu"); break;
    }
  }

  return {
    version: 1,
    encoding: REPLAY_ENCODING,
    timeQuantumMs: TIME_Q,
    viewport: { width: 1280, height: 900, devicePixelRatio: 2, scrollWidth: 1280, scrollHeight: 4000 },
    targets,
    strings,
    tapeBase64,
    tapeHash: fnv1a64(tapeBase64),
    capabilities: [...caps].sort() as ForensicReplayTape["capabilities"],
    metrics: {
      eventCount: events.length,
      byteLength,
      targetCount: targets.length,
      stringCount: strings.length,
      signatureStrokeCount: sigStrokes,
      signaturePointCount: sigPoints,
      clipboardEventCount: clipCount,
      maxTimestampMs: maxTs,
      gazePointCount: 0,
      gazeFixationCount: 0,
      gazeBlinkCount: 0,
    },
  };
}

// ── LLM Signer: synthetic robotic session ───────────────────

function generateLLMSignerEvents(): ForensicReplayEncodedEvent[] {
  const events: ForensicReplayEncodedEvent[] = [];

  // Robotic pattern: instant start, perfectly uniform timing, no hesitation
  // Scrolls at perfectly even intervals
  for (let i = 0; i < 8; i++) {
    events.push({ type: "scroll", delta: Math.round(250 / TIME_Q), scrollY: i * 500, scrollMax: 4000 });
  }

  // Navigate pages with exactly uniform timing
  events.push({ type: "page", delta: Math.round(100 / TIME_Q), page: 1, totalPages: 3 });
  events.push({ type: "page", delta: Math.round(100 / TIME_Q), page: 2, totalPages: 3 });
  events.push({ type: "page", delta: Math.round(100 / TIME_Q), page: 3, totalPages: 3 });

  // Click on field — zero hesitation
  events.push({ type: "click", delta: Math.round(50 / TIME_Q), targetId: 1, x: 400, y: 300, button: 0 });
  events.push({ type: "focus", delta: 1, targetId: 1 });

  // Type name with perfectly uniform 30ms intervals (superhuman cadence)
  const name = "John Smith";
  for (let i = 0; i < name.length; i++) {
    events.push({ type: "key", delta: Math.round(30 / TIME_Q), targetId: 1, keyId: i + 1, modifiers: 0 });
  }

  // Field commit — instant
  events.push({ type: "fieldCommit", delta: 1, targetId: 1, valueId: 1 });

  // Click on date field — same uniform pattern
  events.push({ type: "click", delta: Math.round(50 / TIME_Q), targetId: 2, x: 400, y: 380, button: 0 });
  events.push({ type: "focus", delta: 1, targetId: 2 });

  // Type date — same perfect 30ms rhythm
  const date = "2026-03-28";
  for (let i = 0; i < date.length; i++) {
    events.push({ type: "key", delta: Math.round(30 / TIME_Q), targetId: 2, keyId: 20 + i, modifiers: 0 });
  }
  events.push({ type: "fieldCommit", delta: 1, targetId: 2, valueId: 2 });

  // Signature — perfectly linear, no pressure variation, no hesitation
  events.push({ type: "click", delta: Math.round(80 / TIME_Q), targetId: 3, x: 200, y: 500, button: 0 });

  // Stroke 1: perfectly straight horizontal line
  events.push({ type: "signatureStart", delta: Math.round(20 / TIME_Q), targetId: 3, strokeId: 1, x: 50, y: 50, pressure: 128 });
  for (let i = 1; i <= 30; i++) {
    events.push({ type: "signaturePoint", delta: Math.round(8 / TIME_Q), strokeId: 1, x: 50 + i * 5, y: 50, pressure: 128 });
  }
  events.push({ type: "signatureEnd", delta: 1, strokeId: 1 });

  // Stroke 2: perfectly straight diagonal — same pressure, same speed
  events.push({ type: "signatureStart", delta: Math.round(20 / TIME_Q), targetId: 3, strokeId: 2, x: 50, y: 70, pressure: 128 });
  for (let i = 1; i <= 20; i++) {
    events.push({ type: "signaturePoint", delta: Math.round(8 / TIME_Q), strokeId: 2, x: 50 + i * 6, y: 70 - i * 2, pressure: 128 });
  }
  events.push({ type: "signatureEnd", delta: 1, strokeId: 2 });

  events.push({ type: "signatureCommit", delta: Math.round(10 / TIME_Q), targetId: 3, signatureId: 1 });

  // No visibility changes, no context menu, no clipboard — pure efficiency

  return events;
}

// ── Human Signer: interactive terminal capture ──────────────

function generateHumanSignerEvents(): Promise<ForensicReplayEncodedEvent[]> {
  return new Promise((resolve) => {
    const events: ForensicReplayEncodedEvent[] = [];
    const startedAt = Date.now();
    let lastAt = 0;

    function elapsed() { return Date.now() - startedAt; }
    function delta() {
      const now = elapsed();
      const d = Math.max(0, Math.round((now - lastAt) / TIME_Q));
      lastAt = now;
      return d;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log("\n╔════════════════════════════════════════════════════════╗");
    console.log("║         FORENSIC REPLAY — Human Signing Test          ║");
    console.log("╠════════════════════════════════════════════════════════╣");
    console.log("║  This simulates signing a contract. I'll record your  ║");
    console.log("║  timing patterns, keystroke rhythm, and behavior.     ║");
    console.log("║                                                       ║");
    console.log("║  Just answer the prompts naturally — take your time.  ║");
    console.log("╚════════════════════════════════════════════════════════╝\n");

    // Simulate reading the document — scroll events
    console.log("📄 Contract: Mutual Non-Disclosure Agreement");
    console.log("   Between: ProofMark Labs and [You]");
    console.log("   Pages: 3 | Term: 24 months\n");

    events.push({ type: "page", delta: delta(), page: 1, totalPages: 3 });

    const steps = [
      () => {
        rl.question("📖 Read page 1... Press Enter when done reading > ", () => {
          events.push({ type: "scroll", delta: delta(), scrollY: 400, scrollMax: 4000 });
          events.push({ type: "scroll", delta: delta(), scrollY: 900, scrollMax: 4000 });
          events.push({ type: "page", delta: delta(), page: 2, totalPages: 3 });
          console.log("\n📄 Page 2: Obligations & Restrictions\n");
          nextStep();
        });
      },
      () => {
        rl.question("📖 Read page 2... Press Enter when done reading > ", () => {
          events.push({ type: "scroll", delta: delta(), scrollY: 1800, scrollMax: 4000 });
          events.push({ type: "scroll", delta: delta(), scrollY: 2400, scrollMax: 4000 });
          events.push({ type: "page", delta: delta(), page: 3, totalPages: 3 });
          console.log("\n📄 Page 3: Signature Block\n");
          nextStep();
        });
      },
      () => {
        rl.question("📖 Read page 3... Press Enter when done reading > ", () => {
          events.push({ type: "scroll", delta: delta(), scrollY: 3200, scrollMax: 4000 });
          events.push({ type: "scroll", delta: delta(), scrollY: 3800, scrollMax: 4000 });
          console.log("\n✏️  Now fill out the signature fields:\n");
          nextStep();
        });
      },
      () => {
        events.push({ type: "click", delta: delta(), targetId: 1, x: 400, y: 300, button: 0 });
        events.push({ type: "focus", delta: delta(), targetId: 1 });

        rl.question("  Full Name: ", (name) => {
          // Record each character with real timing
          for (let i = 0; i < name.length; i++) {
            events.push({ type: "key", delta: delta(), targetId: 1, keyId: i + 1, modifiers: 0 });
          }
          events.push({ type: "fieldCommit", delta: delta(), targetId: 1, valueId: 1 });
          events.push({ type: "blur", delta: delta(), targetId: 1 });
          nextStep();
        });
      },
      () => {
        events.push({ type: "click", delta: delta(), targetId: 2, x: 400, y: 380, button: 0 });
        events.push({ type: "focus", delta: delta(), targetId: 2 });

        rl.question("  Date (YYYY-MM-DD): ", (date) => {
          for (let i = 0; i < date.length; i++) {
            events.push({ type: "key", delta: delta(), targetId: 2, keyId: 20 + i, modifiers: 0 });
          }
          events.push({ type: "fieldCommit", delta: delta(), targetId: 2, valueId: 2 });
          events.push({ type: "blur", delta: delta(), targetId: 2 });
          nextStep();
        });
      },
      () => {
        console.log("\n🖊️  Draw your signature! Type characters to simulate pen strokes.");
        console.log("   (Each character = a stroke point. Type naturally, then press Enter)\n");

        events.push({ type: "click", delta: delta(), targetId: 3, x: 200, y: 500, button: 0 });

        rl.question("  Signature stroke 1: ", (stroke1) => {
          events.push({ type: "signatureStart", delta: delta(), targetId: 3, strokeId: 1, x: 50, y: 50, pressure: Math.round(Math.random() * 60 + 90) });
          for (let i = 0; i < stroke1.length; i++) {
            const pressure = Math.round(Math.random() * 80 + 80);
            const dx = Math.round(Math.random() * 8 + 2);
            const dy = Math.round(Math.random() * 10 - 5);
            events.push({ type: "signaturePoint", delta: delta(), strokeId: 1, x: 50 + (i + 1) * dx, y: 50 + (i + 1) * dy, pressure });
          }
          events.push({ type: "signatureEnd", delta: delta(), strokeId: 1 });

          rl.question("  Signature stroke 2: ", (stroke2) => {
            events.push({ type: "signatureStart", delta: delta(), targetId: 3, strokeId: 2, x: 50, y: 70, pressure: Math.round(Math.random() * 60 + 90) });
            for (let i = 0; i < stroke2.length; i++) {
              const pressure = Math.round(Math.random() * 80 + 80);
              const dx = Math.round(Math.random() * 8 + 2);
              const dy = Math.round(Math.random() * 10 - 5);
              events.push({ type: "signaturePoint", delta: delta(), strokeId: 2, x: 50 + (i + 1) * dx, y: 70 + (i + 1) * dy, pressure });
            }
            events.push({ type: "signatureEnd", delta: delta(), strokeId: 2 });
            events.push({ type: "signatureCommit", delta: delta(), targetId: 3, signatureId: 1 });

            console.log("\n✅ Signature captured!\n");
            nextStep();
          });
        });
      },
      () => {
        rl.question("🔍 Want to review the document before submitting? (y/n): ", (answer) => {
          if (answer.toLowerCase() === "y") {
            events.push({ type: "scroll", delta: delta(), scrollY: 0, scrollMax: 4000 });
            events.push({ type: "scroll", delta: delta(), scrollY: 1500, scrollMax: 4000 });
            events.push({ type: "page", delta: delta(), page: 1, totalPages: 3 });
            events.push({ type: "page", delta: delta(), page: 2, totalPages: 3 });
            events.push({ type: "page", delta: delta(), page: 3, totalPages: 3 });
          }
          nextStep();
        });
      },
      () => {
        // Tab away and come back (natural behavior)
        events.push({ type: "visibility", delta: delta(), hidden: false });
        console.log("✨ Signing complete! Processing your forensic data...\n");
        rl.close();
        resolve(events);
      },
    ];

    let stepIndex = 0;
    function nextStep() {
      if (stepIndex < steps.length) {
        steps[stepIndex]!();
        stepIndex++;
      }
    }

    nextStep();
  });
}

// ── Analysis ────────────────────────────────────────────────

function analyzeSession(label: string, tape: ForensicReplayTape): {
  behavior: ReplayBehaviorFeatures;
  signatureMotion: SignatureMotionFeatures | null;
} {
  const behavior = extractBehaviorFeatures(tape);

  // Build signature motion from the tape events
  const events = decodeReplayEventsSync(tape.tapeBase64);
  let sigStrokes: Array<Array<{ x: number; y: number; t: number; force: number }>> = [];
  let currentStroke: Array<{ x: number; y: number; t: number; force: number }> = [];
  let atMs = 0;

  for (const e of events) {
    atMs += e.delta * TIME_Q;
    if (e.type === "signatureStart") {
      currentStroke = [{ x: e.x, y: e.y, t: atMs, force: e.pressure / 255 }];
    } else if (e.type === "signaturePoint") {
      currentStroke.push({ x: e.x, y: e.y, t: atMs, force: e.pressure / 255 });
    } else if (e.type === "signatureEnd") {
      if (currentStroke.length > 0) sigStrokes.push(currentStroke);
      currentStroke = [];
    }
  }

  // Compute basic signature motion metrics
  let signatureMotion: SignatureMotionFeatures | null = null;
  if (sigStrokes.length > 0) {
    let totalPoints = 0;
    let totalDuration = 0;
    let totalPathLength = 0;
    let speeds: number[] = [];
    let pressures: number[] = [];
    let dirChanges = 0;

    for (const stroke of sigStrokes) {
      totalPoints += stroke.length;
      if (stroke.length >= 2) {
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

        // Direction changes
        for (let i = 2; i < stroke.length; i++) {
          const a = stroke[i - 2]!;
          const b = stroke[i - 1]!;
          const c = stroke[i]!;
          const ax = b.x - a.x, ay = b.y - a.y;
          const bx = c.x - b.x, by = c.y - b.y;
          const la = Math.sqrt(ax * ax + ay * ay);
          const lb = Math.sqrt(bx * bx + by * by);
          if (la > 0 && lb > 0) {
            const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
            if (Math.acos(cos) * (180 / Math.PI) > 35) dirChanges++;
          }
        }
      }
    }

    const avgSpeed = speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0;
    const speedStdDev = speeds.length > 0 ? Math.sqrt(speeds.reduce((s, v) => s + (v - avgSpeed) ** 2, 0) / speeds.length) : 0;
    const avgPressure = pressures.length > 0 ? pressures.reduce((a, b) => a + b, 0) / pressures.length : 0;
    const pressureStdDev = pressures.length > 0 ? Math.sqrt(pressures.reduce((s, v) => s + (v - avgPressure) ** 2, 0) / pressures.length) : 0;

    // Bounding box
    const allPoints = sigStrokes.flat();
    const xs = allPoints.map((p) => p.x);
    const ys = allPoints.map((p) => p.y);
    const bbW = Math.max(...xs) - Math.min(...xs);
    const bbH = Math.max(...ys) - Math.min(...ys);

    signatureMotion = {
      strokeCount: sigStrokes.length,
      pointCount: totalPoints,
      totalDurationMs: totalDuration,
      totalPathLengthPx: totalPathLength,
      pathEfficiency: totalPathLength > 0 ? Math.sqrt((allPoints[allPoints.length - 1]!.x - allPoints[0]!.x) ** 2 + (allPoints[allPoints.length - 1]!.y - allPoints[0]!.y) ** 2) / totalPathLength : 0,
      averageSpeedPxPerMs: avgSpeed,
      speedStdDev,
      maxSpeed: speeds.length > 0 ? Math.max(...speeds) : 0,
      averagePressure: avgPressure,
      pressureStdDev,
      pressureRange: pressures.length > 0 ? [Math.min(...pressures), Math.max(...pressures)] : [0, 0],
      directionChanges: dirChanges,
      pauseCount: 0,
      pauseDurationMs: 0,
      boundingBox: { width: bbW, height: bbH, aspectRatio: bbH > 0 ? bbW / bbH : bbW },
    };
  }

  return { behavior, signatureMotion };
}

function printBehaviorSummary(label: string, b: ReplayBehaviorFeatures) {
  console.log(`\n  📊 ${label} Behavior:`);
  console.log(`     Session: ${(b.sessionDurationMs / 1000).toFixed(1)}s | Events: ${b.eventCount}`);
  console.log(`     Scroll: ${b.scrollEventCount} events, ${(b.maxScrollDepthRatio * 100).toFixed(0)}% depth, ${b.scrollDirectionChanges} dir changes`);
  console.log(`     Pages: ${b.pagesViewed.join(",")} | Changes: ${b.totalPageChanges}`);
  console.log(`     Keys: ${b.keystrokeCount} | Avg interval: ${b.averageKeystrokeIntervalMs.toFixed(0)}ms`);
  console.log(`     Fields: ${b.fieldCommitCount} | Clicks: ${b.clickCount} | Focus: ${b.focusChangeCount}`);
  console.log(`     Clipboard: copy=${b.copyCount} cut=${b.cutCount} paste=${b.pasteCount}`);
  console.log(`     Time to sig: ${b.timeToFirstSignatureMs != null ? (b.timeToFirstSignatureMs / 1000).toFixed(1) + "s" : "N/A"}`);
  console.log(`     Sig duration: ${b.signatureDurationMs != null ? (b.signatureDurationMs / 1000).toFixed(1) + "s" : "N/A"}`);
  console.log(`     Tab hidden: ${b.tabHiddenCount}x`);
}

function printSignatureMotion(label: string, sig: SignatureMotionFeatures | null) {
  if (!sig) {
    console.log(`\n  🖊️  ${label} Signature: none`);
    return;
  }
  console.log(`\n  🖊️  ${label} Signature Motion:`);
  console.log(`     Strokes: ${sig.strokeCount} | Points: ${sig.pointCount} | Duration: ${sig.totalDurationMs.toFixed(0)}ms`);
  console.log(`     Path: ${sig.totalPathLengthPx.toFixed(0)}px | Efficiency: ${(sig.pathEfficiency * 100).toFixed(1)}%`);
  console.log(`     Speed: avg=${sig.averageSpeedPxPerMs.toFixed(3)} std=${sig.speedStdDev.toFixed(3)} max=${sig.maxSpeed.toFixed(3)}`);
  console.log(`     Pressure: avg=${sig.averagePressure.toFixed(3)} std=${sig.pressureStdDev.toFixed(3)} range=[${sig.pressureRange[0]!.toFixed(2)},${sig.pressureRange[1]!.toFixed(2)}]`);
  console.log(`     Direction changes: ${sig.directionChanges} | BBox: ${sig.boundingBox.width.toFixed(0)}x${sig.boundingBox.height.toFixed(0)}`);
}

// ── Statistical tools ───────────────────────────────────────

function shannonEntropy(values: number[], bins = 10): number {
  if (values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0]!, max = sorted[sorted.length - 1]!;
  const range = max - min || 1;
  const counts = new Array(bins).fill(0) as number[];
  for (const v of values) counts[Math.min(bins - 1, Math.floor((v - min) / range * bins))]!++;
  const probs = counts.map((c) => c / values.length).filter((p) => p > 0);
  const entropy = -probs.reduce((s, p) => s + p * Math.log2(p), 0);
  return entropy / Math.log2(bins); // normalized 0–1
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

// Consecutive-difference variance ratio: ~1.0 for uncorrelated (random/synthetic),
// <0.8 for positively correlated (real human motor patterns)
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

// Check if values cluster on multiples of a quantum (e.g., TIME_Q)
function quantizationRatio(values: number[], quantum: number): number {
  if (values.length === 0) return 0;
  let onGrid = 0;
  for (const v of values) {
    if (v % quantum === 0 || Math.abs(v % quantum) < 2) onGrid++;
  }
  return onGrid / values.length;
}

// Unique-value ratio: real humans produce many unique intervals, LLMs repeat values
function uniqueRatio(values: number[]): number {
  if (values.length === 0) return 0;
  return new Set(values).size / values.length;
}

function heuristicVerdict(b: ReplayBehaviorFeatures, sig: SignatureMotionFeatures | null): {
  verdict: string;
  confidence: number;
  automationScore: number;
  flags: string[];
  stats: Record<string, number>;
} {
  let score = 0;
  const flags: string[] = [];
  const stats: Record<string, number> = {};

  // ── Keystroke analysis ─────────────────────────────────────
  if (b.keystrokeCount > 5 && b.averageKeystrokeIntervalMs > 0) {
    const delays = b.interKeystrokeDelaysMs;
    if (delays.length > 3) {
      const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
      const stdDev = Math.sqrt(delays.reduce((s, v) => s + (v - avg) ** 2, 0) / delays.length);
      const cv = avg > 0 ? stdDev / avg : 0;
      const entropy = shannonEntropy(delays);
      const autoCorr = lag1Autocorrelation(delays);
      const cdvrVal = cdvr(delays);
      const quantRatio = quantizationRatio(delays, TIME_Q);
      const uniqRatio = uniqueRatio(delays);

      stats.keystrokeCv = cv;
      stats.keystrokeEntropy = entropy;
      stats.keystrokeAutoCorr = autoCorr;
      stats.keystrokeCdvr = cdvrVal;
      stats.keystrokeQuantRatio = quantRatio;
      stats.keystrokeUniqueRatio = uniqRatio;

      // CV < 0.15: very uniform — real humans show cv 0.3–0.8
      if (cv < 0.15) {
        score += 22;
        flags.push(`KEYSTROKE_UNIFORM: cv=${cv.toFixed(3)} — robotic cadence (human range: 0.3–0.8)`);
      }

      // Low entropy: delays cluster in few bins — real typing entropy is 0.4–0.85
      if (entropy < 0.30) {
        score += 18;
        flags.push(`KEYSTROKE_LOW_ENTROPY: ${entropy.toFixed(3)} — too few distinct patterns (human: 0.4+)`);
      }

      // Near-zero autocorrelation: delays uncorrelated (synthetic/random)
      // Real humans: 0.12–0.50 (motor persistence — slow key follows slow key)
      if (delays.length > 5 && Math.abs(autoCorr) < 0.10) {
        score += 16;
        flags.push(`KEYSTROKE_NO_MOTOR_PERSISTENCE: lag1=${autoCorr.toFixed(3)} — no correlation between consecutive delays (human: 0.12+)`);
      }

      // CDVR ≈ 1.0: uncorrelated noise (both uniform and random)
      // Real humans: 0.35–0.80 (adjacent delays are correlated, so consecutive diffs are small)
      if (delays.length > 5 && cdvrVal > 0.85) {
        score += 14;
        flags.push(`KEYSTROKE_SYNTHETIC_TIMING: cdvr=${cdvrVal.toFixed(3)} — consecutive delays uncorrelated (human: <0.85)`);
      }

      // Quantization: delays land on exact multiples of TIME_Q (programmatic generation)
      // Real humans hit quantized values < 30% of the time
      if (quantRatio > 0.60) {
        score += 16;
        flags.push(`KEYSTROKE_QUANTIZED: ${(quantRatio * 100).toFixed(0)}% on ${TIME_Q}ms grid — programmatic (human: <30%)`);
      }

      // Superhuman speed: fastest sustained human typing is ~55ms inter-key
      if (avg < 55) {
        score += 14;
        flags.push(`KEYSTROKE_SUPERHUMAN: avg=${avg.toFixed(0)}ms — below human motor limit (~55ms)`);
      }
    }
  }

  // ── Scroll patterns ────────────────────────────────────────
  if (b.scrollEventCount > 0 && b.scrollDirectionChanges === 0) {
    score += 8;
    flags.push("SCROLL_ONE_DIRECTION: never scrolled back — linear traversal");
  }

  // ── Session pacing ─────────────────────────────────────────
  if (b.sessionDurationMs > 0 && b.sessionDurationMs < 5000 && b.eventCount > 20) {
    score += 15;
    flags.push(`SESSION_FAST: ${b.eventCount} events in ${(b.sessionDurationMs / 1000).toFixed(1)}s — superhuman throughput`);
  }

  // Event timing entropy (all inter-event gaps, not just keystrokes)
  // Synthetic sessions produce either perfectly uniform or uniformly random gaps
  // Real sessions have clustered bursts and natural pauses

  // ── Signature biomechanics ─────────────────────────────────
  if (sig) {
    stats.sigPressureStdDev = sig.pressureStdDev;
    stats.sigSpeedStdDev = sig.speedStdDev;
    stats.sigDirChanges = sig.directionChanges;
    stats.sigPathEfficiency = sig.pathEfficiency;

    if (sig.pressureStdDev < 0.005) {
      score += 20;
      flags.push(`SIG_UNIFORM_PRESSURE: std=${sig.pressureStdDev.toFixed(4)} — zero pressure variation`);
    } else if (sig.pressureStdDev < 0.03) {
      // Fake variation: real pen input has std > 0.05 typically
      score += 12;
      flags.push(`SIG_SYNTHETIC_PRESSURE: std=${sig.pressureStdDev.toFixed(4)} — suspiciously narrow pressure variation`);
    }

    if (sig.speedStdDev < 0.01 && sig.pointCount > 10) {
      score += 15;
      flags.push(`SIG_UNIFORM_SPEED: std=${sig.speedStdDev.toFixed(4)} — constant velocity (no acceleration/deceleration)`);
    }

    if (sig.directionChanges === 0 && sig.pointCount > 10) {
      score += 15;
      flags.push("SIG_NO_DIRECTION_CHANGE: perfectly straight strokes — no natural tremor");
    }

    if (sig.pathEfficiency > 0.95) {
      score += 12;
      flags.push(`SIG_PERFECT_PATH: efficiency=${(sig.pathEfficiency * 100).toFixed(1)}% — unnaturally direct`);
    }

    // Pressure autocorrelation: real pen strokes have highly correlated pressure
    // (you can't jump from light to heavy instantly — motor inertia)
    // Synthetic random pressure has near-zero autocorrelation
    // We'd need raw pressure sequence for this — approximate from features
    if (sig.pressureStdDev > 0.02 && sig.pressureStdDev < 0.06 && sig.pointCount > 10) {
      // Suspicious band: enough variation to look human but not enough for real pen input
      score += 8;
      flags.push(`SIG_PRESSURE_BAND: std in synthetic range (0.02–0.06)`);
    }
  }

  // ── Session cleanliness ────────────────────────────────────
  if (b.tabHiddenCount === 0 && b.copyCount === 0 && b.contextMenuCount === 0 && b.eventCount > 30) {
    score += 5;
    flags.push("SESSION_STERILE: no tab switches, clipboard, or context menu — unusually clean");
  }

  score = Math.min(100, score);
  const verdict = score >= 50 ? "agent" : score >= 25 ? "mixed" : "human";
  const confidence = Math.min(1, 0.2 + score / 100);

  return { verdict, confidence, automationScore: score, flags, stats };
}


// ── Main ────────────────────────────────────────────────────

async function main() {
  const skipHuman = process.argv.includes("--skip-human");

  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log("╔════════════════════════════════════════════════════════╗");
  console.log("║        FORENSIC REPLAY END-TO-END TEST                ║");
  console.log("╚════════════════════════════════════════════════════════╝\n");

  // ── Step 1: Generate LLM signer session ───────────────────
  console.log("🤖 Generating LLM signer session...");
  const llmEvents = generateLLMSignerEvents();
  const llmTape = makeTape(llmEvents);
  console.log(`   Events: ${llmEvents.length} | Bytes: ${llmTape.metrics.byteLength} | Duration: ${llmTape.metrics.maxTimestampMs}ms`);

  // ── Step 2: Human signer session ──────────────────────────
  let humanTape: ForensicReplayTape;
  if (skipHuman) {
    console.log("\n👤 Skipping human signer (--skip-human)");
    // Generate a more natural-looking synthetic human session
    const humanEvents: ForensicReplayEncodedEvent[] = [];
    // Natural scroll with varied timing
    humanEvents.push({ type: "scroll", delta: Math.round(800 / TIME_Q), scrollY: 120, scrollMax: 4000 });
    humanEvents.push({ type: "scroll", delta: Math.round(1200 / TIME_Q), scrollY: 380, scrollMax: 4000 });
    humanEvents.push({ type: "scroll", delta: Math.round(300 / TIME_Q), scrollY: 350, scrollMax: 4000 }); // scroll back
    humanEvents.push({ type: "scroll", delta: Math.round(2000 / TIME_Q), scrollY: 900, scrollMax: 4000 });
    humanEvents.push({ type: "page", delta: Math.round(3000 / TIME_Q), page: 1, totalPages: 3 });
    humanEvents.push({ type: "scroll", delta: Math.round(1500 / TIME_Q), scrollY: 1400, scrollMax: 4000 });
    humanEvents.push({ type: "page", delta: Math.round(4000 / TIME_Q), page: 2, totalPages: 3 });
    humanEvents.push({ type: "scroll", delta: Math.round(2500 / TIME_Q), scrollY: 2200, scrollMax: 4000 });
    humanEvents.push({ type: "visibility", delta: Math.round(5000 / TIME_Q), hidden: true }); // tab away
    humanEvents.push({ type: "visibility", delta: Math.round(8000 / TIME_Q), hidden: false }); // come back
    humanEvents.push({ type: "page", delta: Math.round(2000 / TIME_Q), page: 3, totalPages: 3 });
    humanEvents.push({ type: "scroll", delta: Math.round(1800 / TIME_Q), scrollY: 3200, scrollMax: 4000 });

    // Click and type name with natural variation
    humanEvents.push({ type: "click", delta: Math.round(3000 / TIME_Q), targetId: 1, x: 412, y: 305, button: 0 });
    humanEvents.push({ type: "focus", delta: Math.round(200 / TIME_Q), targetId: 1 });
    const delays = [120, 85, 150, 95, 180, 70, 110, 200, 90, 130]; // natural variation
    for (let i = 0; i < 10; i++) {
      humanEvents.push({ type: "key", delta: Math.round((delays[i] ?? 120) / TIME_Q), targetId: 1, keyId: i + 1, modifiers: 0 });
    }
    humanEvents.push({ type: "fieldCommit", delta: Math.round(500 / TIME_Q), targetId: 1, valueId: 1 });
    humanEvents.push({ type: "blur", delta: Math.round(300 / TIME_Q), targetId: 1 });

    // Date field
    humanEvents.push({ type: "click", delta: Math.round(1500 / TIME_Q), targetId: 2, x: 398, y: 382, button: 0 });
    humanEvents.push({ type: "focus", delta: Math.round(150 / TIME_Q), targetId: 2 });
    const dateDelays = [110, 140, 80, 170, 90, 200, 100, 130, 95, 160];
    for (let i = 0; i < 10; i++) {
      humanEvents.push({ type: "key", delta: Math.round((dateDelays[i] ?? 120) / TIME_Q), targetId: 2, keyId: 20 + i, modifiers: 0 });
    }
    humanEvents.push({ type: "fieldCommit", delta: Math.round(400 / TIME_Q), targetId: 2, valueId: 2 });

    // Signature with natural variation
    humanEvents.push({ type: "click", delta: Math.round(2000 / TIME_Q), targetId: 3, x: 195, y: 510, button: 0 });
    humanEvents.push({ type: "signatureStart", delta: Math.round(800 / TIME_Q), targetId: 3, strokeId: 1, x: 48, y: 52, pressure: 110 });
    const sigPressures1 = [120, 135, 150, 140, 128, 145, 160, 138, 122, 130, 142, 155, 135, 118, 140, 148, 132, 125, 138, 145];
    for (let i = 0; i < sigPressures1.length; i++) {
      const dx = Math.round(4 + Math.random() * 6);
      const dy = Math.round(Math.random() * 12 - 6);
      const dt = Math.round((12 + Math.random() * 20) / TIME_Q);
      humanEvents.push({ type: "signaturePoint", delta: dt, strokeId: 1, x: 48 + (i + 1) * dx, y: 52 + (i + 1) * dy, pressure: sigPressures1[i]! });
    }
    humanEvents.push({ type: "signatureEnd", delta: Math.round(50 / TIME_Q), strokeId: 1 });

    // Pen lift pause + second stroke
    humanEvents.push({ type: "signatureStart", delta: Math.round(300 / TIME_Q), targetId: 3, strokeId: 2, x: 55, y: 68, pressure: 105 });
    const sigPressures2 = [115, 130, 148, 155, 142, 128, 138, 150, 140, 125, 135, 145, 130, 120];
    for (let i = 0; i < sigPressures2.length; i++) {
      const dx = Math.round(5 + Math.random() * 7);
      const dy = Math.round(Math.random() * 14 - 7);
      const dt = Math.round((10 + Math.random() * 24) / TIME_Q);
      humanEvents.push({ type: "signaturePoint", delta: dt, strokeId: 2, x: 55 + (i + 1) * dx, y: 68 + (i + 1) * dy, pressure: sigPressures2[i]! });
    }
    humanEvents.push({ type: "signatureEnd", delta: Math.round(40 / TIME_Q), strokeId: 2 });
    humanEvents.push({ type: "signatureCommit", delta: Math.round(600 / TIME_Q), targetId: 3, signatureId: 1 });

    humanTape = makeTape(humanEvents);
    console.log(`   Events: ${humanEvents.length} | Bytes: ${humanTape.metrics.byteLength} | Duration: ${humanTape.metrics.maxTimestampMs}ms`);
  } else {
    console.log("\n👤 Your turn! Signing as a human...\n");
    const humanEvents = await generateHumanSignerEvents();
    humanTape = makeTape(humanEvents);
    console.log(`   Events: ${humanEvents.length} | Bytes: ${humanTape.metrics.byteLength} | Duration: ${humanTape.metrics.maxTimestampMs}ms`);
  }

  // ── Step 3: Playback controller test ──────────────────────
  console.log("\n⏯️  Testing playback controllers...");

  const llmCtrl = TSPlaybackController.fromTape(llmTape.tapeBase64, 0);
  const humanCtrl = TSPlaybackController.fromTape(humanTape.tapeBase64, 1);
  const multiCtrl = new TSMultiSignerController([llmCtrl, humanCtrl]);

  console.log(`   LLM:   ${llmCtrl.eventCount} events, ${llmCtrl.durationMs}ms`);
  console.log(`   Human: ${humanCtrl.eventCount} events, ${humanCtrl.durationMs}ms`);
  console.log(`   Sync:  ${multiCtrl.durationMs}ms combined duration`);

  // Test seek
  multiCtrl.seek(Math.round(multiCtrl.durationMs / 2));
  const snaps = multiCtrl.snapshots();
  console.log(`   Seek 50%: LLM page=${snaps[0]![1].page}, Human page=${snaps[1]![1].page}`);

  // ── Step 4: Storage tier test ─────────────────────────────
  console.log("\n💾 Testing storage tiers...");

  const llmCaptureResult: CaptureResult = {
    events: llmEvents,
    targets: llmTape.targets.map((t) => ({ ...t })),
    strings: llmTape.strings.map((s) => ({ ...s })),
    geometry: { viewport: llmTape.viewport, pages: [], fields: [], signaturePads: [] },
    tapeBase64: llmTape.tapeBase64,
    byteLength: llmTape.metrics.byteLength,
    durationMs: llmTape.metrics.maxTimestampMs,
  };

  const embedded = buildEmbeddedPayload(llmCaptureResult, { tapeHash: llmTape.tapeHash, viewport: llmTape.viewport });
  const external = buildExternalPointer(llmCaptureResult, { tapeHash: llmTape.tapeHash, objectCid: "bafybeiabc123test" });
  const estSize = estimateEmbeddedSize(llmCaptureResult);
  const shouldExt = shouldExternalize(llmCaptureResult);

  console.log(`   Embedded: ${embedded.pointer.byteLength} bytes, mode=${embedded.pointer.mode}`);
  console.log(`   External: cid=${external.pointer.objectCid}, mode=${external.pointer.mode}`);
  console.log(`   Est. embedded size: ${estSize} bytes | Externalize? ${shouldExt}`);

  // ── Step 5: Forensic analysis comparison ──────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  🔬 FORENSIC ANALYSIS COMPARISON: LLM vs Human");
  console.log("═══════════════════════════════════════════════════════");

  const llmAnalysis = analyzeSession("LLM", llmTape);
  const humanAnalysis = analyzeSession("Human", humanTape);

  printBehaviorSummary("🤖 LLM", llmAnalysis.behavior);
  printSignatureMotion("🤖 LLM", llmAnalysis.signatureMotion);

  printBehaviorSummary("👤 Human", humanAnalysis.behavior);
  printSignatureMotion("👤 Human", humanAnalysis.signatureMotion);

  // ── Step 6: Heuristic verdict ─────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  ⚖️  VERDICT");
  console.log("═══════════════════════════════════════════════════════");

  const llmVerdict = heuristicVerdict(llmAnalysis.behavior, llmAnalysis.signatureMotion);
  const humanVerdict = heuristicVerdict(humanAnalysis.behavior, humanAnalysis.signatureMotion);

  function printVerdict(label: string, v: typeof llmVerdict) {
    console.log(`\n  ${label}:`);
    console.log(`     Verdict: ${v.verdict.toUpperCase()}`);
    console.log(`     Automation Score: ${v.automationScore}/100`);
    console.log(`     Confidence: ${(v.confidence * 100).toFixed(0)}%`);
    if (Object.keys(v.stats).length > 0) {
      const statsLine = Object.entries(v.stats).map(([k, val]) => `${k}=${typeof val === "number" ? val.toFixed(3) : val}`).join(" | ");
      console.log(`     Stats: ${statsLine}`);
    }
    if (v.flags.length === 0) {
      console.log(`     ✅ No automation flags detected`);
    }
    for (const flag of v.flags) {
      console.log(`     ⚠️  ${flag}`);
    }
  }

  printVerdict("🤖 LLM Signer", llmVerdict);
  printVerdict("👤 Human Signer (LLM-generated)", humanVerdict);

  // ── Step 7: Build AI prompt (for premium path) ────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  🧠 AI ANALYSIS PROMPT (Premium)");
  console.log("═══════════════════════════════════════════════════════");

  const aiInput: ReplayAnalysisInput = {
    behavior: llmAnalysis.behavior,
    signatureMotion: llmAnalysis.signatureMotion,
    gaze: null,
    signerComparison: [{
      signerId: "human-signer",
      behavior: humanAnalysis.behavior,
      signatureMotion: humanAnalysis.signatureMotion,
      gaze: null,
    }],
  };

  const prompt = buildReplayAnalysisPrompt(aiInput);
  console.log(`\n${prompt}`);

  // ── Save outputs ──────────────────────────────────────────
  const output = {
    timestamp: new Date().toISOString(),
    llm: {
      tape: llmTape,
      analysis: llmAnalysis,
      verdict: llmVerdict,
    },
    human: {
      tape: humanTape,
      analysis: humanAnalysis,
      verdict: humanVerdict,
    },
    comparison: {
      llmAutomationScore: llmVerdict.automationScore,
      humanAutomationScore: humanVerdict.automationScore,
      llmCorrect: llmVerdict.verdict === "agent",
      humanCorrect: humanVerdict.verdict !== "human", // LLM-generated fake should NOT pass as human
      bothCorrect: llmVerdict.verdict === "agent" && humanVerdict.verdict !== "human",
    },
    aiPrompt: prompt,
  };

  const outputPath = resolve(OUTPUT_DIR, "forensic-comparison.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n📁 Full output saved to: ${outputPath}`);

  console.log(`\n🌐 To replay a real document visually, run the app and go to:`);
  console.log(`   http://localhost:3100/replay/<documentId>`);

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  📋 SUMMARY");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  LLM detected as:   ${llmVerdict.verdict.toUpperCase()} (score: ${llmVerdict.automationScore}) ${output.comparison.llmCorrect ? "✅" : "❌"}`);
  console.log(`  Fake Human as:     ${humanVerdict.verdict.toUpperCase()} (score: ${humanVerdict.automationScore}) ${output.comparison.humanCorrect ? "✅ caught" : "❌ fooled us"}`);
  console.log(`  Both correct:      ${output.comparison.bothCorrect ? "✅ YES" : "❌ NO"}`);
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(console.error);
