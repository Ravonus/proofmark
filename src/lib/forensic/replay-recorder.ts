import {
  encodeReplayEventsSync,
  encodeTimedSignatureSync,
  type ForensicReplayEncodedEvent,
  quantizePressure,
} from "./replay-codec";
import { resolveForensicReplayCore } from "./replay-core";
import {
  type REPLAY_CLIPBOARD_ACTION_CODES,
  REPLAY_ENCODING,
  REPLAY_FORMAT_LIMITS,
  type REPLAY_NAV_DIRECTION_CODES,
} from "./replay-format";
import {
  byte,
  canonicalizeTarget,
  encodeOneEvent,
  eventKind,
  type FinalizeContext,
  fnv1a64,
  gazeQ,
  getViewport,
  normalizeStoredString,
  nowMs,
  type RecordedGazeAnchor,
  type RecordedReplayEvent,
  type ReplayStringKind,
  resolveGazeAnchor,
  round,
  snapshotValue,
  summarizeClipboard,
  type TargetSource,
} from "./replay-recorder-helpers";
import type {
  ForensicReplayEventKind,
  ForensicReplayGazeAnchorEntry,
  ForensicReplayGazeMetadata,
  ForensicReplayGazeSample,
  ForensicReplayStringEntry,
  ForensicReplayTape,
  ForensicReplayTarget,
  TimedSignatureStroke,
} from "./types";

const TIME_QUANTUM_MS = REPLAY_FORMAT_LIMITS.timeQuantumMs;

export class DeterministicReplayRecorder {
  private readonly startedAt = nowMs();
  private viewport = getViewport();
  private readonly events: RecordedReplayEvent[] = [];
  private readonly capabilities = new Set<ForensicReplayEventKind>();
  private readonly activeSignaturePoints = new Map<number, { x: number; y: number }>();
  private readonly pendingFieldTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingFieldValues = new Map<string, string>();
  private lastScrollRecord = { at: 0, y: -1 };
  private nextStrokeId = 1;
  private finalized: Promise<ForensicReplayTape> | null = null;
  private metrics = {
    eventCount: 0,
    signatureStrokeCount: 0,
    signaturePointCount: 0,
    clipboardEventCount: 0,
    gazePointCount: 0,
    gazeFixationCount: 0,
    gazeBlinkCount: 0,
  };
  private lastGazeRecord = { at: 0, x: -1, y: -1 };

  private elapsed() {
    return nowMs() - this.startedAt;
  }

  private pushEvent(event: RecordedReplayEvent) {
    this.events.push(event);
    this.metrics.eventCount += 1;
    this.capabilities.add(eventKind(event));
  }

  recordScroll(scrollY: number, scrollMax: number) {
    const current = this.elapsed();
    const nextY = Math.max(0, round(scrollY));
    if (
      this.lastScrollRecord.y >= 0 &&
      Math.abs(nextY - this.lastScrollRecord.y) < 12 &&
      current - this.lastScrollRecord.at < 64
    ) {
      return;
    }
    this.lastScrollRecord = { at: current, y: nextY };
    this.pushEvent({
      type: "scroll",
      at: current,
      scrollY: nextY,
      scrollMax: Math.max(0, round(scrollMax)),
    });
  }

  recordClick(event: MouseEvent) {
    this.pushEvent({
      type: "click",
      at: this.elapsed(),
      target: canonicalizeTarget(event.target),
      x: Math.max(0, round(event.clientX)),
      y: Math.max(0, round(event.clientY)),
      button: Math.max(0, event.button ?? 0),
    });
  }

  recordContextMenu(event: MouseEvent) {
    this.pushEvent({
      type: "contextMenu",
      at: this.elapsed(),
      target: canonicalizeTarget(event.target),
      x: Math.max(0, round(event.clientX)),
      y: Math.max(0, round(event.clientY)),
    });
  }

  recordKey(event: KeyboardEvent) {
    const key = event.key.length === 1 ? event.key : event.code;
    const modifiers =
      (event.shiftKey ? 1 : 0) |
      (event.ctrlKey ? 2 : 0) |
      (event.altKey ? 4 : 0) |
      (event.metaKey ? 8 : 0) |
      (event.repeat ? 16 : 0);
    this.pushEvent({
      type: "key",
      at: this.elapsed(),
      target: canonicalizeTarget(event.target),
      key,
      modifiers,
    });
  }

