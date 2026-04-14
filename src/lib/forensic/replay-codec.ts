import {
  type REPLAY_CLIPBOARD_ACTION_CODES,
  REPLAY_FORMAT_LIMITS,
  type REPLAY_NAV_DIRECTION_CODES,
  SIGNATURE_ENCODING,
} from "./replay-format";
import type { TimedSignatureStroke } from "./types";

type ReplayNavigationDirection = keyof typeof REPLAY_NAV_DIRECTION_CODES;
type ReplayClipboardAction = keyof typeof REPLAY_CLIPBOARD_ACTION_CODES;

export { decodeReplayEventsSync } from "./replay-codec-decode";
export { encodeReplayEventsSync } from "./replay-codec-encode";

const TIME_QUANTUM_MS = REPLAY_FORMAT_LIMITS.timeQuantumMs;

export type ForensicReplayEncodedEvent =
  | { type: "scroll"; delta: number; scrollY: number; scrollMax: number }
  | {
      type: "click";
      delta: number;
      targetId: number;
      x: number;
      y: number;
      button: number;
    }
  | {
      type: "key";
      delta: number;
      targetId: number;
      keyId: number;
      modifiers: number;
    }
  | { type: "focus"; delta: number; targetId: number }
  | { type: "blur"; delta: number; targetId: number }
  | { type: "visibility"; delta: number; hidden: boolean }
  | { type: "highlight"; delta: number; targetId: number; labelId: number }
  | {
      type: "navigation";
      delta: number;
      direction: ReplayNavigationDirection;
      targetId: number;
      index: number;
    }
  | { type: "page"; delta: number; page: number; totalPages: number }
  | { type: "modal"; delta: number; nameId: number; open: boolean }
  | {
      type: "signatureStart";
      delta: number;
      targetId: number;
      strokeId: number;
      x: number;
      y: number;
      pressure: number;
    }
  | {
      type: "signaturePoint";
      delta: number;
      strokeId: number;
      x: number;
      y: number;
      pressure: number;
    }
  | { type: "signatureEnd"; delta: number; strokeId: number }
  | {
      type: "signatureCommit";
      delta: number;
      targetId: number;
      signatureId: number;
    }
  | { type: "signatureClear"; delta: number; targetId: number }
  | { type: "fieldCommit"; delta: number; targetId: number; valueId: number }
  | {
      type: "clipboard";
      delta: number;
      action: ReplayClipboardAction;
      targetId: number;
      summaryId: number;
    }
  | {
      type: "contextMenu";
      delta: number;
      targetId: number;
      x: number;
      y: number;
    }
  // v2 opcodes
  | { type: "mouseMove"; delta: number; dx: number; dy: number }
  | { type: "hoverDwell"; delta: number; targetId: number; durationMs: number }
  | { type: "viewportResize"; delta: number; width: number; height: number }
  | {
      type: "touchStart";
      delta: number;
      x: number;
      y: number;
      radius: number;
      force: number;
    }
  | {
      type: "touchMove";
      delta: number;
      dx: number;
      dy: number;
      radius: number;
      force: number;
    }
  | { type: "touchEnd"; delta: number }
  | {
      type: "fieldCorrection";
      delta: number;
      targetId: number;
      correctionKind: number;
      count: number;
    }
  | {
      type: "scrollMomentum";
      delta: number;
      velocity: number;
      deceleration: number;
    }
  // v3 opcodes — eye gaze tracking
  | {
      type: "gazePoint";
      delta: number;
      x: number;
      y: number;
      confidence: number;
    }
  | {
      type: "gazeFixation";
      delta: number;
      x: number;
      y: number;
      durationMs: number;
      targetId: number;
    }
  | {
      type: "gazeSaccade";
      delta: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      velocityDegPerS: number;
    }
  | { type: "gazeBlink"; delta: number; durationMs: number }
  | {
      type: "gazeCalibration";
      delta: number;
      accuracy: number;
      pointCount: number;
    }
  | { type: "gazeLost"; delta: number; reason: number };

export interface ForensicReplayEncodedPayload {
  tapeBase64: string;
  byteLength: number;
}

function round(value: number) {
  return Math.round(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function writeVarUint(bytes: number[], value: number) {
  let next = Math.max(0, Math.floor(value));
  while (next >= 0x80) {
    bytes.push((next & 0x7f) | 0x80);
    next >>>= 7;
  }
  bytes.push(next);
}

function writeVarInt(bytes: number[], value: number) {
  const zigzag = value < 0 ? -value * 2 - 1 : value * 2;
  writeVarUint(bytes, zigzag);
}

function readVarUint(bytes: Uint8Array, offset: { value: number }) {
  let result = 0;
  let shift = 0;
  while (offset.value < bytes.length) {
    const byte = bytes[offset.value++]!;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return result >>> 0;
}

function readVarInt(bytes: Uint8Array, offset: { value: number }) {
  const zigzag = readVarUint(bytes, offset);
  return (zigzag & 1) === 1 ? -((zigzag + 1) >> 1) : zigzag >> 1;
}

function encodeBase64(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(base64: string) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function quantizePressure(force?: number | null) {
  return clamp(round((force ?? 0) * 255), 0, 255);
}

export function dequantizePressure(bucket: number) {
  return clamp(bucket, 0, 255) / 255;
}

export function encodeTimedSignatureSync(strokes: TimedSignatureStroke[]) {
  const bytes: number[] = [];
  writeVarUint(bytes, strokes.length);
  for (const stroke of strokes) {
    writeVarUint(bytes, stroke.length);
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    for (let i = 0; i < stroke.length; i += 1) {
      const point = stroke[i]!;
      const x = round(point.x);
      const y = round(point.y);
      const t = Math.max(0, round(point.t / TIME_QUANTUM_MS));
      if (i === 0) {
        writeVarUint(bytes, x);
        writeVarUint(bytes, y);
        writeVarUint(bytes, t);
      } else {
        writeVarInt(bytes, x - lastX);
        writeVarInt(bytes, y - lastY);
        writeVarUint(bytes, Math.max(0, t - lastT));
      }
      bytes.push(quantizePressure(point.force));
      lastX = x;
      lastY = y;
      lastT = t;
    }
  }
  return `${SIGNATURE_ENCODING}:${encodeBase64(new Uint8Array(bytes))}`;
}

export function decodeTimedSignatureSync(encoded: string): TimedSignatureStroke[] {
  if (!encoded.startsWith(`${SIGNATURE_ENCODING}:`)) return [];
  const bytes = decodeBase64(encoded.slice(SIGNATURE_ENCODING.length + 1));
  const offset = { value: 0 };
  const strokes: TimedSignatureStroke[] = [];
  const strokeCount = readVarUint(bytes, offset);
  for (let strokeIndex = 0; strokeIndex < strokeCount; strokeIndex += 1) {
    const pointCount = readVarUint(bytes, offset);
    const stroke: TimedSignatureStroke = [];
    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      let x: number;
      let y: number;
      let t: number;
      if (pointIndex === 0) {
        x = readVarUint(bytes, offset);
        y = readVarUint(bytes, offset);
        t = readVarUint(bytes, offset);
      } else {
        x = lastX + readVarInt(bytes, offset);
        y = lastY + readVarInt(bytes, offset);
        t = lastT + readVarUint(bytes, offset);
      }
      stroke.push({
        x,
        y,
        t: t * TIME_QUANTUM_MS,
        force: dequantizePressure(bytes[offset.value++] ?? 0),
      });
      lastX = x;
      lastY = y;
      lastT = t;
    }
    strokes.push(stroke);
  }
  return strokes;
}
