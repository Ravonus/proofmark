import { decodeForensicReplay } from "~/lib/forensic";
import type { ForensicReplayTape } from "~/lib/forensic/types";

export interface ReplayParticipantSummary {
  signerId: string;
  label: string;
  replay: ForensicReplayTape;
  status?: string;
  signedAt?: string | Date | null;
  forensicHash?: string | null;
  automationReview?: {
    verdict: string;
    confidence: number;
    source: string;
    automationScore: number;
    recommendedAction: string;
    rationale?: string;
    createdAt?: string;
  } | null;
  policyOutcome?: {
    action: string;
    blocked: boolean;
    reason: string;
  } | null;
  storage?: {
    mode: string;
    objectCid: string | null;
    objectHash: string | null;
    byteLength: number;
    anchored: boolean;
    anchors: Array<{
      chain: string;
      status: string;
      txHash?: string | null;
    }>;
  } | null;
  signatureMotion?: {
    strokeCount: number;
    pointCount: number;
    durationMs: number;
    penLiftCount: number;
    pathLengthPx: number;
    averageVelocityPxPerMs: number;
    velocityCoefficientOfVariation: number;
    directionChangeCount: number;
    pauseCount: number;
    maxPauseMs: number;
    motionComplexityScore: number;
    motionUniformityScore: number;
    boundingBox: {
      width: number;
      height: number;
      aspectRatio: number;
    };
  } | null;
}

type ReplayEventBase = {
  lane: number;
  atMs: number;
  deltaMs: number;
};

export type ReplayLaneEvent =
  | (ReplayEventBase & { type: "scroll"; scrollY: number; scrollMax: number })
  | (ReplayEventBase & { type: "click"; target: string | null; x: number; y: number; button: number })
  | (ReplayEventBase & { type: "key"; target: string | null; key: string; modifiers: number })
  | (ReplayEventBase & { type: "focus"; target: string | null })
  | (ReplayEventBase & { type: "blur"; target: string | null })
  | (ReplayEventBase & { type: "visibility"; hidden: boolean })
  | (ReplayEventBase & { type: "highlight"; target: string | null; label: string | null })
  | (ReplayEventBase & { type: "navigation"; direction: string; target: string | null; index: number })
  | (ReplayEventBase & { type: "page"; page: number; totalPages: number })
  | (ReplayEventBase & { type: "modal"; name: string; open: boolean })
  | (ReplayEventBase & { type: "signatureStart"; target: string | null; strokeId: number; x: number; y: number; pressure: number })
  | (ReplayEventBase & { type: "signaturePoint"; strokeId: number; x: number; y: number; pressure: number })
  | (ReplayEventBase & { type: "signatureEnd"; strokeId: number })
  | (ReplayEventBase & { type: "signatureCommit"; target: string | null; signature: string })
  | (ReplayEventBase & { type: "signatureClear"; target: string | null })
  | (ReplayEventBase & { type: "fieldCommit"; target: string | null; value: string })
  | (ReplayEventBase & { type: "clipboard"; action: string; target: string | null; summary: string })
  | (ReplayEventBase & { type: "contextMenu"; target: string | null; x: number; y: number })
  // Gaze tracking events (premium)
  | (ReplayEventBase & { type: "gazePoint"; x: number; y: number; confidence: number })
  | (ReplayEventBase & { type: "gazeFixation"; x: number; y: number; durationMs: number; target: string | null })
  | (ReplayEventBase & { type: "gazeSaccade"; fromX: number; fromY: number; toX: number; toY: number; velocityDegPerS: number })
  | (ReplayEventBase & { type: "gazeBlink"; durationMs: number })
  | (ReplayEventBase & { type: "gazeCalibration"; accuracy: number; pointCount: number })
  | (ReplayEventBase & { type: "gazeLost"; reason: number });

export interface PreparedReplayLane extends ReplayParticipantSummary {
  lane: number;
  durationMs: number;
  eventCount: number;
  events: ReplayLaneEvent[];
  source: "wasm" | "ts";
}

export interface PreparedReplaySession {
  source: "wasm" | "ts";
  durationMs: number;
  lanes: PreparedReplayLane[];
  mergedEvents: ReplayLaneEvent[];
}