  recordFocus(target: TargetSource) {
    this.pushEvent({
      type: "focus",
      at: this.elapsed(),
      target: canonicalizeTarget(target),
    });
  }

  recordBlur(target: TargetSource) {
    this.pushEvent({
      type: "blur",
      at: this.elapsed(),
      target: canonicalizeTarget(target),
    });
  }

  recordVisibility(hidden: boolean) {
    this.pushEvent({ type: "visibility", at: this.elapsed(), hidden });
  }

  recordHighlight(target: TargetSource, label?: string | null) {
    this.pushEvent({
      type: "highlight",
      at: this.elapsed(),
      target: canonicalizeTarget(target),
      label: label ?? null,
    });
  }

  recordNavigation(direction: keyof typeof REPLAY_NAV_DIRECTION_CODES, target?: TargetSource, index?: number) {
    this.pushEvent({
      type: "navigation",
      at: this.elapsed(),
      direction,
      target: target == null ? null : canonicalizeTarget(target),
      index: Math.max(0, index ?? 0),
    });
  }

  recordPage(page: number, totalPages: number) {
    this.pushEvent({
      type: "page",
      at: this.elapsed(),
      page: Math.max(0, round(page)),
      totalPages: Math.max(0, round(totalPages)),
    });
  }

  recordModal(name: string, open: boolean) {
    this.pushEvent({ type: "modal", at: this.elapsed(), name, open });
  }

  recordSignatureStrokeStart(target: TargetSource, x: number, y: number, pressure?: number | null) {
    const strokeId = this.nextStrokeId++;
    this.metrics.signatureStrokeCount += 1;
    this.metrics.signaturePointCount += 1;
    const nextX = Math.max(0, round(x));
    const nextY = Math.max(0, round(y));
    this.activeSignaturePoints.set(strokeId, { x: nextX, y: nextY });
    this.pushEvent({
      type: "signatureStart",
      at: this.elapsed(),
      target: canonicalizeTarget(target),
      strokeId,
      x: nextX,
      y: nextY,
      pressure: quantizePressure(pressure),
    });
    return strokeId;
  }

  recordSignaturePoint(strokeId: number, x: number, y: number, pressure?: number | null) {
    if (!this.activeSignaturePoints.has(strokeId)) return;
    const nextX = Math.max(0, round(x));
    const nextY = Math.max(0, round(y));
    this.metrics.signaturePointCount += 1;
    this.activeSignaturePoints.set(strokeId, { x: nextX, y: nextY });
    this.pushEvent({
      type: "signaturePoint",
      at: this.elapsed(),
      strokeId,
      x: nextX,
      y: nextY,
      pressure: quantizePressure(pressure),
    });
  }

  recordSignatureStrokeEnd(strokeId: number) {
    if (!this.activeSignaturePoints.has(strokeId)) return;
    this.activeSignaturePoints.delete(strokeId);
    this.pushEvent({ type: "signatureEnd", at: this.elapsed(), strokeId });
  }

  recordSignatureCommit(target: TargetSource, strokes: TimedSignatureStroke[]) {
    this.pushEvent({
      type: "signatureCommit",
      at: this.elapsed(),
      target: canonicalizeTarget(target),
      strokes,
    });
  }

  recordSignatureClear(target: TargetSource) {
    this.pushEvent({
      type: "signatureClear",
      at: this.elapsed(),
      target: canonicalizeTarget(target),
    });
  }

  recordFieldValue(fieldId: string, value: string) {
    this.pendingFieldValues.set(fieldId, snapshotValue(value));
    const existing = this.pendingFieldTimers.get(fieldId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => this.flushFieldValue(fieldId), 180);
    this.pendingFieldTimers.set(fieldId, timer);
  }

  flushFieldValue(fieldId: string) {
    const timer = this.pendingFieldTimers.get(fieldId);
    if (timer) clearTimeout(timer);
    this.pendingFieldTimers.delete(fieldId);
    const value = this.pendingFieldValues.get(fieldId);
    if (value == null) return;
    this.pendingFieldValues.delete(fieldId);
    this.pushEvent({
      type: "fieldCommit",
      at: this.elapsed(),
      target: canonicalizeTarget(`field:${fieldId}`),
      value,
    });
  }

