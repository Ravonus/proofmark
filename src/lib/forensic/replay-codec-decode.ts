import type { ForensicReplayEncodedEvent } from "./replay-codec";
import { decodeBase64 } from "./replay-codec";
import {
  REPLAY_CLIPBOARD_ACTION_CODES,
  REPLAY_NAV_DIRECTION_CODES,
  REPLAY_OPS,
  type ReplayOpCode,
} from "./replay-format";

const ReplayOp = REPLAY_OPS;
const NAV_DIRECTION_CODES = REPLAY_NAV_DIRECTION_CODES;
const CLIPBOARD_ACTION_CODES = REPLAY_CLIPBOARD_ACTION_CODES;

type ReplayNavigationDirection = keyof typeof NAV_DIRECTION_CODES;
type ReplayClipboardAction = keyof typeof CLIPBOARD_ACTION_CODES;

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

function decodeNavigationDirection(code: number): ReplayNavigationDirection {
  return (
    (Object.entries(NAV_DIRECTION_CODES).find(([, value]) => value === code)?.[0] as
      | ReplayNavigationDirection
      | undefined) ?? "jump"
  );
}

function decodeClipboardAction(code: number): ReplayClipboardAction {
  return (
    (Object.entries(CLIPBOARD_ACTION_CODES).find(([, value]) => value === code)?.[0] as
      | ReplayClipboardAction
      | undefined) ?? "paste"
  );
}

function decodeV1Event(
  op: ReplayOpCode,
  delta: number,
  bytes: Uint8Array,
  offset: { value: number },
  signaturePoints: Map<number, { x: number; y: number }>,
): ForensicReplayEncodedEvent | null {
  switch (op) {
    case ReplayOp.Scroll:
      return {
        type: "scroll",
        delta,
        scrollY: readVarUint(bytes, offset),
        scrollMax: readVarUint(bytes, offset),
      };
    case ReplayOp.Click:
      return {
        type: "click",
        delta,
        targetId: readVarUint(bytes, offset),
        x: readVarUint(bytes, offset),
        y: readVarUint(bytes, offset),
        button: readVarUint(bytes, offset),
      };
    case ReplayOp.Key:
      return {
        type: "key",
        delta,
        targetId: readVarUint(bytes, offset),
        keyId: readVarUint(bytes, offset),
        modifiers: readVarUint(bytes, offset),
      };
    case ReplayOp.Focus:
      return { type: "focus", delta, targetId: readVarUint(bytes, offset) };
    case ReplayOp.Blur:
      return { type: "blur", delta, targetId: readVarUint(bytes, offset) };
    case ReplayOp.Visibility:
      return {
        type: "visibility",
        delta,
        hidden: readVarUint(bytes, offset) === 1,
      };
    case ReplayOp.Highlight:
      return {
        type: "highlight",
        delta,
        targetId: readVarUint(bytes, offset),
        labelId: readVarUint(bytes, offset),
      };
    case ReplayOp.Navigation:
      return {
        type: "navigation",
        delta,
        direction: decodeNavigationDirection(readVarUint(bytes, offset)),
        targetId: readVarUint(bytes, offset),
        index: readVarUint(bytes, offset),
      };
    case ReplayOp.Page:
      return {
        type: "page",
        delta,
        page: readVarUint(bytes, offset),
        totalPages: readVarUint(bytes, offset),
      };
    case ReplayOp.Modal:
      return {
        type: "modal",
        delta,
        nameId: readVarUint(bytes, offset),
        open: readVarUint(bytes, offset) === 1,
      };
    case ReplayOp.SignatureStart: {
      const ev = {
        type: "signatureStart" as const,
        delta,
        targetId: readVarUint(bytes, offset),
        strokeId: readVarUint(bytes, offset),
        x: readVarUint(bytes, offset),
        y: readVarUint(bytes, offset),
        pressure: readVarUint(bytes, offset),
      };
      signaturePoints.set(ev.strokeId, { x: ev.x, y: ev.y });
      return ev;
    }
    case ReplayOp.SignaturePoint: {
      const strokeId = readVarUint(bytes, offset);
      const previous = signaturePoints.get(strokeId) ?? { x: 0, y: 0 };
      const ev = {
        type: "signaturePoint" as const,
        delta,
        strokeId,
        x: previous.x + readVarInt(bytes, offset),
        y: previous.y + readVarInt(bytes, offset),
        pressure: readVarUint(bytes, offset),
      };
      signaturePoints.set(strokeId, { x: ev.x, y: ev.y });
      return ev;
    }
    case ReplayOp.SignatureEnd: {
      const strokeId = readVarUint(bytes, offset);
      signaturePoints.delete(strokeId);
      return { type: "signatureEnd", delta, strokeId };
    }
    case ReplayOp.SignatureCommit:
      return {
        type: "signatureCommit",
        delta,
        targetId: readVarUint(bytes, offset),
        signatureId: readVarUint(bytes, offset),
      };
    case ReplayOp.SignatureClear:
      return {
        type: "signatureClear",
        delta,
        targetId: readVarUint(bytes, offset),
      };
    case ReplayOp.FieldCommit:
      return {
        type: "fieldCommit",
        delta,
        targetId: readVarUint(bytes, offset),
        valueId: readVarUint(bytes, offset),
      };
    case ReplayOp.Clipboard:
      return {
        type: "clipboard",
        delta,
        action: decodeClipboardAction(readVarUint(bytes, offset)),
        targetId: readVarUint(bytes, offset),
        summaryId: readVarUint(bytes, offset),
      };
    case ReplayOp.ContextMenu:
      return {
        type: "contextMenu",
        delta,
        targetId: readVarUint(bytes, offset),
        x: readVarUint(bytes, offset),
        y: readVarUint(bytes, offset),
      };
    default:
      return null;
  }
}

