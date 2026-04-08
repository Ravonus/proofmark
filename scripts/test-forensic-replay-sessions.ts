/**
 * Session generators for forensic replay test — extracted from test-forensic-replay.ts
 * for file-length compliance.
 */

import * as readline from "readline";
import type { ForensicReplayEncodedEvent } from "~/lib/forensic/replay-codec";
import { REPLAY_FORMAT_LIMITS } from "~/lib/forensic/replay-format";

const TIME_Q = REPLAY_FORMAT_LIMITS.timeQuantumMs;

// ── LLM Signer: synthetic robotic session ───────────────────

export function generateLLMSignerEvents(): ForensicReplayEncodedEvent[] {
  const events: ForensicReplayEncodedEvent[] = [];

  // Robotic pattern: instant start, perfectly uniform timing, no hesitation
  // Scrolls at perfectly even intervals
  for (let i = 0; i < 8; i++) {
    events.push({
      type: "scroll",
      delta: Math.round(250 / TIME_Q),
      scrollY: i * 500,
      scrollMax: 4000,
    });
  }

  // Navigate pages with exactly uniform timing
  for (let p = 1; p <= 3; p++) {
    events.push({
      type: "page",
      delta: Math.round(100 / TIME_Q),
      page: p,
      totalPages: 3,
    });
  }

  // Click on field -- zero hesitation
  events.push({
    type: "click",
    delta: Math.round(50 / TIME_Q),
    targetId: 1,
    x: 400,
    y: 300,
    button: 0,
  });
  events.push({ type: "focus", delta: 1, targetId: 1 });

  // Type name with perfectly uniform 30ms intervals (superhuman cadence)
  const name = "John Smith";
  for (let i = 0; i < name.length; i++) {
    events.push({
      type: "key",
      delta: Math.round(30 / TIME_Q),
      targetId: 1,
      keyId: i + 1,
      modifiers: 0,
    });
  }

  // Field commit -- instant
  events.push({ type: "fieldCommit", delta: 1, targetId: 1, valueId: 1 });

  // Click on date field -- same uniform pattern
  events.push({
    type: "click",
    delta: Math.round(50 / TIME_Q),
    targetId: 2,
    x: 400,
    y: 380,
    button: 0,
  });
  events.push({ type: "focus", delta: 1, targetId: 2 });

  // Type date -- same perfect 30ms rhythm
  const date = "2026-03-28";
  for (let i = 0; i < date.length; i++) {
    events.push({
      type: "key",
      delta: Math.round(30 / TIME_Q),
      targetId: 2,
      keyId: 20 + i,
      modifiers: 0,
    });
  }
  events.push({ type: "fieldCommit", delta: 1, targetId: 2, valueId: 2 });

  // Signature -- perfectly linear, no pressure variation, no hesitation
  events.push({
    type: "click",
    delta: Math.round(80 / TIME_Q),
    targetId: 3,
    x: 200,
    y: 500,
    button: 0,
  });

  // Stroke 1: perfectly straight horizontal line
  events.push({
    type: "signatureStart",
    delta: Math.round(20 / TIME_Q),
    targetId: 3,
    strokeId: 1,
    x: 50,
    y: 50,
    pressure: 128,
  });
  for (let i = 1; i <= 30; i++) {
    events.push({
      type: "signaturePoint",
      delta: Math.round(8 / TIME_Q),
      strokeId: 1,
      x: 50 + i * 5,
      y: 50,
      pressure: 128,
    });
  }
  events.push({ type: "signatureEnd", delta: 1, strokeId: 1 });

  // Stroke 2: perfectly straight diagonal -- same pressure, same speed
  events.push({
    type: "signatureStart",
    delta: Math.round(20 / TIME_Q),
    targetId: 3,
    strokeId: 2,
    x: 50,
    y: 70,
    pressure: 128,
  });
  for (let i = 1; i <= 20; i++) {
    events.push({
      type: "signaturePoint",
      delta: Math.round(8 / TIME_Q),
      strokeId: 2,
      x: 50 + i * 6,
      y: 70 - i * 2,
      pressure: 128,
    });
  }
  events.push({ type: "signatureEnd", delta: 1, strokeId: 2 });

  events.push({
    type: "signatureCommit",
    delta: Math.round(10 / TIME_Q),
    targetId: 3,
    signatureId: 1,
  });

  return events;
}