  recordGazePoint(x: number, y: number, confidence: number) {
    const at = this.elapsed();
    const qx = gazeQ(x),
      qy = gazeQ(y);
    if (this.lastGazeRecord.x === qx && this.lastGazeRecord.y === qy && at - this.lastGazeRecord.at < 16) return;
    this.lastGazeRecord = { at, x: qx, y: qy };
    this.metrics.gazePointCount++;

    this.pushEvent({
      type: "gazePoint",
      at,
      x: qx,
      y: qy, // viewport-relative [0, 1000]
      confidence: byte(confidence * 255),
      anchor: resolveGazeAnchor(x, y),
    });
  }

  recordGazeFixation(x: number, y: number, durationMs: number, target?: TargetSource) {
    this.metrics.gazeFixationCount++;
    this.pushEvent({
      type: "gazeFixation",
      at: this.elapsed(),
      x: gazeQ(x),
      y: gazeQ(y),
      durationMs: round(durationMs),
      target: canonicalizeTarget(target),
    });
  }

  recordGazeSaccade(fromX: number, fromY: number, toX: number, toY: number, velocityDegPerS: number) {
    this.pushEvent({
      type: "gazeSaccade",
      at: this.elapsed(),
      fromX: gazeQ(fromX),
      fromY: gazeQ(fromY),
      toX: gazeQ(toX),
      toY: gazeQ(toY),
      velocityDegPerS: round(velocityDegPerS),
    });
  }

  recordGazeBlink(durationMs: number) {
    this.metrics.gazeBlinkCount++;
    this.pushEvent({
      type: "gazeBlink",
      at: this.elapsed(),
      durationMs: round(durationMs),
    });
  }

  recordGazeCalibration(accuracy: number, pointCount: number) {
    this.pushEvent({
      type: "gazeCalibration",
      at: this.elapsed(),
      accuracy: byte(accuracy * 255),
      pointCount: round(pointCount),
    });
  }

  recordGazeLost(reason: number) {
    this.pushEvent({
      type: "gazeLost",
      at: this.elapsed(),
      reason: byte(reason),
    });
  }

  recordClipboard(action: keyof typeof REPLAY_CLIPBOARD_ACTION_CODES, target: TargetSource, text?: string | null) {
    this.metrics.clipboardEventCount += 1;
    this.pushEvent({
      type: "clipboard",
      at: this.elapsed(),
      target: canonicalizeTarget(target),
      action,
      summary: summarizeClipboard(text),
    });
  }

  private flushAllFieldValues() {
    for (const fieldId of [...this.pendingFieldValues.keys()]) {
      this.flushFieldValue(fieldId);
    }
  }

  private async encodeEventBatch(
    events: RecordedReplayEvent[],
    ctx: FinalizeContext,
  ): Promise<ForensicReplayEncodedEvent[]> {
    const encodedEvents: ForensicReplayEncodedEvent[] = [];
    let lastEventAt = 0;
    for (const event of events) {
      const delta = Math.max(0, round((event.at - lastEventAt) / TIME_QUANTUM_MS));
      lastEventAt = event.at;
      const encoded = await encodeOneEvent(event, delta, ctx, encodeTimedSignatureSync);
      if (encoded) encodedEvents.push(encoded);
    }
    return encodedEvents;
  }

