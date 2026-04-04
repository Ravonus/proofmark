import type {
  ForensicReplayEventKind,
  ForensicReplayGazeAnchorEntry,
  ForensicReplayGazeMetadata,
  ForensicReplayGazeSample,
  ForensicReplayStringEntry,
  ForensicReplayTape,
  ForensicReplayTarget,
  ForensicReplayViewport,
  TimedSignatureStroke,
} from "./types";
import {
  REPLAY_CLIPBOARD_ACTION_CODES,
  REPLAY_ENCODING,
  REPLAY_FORMAT_LIMITS,
  REPLAY_NAV_DIRECTION_CODES,
} from "./replay-format";
import {
  decodeReplayEventsSync,
  decodeTimedSignatureSync,
  dequantizePressure,
  encodeReplayEventsSync,
  encodeTimedSignatureSync,
  quantizePressure,
  type ForensicReplayEncodedEvent,
} from "./replay-codec";
import { resolveForensicReplayCore } from "./replay-core";

const TIME_QUANTUM_MS = REPLAY_FORMAT_LIMITS.timeQuantumMs;
const MAX_STORED_STRING_LENGTH = REPLAY_FORMAT_LIMITS.maxStoredStringLength;
const MAX_FIELD_SNAPSHOT_LENGTH = REPLAY_FORMAT_LIMITS.maxFieldSnapshotLength;
const MAX_CLIPBOARD_PREVIEW = REPLAY_FORMAT_LIMITS.maxClipboardPreview;

const NAV_DIRECTION_CODES = REPLAY_NAV_DIRECTION_CODES;
const CLIPBOARD_ACTION_CODES = REPLAY_CLIPBOARD_ACTION_CODES;

type ReplayStringKind = ForensicReplayStringEntry["kind"];
type ReplayGazeAnchorAttribute = ForensicReplayGazeAnchorEntry["attribute"];
type TargetSource = EventTarget | Element | string | null | undefined;
type RecordedGazeAnchor = {
  attribute: ReplayGazeAnchorAttribute;
  value: string;
  offsetX: number;
  offsetY: number;
};

type RecordedReplayEvent =
  | { type: "scroll"; at: number; scrollY: number; scrollMax: number }
  | { type: "click"; at: number; target: string | null; x: number; y: number; button: number }
  | { type: "key"; at: number; target: string | null; key: string; modifiers: number }
  | { type: "focus"; at: number; target: string | null }
  | { type: "blur"; at: number; target: string | null }
  | { type: "visibility"; at: number; hidden: boolean }
  | { type: "highlight"; at: number; target: string | null; label: string | null }
  | { type: "navigation"; at: number; direction: keyof typeof NAV_DIRECTION_CODES; target: string | null; index: number }
  | { type: "page"; at: number; page: number; totalPages: number }
  | { type: "modal"; at: number; name: string; open: boolean }
  | { type: "signatureStart"; at: number; target: string | null; strokeId: number; x: number; y: number; pressure: number }
  | { type: "signaturePoint"; at: number; strokeId: number; x: number; y: number; pressure: number }
  | { type: "signatureEnd"; at: number; strokeId: number }
  | { type: "signatureCommit"; at: number; target: string | null; strokes: TimedSignatureStroke[] }
  | { type: "signatureClear"; at: number; target: string | null }
  | { type: "fieldCommit"; at: number; target: string | null; value: string }
  | { type: "clipboard"; at: number; target: string | null; action: keyof typeof CLIPBOARD_ACTION_CODES; summary: string }
  | { type: "contextMenu"; at: number; target: string | null; x: number; y: number }
  // Gaze tracking events (premium)
  | { type: "gazePoint"; at: number; x: number; y: number; confidence: number; anchor: RecordedGazeAnchor | null }
  | { type: "gazeFixation"; at: number; x: number; y: number; durationMs: number; target: string | null }
  | { type: "gazeSaccade"; at: number; fromX: number; fromY: number; toX: number; toY: number; velocityDegPerS: number }
  | { type: "gazeBlink"; at: number; durationMs: number }
  | { type: "gazeCalibration"; at: number; accuracy: number; pointCount: number }
  | { type: "gazeLost"; at: number; reason: number };