// ── Human Signer: interactive terminal capture ──────────────

export function generateHumanSignerEvents(): Promise<ForensicReplayEncodedEvent[]> {
  return new Promise((resolve) => {
    const events: ForensicReplayEncodedEvent[] = [];
    const startedAt = Date.now();
    let lastAt = 0;

    function elapsed() {
      return Date.now() - startedAt;
    }
    function delta() {
      const now = elapsed();
      const d = Math.max(0, Math.round((now - lastAt) / TIME_Q));
      lastAt = now;
      return d;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("\n╔════════════════════════════════════════════════════════╗");
    console.log("║         FORENSIC REPLAY — Human Signing Test          ║");
    console.log("╠════════════════════════════════════════════════════════╣");
    console.log("║  This simulates signing a contract. I'll record your  ║");
    console.log("║  timing patterns, keystroke rhythm, and behavior.     ║");
    console.log("║                                                       ║");
    console.log("║  Just answer the prompts naturally — take your time.  ║");
    console.log("╚════════════════════════════════════════════════════════╝\n");

    console.log("📄 Contract: Mutual Non-Disclosure Agreement");
    console.log("   Between: ProofMark Labs and [You]");
    console.log("   Pages: 3 | Term: 24 months\n");

    events.push({ type: "page", delta: delta(), page: 1, totalPages: 3 });

    const steps = [
      () => buildReadPageStep(rl, events, delta, { pageNum: 1, scrollY1: 400, scrollY2: 900, nextPage: 2 }, nextStep),
      () => buildReadPageStep(rl, events, delta, { pageNum: 2, scrollY1: 1800, scrollY2: 2400, nextPage: 3 }, nextStep),
      () => buildReadPage3Step(rl, events, delta, nextStep),
      () => buildNameFieldStep(rl, events, delta, nextStep),
      () => buildDateFieldStep(rl, events, delta, nextStep),
      () => buildSignatureStep(rl, events, delta, nextStep),
      () => buildReviewStep(rl, events, delta, nextStep),
      () => {
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

// ── Step builders (reduce generateHumanSignerEvents complexity) ──

function buildReadPageStep(
  rl: readline.Interface,
  events: ForensicReplayEncodedEvent[],
  delta: () => number,
  opts: {
    pageNum: number;
    scrollY1: number;
    scrollY2: number;
    nextPage: number;
  },
  next: () => void,
) {
  const { pageNum, scrollY1, scrollY2, nextPage } = opts;
  rl.question(`📖 Read page ${pageNum}... Press Enter when done reading > `, () => {
    events.push({
      type: "scroll",
      delta: delta(),
      scrollY: scrollY1,
      scrollMax: 4000,
    });
    events.push({
      type: "scroll",
      delta: delta(),
      scrollY: scrollY2,
      scrollMax: 4000,
    });
    events.push({
      type: "page",
      delta: delta(),
      page: nextPage,
      totalPages: 3,
    });
    const labels: Record<number, string> = {
      2: "\n📄 Page 2: Obligations & Restrictions\n",
      3: "\n📄 Page 3: Signature Block\n",
    };
    if (labels[nextPage]) console.log(labels[nextPage]);
    next();
  });
}

function buildReadPage3Step(
  rl: readline.Interface,
  events: ForensicReplayEncodedEvent[],
  delta: () => number,
  next: () => void,
) {
  rl.question("📖 Read page 3... Press Enter when done reading > ", () => {
    events.push({
      type: "scroll",
      delta: delta(),
      scrollY: 3200,
      scrollMax: 4000,
    });
    events.push({
      type: "scroll",
      delta: delta(),
      scrollY: 3800,
      scrollMax: 4000,
    });
    console.log("\n✏️  Now fill out the signature fields:\n");
    next();
  });
}

function buildNameFieldStep(
  rl: readline.Interface,
  events: ForensicReplayEncodedEvent[],
  delta: () => number,
  next: () => void,
) {
  events.push({
    type: "click",
    delta: delta(),
    targetId: 1,
    x: 400,
    y: 300,
    button: 0,
  });
  events.push({ type: "focus", delta: delta(), targetId: 1 });
  rl.question("  Full Name: ", (name) => {
    for (let i = 0; i < name.length; i++) {
      events.push({
        type: "key",
        delta: delta(),
        targetId: 1,
        keyId: i + 1,
        modifiers: 0,
      });
    }
    events.push({
      type: "fieldCommit",
      delta: delta(),
      targetId: 1,
      valueId: 1,
    });
    events.push({ type: "blur", delta: delta(), targetId: 1 });
    next();
  });
}

function buildDateFieldStep(
  rl: readline.Interface,
  events: ForensicReplayEncodedEvent[],
  delta: () => number,
  next: () => void,
) {
  events.push({
    type: "click",
    delta: delta(),
    targetId: 2,
    x: 400,
    y: 380,
    button: 0,
  });
  events.push({ type: "focus", delta: delta(), targetId: 2 });
  rl.question("  Date (YYYY-MM-DD): ", (date) => {
    for (let i = 0; i < date.length; i++) {
      events.push({
        type: "key",
        delta: delta(),
        targetId: 2,
        keyId: 20 + i,
        modifiers: 0,
      });
    }
    events.push({
      type: "fieldCommit",
      delta: delta(),
      targetId: 2,
      valueId: 2,
    });
    events.push({ type: "blur", delta: delta(), targetId: 2 });
    next();
  });
}

function buildSignatureStep(
  rl: readline.Interface,
  events: ForensicReplayEncodedEvent[],
  delta: () => number,
  next: () => void,
) {
  console.log("\n🖊️  Draw your signature! Type characters to simulate pen strokes.");
  console.log("   (Each character = a stroke point. Type naturally, then press Enter)\n");

  events.push({
    type: "click",
    delta: delta(),
    targetId: 3,
    x: 200,
    y: 500,
    button: 0,
  });

  rl.question("  Signature stroke 1: ", (stroke1) => {
    pushStrokeEvents(events, delta, {
      strokeId: 1,
      baseX: 50,
      baseY: 50,
      input: stroke1,
    });

    rl.question("  Signature stroke 2: ", (stroke2) => {
      pushStrokeEvents(events, delta, {
        strokeId: 2,
        baseX: 50,
        baseY: 70,
        input: stroke2,
      });
      events.push({
        type: "signatureCommit",
        delta: delta(),
        targetId: 3,
        signatureId: 1,
      });
      console.log("\n✅ Signature captured!\n");
      next();
    });
  });
}

function pushStrokeEvents(
  events: ForensicReplayEncodedEvent[],
  delta: () => number,
  opts: { strokeId: number; baseX: number; baseY: number; input: string },
) {
  const { strokeId, baseX, baseY, input } = opts;
  events.push({
    type: "signatureStart",
    delta: delta(),
    targetId: 3,
    strokeId,
    x: baseX,
    y: baseY,
    pressure: Math.round(Math.random() * 60 + 90),
  });
  for (let i = 0; i < input.length; i++) {
    const pressure = Math.round(Math.random() * 80 + 80);
    const dx = Math.round(Math.random() * 8 + 2);
    const dy = Math.round(Math.random() * 10 - 5);
    events.push({
      type: "signaturePoint",
      delta: delta(),
      strokeId,
      x: baseX + (i + 1) * dx,
      y: baseY + (i + 1) * dy,
      pressure,
    });
  }
  events.push({ type: "signatureEnd", delta: delta(), strokeId });
}

function buildReviewStep(
  rl: readline.Interface,
  events: ForensicReplayEncodedEvent[],
  delta: () => number,
  next: () => void,
) {
  rl.question("🔍 Want to review the document before submitting? (y/n): ", (answer) => {
    if (answer.toLowerCase() === "y") {
      events.push({
        type: "scroll",
        delta: delta(),
        scrollY: 0,
        scrollMax: 4000,
      });
      events.push({
        type: "scroll",
        delta: delta(),
        scrollY: 1500,
        scrollMax: 4000,
      });
      for (let p = 1; p <= 3; p++) {
        events.push({ type: "page", delta: delta(), page: p, totalPages: 3 });
      }
    }
    next();
  });
}
