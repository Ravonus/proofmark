import type { ForensicReplayEncodedEvent } from "./replay-codec";
import { quantizePressure, encodeReplayEventsSync } from "./replay-codec";
import { REPLAY_FORMAT_LIMITS, REPLAY_CLIPBOARD_ACTION_CODES, REPLAY_NAV_DIRECTION_CODES } from "./replay-format";
import { resolveForensicReplayCore } from "./replay-core";

const TIME_QUANTUM_MS = REPLAY_FORMAT_LIMITS.timeQuantumMs;
const MAX_CLIPBOARD_PREVIEW = REPLAY_FORMAT_LIMITS.maxClipboardPreview;
const MAX_STORED_STRING = REPLAY_FORMAT_LIMITS.maxStoredStringLength;
const MAX_FIELD_SNAPSHOT = REPLAY_FORMAT_LIMITS.maxFieldSnapshotLength;

type NAV = keyof typeof REPLAY_NAV_DIRECTION_CODES;
type CLIP = keyof typeof REPLAY_CLIPBOARD_ACTION_CODES;

export interface CapturedGeometry {
  viewport: CapturedViewport;
  pages: CapturedPage[];
  fields: CapturedField[];
  signaturePads: CapturedSignaturePad[];
}

export interface CapturedViewport {
  width: number;
  height: number;
  devicePixelRatio: number;
  scrollWidth: number;
  scrollHeight: number;
}

export interface CapturedPage {
  pageIndex: number;
  width: number;
  height: number;
  offsetY: number;
}

export interface CapturedField {
  targetId: number;
  pageIndex: number;
  rect: { x: number; y: number; w: number; h: number };
  fieldType: "text" | "signature" | "initials" | "checkbox" | "radio" | "date" | "dropdown";
}

export interface CapturedSignaturePad {
  targetId: number;
  pageIndex: number;
  rect: { x: number; y: number; w: number; h: number };
  canvasWidth: number;
  canvasHeight: number;
}

export interface CaptureTarget {
  id: number;
  hash: string;
  descriptor: string;
}

export interface CaptureString {
  id: number;
  kind: "key" | "label" | "value" | "signature" | "clipboard";
  hash: string;
  value: string;
}

export interface CaptureResult {
  events: ForensicReplayEncodedEvent[];
  targets: CaptureTarget[];
  strings: CaptureString[];
  geometry: CapturedGeometry;
  tapeBase64: string;
  byteLength: number;
  durationMs: number;
}

function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function normalizeText(v: string) {
  return v.trim().replace(/\s+/g, " ").slice(0, MAX_STORED_STRING);
}

function readDescriptor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const fid =
    el.getAttribute("data-forensic-id") ??
    el.getAttribute("data-field-id") ??
    el.getAttribute("data-testid") ??
    el.getAttribute("aria-label") ??
    el.getAttribute("name") ??
    el.id ??
    "";
  const role = el.getAttribute("role") ?? "";
  const type = el.getAttribute("type") ?? "";
  const parts = [`tag:${tag}`];
  if (fid) parts.push(`id:${normalizeText(fid).slice(0, 64)}`);
  if (role) parts.push(`role:${normalizeText(role).slice(0, 32)}`);
  if (type) parts.push(`type:${normalizeText(type).slice(0, 32)}`);
  return parts.join("|");
}

function canonicalize(target: EventTarget | Element | string | null | undefined): string | null {
  if (target == null) return null;
  if (typeof target === "string") return `synthetic|${normalizeText(target).slice(0, 96)}`;
  const el = target instanceof Element ? target : (target as Node).nodeType === Node.ELEMENT_NODE ? (target as Element) : (target as Node).parentElement;
  if (!el) return "synthetic|unknown";
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let d = 0; cur && d < 4; d++) {
    parts.push(readDescriptor(cur));
    cur = cur.parentElement;
  }
  return parts.join(">");
}

function snapshotViewport(): CapturedViewport {
  if (typeof window === "undefined") return { width: 0, height: 0, devicePixelRatio: 1, scrollWidth: 0, scrollHeight: 0 };
  const root = document.documentElement;
  return {
    width: Math.round(window.innerWidth),
    height: Math.round(window.innerHeight),
    devicePixelRatio: window.devicePixelRatio || 1,
    scrollWidth: Math.round(root.scrollWidth),
    scrollHeight: Math.round(root.scrollHeight),
  };
}

