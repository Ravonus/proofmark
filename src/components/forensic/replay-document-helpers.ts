import type { ForensicReplayEncodedEvent } from "~/lib/forensic/replay-codec";
import { REPLAY_FORMAT_LIMITS } from "~/lib/forensic/replay-format";
import { classifyInteractions, classifySession } from "~/lib/forensic/session";
import type { BehavioralSignals, ForensicReplayTape } from "~/lib/forensic/types";

const TQ = REPLAY_FORMAT_LIMITS.timeQuantumMs;
const GAZE_SCALE = 1000;
const GAZE_TRAIL_LENGTH = 20;

export { GAZE_SCALE, GAZE_TRAIL_LENGTH, TQ };

const LANE_COLORS = ["#60a5fa", "#f87171", "#34d399", "#fbbf24", "#a78bfa", "#38bdf8", "#fb923c", "#e879f9"];

export function formatTime(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function laneColor(index: number) {
  return LANE_COLORS[index % LANE_COLORS.length] ?? "#60a5fa";
}

export function escapeSelectorValue(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function resolveFieldId(tape: ForensicReplayTape, targetId: number) {
  const target = tape.targets.find((entry) => entry.id === targetId);
  if (!target) return null;
  const match = /field:([^\s>|]+)/.exec(target.descriptor) ?? /\bid:([^\s>|]+)/.exec(target.descriptor);
  return match?.[1] ?? null;
}

function resolveString(tape: ForensicReplayTape, id: number) {
  return tape.strings.find((entry) => entry.id === id)?.value ?? "";
}

export type ReplayGazeAnchor = {
  attribute: "data-field-id" | "data-forensic-id";
  value: string;
  offsetX: number;
  offsetY: number;
};

export type ReplayGazePoint = {
  x: number;
  y: number;
  docY: number;
  confidence: number;
  anchor: ReplayGazeAnchor | null;
};

export type ReplayState = {
  scrollY: number;
  scrollMax: number;
  scrollRatio: number;
  focusedFieldId: string | null;
  fieldTexts: Record<string, string>;
  hidden: boolean;
  modalOpen: string | null;
  lastAction: string;
  lastActionAt: number;
  eventIndex: number;
  gaze: {
    active: boolean;
    current: ReplayGazePoint | null;
    trail: Array<ReplayGazePoint & { age: number }>;
  };
  signatureStrokes: Array<{
    strokeId: number;
    points: Array<{ x: number; y: number; pressure: number }>;
  }>;
  clearedStrokes: Array<
    Array<{
      strokeId: number;
      points: Array<{ x: number; y: number; pressure: number }>;
    }>
  >;
  activeStrokeId: number | null;
  signatureCommitted: boolean;
};

function resolveGazeAnchorSample(tape: ForensicReplayTape, sampleIndex: number): ReplayGazeAnchor | null {
  const metadata = tape.gazeAnchors;
  if (!metadata) return null;
  const sample = metadata.samples[sampleIndex];
  if (!sample?.anchorId) return null;
  const anchor = metadata.anchors.find((entry) => entry.id === sample.anchorId);
  if (!anchor) return null;
  const scale = metadata.scale || GAZE_SCALE;
  return {
    attribute: anchor.attribute,
    value: anchor.value,
    offsetX: sample.offsetX / scale,
    offsetY: sample.offsetY / scale,
  };
}

function accumulateGazeCounters(events: ForensicReplayEncodedEvent[]) {
  let gazePointCount = 0;
  let gazeFixationCount = 0;
  let gazeFixTotalMs = 0;
  let gazeBlinkCount = 0;
  let gazeTrackingLostMs = 0;
  let gazeLastLostAt: number | null = null;
  let atMs = 0;

  for (const event of events) {
    atMs += event.delta * TQ;
    switch (event.type) {
      case "gazePoint":
        gazePointCount++;
        if (gazeLastLostAt !== null) {
          gazeTrackingLostMs += atMs - gazeLastLostAt;
          gazeLastLostAt = null;
        }
        break;
      case "gazeFixation":
        gazeFixationCount++;
        gazeFixTotalMs += event.durationMs ?? 0;
        break;
      case "gazeBlink":
        gazeBlinkCount++;
        break;
      case "gazeLost":
        gazeLastLostAt = atMs;
        break;
    }
  }
  return {
    gazePointCount,
    gazeFixationCount,
    gazeFixTotalMs,
    gazeBlinkCount,
    gazeTrackingLostMs,
  };
}

/** Accumulate tape-level counters for behavioral signal reconstruction. */
function accumulateTapeCounters(events: ForensicReplayEncodedEvent[]) {
  const keyTimesMs: number[] = [];
  let atMs = 0;
  let clickCount = 0;
  let focusChanges = 0;
  let pasteEvents = 0;
  let copyEvents = 0;
  let cutEvents = 0;
  let mouseMoveCount = 0;
  let maxScrollDepth = 0;

  for (const event of events) {
    atMs += event.delta * TQ;
    switch (event.type) {
      case "key":
        keyTimesMs.push(atMs);
        break;
      case "click":
        clickCount++;
        break;
      case "focus":
        focusChanges++;
        break;
      case "scroll": {
        const depth = event.scrollMax > 0 ? event.scrollY / event.scrollMax : 0;
        if (depth > maxScrollDepth) maxScrollDepth = depth;
        mouseMoveCount += 2;
        break;
      }
      case "clipboard": {
        if (event.action === "paste") pasteEvents++;
        else if (event.action === "copy") copyEvents++;
        else if (event.action === "cut") cutEvents++;
        break;
      }
    }
  }

  const gaze = accumulateGazeCounters(events);

  return {
    atMs,
    keyTimesMs,
    clickCount,
    focusChanges,
    pasteEvents,
    copyEvents,
    cutEvents,
    mouseMoveCount,
    maxScrollDepth,
    ...gaze,
  };
}

export function classifyFromTape(tape: ForensicReplayTape, events: ForensicReplayEncodedEvent[]) {
  const counters = accumulateTapeCounters(events);

  const cadence: number[] = [];
  for (let index = 1; index < counters.keyTimesMs.length; index += 1) {
    cadence.push(counters.keyTimesMs[index]! - counters.keyTimesMs[index - 1]!);
  }

  const sessionMs = counters.atMs || 1;
  const gazeValidMs = sessionMs - counters.gazeTrackingLostMs;
  const gazeActive = counters.gazePointCount > 0 || (tape.metrics.gazePointCount ?? 0) > 0;
  const effectiveGazePoints = counters.gazePointCount || (tape.metrics.gazePointCount ?? 0);
  const effectiveFixations = counters.gazeFixationCount || (tape.metrics.gazeFixationCount ?? 0);
  const effectiveBlinks = counters.gazeBlinkCount || (tape.metrics.gazeBlinkCount ?? 0);

  const behavioral: BehavioralSignals = {
    timeOnPage: counters.atMs,
    scrolledToBottom: counters.maxScrollDepth > 0.85,
    maxScrollDepth: Math.round(counters.maxScrollDepth * 100),
    mouseMoveCount: counters.mouseMoveCount,
    clickCount: counters.clickCount,
    keyPressCount: counters.keyTimesMs.length,
    pageWasHidden: false,
    hiddenDuration: 0,
    interactionTimeline: [],
    typingCadence: cadence,
    mouseVelocityAvg: 0,
    mouseAccelerationPattern: "",
    touchPressureAvg: null,
    scrollPattern: [],
    focusChanges: counters.focusChanges,
    pasteEvents: counters.pasteEvents,
    copyEvents: counters.copyEvents,
    cutEvents: counters.cutEvents,
    rightClicks: 0,
    gazeTrackingActive: gazeActive,
    gazePointCount: effectiveGazePoints,
    gazeFixationCount: effectiveFixations,
    gazeFixationAvgMs: effectiveFixations > 0 ? counters.gazeFixTotalMs / effectiveFixations : 0,
    gazeBlinkCount: effectiveBlinks,
    gazeBlinkRate: sessionMs > 0 ? (effectiveBlinks / sessionMs) * 60000 : 0,
    gazeTrackingCoverage: gazeActive ? Math.max(0, Math.min(1, gazeValidMs / sessionMs)) : 0,
    replay: tape,
  };

  const interactions = classifyInteractions(tape, behavioral);
  const classification = classifySession(interactions, behavioral);
  return { classification, interactions };
}

type EventContext = {
  state: ReplayState;
  event: ForensicReplayEncodedEvent;
  tape: ForensicReplayTape;
  atMs: number;
  gazeSampleIndex: { value: number };
  docViewStartMs: number;
};

/** Apply a single event to the replay state accumulator. */
function applyEventToState(ctx: EventContext) {
  const { state, event, tape, atMs } = ctx;
  state.lastActionAt = atMs;

  switch (event.type) {
    case "scroll":
      state.scrollY = event.scrollY;
      state.scrollMax = Math.max(1, event.scrollMax);
      state.scrollRatio = state.scrollY / state.scrollMax;
      state.lastAction = `Scrolled ${Math.round(state.scrollRatio * 100)}%`;
      break;
    case "signatureStart":
      state.signatureStrokes.push({
        strokeId: event.strokeId,
        points: [{ x: event.x, y: event.y, pressure: event.pressure }],
      });
      state.activeStrokeId = event.strokeId;
      state.lastAction = "Signing...";
      break;
    case "signaturePoint": {
      const stroke = state.signatureStrokes.find((s) => s.strokeId === event.strokeId);
      if (stroke)
        stroke.points.push({
          x: event.x,
          y: event.y,
          pressure: event.pressure,
        });
      break;
    }
    case "signatureEnd":
      state.activeStrokeId = null;
      state.lastAction = "Stroke complete";
      break;
    case "signatureCommit":
      state.signatureCommitted = true;
      state.lastAction = "Signature committed";
      break;
    case "signatureClear":
      if (state.signatureStrokes.length > 0) {
        state.clearedStrokes.push([...state.signatureStrokes]);
      }
      state.signatureStrokes = [];
      state.signatureCommitted = false;
      state.lastAction = "Signature cleared";
      break;
    case "click":
      state.lastAction = "Clicked";
      break;
    case "key":
      state.lastAction = `Key "${resolveString(tape, event.keyId)}"`;
      break;
    case "focus":
      state.focusedFieldId = resolveFieldId(tape, event.targetId);
      state.lastAction = state.focusedFieldId ? `Focused ${state.focusedFieldId}` : "Focused";
      break;
    case "blur":
      state.focusedFieldId = null;
      break;
    case "visibility":
      state.hidden = event.hidden;
      state.lastAction = event.hidden ? "Tab hidden" : "Tab visible";
      break;
    case "modal":
      state.modalOpen = event.open ? resolveString(tape, event.nameId) : null;
      state.lastAction = event.open ? `Modal: ${resolveString(tape, event.nameId)}` : "Closed modal";
      break;
    case "fieldCommit": {
      const fieldId = resolveFieldId(tape, event.targetId);
      const value = resolveString(tape, event.valueId);
      if (fieldId) state.fieldTexts[fieldId] = value;
      state.lastAction = fieldId ? `${fieldId} updated` : "Field updated";
      break;
    }
    default:
      applyGazeEvent(ctx);
      break;
  }
}

function applyGazeEvent(ctx: EventContext) {
  const { state, event, tape, atMs, gazeSampleIndex, docViewStartMs } = ctx;
  switch (event.type) {
    case "gazePoint": {
      if (docViewStartMs > 0 && atMs < docViewStartMs) {
        gazeSampleIndex.value += 1;
        break;
      }
      const gx = event.x / GAZE_SCALE;
      const gy = event.y / GAZE_SCALE;
      const vpH = tape.viewport.height || 1;
      const totalH = Math.max(vpH, state.scrollMax + vpH);
      const docY = Math.max(0, Math.min(1, (state.scrollY + gy * vpH) / totalH));
      const point: ReplayGazePoint = {
        x: gx,
        y: gy,
        docY,
        confidence: (event.confidence ?? 0) / 255,
        anchor: resolveGazeAnchorSample(tape, gazeSampleIndex.value),
      };
      gazeSampleIndex.value += 1;
      state.gaze.active = true;
      state.gaze.current = point;
      state.gaze.trail.push({ ...point, age: 0 });
      if (state.gaze.trail.length > GAZE_TRAIL_LENGTH) state.gaze.trail.shift();
      for (let trailIndex = 0; trailIndex < state.gaze.trail.length - 1; trailIndex += 1) {
        state.gaze.trail[trailIndex]!.age += 1;
      }
      break;
    }
    case "gazeFixation":
      state.lastAction = `Fixation (${event.durationMs}ms)`;
      break;
    case "gazeBlink":
      state.lastAction = "Blink";
      break;
    case "gazeLost":
      state.gaze.active = false;
      state.gaze.current = null;
      break;
    default:
      break;
  }
}

export function buildStateAt(
  tape: ForensicReplayTape,
  events: ForensicReplayEncodedEvent[],
  targetMs: number,
  docViewStartMs = 0,
): ReplayState {
  const state: ReplayState = {
    scrollY: 0,
    scrollMax: 1,
    scrollRatio: 0,
    focusedFieldId: null,
    fieldTexts: {},
    hidden: false,
    modalOpen: null,
    lastAction: "",
    lastActionAt: 0,
    eventIndex: 0,
    gaze: { active: false, current: null, trail: [] },
    signatureStrokes: [],
    clearedStrokes: [],
    activeStrokeId: null,
    signatureCommitted: false,
  };

  let atMs = 0;
  const gazeSampleIndex = { value: 0 };

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    atMs += event.delta * TQ;
    if (atMs > targetMs) break;
    state.eventIndex = index + 1;
    applyEventToState({
      state,
      event,
      tape,
      atMs,
      gazeSampleIndex,
      docViewStartMs,
    });
  }

  return state;
}
