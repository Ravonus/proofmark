import { decodeReplayEventsSync, type ForensicReplayEncodedEvent } from "./replay-codec";
import { REPLAY_FORMAT_LIMITS } from "./replay-format";

const TIME_QUANTUM_MS = REPLAY_FORMAT_LIMITS.timeQuantumMs;

export type PlaybackState = "idle" | "playing" | "paused" | "ended";

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  atMs: number;
}

export interface ActiveStroke {
  strokeId: number;
  targetId: number;
  points: StrokePoint[];
}

export interface SceneSnapshot {
  atMs: number;
  eventIndex: number;
  scrollY: number;
  scrollMax: number;
  page: number;
  totalPages: number;
  hidden: boolean;
  focusedTargetId: number;
  currentTargetId: number;
  modalNameId: number;
  modalOpen: boolean;
  activeStrokes: ActiveStroke[];
  committedSignatureIds: number[];
  fieldValues: Array<[number, number]>;
}

function eventDelta(e: ForensicReplayEncodedEvent): number {
  return e.delta;
}

function deltaToMs(delta: number): number {
  return delta * TIME_QUANTUM_MS;
}

function emptySnapshot(): SceneSnapshot {
  return {
    atMs: 0,
    eventIndex: 0,
    scrollY: 0,
    scrollMax: 0,
    page: 0,
    totalPages: 0,
    hidden: false,
    focusedTargetId: 0,
    currentTargetId: 0,
    modalNameId: 0,
    modalOpen: false,
    activeStrokes: [],
    committedSignatureIds: [],
    fieldValues: [],
  };
}

/**
 * Pure TS playback controller — fallback when WASM is unavailable.
 * Mirrors the Rust PlaybackController API exactly.
 */
export class TSPlaybackController {
  private events: ForensicReplayEncodedEvent[];
  private _state: PlaybackState = "idle";
  private _cursorMs = 0;
  private eventCursor = 0;
  private _speed = 1.0;
  private _durationMs: number;
  readonly lane: number;

  constructor(events: ForensicReplayEncodedEvent[], lane: number) {
    this.events = events;
    this.lane = lane;
    this._durationMs = events.reduce((acc, e) => acc + deltaToMs(eventDelta(e)), 0);
  }

  static fromTape(tapeBase64: string, lane: number): TSPlaybackController {
    return new TSPlaybackController(decodeReplayEventsSync(tapeBase64), lane);
  }

  get state(): PlaybackState {
    return this._state;
  }
  get cursorMs(): number {
    return this._cursorMs;
  }
  get durationMs(): number {
    return this._durationMs;
  }
  get speed(): number {
    return this._speed;
  }
  get eventCount(): number {
    return this.events.length;
  }
  get progress(): number {
    return this._durationMs === 0 ? 0 : Math.min(1, this._cursorMs / this._durationMs);
  }

  play() {
    if (this._state === "ended") this.seek(0);
    this._state = "playing";
  }

  pause() {
    if (this._state === "playing") this._state = "paused";
  }

  resume() {
    if (this._state === "paused") this._state = "playing";
  }

  setSpeed(speed: number) {
    this._speed = Math.max(0.1, Math.min(16, speed));
  }

  seek(targetMs: number) {
    const target = Math.min(targetMs, this._durationMs);
    this._cursorMs = target;
    this.eventCursor = 0;

    let atMs = 0;
    while (this.eventCursor < this.events.length) {
      const nextDelta = deltaToMs(eventDelta(this.events[this.eventCursor]!));
      if (atMs + nextDelta > target) break;
      atMs += nextDelta;
      this.eventCursor++;
    }

    if (target >= this._durationMs) {
      this._state = "ended";
    } else if (this._state === "ended") {
      this._state = "paused";
    }
  }

  tick(realElapsedMs: number): Array<[number, ForensicReplayEncodedEvent]> {
    if (this._state !== "playing") return [];

    const advanceMs = realElapsedMs * this._speed;
    const endMs = Math.min(this._cursorMs + advanceMs, this._durationMs);
    const fired: Array<[number, ForensicReplayEncodedEvent]> = [];

    let atMs = 0;
    for (let i = 0; i < this.eventCursor; i++) {
      atMs += deltaToMs(eventDelta(this.events[i]!));
    }

    while (this.eventCursor < this.events.length) {
      const nextDelta = deltaToMs(eventDelta(this.events[this.eventCursor]!));
      const nextMs = atMs + nextDelta;
      if (nextMs > endMs) break;
      atMs = nextMs;
      fired.push([atMs, this.events[this.eventCursor]!]);
      this.eventCursor++;
    }

    this._cursorMs = endMs;
    if (this._cursorMs >= this._durationMs) this._state = "ended";

    return fired;
  }

  snapshot(): SceneSnapshot {
    return this.snapshotAt(this._cursorMs);
  }

