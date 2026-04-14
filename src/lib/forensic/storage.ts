import type { CapturedGeometry, CaptureResult } from "./capture-adapter";
import { REPLAY_ENCODING, REPLAY_FORMAT_LIMITS } from "./replay-format";
import type { ForensicReplayTape } from "./types";

const TIME_QUANTUM_MS = REPLAY_FORMAT_LIMITS.timeQuantumMs;

export interface ReplayStoragePointer {
  mode: "embedded" | "external";
  encoding: typeof REPLAY_ENCODING;
  byteLength: number;
  eventCount: number;
  durationMs: number;
  tapeHash: string;
  objectCid?: string | null;
  objectUrl?: string | null;
  storageProvider?: string | null;
}

export interface EmbeddedReplayPayload {
  pointer: ReplayStoragePointer;
  tape: ForensicReplayTape;
}

export interface ExternalReplayPayload {
  pointer: ReplayStoragePointer;
}

// ── OSS: Embedded storage ───────────────────────────────────
// Stores the full compact replay inside the PDF forensic block.
// Optimizes for minimal byte size.

export function buildEmbeddedPayload(
  capture: CaptureResult,
  opts: { tapeHash: string; viewport: CapturedGeometry["viewport"] },
): EmbeddedReplayPayload {
  const capabilities = new Set<string>();
  for (const e of capture.events) {
    switch (e.type) {
      case "scroll":
        capabilities.add("scroll");
        break;
      case "click":
        capabilities.add("click");
        break;
      case "key":
        capabilities.add("key");
        break;
      case "focus":
        capabilities.add("focus");
        break;
      case "blur":
        capabilities.add("blur");
        break;
      case "visibility":
        capabilities.add("visibility");
        break;
      case "highlight":
        capabilities.add("highlight");
        break;
      case "navigation":
        capabilities.add("navigation");
        break;
      case "page":
        capabilities.add("page");
        break;
      case "modal":
        capabilities.add("modal");
        break;
      case "signatureStart":
      case "signaturePoint":
      case "signatureEnd":
      case "signatureCommit":
      case "signatureClear":
        capabilities.add("signature");
        break;
      case "fieldCommit":
        capabilities.add("field");
        break;
      case "clipboard":
        capabilities.add("clipboard");
        break;
      case "contextMenu":
        capabilities.add("contextmenu");
        break;
    }
  }

  let sigStrokeCount = 0;
  let sigPointCount = 0;
  let clipCount = 0;
  for (const e of capture.events) {
    if (e.type === "signatureStart") sigStrokeCount++;
    if (e.type === "signaturePoint" || e.type === "signatureStart") sigPointCount++;
    if (e.type === "clipboard") clipCount++;
  }

  const tape: ForensicReplayTape = {
    version: 1,
    encoding: REPLAY_ENCODING,
    timeQuantumMs: TIME_QUANTUM_MS,
    viewport: opts.viewport,
    targets: capture.targets.map((t) => ({
      id: t.id,
      hash: t.hash,
      descriptor: t.descriptor,
    })),
    strings: capture.strings.map((s) => ({
      id: s.id,
      kind: s.kind,
      hash: s.hash,
      value: s.value,
    })),
    tapeBase64: capture.tapeBase64,
    tapeHash: opts.tapeHash,
    capabilities: [...capabilities].sort() as ForensicReplayTape["capabilities"],
    metrics: {
      eventCount: capture.events.length,
      byteLength: capture.byteLength,
      targetCount: capture.targets.length,
      stringCount: capture.strings.length,
      signatureStrokeCount: sigStrokeCount,
      signaturePointCount: sigPointCount,
      clipboardEventCount: clipCount,
      maxTimestampMs: capture.durationMs,
      gazePointCount: 0,
      gazeFixationCount: 0,
      gazeBlinkCount: 0,
    },
  };

  return {
    pointer: {
      mode: "embedded",
      encoding: REPLAY_ENCODING,
      byteLength: capture.byteLength,
      eventCount: capture.events.length,
      durationMs: capture.durationMs,
      tapeHash: opts.tapeHash,
    },
    tape,
  };
}

// ── Premium: External storage ───────────────────────────────
// Stores full replay externally (IPFS / object storage).
// PDF gets only a lightweight pointer with hash.

export function buildExternalPointer(
  capture: CaptureResult,
  opts: {
    tapeHash: string;
    objectCid?: string | null;
    objectUrl?: string | null;
    storageProvider?: string | null;
  },
): ExternalReplayPayload {
  return {
    pointer: {
      mode: "external",
      encoding: REPLAY_ENCODING,
      byteLength: capture.byteLength,
      eventCount: capture.events.length,
      durationMs: capture.durationMs,
      tapeHash: opts.tapeHash,
      objectCid: opts.objectCid ?? null,
      objectUrl: opts.objectUrl ?? null,
      storageProvider: opts.storageProvider ?? null,
    },
  };
}

// Estimate size of the embedded payload (for deciding whether to externalize)
export function estimateEmbeddedSize(capture: CaptureResult): number {
  // tape bytes + JSON overhead for targets/strings (~50 bytes per entry)
  return capture.byteLength + capture.targets.length * 50 + capture.strings.length * 80 + 256; // fixed overhead
}

// Threshold: externalize if embedded payload exceeds this (64KB)
export const EXTERNALIZE_THRESHOLD_BYTES = 64 * 1024;

export function shouldExternalize(capture: CaptureResult): boolean {
  return estimateEmbeddedSize(capture) > EXTERNALIZE_THRESHOLD_BYTES;
}
