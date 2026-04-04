import type { TimedSignatureStroke } from "./types";
import {
  REPLAY_CLIPBOARD_ACTION_CODES,
  REPLAY_FORMAT_LIMITS,
  REPLAY_NAV_DIRECTION_CODES,
  REPLAY_OPS,
  SIGNATURE_ENCODING,
  type ReplayOpCode,
} from "./replay-format";

const TIME_QUANTUM_MS = REPLAY_FORMAT_LIMITS.timeQuantumMs;

const ReplayOp = REPLAY_OPS;
const NAV_DIRECTION_CODES = REPLAY_NAV_DIRECTION_CODES;
const CLIPBOARD_ACTION_CODES = REPLAY_CLIPBOARD_ACTION_CODES;

type ReplayNavigationDirection = keyof typeof NAV_DIRECTION_CODES;
type ReplayClipboardAction = keyof typeof CLIPBOARD_ACTION_CODES;

export type ForensicReplayEncodedEvent =
  | { type: "scroll"; delta: number; scrollY: number; scrollMax: number }
  | { type: "click"; delta: number; targetId: number; x: number; y: number; button: number }
  | { type: "key"; delta: number; targetId: number; keyId: number; modifiers: number }
  | { type: "focus"; delta: number; targetId: number }
  | { type: "blur"; delta: number; targetId: number }
  | { type: "visibility"; delta: number; hidden: boolean }
  | { type: "highlight"; delta: number; targetId: number; labelId: number }
  | { type: "navigation"; delta: number; direction: ReplayNavigationDirection; targetId: number; index: number }
  | { type: "page"; delta: number; page: number; totalPages: number }
  | { type: "modal"; delta: number; nameId: number; open: boolean }
  | { type: "signatureStart"; delta: number; targetId: number; strokeId: number; x: number; y: number; pressure: number }
  | { type: "signaturePoint"; delta: number; strokeId: number; x: number; y: number; pressure: number }
  | { type: "signatureEnd"; delta: number; strokeId: number }
  | { type: "signatureCommit"; delta: number; targetId: number; signatureId: number }
  | { type: "signatureClear"; delta: number; targetId: number }
  | { type: "fieldCommit"; delta: number; targetId: number; valueId: number }
  | { type: "clipboard"; delta: number; action: ReplayClipboardAction; targetId: number; summaryId: number }
  | { type: "contextMenu"; delta: number; targetId: number; x: number; y: number }
  // v2 opcodes
  | { type: "mouseMove"; delta: number; dx: number; dy: number }
  | { type: "hoverDwell"; delta: number; targetId: number; durationMs: number }
  | { type: "viewportResize"; delta: number; width: number; height: number }
  | { type: "touchStart"; delta: number; x: number; y: number; radius: number; force: number }
  | { type: "touchMove"; delta: number; dx: number; dy: number; radius: number; force: number }
  | { type: "touchEnd"; delta: number }
  | { type: "fieldCorrection"; delta: number; targetId: number; correctionKind: number; count: number }
  | { type: "scrollMomentum"; delta: number; velocity: number; deceleration: number }
  // v3 opcodes — eye gaze tracking
  | { type: "gazePoint"; delta: number; x: number; y: number; confidence: number }
  | { type: "gazeFixation"; delta: number; x: number; y: number; durationMs: number; targetId: number }
  | { type: "gazeSaccade"; delta: number; fromX: number; fromY: number; toX: number; toY: number; velocityDegPerS: number }
  | { type: "gazeBlink"; delta: number; durationMs: number }
  | { type: "gazeCalibration"; delta: number; accuracy: number; pointCount: number }
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
  const zigzag = value < 0 ? (-value * 2) - 1 : value * 2;
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

function decodeNavigationDirection(code: number): ReplayNavigationDirection {
  return (
    (Object.entries(NAV_DIRECTION_CODES).find(([, value]) => value === code)?.[0] as ReplayNavigationDirection | undefined) ??
    "jump"
  );
}

