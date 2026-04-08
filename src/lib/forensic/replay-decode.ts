import type { DecodedForensicReplayEvent, ForensicReplayHandlers } from "./replay";
import { decodeReplayEventsSync, dequantizePressure } from "./replay-codec";
import { REPLAY_ENCODING } from "./replay-format";
import type { ForensicReplayStringEntry, ForensicReplayTape, ForensicReplayTarget } from "./types";

function getTarget(targets: ForensicReplayTarget[], id: number) {
  return targets.find((target) => target.id === id) ?? null;
}

function getString(strings: ForensicReplayStringEntry[], id: number) {
  return strings.find((entry) => entry.id === id)?.value ?? "";
}

function decodeBaseEvent(
  event: ReturnType<typeof decodeReplayEventsSync>[number],
  at: number,
  replay: ForensicReplayTape,
): DecodedForensicReplayEvent | null {
  switch (event.type) {
    case "scroll":
      return {
        type: "scroll",
        at,
        scrollY: event.scrollY,
        scrollMax: event.scrollMax,
      };
    case "click":
      return {
        type: "click",
        at,
        target: getTarget(replay.targets, event.targetId),
        x: event.x,
        y: event.y,
        button: event.button,
      };
    case "key":
      return {
        type: "key",
        at,
        target: getTarget(replay.targets, event.targetId),
        key: getString(replay.strings, event.keyId),
        modifiers: {
          shift: (event.modifiers & 1) !== 0,
          ctrl: (event.modifiers & 2) !== 0,
          alt: (event.modifiers & 4) !== 0,
          meta: (event.modifiers & 8) !== 0,
          repeat: (event.modifiers & 16) !== 0,
        },
      };
    case "focus":
      return {
        type: "focus",
        at,
        target: getTarget(replay.targets, event.targetId),
      };
    case "blur":
      return {
        type: "blur",
        at,
        target: getTarget(replay.targets, event.targetId),
      };
    case "visibility":
      return { type: "visibility", at, hidden: event.hidden };
    case "highlight":
      return {
        type: "highlight",
        at,
        target: getTarget(replay.targets, event.targetId),
        label: getString(replay.strings, event.labelId) || null,
      };
    case "navigation":
      return {
        type: "navigation",
        at,
        direction: event.direction,
        target: getTarget(replay.targets, event.targetId),
        index: event.index,
      };
    case "page":
      return {
        type: "page",
        at,
        page: event.page,
        totalPages: event.totalPages,
      };
    case "modal":
      return {
        type: "modal",
        at,
        name: getString(replay.strings, event.nameId),
        open: event.open,
      };
    case "signatureStart":
      return {
        type: "signatureStart",
        at,
        target: getTarget(replay.targets, event.targetId),
        strokeId: event.strokeId,
        x: event.x,
        y: event.y,
        pressure: dequantizePressure(event.pressure),
      };
    case "signaturePoint":
      return {
        type: "signaturePoint",
        at,
        strokeId: event.strokeId,
        x: event.x,
        y: event.y,
        pressure: dequantizePressure(event.pressure),
      };
    case "signatureEnd":
      return { type: "signatureEnd", at, strokeId: event.strokeId };
    default:
      return null;
  }
}