export type DecodedForensicReplayEvent =
  | { type: "scroll"; at: number; scrollY: number; scrollMax: number }
  | { type: "click"; at: number; target: ForensicReplayTarget | null; x: number; y: number; button: number }
  | {
      type: "key";
      at: number;
      target: ForensicReplayTarget | null;
      key: string;
      modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean; repeat: boolean };
    }
  | { type: "focus"; at: number; target: ForensicReplayTarget | null }
  | { type: "blur"; at: number; target: ForensicReplayTarget | null }
  | { type: "visibility"; at: number; hidden: boolean }
  | { type: "highlight"; at: number; target: ForensicReplayTarget | null; label: string | null }
  | {
      type: "navigation";
      at: number;
      direction: keyof typeof NAV_DIRECTION_CODES;
      target: ForensicReplayTarget | null;
      index: number;
    }
  | { type: "page"; at: number; page: number; totalPages: number }
  | { type: "modal"; at: number; name: string; open: boolean }
  | {
      type: "signatureStart";
      at: number;
      target: ForensicReplayTarget | null;
      strokeId: number;
      x: number;
      y: number;
      pressure: number;
    }
  | {
      type: "signaturePoint";
      at: number;
      strokeId: number;
      x: number;
      y: number;
      pressure: number;
    }
  | { type: "signatureEnd"; at: number; strokeId: number }
  | { type: "signatureCommit"; at: number; target: ForensicReplayTarget | null; signature: string }
  | { type: "signatureClear"; at: number; target: ForensicReplayTarget | null }
  | { type: "fieldCommit"; at: number; target: ForensicReplayTarget | null; value: string }
  | {
      type: "clipboard";
      at: number;
      target: ForensicReplayTarget | null;
      action: keyof typeof CLIPBOARD_ACTION_CODES;
      summary: string;
    }
  | { type: "contextMenu"; at: number; target: ForensicReplayTarget | null; x: number; y: number }
  // Gaze tracking events (premium)
  | { type: "gazePoint"; at: number; x: number; y: number; confidence: number }
  | { type: "gazeFixation"; at: number; x: number; y: number; durationMs: number; target: ForensicReplayTarget | null }
  | { type: "gazeSaccade"; at: number; fromX: number; fromY: number; toX: number; toY: number; velocityDegPerS: number }
  | { type: "gazeBlink"; at: number; durationMs: number }
  | { type: "gazeCalibration"; at: number; accuracy: number; pointCount: number }
  | { type: "gazeLost"; at: number; reason: number };

export type ForensicReplayHandlers = {
  onEvent?: (event: DecodedForensicReplayEvent) => void;
  onScroll?: (event: Extract<DecodedForensicReplayEvent, { type: "scroll" }>) => void;
  onClick?: (event: Extract<DecodedForensicReplayEvent, { type: "click" }>) => void;
  onKey?: (event: Extract<DecodedForensicReplayEvent, { type: "key" }>) => void;
  onFocus?: (event: Extract<DecodedForensicReplayEvent, { type: "focus" }>) => void;
  onBlur?: (event: Extract<DecodedForensicReplayEvent, { type: "blur" }>) => void;
  onHighlight?: (event: Extract<DecodedForensicReplayEvent, { type: "highlight" }>) => void;
  onNavigation?: (event: Extract<DecodedForensicReplayEvent, { type: "navigation" }>) => void;
  onPage?: (event: Extract<DecodedForensicReplayEvent, { type: "page" }>) => void;
  onModal?: (event: Extract<DecodedForensicReplayEvent, { type: "modal" }>) => void;
  onSignatureStart?: (event: Extract<DecodedForensicReplayEvent, { type: "signatureStart" }>) => void;
  onSignaturePoint?: (event: Extract<DecodedForensicReplayEvent, { type: "signaturePoint" }>) => void;
  onSignatureEnd?: (event: Extract<DecodedForensicReplayEvent, { type: "signatureEnd" }>) => void;
  onSignatureCommit?: (event: Extract<DecodedForensicReplayEvent, { type: "signatureCommit" }>) => void;
  onSignatureClear?: (event: Extract<DecodedForensicReplayEvent, { type: "signatureClear" }>) => void;
  onFieldCommit?: (event: Extract<DecodedForensicReplayEvent, { type: "fieldCommit" }>) => void;
  onClipboard?: (event: Extract<DecodedForensicReplayEvent, { type: "clipboard" }>) => void;
  onContextMenu?: (event: Extract<DecodedForensicReplayEvent, { type: "contextMenu" }>) => void;
  onGazePoint?: (event: Extract<DecodedForensicReplayEvent, { type: "gazePoint" }>) => void;
  onGazeFixation?: (event: Extract<DecodedForensicReplayEvent, { type: "gazeFixation" }>) => void;
  onGazeSaccade?: (event: Extract<DecodedForensicReplayEvent, { type: "gazeSaccade" }>) => void;
  onGazeBlink?: (event: Extract<DecodedForensicReplayEvent, { type: "gazeBlink" }>) => void;
  onGazeCalibration?: (event: Extract<DecodedForensicReplayEvent, { type: "gazeCalibration" }>) => void;
  onGazeLost?: (event: Extract<DecodedForensicReplayEvent, { type: "gazeLost" }>) => void;
};