function snapshotPages(container?: Element | null): CapturedPage[] {
  if (!container || typeof document === "undefined") return [];
  const pages = container.querySelectorAll("[data-page-index]");
  const result: CapturedPage[] = [];
  for (const page of pages) {
    const idx = parseInt(page.getAttribute("data-page-index") ?? "0", 10);
    const rect = page.getBoundingClientRect();
    const parentRect = container.getBoundingClientRect();
    result.push({
      pageIndex: idx,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      offsetY: Math.round(rect.top - parentRect.top + container.scrollTop),
    });
  }
  return result;
}

function snapshotFields(container?: Element | null): CapturedField[] {
  if (!container || typeof document === "undefined") return [];
  const fields = container.querySelectorAll("[data-field-id]");
  const result: CapturedField[] = [];
  for (const field of fields) {
    const parentRect = container.getBoundingClientRect();
    const rect = field.getBoundingClientRect();
    const fieldType = (field.getAttribute("data-field-type") ?? "text") as CapturedField["fieldType"];
    const pageIndex = parseInt(field.closest("[data-page-index]")?.getAttribute("data-page-index") ?? "0", 10);
    result.push({
      targetId: 0, // filled by adapter during finalization
      pageIndex,
      rect: {
        x: Math.round(rect.left - parentRect.left),
        y: Math.round(rect.top - parentRect.top + container.scrollTop),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      fieldType,
    });
  }
  return result;
}

function snapshotSignaturePads(container?: Element | null): CapturedSignaturePad[] {
  if (!container || typeof document === "undefined") return [];
  const pads = container.querySelectorAll("canvas[data-forensic-id]");
  const result: CapturedSignaturePad[] = [];
  for (const pad of pads) {
    const canvas = pad as HTMLCanvasElement;
    const parentRect = container.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const pageIndex = parseInt(canvas.closest("[data-page-index]")?.getAttribute("data-page-index") ?? "0", 10);
    result.push({
      targetId: 0,
      pageIndex,
      rect: {
        x: Math.round(rect.left - parentRect.left),
        y: Math.round(rect.top - parentRect.top + container.scrollTop),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    });
  }
  return result;
}

export function snapshotGeometry(container?: Element | null): CapturedGeometry {
  return {
    viewport: snapshotViewport(),
    pages: snapshotPages(container),
    fields: snapshotFields(container),
    signaturePads: snapshotSignaturePads(container),
  };
}

/**
 * Thin capture adapter: listens for DOM events, resolves stable targets,
 * batches semantic events, and hands off to Rust/WASM encoder.
 * Keeps this layer minimal — all encode/decode logic lives in Rust.
 */
export class ForensicCaptureAdapter {
  private readonly startedAt = Date.now();
  private readonly targetIndex = new Map<string, number>();
  private readonly stringIndex = new Map<string, number>();
  private readonly targets: CaptureTarget[] = [];
  private readonly strings: CaptureString[] = [];
  private readonly events: ForensicReplayEncodedEvent[] = [];
  private readonly activeStrokes = new Map<number, { x: number; y: number }>();
  private readonly pendingFields = new Map<string, { value: string; timer: ReturnType<typeof setTimeout> }>();
  private readonly abortController = new AbortController();

  private lastEventAt = 0;
  private lastScrollRecord = { at: 0, y: -1 };
  private lastMouseX = 0;
  private lastMouseY = 0;
  private lastMouseSampleAt = 0;
  private hoverTarget: EventTarget | null = null;
  private hoverStartAt = 0;
  private nextStrokeId = 1;
  private container: Element | null = null;
  private geometry: CapturedGeometry;

  constructor(container?: Element | null) {
    this.container = container ?? null;
    this.geometry = snapshotGeometry(container);
  }

  private elapsed(): number {
    return Date.now() - this.startedAt;
  }

  private delta(): number {
    const now = this.elapsed();
    const d = Math.max(0, Math.round((now - this.lastEventAt) / TIME_QUANTUM_MS));
    this.lastEventAt = now;
    return d;
  }

  private registerTarget(descriptor: string | null): number {
    if (!descriptor) return 0;
    const existing = this.targetIndex.get(descriptor);
    if (existing != null) return existing;
    const id = this.targets.length + 1;
    this.targets.push({ id, hash: fnv1a64(descriptor), descriptor });
    this.targetIndex.set(descriptor, id);
    return id;
  }

  private registerString(kind: CaptureString["kind"], value: string): number {
    const normalized = value.slice(0, MAX_STORED_STRING);
    const key = `${kind}:${normalized}`;
    const existing = this.stringIndex.get(key);
    if (existing != null) return existing;
    const id = this.strings.length + 1;
    this.strings.push({ id, kind, hash: fnv1a64(normalized), value: normalized });
    this.stringIndex.set(key, id);
    return id;
  }

  private target(src: EventTarget | Element | string | null | undefined): number {
    return this.registerTarget(canonicalize(src));
  }

  // ── Public recording methods ──────────────────────────────

  recordScroll(scrollY: number, scrollMax: number) {
    const now = this.elapsed();
    const y = Math.max(0, Math.round(scrollY));
    if (Math.abs(y - this.lastScrollRecord.y) < 12 && now - this.lastScrollRecord.at < 64) return;
    this.lastScrollRecord = { at: now, y };
    this.events.push({ type: "scroll", delta: this.delta(), scrollY: y, scrollMax: Math.max(0, Math.round(scrollMax)) });
  }

  recordClick(e: MouseEvent) {
    this.events.push({ type: "click", delta: this.delta(), targetId: this.target(e.target), x: Math.max(0, Math.round(e.clientX)), y: Math.max(0, Math.round(e.clientY)), button: e.button ?? 0 });
  }

  recordContextMenu(e: MouseEvent) {
    this.events.push({ type: "contextMenu", delta: this.delta(), targetId: this.target(e.target), x: Math.max(0, Math.round(e.clientX)), y: Math.max(0, Math.round(e.clientY)) });
  }

  recordKey(e: KeyboardEvent) {
    const key = e.key.length === 1 ? e.key : e.code;
    const modifiers = (e.shiftKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0) | (e.repeat ? 16 : 0);
    this.events.push({ type: "key", delta: this.delta(), targetId: this.target(e.target), keyId: this.registerString("key", key), modifiers });
  }

  recordFocus(target: EventTarget | Element | string | null) {
    this.events.push({ type: "focus", delta: this.delta(), targetId: this.target(target) });
  }

  recordBlur(target: EventTarget | Element | string | null) {
    this.events.push({ type: "blur", delta: this.delta(), targetId: this.target(target) });
  }

  recordVisibility(hidden: boolean) {
    this.events.push({ type: "visibility", delta: this.delta(), hidden });
  }

  recordHighlight(target: EventTarget | Element | string | null, label?: string | null) {
    this.events.push({ type: "highlight", delta: this.delta(), targetId: this.target(target), labelId: label ? this.registerString("label", label) : 0 });
  }

  recordNavigation(direction: NAV, target?: EventTarget | Element | string | null, index?: number) {
    this.events.push({ type: "navigation", delta: this.delta(), direction, targetId: this.target(target ?? null), index: Math.max(0, index ?? 0) });
  }

  recordPage(page: number, totalPages: number) {
    this.events.push({ type: "page", delta: this.delta(), page: Math.max(0, Math.round(page)), totalPages: Math.max(0, Math.round(totalPages)) });
  }

  recordModal(name: string, open: boolean) {
    this.events.push({ type: "modal", delta: this.delta(), nameId: this.registerString("label", name), open });
  }

  recordSignatureStart(target: EventTarget | Element | string | null, x: number, y: number, pressure?: number | null): number {
    const strokeId = this.nextStrokeId++;
    const px = Math.max(0, Math.round(x));
    const py = Math.max(0, Math.round(y));
    this.activeStrokes.set(strokeId, { x: px, y: py });
    this.events.push({ type: "signatureStart", delta: this.delta(), targetId: this.target(target), strokeId, x: px, y: py, pressure: quantizePressure(pressure) });
    return strokeId;
  }

  recordSignaturePoint(strokeId: number, x: number, y: number, pressure?: number | null) {
    if (!this.activeStrokes.has(strokeId)) return;
    const px = Math.max(0, Math.round(x));
    const py = Math.max(0, Math.round(y));
    this.activeStrokes.set(strokeId, { x: px, y: py });
    this.events.push({ type: "signaturePoint", delta: this.delta(), strokeId, x: px, y: py, pressure: quantizePressure(pressure) });
  }

  recordSignatureEnd(strokeId: number) {
    if (!this.activeStrokes.has(strokeId)) return;
    this.activeStrokes.delete(strokeId);
    this.events.push({ type: "signatureEnd", delta: this.delta(), strokeId });
  }

  recordSignatureCommit(target: EventTarget | Element | string | null, encodedSignature: string) {
    this.events.push({ type: "signatureCommit", delta: this.delta(), targetId: this.target(target), signatureId: this.registerString("signature", encodedSignature) });
  }

  recordSignatureClear(target: EventTarget | Element | string | null) {
    this.events.push({ type: "signatureClear", delta: this.delta(), targetId: this.target(target) });
  }

  recordFieldValue(fieldId: string, value: string) {
    const existing = this.pendingFields.get(fieldId);
    if (existing) clearTimeout(existing.timer);
    const snapshot = value.length <= MAX_FIELD_SNAPSHOT ? value : `__forensic_large__:${value.length}:${fnv1a64(value)}`;
    const timer = setTimeout(() => this.flushField(fieldId), 180);
    this.pendingFields.set(fieldId, { value: snapshot, timer });
  }

  recordMouseMove(x: number, y: number) {
    const dx = Math.round(x - (this.lastMouseX ?? x));
    const dy = Math.round(y - (this.lastMouseY ?? y));
    this.lastMouseX = x;
    this.lastMouseY = y;
    if (dx === 0 && dy === 0) return;
    this.events.push({ type: "mouseMove", delta: this.delta(), dx, dy });
  }

  recordHoverDwell(target: EventTarget | Element | string | null, durationMs: number) {
    this.events.push({ type: "hoverDwell", delta: this.delta(), targetId: this.target(target), durationMs: Math.round(durationMs) });
  }

  recordViewportResize(width: number, height: number) {
    this.events.push({ type: "viewportResize", delta: this.delta(), width: Math.round(width), height: Math.round(height) });
  }

  recordTouchStart(x: number, y: number, radius?: number, force?: number) {
    this.events.push({ type: "touchStart", delta: this.delta(), x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), radius: Math.round(Math.min(255, radius ?? 0)), force: quantizePressure(force) });
  }

  recordTouchMove(dx: number, dy: number, radius?: number, force?: number) {
    this.events.push({ type: "touchMove", delta: this.delta(), dx: Math.round(dx), dy: Math.round(dy), radius: Math.round(Math.min(255, radius ?? 0)), force: quantizePressure(force) });
  }

  recordTouchEnd() {
    this.events.push({ type: "touchEnd", delta: this.delta() });
  }

  recordFieldCorrection(fieldId: string, kind: "backspace" | "delete" | "selectAllReplace" | "undo", count: number) {
    const kindMap = { backspace: 1, delete: 2, selectAllReplace: 3, undo: 4 };
    this.events.push({ type: "fieldCorrection", delta: this.delta(), targetId: this.target(`field:${fieldId}`), correctionKind: kindMap[kind], count: Math.max(0, count) });
  }

  recordScrollMomentum(velocity: number, deceleration: number) {
    this.events.push({ type: "scrollMomentum", delta: this.delta(), velocity: Math.round(velocity), deceleration: Math.max(0, Math.round(deceleration)) });
  }

  recordClipboard(action: CLIP, target: EventTarget | Element | string | null, text?: string | null) {
    const normalized = (text ?? "").replace(/\s+/g, " ").trim();
    const summary = normalized
      ? `len:${normalized.length}|hash:${fnv1a64(normalized)}|preview:${normalized.slice(0, MAX_CLIPBOARD_PREVIEW)}`
      : "len:0|hash:0000000000000000";
    this.events.push({ type: "clipboard", delta: this.delta(), action, targetId: this.target(target), summaryId: this.registerString("clipboard", summary) });
  }

  // ── Attach DOM listeners ──────────────────────────────────

  attach(root?: Element | Document | null) {
    const el = root ?? (typeof document !== "undefined" ? document : null);
    if (!el) return;
    const opts: AddEventListenerOptions = { passive: true, signal: this.abortController.signal };

    el.addEventListener("scroll", () => {
      const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
      const scrollMax = typeof document !== "undefined" ? document.documentElement.scrollHeight - document.documentElement.clientHeight : 0;
      this.recordScroll(scrollY, scrollMax);
    }, opts);

    el.addEventListener("click", (e) => this.recordClick(e as MouseEvent), opts);
    el.addEventListener("contextmenu", (e) => this.recordContextMenu(e as MouseEvent), opts);
    el.addEventListener("keydown", (e) => this.recordKey(e as KeyboardEvent), opts);
    el.addEventListener("focusin", (e) => this.recordFocus((e as FocusEvent).target), opts);
    el.addEventListener("focusout", (e) => this.recordBlur((e as FocusEvent).target), opts);

    // Mouse trajectory — sample every ~50ms to keep size down
    el.addEventListener("mousemove", (e) => {
      const me = e as MouseEvent;
      const now = this.elapsed();
      if (now - this.lastMouseSampleAt < 50) return;
      this.lastMouseSampleAt = now;
      this.recordMouseMove(me.clientX, me.clientY);
    }, opts);

    // Hover dwell — track time spent hovering over targets
    el.addEventListener("mouseover", (e) => {
      const target = (e as MouseEvent).target;
      if (this.hoverTarget && this.hoverTarget !== target) {
        const dwell = this.elapsed() - this.hoverStartAt;
        if (dwell > 200) this.recordHoverDwell(this.hoverTarget, dwell);
      }
      this.hoverTarget = target;
      this.hoverStartAt = this.elapsed();
    }, opts);

    // Touch events
    el.addEventListener("touchstart", (e) => {
      const touch = (e as TouchEvent).touches[0];
      if (touch) this.recordTouchStart(touch.clientX, touch.clientY, (touch as any).radiusX, touch.force);
    }, opts);
    el.addEventListener("touchmove", (e) => {
      const touch = (e as TouchEvent).touches[0];
      if (touch) {
        const dx = touch.clientX - this.lastMouseX;
        const dy = touch.clientY - this.lastMouseY;
        this.lastMouseX = touch.clientX;
        this.lastMouseY = touch.clientY;
        this.recordTouchMove(dx, dy, (touch as any).radiusX, touch.force);
      }
    }, opts);
    el.addEventListener("touchend", () => this.recordTouchEnd(), opts);

    // Viewport resize
    if (typeof window !== "undefined") {
      window.addEventListener("resize", () => {
        this.recordViewportResize(window.innerWidth, window.innerHeight);
      }, opts);
    }

    // Field corrections — listen for backspace/delete in inputs
    el.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent;
      const target = ke.target as HTMLElement | null;
      const fieldId = target?.getAttribute("data-field-id") ?? target?.getAttribute("name");
      if (!fieldId) return;
      if (ke.key === "Backspace") this.recordFieldCorrection(fieldId, "backspace", 1);
      else if (ke.key === "Delete") this.recordFieldCorrection(fieldId, "delete", 1);
      else if ((ke.metaKey || ke.ctrlKey) && ke.key === "z") this.recordFieldCorrection(fieldId, "undo", 1);
    }, opts);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => this.recordVisibility(document.hidden), opts);
      document.addEventListener("copy", (e) => this.recordClipboard("copy", (e as ClipboardEvent).target, null), opts);
      document.addEventListener("cut", (e) => this.recordClipboard("cut", (e as ClipboardEvent).target, null), opts);
      document.addEventListener("paste", (e) => this.recordClipboard("paste", (e as ClipboardEvent).target, null), opts);
    }
  }

  detach() {
    this.abortController.abort();
  }

  refreshGeometry() {
    this.geometry = snapshotGeometry(this.container);
  }

  // ── Finalize ──────────────────────────────────────────────

  private flushField(fieldId: string) {
    const pending = this.pendingFields.get(fieldId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingFields.delete(fieldId);
    this.events.push({ type: "fieldCommit", delta: this.delta(), targetId: this.target(`field:${fieldId}`), valueId: this.registerString("value", pending.value) });
  }

  private flushAllFields() {
    for (const fieldId of [...this.pendingFields.keys()]) {
      this.flushField(fieldId);
    }
  }

  async finalize(): Promise<CaptureResult> {
    this.flushAllFields();
    this.refreshGeometry();

    let tapeBase64: string;
    let byteLength: number;

    try {
      const core = await resolveForensicReplayCore();
      const result = await core.encodeReplayEvents(this.events);
      tapeBase64 = result.tapeBase64;
      byteLength = result.byteLength;
    } catch {
      const result = encodeReplayEventsSync(this.events);
      tapeBase64 = result.tapeBase64;
      byteLength = result.byteLength;
    }

    const durationMs = this.events.reduce((acc, e) => acc + e.delta * TIME_QUANTUM_MS, 0);

    return {
      events: this.events,
      targets: this.targets,
      strings: this.strings,
      geometry: this.geometry,
      tapeBase64,
      byteLength,
      durationMs,
    };
  }
}