function decodeExtendedEvent(
  event: ReturnType<typeof decodeReplayEventsSync>[number],
  at: number,
  replay: ForensicReplayTape,
): DecodedForensicReplayEvent | null {
  switch (event.type) {
    case "signatureCommit":
      return {
        type: "signatureCommit",
        at,
        target: getTarget(replay.targets, event.targetId),
        signature: getString(replay.strings, event.signatureId),
      };
    case "signatureClear":
      return {
        type: "signatureClear",
        at,
        target: getTarget(replay.targets, event.targetId),
      };
    case "fieldCommit":
      return {
        type: "fieldCommit",
        at,
        target: getTarget(replay.targets, event.targetId),
        value: getString(replay.strings, event.valueId),
      };
    case "clipboard":
      return {
        type: "clipboard",
        at,
        action: event.action,
        target: getTarget(replay.targets, event.targetId),
        summary: getString(replay.strings, event.summaryId),
      };
    case "contextMenu":
      return {
        type: "contextMenu",
        at,
        target: getTarget(replay.targets, event.targetId),
        x: event.x,
        y: event.y,
      };
    case "gazePoint":
      return {
        type: "gazePoint",
        at,
        x: event.x,
        y: event.y,
        confidence: event.confidence,
      };
    case "gazeFixation":
      return {
        type: "gazeFixation",
        at,
        x: event.x,
        y: event.y,
        durationMs: event.durationMs,
        target: getTarget(replay.targets, event.targetId),
      };
    case "gazeSaccade":
      return {
        type: "gazeSaccade",
        at,
        fromX: event.fromX,
        fromY: event.fromY,
        toX: event.toX,
        toY: event.toY,
        velocityDegPerS: event.velocityDegPerS,
      };
    case "gazeBlink":
      return { type: "gazeBlink", at, durationMs: event.durationMs };
    case "gazeCalibration":
      return {
        type: "gazeCalibration",
        at,
        accuracy: event.accuracy,
        pointCount: event.pointCount,
      };
    case "gazeLost":
      return { type: "gazeLost", at, reason: event.reason };
    default:
      return null;
  }
}

export function decodeForensicReplay(replay: ForensicReplayTape): DecodedForensicReplayEvent[] {
  if (replay.encoding !== REPLAY_ENCODING || !replay.tapeBase64) return [];

  const encodedEvents = decodeReplayEventsSync(replay.tapeBase64);
  const events: DecodedForensicReplayEvent[] = [];
  let at = 0;

  for (const event of encodedEvents) {
    at += event.delta * replay.timeQuantumMs;
    const decoded = decodeBaseEvent(event, at, replay) ?? decodeExtendedEvent(event, at, replay);
    if (decoded) events.push(decoded);
  }

  return events;
}

export function replayForensicTape(
  replay: ForensicReplayTape,
  handlers: ForensicReplayHandlers,
  options?: { speed?: number },
) {
  const events = decodeForensicReplay(replay);
  const speed = Math.max(0.1, options?.speed ?? 1);
  const timers: Array<ReturnType<typeof setTimeout>> = [];

  const dispatch = (event: DecodedForensicReplayEvent) => {
    handlers.onEvent?.(event);
    switch (event.type) {
      case "scroll":
        handlers.onScroll?.(event);
        break;
      case "click":
        handlers.onClick?.(event);
        break;
      case "key":
        handlers.onKey?.(event);
        break;
      case "focus":
        handlers.onFocus?.(event);
        break;
      case "blur":
        handlers.onBlur?.(event);
        break;
      case "highlight":
        handlers.onHighlight?.(event);
        break;
      case "navigation":
        handlers.onNavigation?.(event);
        break;
      case "page":
        handlers.onPage?.(event);
        break;
      case "modal":
        handlers.onModal?.(event);
        break;
      case "signatureStart":
        handlers.onSignatureStart?.(event);
        break;
      case "signaturePoint":
        handlers.onSignaturePoint?.(event);
        break;
      case "signatureEnd":
        handlers.onSignatureEnd?.(event);
        break;
      case "signatureCommit":
        handlers.onSignatureCommit?.(event);
        break;
      case "signatureClear":
        handlers.onSignatureClear?.(event);
        break;
      case "fieldCommit":
        handlers.onFieldCommit?.(event);
        break;
      case "clipboard":
        handlers.onClipboard?.(event);
        break;
      case "contextMenu":
        handlers.onContextMenu?.(event);
        break;
      case "gazePoint":
        handlers.onGazePoint?.(event);
        break;
      case "gazeFixation":
        handlers.onGazeFixation?.(event);
        break;
      case "gazeSaccade":
        handlers.onGazeSaccade?.(event);
        break;
      case "gazeBlink":
        handlers.onGazeBlink?.(event);
        break;
      case "gazeCalibration":
        handlers.onGazeCalibration?.(event);
        break;
      case "gazeLost":
        handlers.onGazeLost?.(event);
        break;
      default:
        break;
    }
  };

  for (const event of events) {
    const timer = setTimeout(() => dispatch(event), event.at / speed);
    timers.push(timer);
  }

  return {
    cancel() {
      for (const timer of timers) clearTimeout(timer);
    },
    events,
  };
}