function round(value: number) {
  return Math.round(value);
}

function byte(v: number) {
  return Math.max(0, Math.min(255, round(v)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function gazeQ(normalized: number) {
  return Math.max(0, Math.min(1000, round(normalized * 1000)));
}

function nowMs() {
  return Date.now();
}

function fnv1a64(input: string) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function normalizeText(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_STORED_STRING_LENGTH);
}

function normalizeStoredString(kind: ReplayStringKind, value: string) {
  if (kind === "value" || kind === "signature") {
    return value.slice(0, MAX_STORED_STRING_LENGTH);
  }
  return normalizeText(value);
}

function snapshotValue(value: string) {
  if (value.length <= MAX_FIELD_SNAPSHOT_LENGTH) return value;
  return `__forensic_large__:${value.length}:${fnv1a64(value)}`;
}

function normalizeAnchorValue(value: string | null) {
  return (value ?? "").trim().slice(0, 128);
}

function summarizeClipboard(text: string | null | undefined) {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "len:0|hash:0000000000000000";
  const preview = normalized.slice(0, MAX_CLIPBOARD_PREVIEW);
  return `len:${normalized.length}|hash:${fnv1a64(normalized)}|preview:${preview}`;
}

function safeElement(target: TargetSource) {
  if (typeof target === "string" || !target) return null;
  if (target instanceof Element) return target;
  const node = target as Node;
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function readTargetText(element: Element) {
  return normalizeText(element.textContent ?? "").slice(0, 48);
}

function readTargetDescriptor(element: Element) {
  const tag = element.tagName.toLowerCase();
  const forensicId =
    element.getAttribute("data-forensic-id") ??
    element.getAttribute("data-field-id") ??
    element.getAttribute("data-testid") ??
    element.getAttribute("aria-label") ??
    element.getAttribute("name") ??
    element.id ??
    "";
  const role = element.getAttribute("role") ?? "";
  const type = element.getAttribute("type") ?? "";
  const text = readTargetText(element);
  const chunks = [`tag:${tag}`];
  if (forensicId) chunks.push(`id:${normalizeText(forensicId).slice(0, 64)}`);
  if (role) chunks.push(`role:${normalizeText(role).slice(0, 32)}`);
  if (type) chunks.push(`type:${normalizeText(type).slice(0, 32)}`);
  if (text) chunks.push(`text:${text}`);
  return chunks.join("|");
}

function canonicalizeTarget(target: TargetSource) {
  if (target == null) return null;
  if (typeof target === "string") return `synthetic|${normalizeText(target).slice(0, 96)}`;
  const element = safeElement(target);
  if (!element) return "synthetic|unknown";
  const parts: string[] = [];
  let current: Element | null = element;
  for (let depth = 0; current && depth < 4; depth += 1) {
    parts.push(readTargetDescriptor(current));
    current = current.parentElement;
  }
  return parts.join(">");
}

function resolveGazeAnchorElement(target: Element | null) {
  let current: Element | null = target;
  while (current) {
    const fieldId = normalizeAnchorValue(current.getAttribute("data-field-id"));
    if (fieldId) {
      return { element: current, attribute: "data-field-id" as const, value: fieldId };
    }
    const forensicId = normalizeAnchorValue(current.getAttribute("data-forensic-id"));
    if (forensicId) {
      return { element: current, attribute: "data-forensic-id" as const, value: forensicId };
    }
    current = current.parentElement;
  }
  return null;
}

function resolveGazeAnchor(x: number, y: number): RecordedGazeAnchor | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const viewportWidth = Math.max(1, window.innerWidth || 1);
  const viewportHeight = Math.max(1, window.innerHeight || 1);
  const px = clamp(x, 0, 1) * viewportWidth;
  const py = clamp(y, 0, 1) * viewportHeight;

  // elementFromPoint hits the topmost visible element.
  // If an overlay (gaze gate, modal, etc.) is covering the document,
  // we get the overlay element instead of the document content.
  // Use elementsFromPoint to look THROUGH overlays.
  let anchor: ReturnType<typeof resolveGazeAnchorElement> = null;
  if (typeof document.elementsFromPoint === "function") {
    const stack = document.elementsFromPoint(px, py);
    for (const el of stack) {
      anchor = resolveGazeAnchorElement(el);
      if (anchor) break;
    }
  } else {
    anchor = resolveGazeAnchorElement(document.elementFromPoint(px, py));
  }

  if (!anchor) return null;
  const rect = anchor.element.getBoundingClientRect();
  const width = Math.max(1, rect.width || 1);
  const height = Math.max(1, rect.height || 1);
  return {
    attribute: anchor.attribute,
    value: anchor.value,
    offsetX: gazeQ((px - rect.left) / width),
    offsetY: gazeQ((py - rect.top) / height),
  };
}

function getScrollInfo() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { scrollY: 0, scrollHeight: 1, viewportHeight: 1 };
  }
  // Use scrollingElement (the actual element that scrolls — body or documentElement)
  const se = document.scrollingElement ?? document.documentElement;
  const scrollY = se.scrollTop || window.scrollY || 0;
  // scrollHeight: take the max of body and documentElement to handle both modes
  const scrollHeight = Math.max(
    document.body?.scrollHeight ?? 0,
    document.documentElement?.scrollHeight ?? 0,
    se.scrollHeight ?? 0,
  );
  return {
    scrollY,
    scrollHeight: Math.max(scrollHeight, window.innerHeight || 1),
    viewportHeight: window.innerHeight || 1,
  };
}

