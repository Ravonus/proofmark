import type { ForensicReplayEncodedEvent, ForensicReplayEncodedPayload } from "./replay-codec";
import { REPLAY_CLIPBOARD_ACTION_CODES, REPLAY_NAV_DIRECTION_CODES, REPLAY_OPS } from "./replay-format";

const ReplayOp = REPLAY_OPS;
const NAV_DIRECTION_CODES = REPLAY_NAV_DIRECTION_CODES;
const CLIPBOARD_ACTION_CODES = REPLAY_CLIPBOARD_ACTION_CODES;

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

function encodeBase64(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function encodeV1Event(
  bytes: number[],
  event: ForensicReplayEncodedEvent,
  signaturePoints: Map<number, { x: number; y: number }>,
): boolean {
  switch (event.type) {
    case "scroll":
      bytes.push(ReplayOp.Scroll);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.scrollY);
      writeVarUint(bytes, event.scrollMax);
      return true;
    case "click":
      bytes.push(ReplayOp.Click);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.targetId);
      writeVarUint(bytes, event.x);
      writeVarUint(bytes, event.y);
      writeVarUint(bytes, event.button);
      return true;
    case "key":
      bytes.push(ReplayOp.Key);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.targetId);
      writeVarUint(bytes, event.keyId);
      writeVarUint(bytes, event.modifiers);
      return true;
    case "focus":
      bytes.push(ReplayOp.Focus);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.targetId);
      return true;
    case "blur":
      bytes.push(ReplayOp.Blur);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.targetId);
      return true;
    case "visibility":
      bytes.push(ReplayOp.Visibility);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.hidden ? 1 : 0);
      return true;
    case "highlight":
      bytes.push(ReplayOp.Highlight);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.targetId);
      writeVarUint(bytes, event.labelId);
      return true;
    case "navigation":
      bytes.push(ReplayOp.Navigation);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, NAV_DIRECTION_CODES[event.direction]);
      writeVarUint(bytes, event.targetId);
      writeVarUint(bytes, event.index);
      return true;
    case "page":
      bytes.push(ReplayOp.Page);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.page);
      writeVarUint(bytes, event.totalPages);
      return true;
    case "modal":
      bytes.push(ReplayOp.Modal);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.nameId);
      writeVarUint(bytes, event.open ? 1 : 0);
      return true;
    case "signatureStart":
      signaturePoints.set(event.strokeId, { x: event.x, y: event.y });
      bytes.push(ReplayOp.SignatureStart);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.targetId);
      writeVarUint(bytes, event.strokeId);
      writeVarUint(bytes, event.x);
      writeVarUint(bytes, event.y);
      writeVarUint(bytes, event.pressure);
      return true;
    case "signaturePoint": {
      const previous = signaturePoints.get(event.strokeId) ?? { x: 0, y: 0 };
      signaturePoints.set(event.strokeId, { x: event.x, y: event.y });
      bytes.push(ReplayOp.SignaturePoint);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.strokeId);
      writeVarInt(bytes, event.x - previous.x);
      writeVarInt(bytes, event.y - previous.y);
      writeVarUint(bytes, event.pressure);
      return true;
    }
    case "signatureEnd":
      signaturePoints.delete(event.strokeId);
      bytes.push(ReplayOp.SignatureEnd);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.strokeId);
      return true;
    case "signatureCommit":
      bytes.push(ReplayOp.SignatureCommit);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.targetId);
      writeVarUint(bytes, event.signatureId);
      return true;
    case "signatureClear":
      bytes.push(ReplayOp.SignatureClear);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.targetId);
      return true;
    case "fieldCommit":
      bytes.push(ReplayOp.FieldCommit);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, event.targetId);
      writeVarUint(bytes, event.valueId);
      return true;
    case "clipboard":
      bytes.push(ReplayOp.Clipboard);
      writeVarUint(bytes, event.delta);
      writeVarUint(bytes, CLIPBOARD_ACTION_CODES[event.action]);
      writeVarUint(bytes, event.targetId);
      writeVarUint(bytes, event.summaryId);
      return true;
    default:
      return false;
  }
}

function encodeV2V3Event(bytes: number[], event: ForensicReplayEncodedEvent): void {
  switch (event.type) {
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
    default:
      break;
  }
}

export function encodeReplayEventsSync(events: ForensicReplayEncodedEvent[]): ForensicReplayEncodedPayload {
  const bytes: number[] = [];
  const signaturePoints = new Map<number, { x: number; y: number }>();

  for (const event of events) {
    if (!encodeV1Event(bytes, event, signaturePoints)) {
      encodeV2V3Event(bytes, event);
    }
  }

  return {
    tapeBase64: encodeBase64(new Uint8Array(bytes)),
    byteLength: bytes.length,
  };
}