function decodeClipboardAction(code: number): ReplayClipboardAction {
  return (
    (Object.entries(CLIPBOARD_ACTION_CODES).find(([, value]) => value === code)?.[0] as ReplayClipboardAction | undefined) ??
    "paste"
  );
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

export function encodeReplayEventsSync(events: ForensicReplayEncodedEvent[]): ForensicReplayEncodedPayload {
  const bytes: number[] = [];
  const signaturePoints = new Map<number, { x: number; y: number }>();

  for (const event of events) {
    switch (event.type) {
      case "scroll":
        bytes.push(ReplayOp.Scroll);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.scrollY);
        writeVarUint(bytes, event.scrollMax);
        break;
      case "click":
        bytes.push(ReplayOp.Click);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.targetId);
        writeVarUint(bytes, event.x);
        writeVarUint(bytes, event.y);
        writeVarUint(bytes, event.button);
        break;
      case "key":
        bytes.push(ReplayOp.Key);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.targetId);
        writeVarUint(bytes, event.keyId);
        writeVarUint(bytes, event.modifiers);
        break;
      case "focus":
        bytes.push(ReplayOp.Focus);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.targetId);
        break;
      case "blur":
        bytes.push(ReplayOp.Blur);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.targetId);
        break;
      case "visibility":
        bytes.push(ReplayOp.Visibility);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.hidden ? 1 : 0);
        break;
      case "highlight":
        bytes.push(ReplayOp.Highlight);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.targetId);
        writeVarUint(bytes, event.labelId);
        break;
      case "navigation":
        bytes.push(ReplayOp.Navigation);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, NAV_DIRECTION_CODES[event.direction]);
        writeVarUint(bytes, event.targetId);
        writeVarUint(bytes, event.index);
        break;
      case "page":
        bytes.push(ReplayOp.Page);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.page);
        writeVarUint(bytes, event.totalPages);
        break;
      case "modal":
        bytes.push(ReplayOp.Modal);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.nameId);
        writeVarUint(bytes, event.open ? 1 : 0);
        break;
      case "signatureStart":
        signaturePoints.set(event.strokeId, { x: event.x, y: event.y });
        bytes.push(ReplayOp.SignatureStart);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.targetId);
        writeVarUint(bytes, event.strokeId);
        writeVarUint(bytes, event.x);
        writeVarUint(bytes, event.y);
        writeVarUint(bytes, event.pressure);
        break;
      case "signaturePoint": {
        const previous = signaturePoints.get(event.strokeId) ?? { x: 0, y: 0 };
        signaturePoints.set(event.strokeId, { x: event.x, y: event.y });
        bytes.push(ReplayOp.SignaturePoint);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.strokeId);
        writeVarInt(bytes, event.x - previous.x);
        writeVarInt(bytes, event.y - previous.y);
        writeVarUint(bytes, event.pressure);
        break;
      }
      case "signatureEnd":
        signaturePoints.delete(event.strokeId);
        bytes.push(ReplayOp.SignatureEnd);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.strokeId);
        break;
      case "signatureCommit":
        bytes.push(ReplayOp.SignatureCommit);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.targetId);
        writeVarUint(bytes, event.signatureId);
        break;
      case "signatureClear":
        bytes.push(ReplayOp.SignatureClear);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.targetId);
        break;
      case "fieldCommit":
        bytes.push(ReplayOp.FieldCommit);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.targetId);
        writeVarUint(bytes, event.valueId);
        break;
      case "clipboard":
        bytes.push(ReplayOp.Clipboard);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, CLIPBOARD_ACTION_CODES[event.action]);
        writeVarUint(bytes, event.targetId);
        writeVarUint(bytes, event.summaryId);
        break;
      case "contextMenu":
        bytes.push(ReplayOp.ContextMenu);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.targetId);
        writeVarUint(bytes, event.x);
        writeVarUint(bytes, event.y);
        break;
      case "mouseMove":
        bytes.push(ReplayOp.MouseMove);
        writeVarUint(bytes, event.delta);
        writeVarInt(bytes, event.dx);
        writeVarInt(bytes, event.dy);
        break;
      case "hoverDwell":
        bytes.push(ReplayOp.HoverDwell);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.targetId);
        writeVarUint(bytes, event.durationMs);
        break;
      case "viewportResize":
        bytes.push(ReplayOp.ViewportResize);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.width);
        writeVarUint(bytes, event.height);
        break;
      case "touchStart":
        bytes.push(ReplayOp.TouchStart);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.x);
        writeVarUint(bytes, event.y);
        bytes.push(event.radius & 0xff);
        bytes.push(event.force & 0xff);
        break;
      case "touchMove":
        bytes.push(ReplayOp.TouchMove);
        writeVarUint(bytes, event.delta);
        writeVarInt(bytes, event.dx);
        writeVarInt(bytes, event.dy);
        bytes.push(event.radius & 0xff);
        bytes.push(event.force & 0xff);
        break;
      case "touchEnd":
        bytes.push(ReplayOp.TouchEnd);
        writeVarUint(bytes, event.delta);
        break;
      case "fieldCorrection":
        bytes.push(ReplayOp.FieldCorrection);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.targetId);
        bytes.push(event.correctionKind & 0xff);
        writeVarUint(bytes, event.count);
        break;
      case "scrollMomentum":
        bytes.push(ReplayOp.ScrollMomentum);
        writeVarUint(bytes, event.delta);
        writeVarInt(bytes, event.velocity);
        writeVarUint(bytes, event.deceleration);
        break;
      case "gazePoint":
        bytes.push(ReplayOp.GazePoint);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.x);
        writeVarUint(bytes, event.y);
        bytes.push(event.confidence & 0xff);
        break;
      case "gazeFixation":
        bytes.push(ReplayOp.GazeFixation);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.x);
        writeVarUint(bytes, event.y);
        writeVarUint(bytes, event.durationMs);
        writeVarUint(bytes, event.targetId);
        break;
      case "gazeSaccade":
        bytes.push(ReplayOp.GazeSaccade);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.fromX);
        writeVarUint(bytes, event.fromY);
        writeVarUint(bytes, event.toX);
        writeVarUint(bytes, event.toY);
        writeVarUint(bytes, event.velocityDegPerS);
        break;
      case "gazeBlink":
        bytes.push(ReplayOp.GazeBlink);
        writeVarUint(bytes, event.delta);
        writeVarUint(bytes, event.durationMs);
        break;
      case "gazeCalibration":
        bytes.push(ReplayOp.GazeCalibration);
        writeVarUint(bytes, event.delta);
        bytes.push(event.accuracy & 0xff);
        writeVarUint(bytes, event.pointCount);
        break;
      case "gazeLost":
        bytes.push(ReplayOp.GazeLost);
        writeVarUint(bytes, event.delta);
        bytes.push(event.reason & 0xff);
        break;
    }
  }

  return {
    tapeBase64: encodeBase64(new Uint8Array(bytes)),
    byteLength: bytes.length,
  };
}