function decodeV2V3Event(
  op: ReplayOpCode,
  delta: number,
  bytes: Uint8Array,
  offset: { value: number },
): ForensicReplayEncodedEvent | null {
  switch (op) {
    case ReplayOp.MouseMove:
      return {
        type: "mouseMove",
        delta,
        dx: readVarInt(bytes, offset),
        dy: readVarInt(bytes, offset),
      };
    case ReplayOp.HoverDwell:
      return {
        type: "hoverDwell",
        delta,
        targetId: readVarUint(bytes, offset),
        durationMs: readVarUint(bytes, offset),
      };
    case ReplayOp.ViewportResize:
      return {
        type: "viewportResize",
        delta,
        width: readVarUint(bytes, offset),
        height: readVarUint(bytes, offset),
      };
    case ReplayOp.TouchStart:
      return {
        type: "touchStart",
        delta,
        x: readVarUint(bytes, offset),
        y: readVarUint(bytes, offset),
        radius: bytes[offset.value++] ?? 0,
        force: bytes[offset.value++] ?? 0,
      };
    case ReplayOp.TouchMove:
      return {
        type: "touchMove",
        delta,
        dx: readVarInt(bytes, offset),
        dy: readVarInt(bytes, offset),
        radius: bytes[offset.value++] ?? 0,
        force: bytes[offset.value++] ?? 0,
      };
    case ReplayOp.TouchEnd:
      return { type: "touchEnd", delta };
    case ReplayOp.FieldCorrection: {
      const targetId = readVarUint(bytes, offset);
      const correctionKind = bytes[offset.value++] ?? 0;
      return {
        type: "fieldCorrection",
        delta,
        targetId,
        correctionKind,
        count: readVarUint(bytes, offset),
      };
    }
    case ReplayOp.ScrollMomentum:
      return {
        type: "scrollMomentum",
        delta,
        velocity: readVarInt(bytes, offset),
        deceleration: readVarUint(bytes, offset),
      };
    case ReplayOp.GazePoint:
      return {
        type: "gazePoint",
        delta,
        x: readVarUint(bytes, offset),
        y: readVarUint(bytes, offset),
        confidence: bytes[offset.value++] ?? 0,
      };
    case ReplayOp.GazeFixation:
      return {
        type: "gazeFixation",
        delta,
        x: readVarUint(bytes, offset),
        y: readVarUint(bytes, offset),
        durationMs: readVarUint(bytes, offset),
        targetId: readVarUint(bytes, offset),
      };
    case ReplayOp.GazeSaccade:
      return {
        type: "gazeSaccade",
        delta,
        fromX: readVarUint(bytes, offset),
        fromY: readVarUint(bytes, offset),
        toX: readVarUint(bytes, offset),
        toY: readVarUint(bytes, offset),
        velocityDegPerS: readVarUint(bytes, offset),
      };
    case ReplayOp.GazeBlink:
      return {
        type: "gazeBlink",
        delta,
        durationMs: readVarUint(bytes, offset),
      };
    case ReplayOp.GazeCalibration:
      return {
        type: "gazeCalibration",
        delta,
        accuracy: bytes[offset.value++] ?? 0,
        pointCount: readVarUint(bytes, offset),
      };
    case ReplayOp.GazeLost: {
      const reason = bytes[offset.value++] ?? 0;
      return { type: "gazeLost", delta, reason };
    }
    default:
      return null;
  }
}

export function decodeReplayEventsSync(tapeBase64: string): ForensicReplayEncodedEvent[] {
  const bytes = decodeBase64(tapeBase64);
  const offset = { value: 0 };
  const events: ForensicReplayEncodedEvent[] = [];
  const signaturePoints = new Map<number, { x: number; y: number }>();

  while (offset.value < bytes.length) {
    const op = bytes[offset.value++] as ReplayOpCode;
    const delta = readVarUint(bytes, offset);
    const v1 = decodeV1Event(op, delta, bytes, offset, signaturePoints);
    if (v1) {
      events.push(v1);
      continue;
    }
    const v2v3 = decodeV2V3Event(op, delta, bytes, offset);
    if (v2v3) {
      events.push(v2v3);
      continue;
    }
    // Unknown opcode — stop
    offset.value = bytes.length;
  }

  return events;
}
