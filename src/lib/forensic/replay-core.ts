import type { TimedSignatureStroke } from "./types";
import {
  decodeReplayEventsSync,
  decodeTimedSignatureSync,
  encodeReplayEventsSync,
  encodeTimedSignatureSync,
  type ForensicReplayEncodedEvent,
  type ForensicReplayEncodedPayload,
} from "./replay-codec";

export type ForensicReplayCoreKind = "wasm" | "ts";

export interface ForensicReplayCore {
  kind: ForensicReplayCoreKind;
  encodeReplayEvents(events: ForensicReplayEncodedEvent[]): Promise<ForensicReplayEncodedPayload>;
  decodeReplayEvents(tapeBase64: string): Promise<ForensicReplayEncodedEvent[]>;
  encodeSignature(strokes: TimedSignatureStroke[]): Promise<string>;
  decodeSignature(encoded: string): Promise<TimedSignatureStroke[]>;
}

type ForensicReplayWasmModule = {
  default: () => Promise<unknown>;
  encode_replay_events: (events: ForensicReplayEncodedEvent[]) => ForensicReplayEncodedPayload;
  decode_replay_events: (tapeBase64: string) => ForensicReplayEncodedEvent[];
  encode_signature: (strokes: TimedSignatureStroke[]) => string;
  decode_signature: (encoded: string) => TimedSignatureStroke[];
};

export type ForensicReplayWasmLoader = () => Promise<ForensicReplayCore>;

let configuredWasmLoader: ForensicReplayWasmLoader | null = null;
let corePromise: Promise<ForensicReplayCore> | null = null;

export function createTypeScriptReplayCore(): ForensicReplayCore {
  return {
    kind: "ts",
    encodeReplayEvents: async (events) => encodeReplayEventsSync(events),
    decodeReplayEvents: async (tapeBase64) => decodeReplayEventsSync(tapeBase64),
    encodeSignature: async (strokes) => encodeTimedSignatureSync(strokes),
    decodeSignature: async (encoded) => decodeTimedSignatureSync(encoded),
  };
}

async function loadDefaultWasmReplayCore(): Promise<ForensicReplayCore> {
  if (typeof window === "undefined" || typeof WebAssembly === "undefined") {
    throw new Error("Browser WASM runtime unavailable");
  }

  const wasmModule = (await import("./generated/forensic_core.js")) as ForensicReplayWasmModule;
  await wasmModule.default();

  return {
    kind: "wasm",
    encodeReplayEvents: async (events) => wasmModule.encode_replay_events(events),
    decodeReplayEvents: async (tapeBase64) => wasmModule.decode_replay_events(tapeBase64),
    encodeSignature: async (strokes) => wasmModule.encode_signature(strokes),
    decodeSignature: async (encoded) => wasmModule.decode_signature(encoded),
  };
}

/**
 * Fallback contract:
 * - callers talk to a single core interface
 * - WASM may replace TS for performance
 * - if WASM fails, callers still get deterministic TS behavior
 */
export async function loadForensicReplayCore(
  wasmLoader: ForensicReplayWasmLoader = loadDefaultWasmReplayCore,
): Promise<ForensicReplayCore> {
  try {
    return await wasmLoader();
  } catch {
    return createTypeScriptReplayCore();
  }
}

export async function resolveForensicReplayCore() {
  if (!corePromise) {
    corePromise = loadForensicReplayCore(configuredWasmLoader ?? loadDefaultWasmReplayCore);
  }
  return corePromise;
}

export function warmForensicReplayCore() {
  void resolveForensicReplayCore();
}

export function configureForensicReplayWasmLoader(loader?: ForensicReplayWasmLoader) {
  configuredWasmLoader = loader ?? null;
  corePromise = null;
}

export function resetForensicReplayCore() {
  configuredWasmLoader = null;
  corePromise = null;
}