export interface ReplayLaneSnapshot {
  lane: number;
  label: string;
  durationMs: number;
  currentEvent: ReplayLaneEvent | null;
  elapsedEventCount: number;
  progress: number;
  scrollY: number;
  scrollMax: number;
  scrollRatio: number;
  page: number;
  totalPages: number;
  currentTarget: string | null;
  focusedTarget: string | null;
  highlightedLabel: string | null;
  modalName: string | null;
  hidden: boolean;
  recentKeys: string[];
  recentClipboard: Array<{ action: string; summary: string; atMs: number }>;
  recentFields: Array<{ target: string | null; value: string; atMs: number }>;
  signatureStrokes: Array<Array<{ x: number; y: number }>>;
  committedSignature: string | null;
  /** Current gaze position (normalized 0-1000 viewport coordinates) or null if not tracked */
  gazePosition: { x: number; y: number; confidence: number } | null;
  /** Whether gaze tracking is currently lost */
  gazeTrackingLost: boolean;
  /** Recent gaze trail (last N points for heatmap/trail rendering) */
  gazeTrail: Array<{ x: number; y: number; confidence: number; atMs: number }>;
  /** Active fixation in progress (if any) */
  gazeFixation: { x: number; y: number; durationMs: number } | null;
  /** Total blinks so far */
  gazeBlinkCount: number;
  /** Whether gaze tracking is active for this lane */
  gazeActive: boolean;
}

type WasmPlaybackEvent =
  | { type: "scroll"; lane: number; atMs: number; deltaMs: number; scrollY: number; scrollMax: number }
  | { type: "click"; lane: number; atMs: number; deltaMs: number; targetId: number; x: number; y: number; button: number }
  | { type: "key"; lane: number; atMs: number; deltaMs: number; targetId: number; keyId: number; modifiers: number }
  | { type: "focus"; lane: number; atMs: number; deltaMs: number; targetId: number }
  | { type: "blur"; lane: number; atMs: number; deltaMs: number; targetId: number }
  | { type: "visibility"; lane: number; atMs: number; deltaMs: number; hidden: boolean }
  | { type: "highlight"; lane: number; atMs: number; deltaMs: number; targetId: number; labelId: number }
  | { type: "navigation"; lane: number; atMs: number; deltaMs: number; direction: string; targetId: number; index: number }
  | { type: "page"; lane: number; atMs: number; deltaMs: number; page: number; totalPages: number }
  | { type: "modal"; lane: number; atMs: number; deltaMs: number; nameId: number; open: boolean }
  | {
      type: "signatureStart";
      lane: number;
      atMs: number;
      deltaMs: number;
      targetId: number;
      strokeId: number;
      x: number;
      y: number;
      pressure: number;
    }
  | { type: "signaturePoint"; lane: number; atMs: number; deltaMs: number; strokeId: number; x: number; y: number; pressure: number }
  | { type: "signatureEnd"; lane: number; atMs: number; deltaMs: number; strokeId: number }
  | { type: "signatureCommit"; lane: number; atMs: number; deltaMs: number; targetId: number; signatureId: number }
  | { type: "signatureClear"; lane: number; atMs: number; deltaMs: number; targetId: number }
  | { type: "fieldCommit"; lane: number; atMs: number; deltaMs: number; targetId: number; valueId: number }
  | { type: "clipboard"; lane: number; atMs: number; deltaMs: number; action: string; targetId: number; summaryId: number }
  | { type: "contextMenu"; lane: number; atMs: number; deltaMs: number; targetId: number; x: number; y: number };

type WasmPlaybackLane = {
  lane: number;
  label?: string | null;
  durationMs: number;
  eventCount: number;
  events: WasmPlaybackEvent[];
};

type WasmPlaybackTimeline = {
  durationMs: number;
  laneCount: number;
  eventCount: number;
  lanes: WasmPlaybackLane[];
  events: WasmPlaybackEvent[];
};

type ForensicPlaybackWasmModule = {
  default: () => Promise<unknown>;
  build_replay_timeline: (tapeBase64: string, lane: number, label?: string | null) => WasmPlaybackTimeline;
  merge_replay_timelines: (lanes: WasmPlaybackLane[]) => WasmPlaybackTimeline;
};

let playbackModulePromise: Promise<ForensicPlaybackWasmModule | null> | null = null;

function safeTarget(replay: ForensicReplayTape, id: number) {
  if (!id) return null;
  return replay.targets.find((target) => target.id === id)?.descriptor ?? null;
}

function safeString(replay: ForensicReplayTape, id: number) {
  if (!id) return "";
  return replay.strings.find((entry) => entry.id === id)?.value ?? "";
}

