import { decodeForensicReplay } from "~/lib/forensic";
import type { ForensicReplayTape } from "~/lib/forensic/types";

export { buildReplayLaneSnapshot, describeReplayEvent, formatReplayKey } from "./replay-runtime-snapshot";
export type {
  PreparedReplayLane,
  PreparedReplaySession,
  ReplayLaneEvent,
  ReplayLaneSnapshot,
  ReplayParticipantSummary,
} from "./replay-runtime-types";

import type {
  ForensicPlaybackWasmModule,
  PreparedReplayLane,
  PreparedReplaySession,
  ReplayLaneEvent,
  ReplayParticipantSummary,
  WasmPlaybackEvent,
  WasmPlaybackLane,
} from "./replay-runtime-types";

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
      return {
        ...event,
        target: safeTarget(replay, event.targetId),
        key: safeString(replay, event.keyId),
      };
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

type DecodedEvent = ReturnType<typeof decodeForensicReplay>[number];
type EventBase = { lane: number; atMs: number; deltaMs: number };

/** Map gaze-specific decoded events to ReplayLaneEvent. */
function mapGazeEvent(
  event: Extract<
    DecodedEvent,
    | { type: "gazePoint" }
    | { type: "gazeFixation" }
    | { type: "gazeSaccade" }
    | { type: "gazeBlink" }
    | { type: "gazeCalibration" }
    | { type: "gazeLost" }
  >,
  base: EventBase,
): ReplayLaneEvent {
  switch (event.type) {
    case "gazePoint":
      return {
        ...base,
        type: "gazePoint",
        x: event.x,
        y: event.y,
        confidence: event.confidence,
      };
    case "gazeFixation":
      return {
        ...base,
        type: "gazeFixation",
        x: event.x,
        y: event.y,
        durationMs: event.durationMs,
        target: event.target?.descriptor ?? null,
      };
    case "gazeSaccade":
      return {
        ...base,
        type: "gazeSaccade",
        fromX: event.fromX,
        fromY: event.fromY,
        toX: event.toX,
        toY: event.toY,
        velocityDegPerS: event.velocityDegPerS,
      };
    case "gazeBlink":
      return { ...base, type: "gazeBlink", durationMs: event.durationMs };
    case "gazeCalibration":
      return {
        ...base,
        type: "gazeCalibration",
        accuracy: event.accuracy,
        pointCount: event.pointCount,
      };
    case "gazeLost":
      return { ...base, type: "gazeLost", reason: event.reason };
  }
}

/** Map signature/field/clipboard/context events to ReplayLaneEvent. */
function mapActionEvent(
  event: Extract<
    DecodedEvent,
    | { type: "signatureStart" }
    | { type: "signaturePoint" }
    | { type: "signatureEnd" }
    | { type: "signatureCommit" }
    | { type: "signatureClear" }
    | { type: "fieldCommit" }
    | { type: "clipboard" }
    | { type: "contextMenu" }
  >,
  base: EventBase,
): ReplayLaneEvent {
  switch (event.type) {
    case "signatureStart":
      return {
        ...base,
        type: "signatureStart",
        target: event.target?.descriptor ?? null,
        strokeId: event.strokeId,
        x: event.x,
        y: event.y,
        pressure: event.pressure,
      };
    case "signaturePoint":
      return {
        ...base,
        type: "signaturePoint",
        strokeId: event.strokeId,
        x: event.x,
        y: event.y,
        pressure: event.pressure,
      };
    case "signatureEnd":
      return { ...base, type: "signatureEnd", strokeId: event.strokeId };
    case "signatureCommit":
      return {
        ...base,
        type: "signatureCommit",
        target: event.target?.descriptor ?? null,
        signature: event.signature,
      };
    case "signatureClear":
      return {
        ...base,
        type: "signatureClear",
        target: event.target?.descriptor ?? null,
      };
    case "fieldCommit":
      return {
        ...base,
        type: "fieldCommit",
        target: event.target?.descriptor ?? null,
        value: event.value,
      };
    case "clipboard":
      return {
        ...base,
        type: "clipboard",
        action: event.action,
        target: event.target?.descriptor ?? null,
        summary: event.summary,
      };
    case "contextMenu":
      return {
        ...base,
        type: "contextMenu",
        target: event.target?.descriptor ?? null,
        x: event.x,
        y: event.y,
      };
  }
}

/** Map a single decoded forensic event to a ReplayLaneEvent. */
function mapDecodedEvent(event: DecodedEvent, lane: number, deltaMs: number): ReplayLaneEvent {
  const base: EventBase = { lane, atMs: event.at, deltaMs };

  switch (event.type) {
    case "scroll":
      return {
        ...base,
        type: "scroll",
        scrollY: event.scrollY,
        scrollMax: event.scrollMax,
      };
    case "click":
      return {
        ...base,
        type: "click",
        target: event.target?.descriptor ?? null,
        x: event.x,
        y: event.y,
        button: event.button,
      };
    case "key":
      return {
        ...base,
        type: "key",
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
      return {
        ...base,
        type: "focus",
        target: event.target?.descriptor ?? null,
      };
    case "blur":
      return {
        ...base,
        type: "blur",
        target: event.target?.descriptor ?? null,
      };
    case "visibility":
      return { ...base, type: "visibility", hidden: event.hidden };
    case "highlight":
      return {
        ...base,
        type: "highlight",
        target: event.target?.descriptor ?? null,
        label: event.label,
      };
    case "navigation":
      return {
        ...base,
        type: "navigation",
        direction: event.direction,
        target: event.target?.descriptor ?? null,
        index: event.index,
      };
    case "page":
      return {
        ...base,
        type: "page",
        page: event.page,
        totalPages: event.totalPages,
      };
    case "modal":
      return { ...base, type: "modal", name: event.name, open: event.open };
    case "gazePoint":
    case "gazeFixation":
    case "gazeSaccade":
    case "gazeBlink":
    case "gazeCalibration":
    case "gazeLost":
      return mapGazeEvent(event, base);
    default:
      return mapActionEvent(event, base);
  }
}

function normalizeFallbackLane(participant: ReplayParticipantSummary, lane: number): PreparedReplayLane {
  const events = decodeForensicReplay(participant.replay).map<ReplayLaneEvent>((event, index, source) => {
    const deltaMs = index === 0 ? event.at : Math.max(0, event.at - source[index - 1]!.at);
    return mapDecodedEvent(event, lane, deltaMs);
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
        // eslint-disable-next-line @next/next/no-assign-module-variable
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

export async function prepareReplaySession(participants: ReplayParticipantSummary[]): Promise<PreparedReplaySession> {
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
        mergedEvents: merged.events.map((event) =>
          normalizeWasmEvent(event, replayByLane.get(event.lane) ?? participants[0]!.replay),
        ),
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