function getViewport(): ForensicReplayViewport {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { width: 0, height: 0, devicePixelRatio: 1, scrollWidth: 0, scrollHeight: 0 };
  }
  const { scrollHeight } = getScrollInfo();
  return {
    width: round(window.innerWidth),
    height: round(window.innerHeight),
    devicePixelRatio: window.devicePixelRatio || 1,
    scrollWidth: round(Math.max(document.body?.scrollWidth ?? 0, document.documentElement?.scrollWidth ?? 0)),
    scrollHeight: round(scrollHeight),
  };
}

function eventKind(event: RecordedReplayEvent): ForensicReplayEventKind {
  switch (event.type) {
    case "scroll":
      return "scroll";
    case "click":
      return "click";
    case "key":
      return "key";
    case "focus":
      return "focus";
    case "blur":
      return "blur";
    case "visibility":
      return "visibility";
    case "highlight":
      return "highlight";
    case "navigation":
      return "navigation";
    case "page":
      return "page";
    case "modal":
      return "modal";
    case "signatureStart":
    case "signaturePoint":
    case "signatureEnd":
    case "signatureCommit":
    case "signatureClear":
      return "signature";
    case "fieldCommit":
      return "field";
    case "clipboard":
      return "clipboard";
    case "contextMenu":
      return "contextmenu";
    case "gazePoint":
    case "gazeFixation":
    case "gazeSaccade":
    case "gazeBlink":
    case "gazeCalibration":
    case "gazeLost":
      return "gaze";
  }
}

export function encodeTimedSignature(strokes: TimedSignatureStroke[]) {
  return encodeTimedSignatureSync(strokes);
}