  snapshotAt(targetMs: number): SceneSnapshot {
    const snap = emptySnapshot();
    snap.atMs = targetMs;

    let atMs = 0;
    const activeStrokes = new Map<number, ActiveStroke>();
    const strokeOrder: number[] = [];

    for (let i = 0; i < this.events.length; i++) {
      const event = this.events[i]!;
      atMs += deltaToMs(eventDelta(event));
      if (atMs > targetMs) break;

      snap.eventIndex = i + 1;

      switch (event.type) {
        case "scroll":
          snap.scrollY = event.scrollY;
          snap.scrollMax = event.scrollMax;
          break;
        case "click":
          snap.currentTargetId = event.targetId;
          break;
        case "key":
          snap.currentTargetId = event.targetId;
          break;
        case "focus":
          snap.focusedTargetId = event.targetId;
          snap.currentTargetId = event.targetId;
          break;
        case "blur":
          if (snap.focusedTargetId === event.targetId) snap.focusedTargetId = 0;
          snap.currentTargetId = event.targetId;
          break;
        case "visibility":
          snap.hidden = event.hidden;
          break;
        case "highlight":
          snap.currentTargetId = event.targetId;
          break;
        case "navigation":
          snap.currentTargetId = event.targetId;
          break;
        case "page":
          snap.page = event.page;
          snap.totalPages = event.totalPages;
          break;
        case "modal":
          snap.modalNameId = event.nameId;
          snap.modalOpen = event.open;
          break;
        case "signatureStart":
          snap.currentTargetId = event.targetId;
          if (!activeStrokes.has(event.strokeId)) strokeOrder.push(event.strokeId);
          activeStrokes.set(event.strokeId, {
            strokeId: event.strokeId,
            targetId: event.targetId,
            points: [{ x: event.x, y: event.y, pressure: event.pressure, atMs }],
          });
          break;
        case "signaturePoint": {
          const stroke = activeStrokes.get(event.strokeId);
          if (stroke) {
            stroke.points.push({
              x: event.x,
              y: event.y,
              pressure: event.pressure,
              atMs,
            });
          }
          break;
        }
        case "signatureEnd":
          break;
        case "signatureCommit":
          snap.currentTargetId = event.targetId;
          snap.committedSignatureIds.push(event.signatureId);
          break;
        case "signatureClear":
          snap.currentTargetId = event.targetId;
          activeStrokes.clear();
          strokeOrder.length = 0;
          break;
        case "fieldCommit": {
          snap.currentTargetId = event.targetId;
          const existing = snap.fieldValues.find(([tid]) => tid === event.targetId);
          if (existing) existing[1] = event.valueId;
          else snap.fieldValues.push([event.targetId, event.valueId]);
          break;
        }
        case "clipboard":
          snap.currentTargetId = event.targetId;
          break;
        case "contextMenu":
          snap.currentTargetId = event.targetId;
          break;
      }
    }

    snap.activeStrokes = strokeOrder
      .map((sid) => activeStrokes.get(sid))
      .filter((s): s is ActiveStroke => s != null && s.points.length > 0);

    return snap;
  }
}

/**
 * Multi-signer synchronized controller (TS fallback).
 */
export class TSMultiSignerController {
  readonly controllers: TSPlaybackController[];
  readonly durationMs: number;
  private _state: PlaybackState = "idle";
  private _cursorMs = 0;
  private _speed = 1.0;

  constructor(controllers: TSPlaybackController[]) {
    this.controllers = controllers;
    this.durationMs = controllers.reduce((max, c) => Math.max(max, c.durationMs), 0);
  }

  get state(): PlaybackState {
    return this._state;
  }
  get cursorMs(): number {
    return this._cursorMs;
  }
  get speed(): number {
    return this._speed;
  }
  get progress(): number {
    return this.durationMs === 0 ? 0 : Math.min(1, this._cursorMs / this.durationMs);
  }

  play() {
    if (this._state === "ended") this.seek(0);
    this._state = "playing";
    for (const c of this.controllers) c.play();
  }

  pause() {
    this._state = "paused";
    for (const c of this.controllers) c.pause();
  }

  resume() {
    this._state = "playing";
    for (const c of this.controllers) c.resume();
  }

  setSpeed(speed: number) {
    this._speed = Math.max(0.1, Math.min(16, speed));
    for (const c of this.controllers) c.setSpeed(this._speed);
  }

  seek(targetMs: number) {
    const target = Math.min(targetMs, this.durationMs);
    this._cursorMs = target;
    for (const c of this.controllers) c.seek(target);
    if (target >= this.durationMs) this._state = "ended";
    else if (this._state === "ended") this._state = "paused";
  }

  tick(realElapsedMs: number): Array<[number, number, ForensicReplayEncodedEvent]> {
    if (this._state !== "playing") return [];
    const advance = realElapsedMs * this._speed;
    this._cursorMs = Math.min(this._cursorMs + advance, this.durationMs);

    const all: Array<[number, number, ForensicReplayEncodedEvent]> = [];
    for (const c of this.controllers) {
      for (const [atMs, event] of c.tick(realElapsedMs)) {
        all.push([atMs, c.lane, event]);
      }
    }
    all.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    if (this._cursorMs >= this.durationMs) this._state = "ended";
    return all;
  }

  snapshots(): Array<[number, SceneSnapshot]> {
    return this.controllers.map((c) => [c.lane, c.snapshot()]);
  }
}