function normalizePressure(value: number) {
  return Math.max(0, Math.min(255, value)) / 255;
}

function normalizeWasmEvent(event: WasmPlaybackEvent, replay: ForensicReplayTape): ReplayLaneEvent {
  switch (event.type) {
    case "scroll":
      return event;
    case "click":
      return { ...event, target: safeTarget(replay, event.targetId) };
    case "key":
      return { ...event, target: safeTarget(replay, event.targetId), key: safeString(replay, event.keyId) };
    case "focus":
      return { ...event, target: safeTarget(replay, event.targetId) };
    case "blur":
      return { ...event, target: safeTarget(replay, event.targetId) };
    case "visibility":
      return event;
    case "highlight":
      return {
        ...event,
        target: safeTarget(replay, event.targetId),
        label: safeString(replay, event.labelId) || null,
      };
    case "navigation":
      return { ...event, target: safeTarget(replay, event.targetId) };
    case "page":
      return event;
    case "modal":
      return { ...event, name: safeString(replay, event.nameId) };
    case "signatureStart":
      return {
        ...event,
        target: safeTarget(replay, event.targetId),
        pressure: normalizePressure(event.pressure),
      };
    case "signaturePoint":
      return { ...event, pressure: normalizePressure(event.pressure) };
    case "signatureEnd":
      return event;
    case "signatureCommit":
      return {
        ...event,
        target: safeTarget(replay, event.targetId),
        signature: safeString(replay, event.signatureId),
      };
    case "signatureClear":
      return { ...event, target: safeTarget(replay, event.targetId) };
    case "fieldCommit":
      return {
        ...event,
        target: safeTarget(replay, event.targetId),
        value: safeString(replay, event.valueId),
      };
    case "clipboard":
      return {
        ...event,
        target: safeTarget(replay, event.targetId),
        summary: safeString(replay, event.summaryId),
      };
    case "contextMenu":
      return { ...event, target: safeTarget(replay, event.targetId) };
  }
}