export function decodeTimedSignature(encoded: string): TimedSignatureStroke[] {
  return decodeTimedSignatureSync(encoded);
}

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
    this.pushEvent({ type: "focus", at: this.elapsed(), target: canonicalizeTarget(target) });
  }

  recordBlur(target: TargetSource) {
    this.pushEvent({ type: "blur", at: this.elapsed(), target: canonicalizeTarget(target) });
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

  recordNavigation(direction: keyof typeof NAV_DIRECTION_CODES, target?: TargetSource, index?: number) {
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
    this.pushEvent({ type: "signatureClear", at: this.elapsed(), target: canonicalizeTarget(target) });
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
    const qx = gazeQ(x), qy = gazeQ(y);
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
    this.pushEvent({ type: "gazeFixation", at: this.elapsed(), x: gazeQ(x), y: gazeQ(y), durationMs: round(durationMs), target: canonicalizeTarget(target) });
  }

  recordGazeSaccade(fromX: number, fromY: number, toX: number, toY: number, velocityDegPerS: number) {
    this.pushEvent({ type: "gazeSaccade", at: this.elapsed(), fromX: gazeQ(fromX), fromY: gazeQ(fromY), toX: gazeQ(toX), toY: gazeQ(toY), velocityDegPerS: round(velocityDegPerS) });
  }

  recordGazeBlink(durationMs: number) {
    this.metrics.gazeBlinkCount++;
    this.pushEvent({ type: "gazeBlink", at: this.elapsed(), durationMs: round(durationMs) });
  }

  recordGazeCalibration(accuracy: number, pointCount: number) {
    this.pushEvent({ type: "gazeCalibration", at: this.elapsed(), accuracy: byte(accuracy * 255), pointCount: round(pointCount) });
  }

  recordGazeLost(reason: number) {
    this.pushEvent({ type: "gazeLost", at: this.elapsed(), reason: byte(reason) });
  }

  recordClipboard(action: keyof typeof CLIPBOARD_ACTION_CODES, target: TargetSource, text?: string | null) {
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

  async finalize(): Promise<ForensicReplayTape> {
    if (this.finalized) return this.finalized;
    this.finalized = (async () => {
      this.flushAllFieldValues();
      // Re-capture viewport at finalize time (page content may have loaded since construction)
      this.viewport = getViewport();
      // Try WASM, fall back to TS sync encoder — must not throw
      let core: { kind: string; encodeReplayEvents: (e: ForensicReplayEncodedEvent[]) => Promise<{ tapeBase64: string; byteLength: number }>; encodeSignature: (s: TimedSignatureStroke[]) => Promise<string> };
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
      const encodedEvents: ForensicReplayEncodedEvent[] = [];
      let lastEventAt = 0;

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
        stringEntries.push({ id, kind, hash: fnv1a64(normalized), value: normalized });
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

      for (const event of this.events) {
        const delta = Math.max(0, round((event.at - lastEventAt) / TIME_QUANTUM_MS));
        lastEventAt = event.at;

        switch (event.type) {
          case "scroll":
            encodedEvents.push({ type: "scroll", delta, scrollY: event.scrollY, scrollMax: event.scrollMax });
            break;
          case "click":
            encodedEvents.push({
              type: "click",
              delta,
              targetId: registerTarget(event.target),
              x: event.x,
              y: event.y,
              button: event.button,
            });
            break;
          case "key":
            encodedEvents.push({
              type: "key",
              delta,
              targetId: registerTarget(event.target),
              keyId: registerString("key", event.key),
              modifiers: event.modifiers,
            });
            break;
          case "focus":
            encodedEvents.push({ type: "focus", delta, targetId: registerTarget(event.target) });
            break;
          case "blur":
            encodedEvents.push({ type: "blur", delta, targetId: registerTarget(event.target) });
            break;
          case "visibility":
            encodedEvents.push({ type: "visibility", delta, hidden: event.hidden });
            break;
          case "highlight":
            encodedEvents.push({
              type: "highlight",
              delta,
              targetId: registerTarget(event.target),
              labelId: event.label ? registerString("label", event.label) : 0,
            });
            break;
          case "navigation":
            encodedEvents.push({
              type: "navigation",
              delta,
              direction: event.direction,
              targetId: registerTarget(event.target),
              index: event.index,
            });
            break;
          case "page":
            encodedEvents.push({ type: "page", delta, page: event.page, totalPages: event.totalPages });
            break;
          case "modal":
            encodedEvents.push({
              type: "modal",
              delta,
              nameId: registerString("label", event.name),
              open: event.open,
            });
            break;
          case "signatureStart":
            encodedEvents.push({
              type: "signatureStart",
              delta,
              targetId: registerTarget(event.target),
              strokeId: event.strokeId,
              x: event.x,
              y: event.y,
              pressure: event.pressure,
            });
            break;
          case "signaturePoint":
            encodedEvents.push({
              type: "signaturePoint",
              delta,
              strokeId: event.strokeId,
              x: event.x,
              y: event.y,
              pressure: event.pressure,
            });
            break;
          case "signatureEnd":
            encodedEvents.push({ type: "signatureEnd", delta, strokeId: event.strokeId });
            break;
          case "signatureCommit": {
            let signature: string;
            try {
              signature = await core.encodeSignature(event.strokes);
            } catch {
              signature = encodeTimedSignatureSync(event.strokes);
            }
            encodedEvents.push({
              type: "signatureCommit",
              delta,
              targetId: registerTarget(event.target),
              signatureId: registerString("signature", signature),
            });
            break;
          }
          case "signatureClear":
            encodedEvents.push({ type: "signatureClear", delta, targetId: registerTarget(event.target) });
            break;
          case "fieldCommit":
            encodedEvents.push({
              type: "fieldCommit",
              delta,
              targetId: registerTarget(event.target),
              valueId: registerString("value", event.value),
            });
            break;
          case "clipboard":
            encodedEvents.push({
              type: "clipboard",
              delta,
              action: event.action,
              targetId: registerTarget(event.target),
              summaryId: registerString("clipboard", event.summary),
            });
            break;
          case "contextMenu":
            encodedEvents.push({
              type: "contextMenu",
              delta,
              targetId: registerTarget(event.target),
              x: event.x,
              y: event.y,
            });
            break;
          case "gazePoint":
            gazeSamples.push({
              anchorId: registerGazeAnchor(event.anchor),
              offsetX: event.anchor?.offsetX ?? 0,
              offsetY: event.anchor?.offsetY ?? 0,
            });
            encodedEvents.push({ type: "gazePoint", delta, x: event.x, y: event.y, confidence: event.confidence });
            break;
          case "gazeFixation":
            encodedEvents.push({
              type: "gazeFixation",
              delta,
              x: event.x,
              y: event.y,
              durationMs: event.durationMs,
              targetId: registerTarget(event.target),
            });
            break;
          case "gazeSaccade":
            encodedEvents.push({
              type: "gazeSaccade",
              delta,
              fromX: event.fromX,
              fromY: event.fromY,
              toX: event.toX,
              toY: event.toY,
              velocityDegPerS: event.velocityDegPerS,
            });
            break;
          case "gazeBlink":
            encodedEvents.push({ type: "gazeBlink", delta, durationMs: event.durationMs });
            break;
          case "gazeCalibration":
            encodedEvents.push({ type: "gazeCalibration", delta, accuracy: event.accuracy, pointCount: event.pointCount });
            break;
          case "gazeLost":
            encodedEvents.push({ type: "gazeLost", delta, reason: event.reason });
            break;
        }
      }

      let tapeBase64: string;
      let byteLength: number;
      try {
        const result = await core.encodeReplayEvents(encodedEvents);
        tapeBase64 = result.tapeBase64;
        byteLength = result.byteLength;
      } catch {
        // Last resort: sync TS encoder
        const result = encodeReplayEventsSync(encodedEvents);
        tapeBase64 = result.tapeBase64;
        byteLength = result.byteLength;
      }

      let tapeHash: string;
      try {
        const hashSource = JSON.stringify({ encoding: REPLAY_ENCODING, tapeBase64 });
        if (typeof crypto !== "undefined" && crypto.subtle) {
          tapeHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashSource))))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        } else {
          tapeHash = fnv1a64(hashSource).padEnd(64, "0");
        }
      } catch {
        tapeHash = fnv1a64(tapeBase64).padEnd(64, "0");
      }

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

function getTarget(targets: ForensicReplayTarget[], id: number) {
  return targets.find((target) => target.id === id) ?? null;
}

function getString(strings: ForensicReplayStringEntry[], id: number) {
  return strings.find((entry) => entry.id === id)?.value ?? "";
}

export function decodeForensicReplay(replay: ForensicReplayTape): DecodedForensicReplayEvent[] {
  if (replay.encoding !== REPLAY_ENCODING || !replay.tapeBase64) return [];

  const encodedEvents = decodeReplayEventsSync(replay.tapeBase64);
  const events: DecodedForensicReplayEvent[] = [];
  let at = 0;

  for (const event of encodedEvents) {
    at += event.delta * replay.timeQuantumMs;
    switch (event.type) {
      case "scroll":
        events.push({ type: "scroll", at, scrollY: event.scrollY, scrollMax: event.scrollMax });
        break;
      case "click":
        events.push({
          type: "click",
          at,
          target: getTarget(replay.targets, event.targetId),
          x: event.x,
          y: event.y,
          button: event.button,
        });
        break;
      case "key":
        events.push({
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
        });
        break;
      case "focus":
        events.push({ type: "focus", at, target: getTarget(replay.targets, event.targetId) });
        break;
      case "blur":
        events.push({ type: "blur", at, target: getTarget(replay.targets, event.targetId) });
        break;
      case "visibility":
        events.push({ type: "visibility", at, hidden: event.hidden });
        break;
      case "highlight":
        events.push({
          type: "highlight",
          at,
          target: getTarget(replay.targets, event.targetId),
          label: getString(replay.strings, event.labelId) || null,
        });
        break;
      case "navigation":
        events.push({
          type: "navigation",
          at,
          direction: event.direction,
          target: getTarget(replay.targets, event.targetId),
          index: event.index,
        });
        break;
      case "page":
        events.push({ type: "page", at, page: event.page, totalPages: event.totalPages });
        break;
      case "modal":
        events.push({
          type: "modal",
          at,
          name: getString(replay.strings, event.nameId),
          open: event.open,
        });
        break;
      case "signatureStart":
        events.push({
          type: "signatureStart",
          at,
          target: getTarget(replay.targets, event.targetId),
          strokeId: event.strokeId,
          x: event.x,
          y: event.y,
          pressure: dequantizePressure(event.pressure),
        });
        break;
      case "signaturePoint":
        events.push({
          type: "signaturePoint",
          at,
          strokeId: event.strokeId,
          x: event.x,
          y: event.y,
          pressure: dequantizePressure(event.pressure),
        });
        break;
      case "signatureEnd":
        events.push({ type: "signatureEnd", at, strokeId: event.strokeId });
        break;
      case "signatureCommit":
        events.push({
          type: "signatureCommit",
          at,
          target: getTarget(replay.targets, event.targetId),
          signature: getString(replay.strings, event.signatureId),
        });
        break;
      case "signatureClear":
        events.push({ type: "signatureClear", at, target: getTarget(replay.targets, event.targetId) });
        break;
      case "fieldCommit":
        events.push({
          type: "fieldCommit",
          at,
          target: getTarget(replay.targets, event.targetId),
          value: getString(replay.strings, event.valueId),
        });
        break;
      case "clipboard":
        events.push({
          type: "clipboard",
          at,
          action: event.action,
          target: getTarget(replay.targets, event.targetId),
          summary: getString(replay.strings, event.summaryId),
        });
        break;
      case "contextMenu":
        events.push({
          type: "contextMenu",
          at,
          target: getTarget(replay.targets, event.targetId),
          x: event.x,
          y: event.y,
        });
        break;
      case "gazePoint":
        events.push({ type: "gazePoint", at, x: event.x, y: event.y, confidence: event.confidence });
        break;
      case "gazeFixation":
        events.push({
          type: "gazeFixation",
          at,
          x: event.x,
          y: event.y,
          durationMs: event.durationMs,
          target: getTarget(replay.targets, event.targetId),
        });
        break;
      case "gazeSaccade":
        events.push({
          type: "gazeSaccade",
          at,
          fromX: event.fromX,
          fromY: event.fromY,
          toX: event.toX,
          toY: event.toY,
          velocityDegPerS: event.velocityDegPerS,
        });
        break;
      case "gazeBlink":
        events.push({ type: "gazeBlink", at, durationMs: event.durationMs });
        break;
      case "gazeCalibration":
        events.push({ type: "gazeCalibration", at, accuracy: event.accuracy, pointCount: event.pointCount });
        break;
      case "gazeLost":
        events.push({ type: "gazeLost", at, reason: event.reason });
        break;
    }
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