export function decodeReplayEventsSync(tapeBase64: string): ForensicReplayEncodedEvent[] {
  const bytes = decodeBase64(tapeBase64);
  const offset = { value: 0 };
  const events: ForensicReplayEncodedEvent[] = [];
  const signaturePoints = new Map<number, { x: number; y: number }>();

  while (offset.value < bytes.length) {
    const op = bytes[offset.value++] as ReplayOpCode;
    const delta = readVarUint(bytes, offset);
    switch (op) {
      case ReplayOp.Scroll:
        events.push({
          type: "scroll",
          delta,
          scrollY: readVarUint(bytes, offset),
          scrollMax: readVarUint(bytes, offset),
        });
        break;
      case ReplayOp.Click:
        events.push({
          type: "click",
          delta,
          targetId: readVarUint(bytes, offset),
          x: readVarUint(bytes, offset),
          y: readVarUint(bytes, offset),
          button: readVarUint(bytes, offset),
        });
        break;
      case ReplayOp.Key:
        events.push({
          type: "key",
          delta,
          targetId: readVarUint(bytes, offset),
          keyId: readVarUint(bytes, offset),
          modifiers: readVarUint(bytes, offset),
        });
        break;
      case ReplayOp.Focus:
        events.push({ type: "focus", delta, targetId: readVarUint(bytes, offset) });
        break;
      case ReplayOp.Blur:
        events.push({ type: "blur", delta, targetId: readVarUint(bytes, offset) });
        break;
      case ReplayOp.Visibility:
        events.push({ type: "visibility", delta, hidden: readVarUint(bytes, offset) === 1 });
        break;
      case ReplayOp.Highlight:
        events.push({
          type: "highlight",
          delta,
          targetId: readVarUint(bytes, offset),
          labelId: readVarUint(bytes, offset),
        });
        break;
      case ReplayOp.Navigation:
        events.push({
          type: "navigation",
          delta,
          direction: decodeNavigationDirection(readVarUint(bytes, offset)),
          targetId: readVarUint(bytes, offset),
          index: readVarUint(bytes, offset),
        });
        break;
      case ReplayOp.Page:
        events.push({
          type: "page",
          delta,
          page: readVarUint(bytes, offset),
          totalPages: readVarUint(bytes, offset),
        });
        break;
      case ReplayOp.Modal:
        events.push({
          type: "modal",
          delta,
          nameId: readVarUint(bytes, offset),
          open: readVarUint(bytes, offset) === 1,
        });
        break;
      case ReplayOp.SignatureStart: {
        const event: Extract<ForensicReplayEncodedEvent, { type: "signatureStart" }> = {
          type: "signatureStart",
          delta,
          targetId: readVarUint(bytes, offset),
          strokeId: readVarUint(bytes, offset),
          x: readVarUint(bytes, offset),
          y: readVarUint(bytes, offset),
          pressure: readVarUint(bytes, offset),
        };
        signaturePoints.set(event.strokeId, { x: event.x, y: event.y });
        events.push(event);
        break;
      }
      case ReplayOp.SignaturePoint: {
        const strokeId = readVarUint(bytes, offset);
        const previous = signaturePoints.get(strokeId) ?? { x: 0, y: 0 };
        const event: Extract<ForensicReplayEncodedEvent, { type: "signaturePoint" }> = {
          type: "signaturePoint",
          delta,
          strokeId,
          x: previous.x + readVarInt(bytes, offset),
          y: previous.y + readVarInt(bytes, offset),
          pressure: readVarUint(bytes, offset),
        };
        signaturePoints.set(strokeId, { x: event.x, y: event.y });
        events.push(event);
        break;
      }
      case ReplayOp.SignatureEnd: {
        const strokeId = readVarUint(bytes, offset);
        signaturePoints.delete(strokeId);
        events.push({ type: "signatureEnd", delta, strokeId });
        break;
      }
      case ReplayOp.SignatureCommit:
        events.push({
          type: "signatureCommit",
          delta,
          targetId: readVarUint(bytes, offset),
          signatureId: readVarUint(bytes, offset),
        });
        break;
      case ReplayOp.SignatureClear:
        events.push({ type: "signatureClear", delta, targetId: readVarUint(bytes, offset) });
        break;
      case ReplayOp.FieldCommit:
        events.push({
          type: "fieldCommit",
          delta,
          targetId: readVarUint(bytes, offset),
          valueId: readVarUint(bytes, offset),
        });
        break;
      case ReplayOp.Clipboard:
        events.push({
          type: "clipboard",
          delta,
          action: decodeClipboardAction(readVarUint(bytes, offset)),
          targetId: readVarUint(bytes, offset),
          summaryId: readVarUint(bytes, offset),
        });
        break;
      case ReplayOp.ContextMenu:
        events.push({
          type: "contextMenu",
          delta,
          targetId: readVarUint(bytes, offset),
          x: readVarUint(bytes, offset),
          y: readVarUint(bytes, offset),
        });
        break;
      case ReplayOp.MouseMove:
        events.push({ type: "mouseMove", delta, dx: readVarInt(bytes, offset), dy: readVarInt(bytes, offset) });
        break;
      case ReplayOp.HoverDwell:
        events.push({ type: "hoverDwell", delta, targetId: readVarUint(bytes, offset), durationMs: readVarUint(bytes, offset) });
        break;
      case ReplayOp.ViewportResize:
        events.push({ type: "viewportResize", delta, width: readVarUint(bytes, offset), height: readVarUint(bytes, offset) });
        break;
      case ReplayOp.TouchStart: {
        const ev = { type: "touchStart" as const, delta, x: readVarUint(bytes, offset), y: readVarUint(bytes, offset), radius: bytes[offset.value++] ?? 0, force: bytes[offset.value++] ?? 0 };
        events.push(ev);
        break;
      }
      case ReplayOp.TouchMove: {
        const ev = { type: "touchMove" as const, delta, dx: readVarInt(bytes, offset), dy: readVarInt(bytes, offset), radius: bytes[offset.value++] ?? 0, force: bytes[offset.value++] ?? 0 };
        events.push(ev);
        break;
      }
      case ReplayOp.TouchEnd:
        events.push({ type: "touchEnd", delta });
        break;
      case ReplayOp.FieldCorrection: {
        const targetId = readVarUint(bytes, offset);
        const correctionKind = bytes[offset.value++] ?? 0;
        events.push({ type: "fieldCorrection", delta, targetId, correctionKind, count: readVarUint(bytes, offset) });
        break;
      }
      case ReplayOp.ScrollMomentum:
        events.push({ type: "scrollMomentum", delta, velocity: readVarInt(bytes, offset), deceleration: readVarUint(bytes, offset) });
        break;
      case ReplayOp.GazePoint:
        events.push({ type: "gazePoint", delta, x: readVarUint(bytes, offset), y: readVarUint(bytes, offset), confidence: bytes[offset.value++] ?? 0 });
        break;
      case ReplayOp.GazeFixation:
        events.push({ type: "gazeFixation", delta, x: readVarUint(bytes, offset), y: readVarUint(bytes, offset), durationMs: readVarUint(bytes, offset), targetId: readVarUint(bytes, offset) });
        break;
      case ReplayOp.GazeSaccade:
        events.push({ type: "gazeSaccade", delta, fromX: readVarUint(bytes, offset), fromY: readVarUint(bytes, offset), toX: readVarUint(bytes, offset), toY: readVarUint(bytes, offset), velocityDegPerS: readVarUint(bytes, offset) });
        break;
      case ReplayOp.GazeBlink:
        events.push({ type: "gazeBlink", delta, durationMs: readVarUint(bytes, offset) });
        break;
      case ReplayOp.GazeCalibration:
        events.push({ type: "gazeCalibration", delta, accuracy: bytes[offset.value++] ?? 0, pointCount: readVarUint(bytes, offset) });
        break;
      case ReplayOp.GazeLost: {
        const reason = bytes[offset.value++] ?? 0;
        events.push({ type: "gazeLost", delta, reason });
        break;
      }
      default:
        offset.value = bytes.length;
        break;
    }
  }

  return events;
}