function normalizeFallbackLane(participant: ReplayParticipantSummary, lane: number): PreparedReplayLane {
  const events = decodeForensicReplay(participant.replay).map<ReplayLaneEvent>((event, index, source) => {
    const deltaMs = index === 0 ? event.at : Math.max(0, event.at - source[index - 1]!.at);
    switch (event.type) {
      case "scroll":
        return { type: "scroll", lane, atMs: event.at, deltaMs, scrollY: event.scrollY, scrollMax: event.scrollMax };
      case "click":
        return { type: "click", lane, atMs: event.at, deltaMs, target: event.target?.descriptor ?? null, x: event.x, y: event.y, button: event.button };
      case "key":
        return {
          type: "key",
          lane,
          atMs: event.at,
          deltaMs,
          target: event.target?.descriptor ?? null,
          key: event.key,
          modifiers:
            (event.modifiers.shift ? 1 : 0) |
            (event.modifiers.ctrl ? 2 : 0) |
            (event.modifiers.alt ? 4 : 0) |
            (event.modifiers.meta ? 8 : 0) |
            (event.modifiers.repeat ? 16 : 0),
        };
      case "focus":
        return { type: "focus", lane, atMs: event.at, deltaMs, target: event.target?.descriptor ?? null };
      case "blur":
        return { type: "blur", lane, atMs: event.at, deltaMs, target: event.target?.descriptor ?? null };
      case "visibility":
        return { type: "visibility", lane, atMs: event.at, deltaMs, hidden: event.hidden };
      case "highlight":
        return {
          type: "highlight",
          lane,
          atMs: event.at,
          deltaMs,
          target: event.target?.descriptor ?? null,
          label: event.label,
        };
      case "navigation":
        return {
          type: "navigation",
          lane,
          atMs: event.at,
          deltaMs,
          direction: event.direction,
          target: event.target?.descriptor ?? null,
          index: event.index,
        };
      case "page":
        return { type: "page", lane, atMs: event.at, deltaMs, page: event.page, totalPages: event.totalPages };
      case "modal":
        return { type: "modal", lane, atMs: event.at, deltaMs, name: event.name, open: event.open };
      case "signatureStart":
        return {
          type: "signatureStart",
          lane,
          atMs: event.at,
          deltaMs,
          target: event.target?.descriptor ?? null,
          strokeId: event.strokeId,
          x: event.x,
          y: event.y,
          pressure: event.pressure,
        };
      case "signaturePoint":
        return {
          type: "signaturePoint",
          lane,
          atMs: event.at,
          deltaMs,
          strokeId: event.strokeId,
          x: event.x,
          y: event.y,
          pressure: event.pressure,
        };
      case "signatureEnd":
        return { type: "signatureEnd", lane, atMs: event.at, deltaMs, strokeId: event.strokeId };
      case "signatureCommit":
        return {
          type: "signatureCommit",
          lane,
          atMs: event.at,
          deltaMs,
          target: event.target?.descriptor ?? null,
          signature: event.signature,
        };
      case "signatureClear":
        return { type: "signatureClear", lane, atMs: event.at, deltaMs, target: event.target?.descriptor ?? null };
      case "fieldCommit":
        return { type: "fieldCommit", lane, atMs: event.at, deltaMs, target: event.target?.descriptor ?? null, value: event.value };
      case "clipboard":
        return {
          type: "clipboard",
          lane,
          atMs: event.at,
          deltaMs,
          action: event.action,
          target: event.target?.descriptor ?? null,
          summary: event.summary,
        };
      case "contextMenu":
        return {
          type: "contextMenu",
          lane,
          atMs: event.at,
          deltaMs,
          target: event.target?.descriptor ?? null,
          x: event.x,
          y: event.y,
        };
      case "gazePoint":
        return { type: "gazePoint", lane, atMs: event.at, deltaMs, x: event.x, y: event.y, confidence: event.confidence };
      case "gazeFixation":
        return {
          type: "gazeFixation",
          lane,
          atMs: event.at,
          deltaMs,
          x: event.x,
          y: event.y,
          durationMs: event.durationMs,
          target: event.target?.descriptor ?? null,
        };
      case "gazeSaccade":
        return {
          type: "gazeSaccade",
          lane,
          atMs: event.at,
          deltaMs,
          fromX: event.fromX,
          fromY: event.fromY,
          toX: event.toX,
          toY: event.toY,
          velocityDegPerS: event.velocityDegPerS,
        };
      case "gazeBlink":
        return { type: "gazeBlink", lane, atMs: event.at, deltaMs, durationMs: event.durationMs };
      case "gazeCalibration":
        return { type: "gazeCalibration", lane, atMs: event.at, deltaMs, accuracy: event.accuracy, pointCount: event.pointCount };
      case "gazeLost":
        return { type: "gazeLost", lane, atMs: event.at, deltaMs, reason: event.reason };
    }
  });

  return {
    ...participant,
    lane,
    durationMs: events.at(-1)?.atMs ?? 0,
    eventCount: events.length,
    events,
    source: "ts",
  };
}

async function loadPlaybackModule() {
  if (!playbackModulePromise) {
    playbackModulePromise = (async () => {
      if (typeof window === "undefined" || typeof WebAssembly === "undefined") return null;
      try {
        const module = (await import("~/lib/forensic/generated/forensic_core.js")) as ForensicPlaybackWasmModule;
        await module.default();
        return module;
      } catch {
        return null;
      }
    })();
  }

  return playbackModulePromise;
}

export async function prepareReplaySession(
  participants: ReplayParticipantSummary[],
): Promise<PreparedReplaySession> {
  if (participants.length === 0) {
    return { source: "ts", durationMs: 0, lanes: [], mergedEvents: [] };
  }

  const wasm = await loadPlaybackModule();
  if (wasm) {
    try {
      const rawLanes: WasmPlaybackLane[] = [];
      const replayByLane = new Map<number, ForensicReplayTape>();
      const lanes = participants.map<PreparedReplayLane>((participant, index) => {
        const laneNumber = index + 1;
        replayByLane.set(laneNumber, participant.replay);
        const timeline = wasm.build_replay_timeline(participant.replay.tapeBase64, laneNumber, participant.label);
        const rawLane = timeline.lanes[0] ?? {
          lane: laneNumber,
          label: participant.label,
          durationMs: 0,
          eventCount: 0,
          events: [],
        };
        rawLanes.push(rawLane);
        return {
          ...participant,
          lane: rawLane.lane,
          durationMs: rawLane.durationMs,
          eventCount: rawLane.eventCount,
          events: rawLane.events.map((event) => normalizeWasmEvent(event, participant.replay)),
          source: "wasm",
        };
      });

      const merged = wasm.merge_replay_timelines(rawLanes);
      return {
        source: "wasm",
        durationMs: merged.durationMs,
        lanes,
        mergedEvents: merged.events.map((event) => normalizeWasmEvent(event, replayByLane.get(event.lane) ?? participants[0]!.replay)),
      };
    } catch {
      // Fall through to the deterministic TS path.
    }
  }

  const lanes = participants.map((participant, index) => normalizeFallbackLane(participant, index + 1));
  const mergedEvents = lanes
    .flatMap((lane) => lane.events)
    .sort((left, right) => left.atMs - right.atMs || left.lane - right.lane);

  return {
    source: "ts",
    durationMs: lanes.reduce((max, lane) => Math.max(max, lane.durationMs), 0),
    lanes,
    mergedEvents,
  };
}

