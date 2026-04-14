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

import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import type { CaptureResult } from "~/lib/forensic/capture-adapter";
import { TSMultiSignerController, TSPlaybackController } from "~/lib/forensic/playback-controller";
import { encodeReplayEventsSync, type ForensicReplayEncodedEvent } from "~/lib/forensic/replay-codec";
import { REPLAY_ENCODING, REPLAY_FORMAT_LIMITS } from "~/lib/forensic/replay-format";
import {
  buildEmbeddedPayload,
  buildExternalPointer,
  estimateEmbeddedSize,
  shouldExternalize,
} from "~/lib/forensic/storage";
import type { ForensicReplayTape } from "~/lib/forensic/types";

// Premium AI analysis (only imported for this test)
import { buildReplayAnalysisPrompt, type ReplayAnalysisInput } from "~/premium/ai/replay-analysis";

import {
  analyzeSession,
  heuristicVerdict,
  printBehaviorSummary,
  printSignatureMotion,
  type VerdictResult,
} from "./test-forensic-replay-analysis";
import { generateHumanSignerEvents, generateLLMSignerEvents } from "./test-forensic-replay-sessions";

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

/** Register a target if not already tracked */
function registerTarget(
  id: number,
  prefix: string,
  targetIndex: Map<number, boolean>,
  targets: ForensicReplayTape["targets"],
) {
  if (targetIndex.has(id)) return;
  targetIndex.set(id, true);
  targets.push({ id, hash: fnv1a64(`t${id}`), descriptor: `${prefix}-${id}` });
}

/** Register a string if not already tracked */
function registerString(opts: {
  id: number;
  kind: string;
  hashPrefix: string;
  value: string;
  stringIndex: Map<number, boolean>;
  strings: ForensicReplayTape["strings"];
}) {
  if (opts.stringIndex.has(opts.id)) return;
  opts.stringIndex.set(opts.id, true);
  opts.strings.push({
    id: opts.id,
    kind: opts.kind,
    hash: fnv1a64(`${opts.hashPrefix}${opts.id}`),
    value: opts.value,
  });
}

