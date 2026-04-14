import type { PreparedReplayLane, ReplayLaneEvent, ReplayLaneSnapshot } from "./replay-runtime-types";

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

/** Mutable accumulator for buildReplayLaneSnapshot */
type SnapshotAccumulator = {
  currentEvent: ReplayLaneEvent | null;
  elapsedEventCount: number;
  scrollY: number;
  scrollMax: number;
  page: number;
  totalPages: number;
  currentTarget: string | null;
  focusedTarget: string | null;
  highlightedLabel: string | null;
  modalName: string | null;
  hidden: boolean;
  committedSignature: string | null;
  gazePosition: ReplayLaneSnapshot["gazePosition"];
  gazeTrackingLost: boolean;
  gazeFixation: ReplayLaneSnapshot["gazeFixation"];
  gazeBlinkCount: number;
  gazeActive: boolean;
  recentKeys: string[];
  recentClipboard: ReplayLaneSnapshot["recentClipboard"];
  recentFields: ReplayLaneSnapshot["recentFields"];
  gazeTrail: ReplayLaneSnapshot["gazeTrail"];
  activeStrokes: Map<number, Array<{ x: number; y: number }>>;
  strokeOrder: number[];
};

function applySnapshotEvent(acc: SnapshotAccumulator, event: ReplayLaneEvent) {
  acc.currentEvent = event;
  acc.elapsedEventCount += 1;

  switch (event.type) {
    case "scroll":
      acc.scrollY = event.scrollY;
      acc.scrollMax = Math.max(acc.scrollMax, event.scrollMax);
      break;
    case "click":
      acc.currentTarget = event.target;
      break;
    case "key":
      acc.currentTarget = event.target;
      acc.recentKeys.unshift(formatReplayKey(event.modifiers, event.key));
      acc.recentKeys.splice(8);
      break;
    case "focus":
      acc.currentTarget = event.target;
      acc.focusedTarget = event.target;
      break;
    case "blur":
      acc.currentTarget = event.target;
      if (acc.focusedTarget === event.target) acc.focusedTarget = null;
      break;
    case "visibility":
      acc.hidden = event.hidden;
      break;
    case "highlight":
      acc.currentTarget = event.target;
      acc.highlightedLabel = event.label ?? event.target;
      break;
    case "navigation":
      acc.currentTarget = event.target;
      break;
    case "page":
      acc.page = event.page;
      acc.totalPages = event.totalPages;
      break;
    case "modal":
      acc.modalName = event.open ? event.name : null;
      break;
    case "signatureStart":
      acc.currentTarget = event.target;
      if (!acc.activeStrokes.has(event.strokeId)) {
        acc.strokeOrder.push(event.strokeId);
      }
      acc.activeStrokes.set(event.strokeId, [{ x: event.x, y: event.y }]);
      break;
    case "signaturePoint": {
      const stroke = acc.activeStrokes.get(event.strokeId) ?? [];
      if (stroke.length === 0) acc.strokeOrder.push(event.strokeId);
      stroke.push({ x: event.x, y: event.y });
      acc.activeStrokes.set(event.strokeId, stroke);
      break;
    }
    case "signatureEnd":
      break;
    case "signatureCommit":
      acc.currentTarget = event.target;
      acc.committedSignature = event.signature;
      break;
    case "signatureClear":
      acc.currentTarget = event.target;
      acc.committedSignature = null;
      acc.activeStrokes.clear();
      acc.strokeOrder.length = 0;
      break;
    case "fieldCommit":
      acc.currentTarget = event.target;
      acc.recentFields.unshift({
        target: event.target,
        value: event.value,
        atMs: event.atMs,
      });
      acc.recentFields.splice(4);
      break;
    case "clipboard":
      acc.currentTarget = event.target;
      acc.recentClipboard.unshift({
        action: event.action,
        summary: event.summary,
        atMs: event.atMs,
      });
      acc.recentClipboard.splice(4);
      break;
    case "contextMenu":
      acc.currentTarget = event.target;
      break;
    case "gazePoint":
      acc.gazeActive = true;
      acc.gazeTrackingLost = false;
      acc.gazePosition = {
        x: event.x,
        y: event.y,
        confidence: event.confidence,
      };
      acc.gazeTrail.push({
        x: event.x,
        y: event.y,
        confidence: event.confidence,
        atMs: event.atMs,
      });
      if (acc.gazeTrail.length > 60) acc.gazeTrail.shift();
      break;
    case "gazeFixation":
      acc.gazeFixation = {
        x: event.x,
        y: event.y,
        durationMs: event.durationMs,
      };
      break;
    case "gazeSaccade":
      acc.gazeFixation = null;
      break;
    case "gazeBlink":
      acc.gazeBlinkCount += 1;
      break;
    case "gazeCalibration":
      acc.gazeActive = true;
      break;
    case "gazeLost":
      acc.gazeTrackingLost = true;
      acc.gazePosition = null;
      break;
  }
}

export function buildReplayLaneSnapshot(lane: PreparedReplayLane, currentMs: number): ReplayLaneSnapshot {
  const acc: SnapshotAccumulator = {
    currentEvent: null,
    elapsedEventCount: 0,
    scrollY: 0,
    scrollMax: lane.replay.viewport.scrollHeight || 0,
    page: 1,
    totalPages: 1,
    currentTarget: null,
    focusedTarget: null,
    highlightedLabel: null,
    modalName: null,
    hidden: false,
    committedSignature: null,
    gazePosition: null,
    gazeTrackingLost: false,
    gazeFixation: null,
    gazeBlinkCount: 0,
    gazeActive: false,
    recentKeys: [],
    recentClipboard: [],
    recentFields: [],
    gazeTrail: [],
    activeStrokes: new Map(),
    strokeOrder: [],
  };

  for (const event of lane.events) {
    if (event.atMs > currentMs) break;
    applySnapshotEvent(acc, event);
  }

  return {
    lane: lane.lane,
    label: lane.label,
    durationMs: lane.durationMs,
    currentEvent: acc.currentEvent,
    elapsedEventCount: acc.elapsedEventCount,
    progress: lane.durationMs > 0 ? Math.min(1, currentMs / lane.durationMs) : 0,
    scrollY: acc.scrollY,
    scrollMax: acc.scrollMax,
    scrollRatio: acc.scrollMax > 0 ? Math.min(1, acc.scrollY / acc.scrollMax) : 0,
    page: acc.page,
    totalPages: acc.totalPages,
    currentTarget: acc.currentTarget,
    focusedTarget: acc.focusedTarget,
    highlightedLabel: acc.highlightedLabel,
    modalName: acc.modalName,
    hidden: acc.hidden,
    recentKeys: acc.recentKeys,
    recentClipboard: acc.recentClipboard,
    recentFields: acc.recentFields,
    signatureStrokes: acc.strokeOrder
      .map((strokeId) => acc.activeStrokes.get(strokeId) ?? [])
      .filter((stroke) => stroke.length > 0),
    committedSignature: acc.committedSignature,
    gazePosition: acc.gazePosition,
    gazeTrackingLost: acc.gazeTrackingLost,
    gazeTrail: acc.gazeTrail,
    gazeFixation: acc.gazeFixation,
    gazeBlinkCount: acc.gazeBlinkCount,
    gazeActive: acc.gazeActive,
  };
}