  private async computeTapeHash(tapeBase64: string): Promise<string> {
    const hashSource = JSON.stringify({
      encoding: REPLAY_ENCODING,
      tapeBase64,
    });
    try {
      if (typeof crypto !== "undefined" && crypto.subtle) {
        return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashSource))))
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
      }
      return fnv1a64(hashSource).padEnd(64, "0");
    } catch {
      return fnv1a64(tapeBase64).padEnd(64, "0");
    }
  }

  async finalize(): Promise<ForensicReplayTape> {
    if (this.finalized) return this.finalized;
    this.finalized = (async () => {
      this.flushAllFieldValues();
      // Re-capture viewport at finalize time (page content may have loaded since construction)
      this.viewport = getViewport();
      // Try WASM, fall back to TS sync encoder — must not throw
      let core: {
        kind: string;
        encodeReplayEvents: (e: ForensicReplayEncodedEvent[]) => Promise<{ tapeBase64: string; byteLength: number }>;
        encodeSignature: (s: TimedSignatureStroke[]) => Promise<string>;
      };
      try {
        core = await resolveForensicReplayCore();
      } catch {
        core = {
          kind: "ts-inline",
          encodeReplayEvents: async (events) => encodeReplayEventsSync(events),
          encodeSignature: async (strokes) => encodeTimedSignatureSync(strokes),
        };
      }
      const targetEntries: ForensicReplayTarget[] = [];
      const stringEntries: ForensicReplayStringEntry[] = [];
      const gazeAnchorEntries: ForensicReplayGazeAnchorEntry[] = [];
      const gazeSamples: ForensicReplayGazeSample[] = [];
      const targetIndex = new Map<string, number>();
      const stringIndex = new Map<string, number>();
      const gazeAnchorIndex = new Map<string, number>();
      const registerTarget = (descriptor: string | null | undefined) => {
        if (!descriptor) return 0;
        const existing = targetIndex.get(descriptor);
        if (existing != null) return existing;
        const id = targetEntries.length + 1;
        targetEntries.push({ id, hash: fnv1a64(descriptor), descriptor });
        targetIndex.set(descriptor, id);
        return id;
      };

      const registerString = (kind: ReplayStringKind, value: string) => {
        const normalized = normalizeStoredString(kind, value);
        const key = `${kind}:${normalized}`;
        const existing = stringIndex.get(key);
        if (existing != null) return existing;
        const id = stringEntries.length + 1;
        stringEntries.push({
          id,
          kind,
          hash: fnv1a64(normalized),
          value: normalized,
        });
        stringIndex.set(key, id);
        return id;
      };

      const registerGazeAnchor = (anchor: RecordedGazeAnchor | null) => {
        if (!anchor) return 0;
        const key = `${anchor.attribute}:${anchor.value}`;
        const existing = gazeAnchorIndex.get(key);
        if (existing != null) return existing;
        const id = gazeAnchorEntries.length + 1;
        gazeAnchorEntries.push({
          id,
          attribute: anchor.attribute,
          value: anchor.value,
        });
        gazeAnchorIndex.set(key, id);
        return id;
      };

      const ctx: FinalizeContext = {
        core,
        registerTarget,
        registerString,
        registerGazeAnchor,
        gazeSamples,
      };
      const encodedEvents = await this.encodeEventBatch(this.events, ctx);

      let tapeBase64: string;
      let byteLength: number;
      try {
        const result = await core.encodeReplayEvents(encodedEvents);
        tapeBase64 = result.tapeBase64;
        byteLength = result.byteLength;
      } catch {
        const result = encodeReplayEventsSync(encodedEvents);
        tapeBase64 = result.tapeBase64;
        byteLength = result.byteLength;
      }

      const tapeHash = await this.computeTapeHash(tapeBase64);

      return {
        version: 1,
        encoding: REPLAY_ENCODING,
        timeQuantumMs: TIME_QUANTUM_MS,
        viewport: this.viewport,
        targets: targetEntries,
        strings: stringEntries,
        gazeAnchors:
          gazeSamples.length > 0
            ? ({
                scale: 1000,
                anchors: gazeAnchorEntries,
                samples: gazeSamples,
              } satisfies ForensicReplayGazeMetadata)
            : null,
        tapeBase64,
        tapeHash,
        capabilities: [...this.capabilities].sort(),
        metrics: {
          eventCount: this.metrics.eventCount,
          byteLength,
          targetCount: targetEntries.length,
          stringCount: stringEntries.length,
          signatureStrokeCount: this.metrics.signatureStrokeCount,
          signaturePointCount: this.metrics.signaturePointCount,
          clipboardEventCount: this.metrics.clipboardEventCount,
          maxTimestampMs: this.events.at(-1)?.at ?? 0,
          gazePointCount: this.metrics.gazePointCount,
          gazeFixationCount: this.metrics.gazeFixationCount,
          gazeBlinkCount: this.metrics.gazeBlinkCount,
        },
      } satisfies ForensicReplayTape;
    })();
    return this.finalized;
  }
}