export function formatReplayKey(modifiers: number, key: string) {
  const parts: string[] = [];
  if ((modifiers & 8) !== 0) parts.push("Meta");
  if ((modifiers & 2) !== 0) parts.push("Ctrl");
  if ((modifiers & 4) !== 0) parts.push("Alt");
  if ((modifiers & 1) !== 0) parts.push("Shift");
  parts.push(key === " " ? "Space" : key);
  return parts.join("+");
}

export function describeReplayEvent(event: ReplayLaneEvent | null) {
  if (!event) return "Waiting for replay";
  switch (event.type) {
    case "scroll":
      return `Scrolled to ${Math.round((event.scrollY / Math.max(1, event.scrollMax)) * 100)}%`;
    case "click":
      return `Clicked ${event.target ?? "surface"}`;
    case "key":
      return `Pressed ${formatReplayKey(event.modifiers, event.key)}`;
    case "focus":
      return `Focused ${event.target ?? "field"}`;
    case "blur":
      return `Blurred ${event.target ?? "field"}`;
    case "visibility":
      return event.hidden ? "Tab hidden" : "Tab active";
    case "highlight":
      return `Highlighted ${event.label ?? event.target ?? "selection"}`;
    case "navigation":
      return `Navigation ${event.direction} ${event.index > 0 ? `(${event.index})` : ""}`.trim();
    case "page":
      return `Viewed page ${event.page}/${Math.max(1, event.totalPages)}`;
    case "modal":
      return `${event.open ? "Opened" : "Closed"} ${event.name || "modal"}`;
    case "signatureStart":
      return "Started signature stroke";
    case "signaturePoint":
      return "Drawing signature";
    case "signatureEnd":
      return "Lifted pen";
    case "signatureCommit":
      return "Committed signature";
    case "signatureClear":
      return "Cleared signature";
    case "fieldCommit":
      return `Committed ${event.target ?? "field"} value`;
    case "clipboard":
      return `${event.action} on ${event.target ?? "field"}`;
    case "contextMenu":
      return `Opened context menu on ${event.target ?? "surface"}`;
    case "gazePoint":
      return `Gaze at (${Math.round(event.x / 10)}%, ${Math.round(event.y / 10)}%)`;
    case "gazeFixation":
      return `Fixation ${event.durationMs}ms at (${Math.round(event.x / 10)}%, ${Math.round(event.y / 10)}%)`;
    case "gazeSaccade":
      return `Saccade ${event.velocityDegPerS}°/s`;
    case "gazeBlink":
      return `Blink ${event.durationMs}ms`;
    case "gazeCalibration":
      return `Gaze calibration: ${Math.round((event.accuracy / 255) * 100)}% accuracy`;
    case "gazeLost":
      return "Gaze tracking lost";
  }
}