/** Capability-only event types that just add a cap string */
const CAP_ONLY_TYPES: Record<string, string> = {
  scroll: "scroll",
  focus: "focus",
  blur: "blur",
  visibility: "visibility",
  highlight: "highlight",
  navigation: "navigation",
  page: "page",
  modal: "modal",
  contextMenu: "contextmenu",
};

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

    const capOnly = CAP_ONLY_TYPES[e.type];
    if (capOnly) {
      caps.add(capOnly);
      continue;
    }

    switch (e.type) {
      case "click":
        caps.add("click");
        registerTarget(e.targetId, "target", targetIndex, targets);
        break;
      case "key":
        caps.add("key");
        registerTarget(e.targetId, "target", targetIndex, targets);
        registerString({
          id: e.keyId,
          kind: "key",
          hashPrefix: "k",
          value: `key-${e.keyId}`,
          stringIndex,
          strings,
        });
        break;
      case "signatureStart":
        caps.add("signature");
        sigStrokes++;
        sigPoints++;
        break;
      case "signaturePoint":
        sigPoints++;
        break;
      case "signatureCommit":
        registerString({
          id: e.signatureId,
          kind: "signature",
          hashPrefix: "sig",
          value: "pm-sig-v1:encoded",
          stringIndex,
          strings,
        });
        break;
      case "fieldCommit":
        caps.add("field");
        registerTarget(e.targetId, "field", targetIndex, targets);
        registerString({
          id: e.valueId,
          kind: "value",
          hashPrefix: "v",
          value: `value-${e.valueId}`,
          stringIndex,
          strings,
        });
        break;
      case "clipboard":
        caps.add("clipboard");
        clipCount++;
        break;
    }
  }

  return {
    version: 1,
    encoding: REPLAY_ENCODING,
    timeQuantumMs: TIME_Q,
    viewport: {
      width: 1280,
      height: 900,
      devicePixelRatio: 2,
      scrollWidth: 1280,
      scrollHeight: 4000,
    },
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

// ── Synthetic "human" session (--skip-human mode) ────────────

function generateSyntheticHumanEvents(): ForensicReplayEncodedEvent[] {
  const ev: ForensicReplayEncodedEvent[] = [];
  const q = (ms: number) => Math.round(ms / TIME_Q);

  // Natural scroll with varied timing
  const scrollData = [
    [800, 120],
    [1200, 380],
    [300, 350],
    [2000, 900],
  ] as const;
  for (const [ms, y] of scrollData) {
    ev.push({ type: "scroll", delta: q(ms), scrollY: y, scrollMax: 4000 });
  }

  ev.push({ type: "page", delta: q(3000), page: 1, totalPages: 3 });
  ev.push({ type: "scroll", delta: q(1500), scrollY: 1400, scrollMax: 4000 });
  ev.push({ type: "page", delta: q(4000), page: 2, totalPages: 3 });
  ev.push({ type: "scroll", delta: q(2500), scrollY: 2200, scrollMax: 4000 });
  ev.push({ type: "visibility", delta: q(5000), hidden: true });
  ev.push({ type: "visibility", delta: q(8000), hidden: false });
  ev.push({ type: "page", delta: q(2000), page: 3, totalPages: 3 });
  ev.push({ type: "scroll", delta: q(1800), scrollY: 3200, scrollMax: 4000 });

  // Name field with natural variation
  ev.push({
    type: "click",
    delta: q(3000),
    targetId: 1,
    x: 412,
    y: 305,
    button: 0,
  });
  ev.push({ type: "focus", delta: q(200), targetId: 1 });
  const delays = [120, 85, 150, 95, 180, 70, 110, 200, 90, 130];
  for (let i = 0; i < 10; i++) {
    ev.push({
      type: "key",
      delta: q(delays[i] ?? 120),
      targetId: 1,
      keyId: i + 1,
      modifiers: 0,
    });
  }
  ev.push({ type: "fieldCommit", delta: q(500), targetId: 1, valueId: 1 });
  ev.push({ type: "blur", delta: q(300), targetId: 1 });

  // Date field
  ev.push({
    type: "click",
    delta: q(1500),
    targetId: 2,
    x: 398,
    y: 382,
    button: 0,
  });
  ev.push({ type: "focus", delta: q(150), targetId: 2 });
  const dateDelays = [110, 140, 80, 170, 90, 200, 100, 130, 95, 160];
  for (let i = 0; i < 10; i++) {
    ev.push({
      type: "key",
      delta: q(dateDelays[i] ?? 120),
      targetId: 2,
      keyId: 20 + i,
      modifiers: 0,
    });
  }
  ev.push({ type: "fieldCommit", delta: q(400), targetId: 2, valueId: 2 });

  // Signature with natural variation
  ev.push({
    type: "click",
    delta: q(2000),
    targetId: 3,
    x: 195,
    y: 510,
    button: 0,
  });
  pushSyntheticStroke(ev, {
    strokeId: 1,
    baseX: 48,
    baseY: 52,
    startPressure: 110,
    pressures: [120, 135, 150, 140, 128, 145, 160, 138, 122, 130, 142, 155, 135, 118, 140, 148, 132, 125, 138, 145],
  });
  ev.push({ type: "signatureEnd", delta: q(50), strokeId: 1 });

  pushSyntheticStroke(ev, {
    strokeId: 2,
    baseX: 55,
    baseY: 68,
    startPressure: 105,
    pressures: [115, 130, 148, 155, 142, 128, 138, 150, 140, 125, 135, 145, 130, 120],
  });
  ev.push({ type: "signatureEnd", delta: q(40), strokeId: 2 });
  ev.push({
    type: "signatureCommit",
    delta: q(600),
    targetId: 3,
    signatureId: 1,
  });

  return ev;
}

function pushSyntheticStroke(
  ev: ForensicReplayEncodedEvent[],
  opts: {
    strokeId: number;
    baseX: number;
    baseY: number;
    startPressure: number;
    pressures: number[];
  },
) {
  const { strokeId, baseX, baseY, startPressure, pressures } = opts;
  const q = (ms: number) => Math.round(ms / TIME_Q);
  ev.push({
    type: "signatureStart",
    delta: strokeId === 1 ? q(800) : q(300),
    targetId: 3,
    strokeId,
    x: baseX,
    y: baseY,
    pressure: startPressure,
  });
  for (let i = 0; i < pressures.length; i++) {
    const dx = Math.round(4 + Math.random() * 6);
    const dy = Math.round(Math.random() * 12 - 6);
    const dt = Math.round((12 + Math.random() * 20) / TIME_Q);
    ev.push({
      type: "signaturePoint",
      delta: dt,
      strokeId,
      x: baseX + (i + 1) * dx,
      y: baseY + (i + 1) * dy,
      pressure: pressures[i]!,
    });
  }
}

// ── Verdict printer ──────────────────────────────────────────

function printVerdict(label: string, v: VerdictResult) {
  console.log(`\n  ${label}:`);
  console.log(`     Verdict: ${v.verdict.toUpperCase()}`);
  console.log(`     Automation Score: ${v.automationScore}/100`);
  console.log(`     Confidence: ${(v.confidence * 100).toFixed(0)}%`);
  if (Object.keys(v.stats).length > 0) {
    const statsLine = Object.entries(v.stats)
      .map(([k, val]) => `${k}=${typeof val === "number" ? val.toFixed(3) : val}`)
      .join(" | ");
    console.log(`     Stats: ${statsLine}`);
  }
  if (v.flags.length === 0) {
    console.log("     ✅ No automation flags detected");
  }
  for (const flag of v.flags) {
    console.log(`     ⚠️  ${flag}`);
  }
}

function testStorageTiers(llmEvents: ForensicReplayEncodedEvent[], llmTape: ForensicReplayTape) {
  console.log("\n💾 Testing storage tiers...");
  const llmCaptureResult: CaptureResult = {
    events: llmEvents,
    targets: llmTape.targets.map((t) => ({ ...t })),
    strings: llmTape.strings.map((s) => ({ ...s })),
    geometry: {
      viewport: llmTape.viewport,
      pages: [],
      fields: [],
      signaturePads: [],
    },
    tapeBase64: llmTape.tapeBase64,
    byteLength: llmTape.metrics.byteLength,
    durationMs: llmTape.metrics.maxTimestampMs,
  };
  const embedded = buildEmbeddedPayload(llmCaptureResult, {
    tapeHash: llmTape.tapeHash,
    viewport: llmTape.viewport,
  });
  const external = buildExternalPointer(llmCaptureResult, {
    tapeHash: llmTape.tapeHash,
    objectCid: "bafybeiabc123test",
  });
  const estSize = estimateEmbeddedSize(llmCaptureResult);
  const shouldExt = shouldExternalize(llmCaptureResult);
  console.log(`   Embedded: ${embedded.pointer.byteLength} bytes, mode=${embedded.pointer.mode}`);
  console.log(`   External: cid=${external.pointer.objectCid}, mode=${external.pointer.mode}`);
  console.log(`   Est. embedded size: ${estSize} bytes | Externalize? ${shouldExt}`);
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
  console.log(
    `   Events: ${llmEvents.length} | Bytes: ${llmTape.metrics.byteLength} | Duration: ${llmTape.metrics.maxTimestampMs}ms`,
  );

  // ── Step 2: Human signer session ──────────────────────────
  let humanTape: ForensicReplayTape;
  if (skipHuman) {
    console.log("\n👤 Skipping human signer (--skip-human)");
    const humanEvents = generateSyntheticHumanEvents();
    humanTape = makeTape(humanEvents);
    console.log(
      `   Events: ${humanEvents.length} | Bytes: ${humanTape.metrics.byteLength} | Duration: ${humanTape.metrics.maxTimestampMs}ms`,
    );
  } else {
    console.log("\n👤 Your turn! Signing as a human...\n");
    const humanEvents = await generateHumanSignerEvents();
    humanTape = makeTape(humanEvents);
    console.log(
      `   Events: ${humanEvents.length} | Bytes: ${humanTape.metrics.byteLength} | Duration: ${humanTape.metrics.maxTimestampMs}ms`,
    );
  }

  // ── Step 3: Playback controller test ──────────────────────
  console.log("\n⏯️  Testing playback controllers...");
  const llmCtrl = TSPlaybackController.fromTape(llmTape.tapeBase64, 0);
  const humanCtrl = TSPlaybackController.fromTape(humanTape.tapeBase64, 1);
  const multiCtrl = new TSMultiSignerController([llmCtrl, humanCtrl]);
  console.log(`   LLM:   ${llmCtrl.eventCount} events, ${llmCtrl.durationMs}ms`);
  console.log(`   Human: ${humanCtrl.eventCount} events, ${humanCtrl.durationMs}ms`);
  console.log(`   Sync:  ${multiCtrl.durationMs}ms combined duration`);
  multiCtrl.seek(Math.round(multiCtrl.durationMs / 2));
  const snaps = multiCtrl.snapshots();
  console.log(`   Seek 50%: LLM page=${snaps[0]![1].page}, Human page=${snaps[1]![1].page}`);

  // ── Step 4: Storage tier test ─────────────────────────────
  testStorageTiers(llmEvents, llmTape);

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
    signerComparison: [
      {
        signerId: "human-signer",
        behavior: humanAnalysis.behavior,
        signatureMotion: humanAnalysis.signatureMotion,
        gaze: null,
      },
    ],
  };
  const prompt = buildReplayAnalysisPrompt(aiInput);
  console.log(`\n${prompt}`);

  // ── Save outputs ──────────────────────────────────────────
  const output = {
    timestamp: new Date().toISOString(),
    llm: { tape: llmTape, analysis: llmAnalysis, verdict: llmVerdict },
    human: { tape: humanTape, analysis: humanAnalysis, verdict: humanVerdict },
    comparison: {
      llmAutomationScore: llmVerdict.automationScore,
      humanAutomationScore: humanVerdict.automationScore,
      llmCorrect: llmVerdict.verdict === "agent",
      humanCorrect: humanVerdict.verdict !== "human",
      bothCorrect: llmVerdict.verdict === "agent" && humanVerdict.verdict !== "human",
    },
    aiPrompt: prompt,
  };
  const outputPath = resolve(OUTPUT_DIR, "forensic-comparison.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n📁 Full output saved to: ${outputPath}`);
  console.log(`\n🌐 To replay a real document visually, run the app and go to:`);
  console.log("   http://localhost:3100/replay/<documentId>");

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  📋 SUMMARY");
  console.log("═══════════════════════════════════════════════════════");
  console.log(
    `  LLM detected as:   ${llmVerdict.verdict.toUpperCase()} (score: ${llmVerdict.automationScore}) ${output.comparison.llmCorrect ? "✅" : "❌"}`,
  );
  console.log(
    `  Fake Human as:     ${humanVerdict.verdict.toUpperCase()} (score: ${humanVerdict.automationScore}) ${output.comparison.humanCorrect ? "✅ caught" : "❌ fooled us"}`,
  );
  console.log(`  Both correct:      ${output.comparison.bothCorrect ? "✅ YES" : "❌ NO"}`);
  console.log("═══════════════════════════════════════════════════════\n");
}

main().catch(console.error);