export function buildReplayLaneSnapshot(
  lane: PreparedReplayLane,
  currentMs: number,
): ReplayLaneSnapshot {
  const recentKeys: string[] = [];
  const recentClipboard: ReplayLaneSnapshot["recentClipboard"] = [];
  const recentFields: ReplayLaneSnapshot["recentFields"] = [];
  const activeStrokes = new Map<number, Array<{ x: number; y: number }>>();
  const strokeOrder: number[] = [];

  let currentEvent: ReplayLaneEvent | null = null;
  let elapsedEventCount = 0;
  let scrollY = 0;
  let scrollMax = lane.replay.viewport.scrollHeight || 0;
  let page = 1;
  let totalPages = 1;
  let currentTarget: string | null = null;
  let focusedTarget: string | null = null;
  let highlightedLabel: string | null = null;
  let modalName: string | null = null;
  let hidden = false;
  let committedSignature: string | null = null;
  let gazePosition: ReplayLaneSnapshot["gazePosition"] = null;
  let gazeTrackingLost = false;
  const gazeTrail: ReplayLaneSnapshot["gazeTrail"] = [];
  let gazeFixation: ReplayLaneSnapshot["gazeFixation"] = null;
  let gazeBlinkCount = 0;
  let gazeActive = false;
  const GAZE_TRAIL_MAX = 60;

  for (const event of lane.events) {
    if (event.atMs > currentMs) break;
    currentEvent = event;
    elapsedEventCount += 1;

    switch (event.type) {
      case "scroll":
        scrollY = event.scrollY;
        scrollMax = Math.max(scrollMax, event.scrollMax);
        break;
      case "click":
        currentTarget = event.target;
        break;
      case "key":
        currentTarget = event.target;
        recentKeys.unshift(formatReplayKey(event.modifiers, event.key));
        recentKeys.splice(8);
        break;
      case "focus":
        currentTarget = event.target;
        focusedTarget = event.target;
        break;
      case "blur":
        currentTarget = event.target;
        if (focusedTarget === event.target) focusedTarget = null;
        break;
      case "visibility":
        hidden = event.hidden;
        break;
      case "highlight":
        currentTarget = event.target;
        highlightedLabel = event.label ?? event.target;
        break;
      case "navigation":
        currentTarget = event.target;
        break;
      case "page":
        page = event.page;
        totalPages = event.totalPages;
        break;
      case "modal":
        modalName = event.open ? event.name : null;
        break;
      case "signatureStart":
        currentTarget = event.target;
        if (!activeStrokes.has(event.strokeId)) {
          strokeOrder.push(event.strokeId);
        }
        activeStrokes.set(event.strokeId, [{ x: event.x, y: event.y }]);
        break;
      case "signaturePoint": {
        const stroke = activeStrokes.get(event.strokeId) ?? [];
        if (stroke.length === 0) strokeOrder.push(event.strokeId);
        stroke.push({ x: event.x, y: event.y });
        activeStrokes.set(event.strokeId, stroke);
        break;
      }
      case "signatureEnd":
        break;
      case "signatureCommit":
        currentTarget = event.target;
        committedSignature = event.signature;
        break;
      case "signatureClear":
        currentTarget = event.target;
        committedSignature = null;
        activeStrokes.clear();
        strokeOrder.length = 0;
        break;
      case "fieldCommit":
        currentTarget = event.target;
        recentFields.unshift({ target: event.target, value: event.value, atMs: event.atMs });
        recentFields.splice(4);
        break;
      case "clipboard":
        currentTarget = event.target;
        recentClipboard.unshift({ action: event.action, summary: event.summary, atMs: event.atMs });
        recentClipboard.splice(4);
        break;
      case "contextMenu":
        currentTarget = event.target;
        break;
      case "gazePoint":
        gazeActive = true;
        gazeTrackingLost = false;
        gazePosition = { x: event.x, y: event.y, confidence: event.confidence };
        gazeTrail.push({ x: event.x, y: event.y, confidence: event.confidence, atMs: event.atMs });
        if (gazeTrail.length > GAZE_TRAIL_MAX) gazeTrail.shift();
        break;
      case "gazeFixation":
        gazeFixation = { x: event.x, y: event.y, durationMs: event.durationMs };
        break;
      case "gazeSaccade":
        gazeFixation = null;
        break;
      case "gazeBlink":
        gazeBlinkCount += 1;
        break;
      case "gazeCalibration":
        gazeActive = true;
        break;
      case "gazeLost":
        gazeTrackingLost = true;
        gazePosition = null;
        break;
    }
  }

  return {
    lane: lane.lane,
    label: lane.label,
    durationMs: lane.durationMs,
    currentEvent,
    elapsedEventCount,
    progress: lane.durationMs > 0 ? Math.min(1, currentMs / lane.durationMs) : 0,
    scrollY,
    scrollMax,
    scrollRatio: scrollMax > 0 ? Math.min(1, scrollY / scrollMax) : 0,
    page,
    totalPages,
    currentTarget,
    focusedTarget,
    highlightedLabel,
    modalName,
    hidden,
    recentKeys,
    recentClipboard,
    recentFields,
    signatureStrokes: strokeOrder
      .map((strokeId) => activeStrokes.get(strokeId) ?? [])
      .filter((stroke) => stroke.length > 0),
    committedSignature,
    gazePosition,
    gazeTrackingLost,
    gazeTrail,
    gazeFixation,
    gazeBlinkCount,
    gazeActive,
  };
}
