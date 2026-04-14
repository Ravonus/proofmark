import type { ForensicReplayEncodedEvent } from "./replay-codec";
import {
  type REPLAY_CLIPBOARD_ACTION_CODES,
  REPLAY_FORMAT_LIMITS,
  type REPLAY_NAV_DIRECTION_CODES,
} from "./replay-format";
import type {
  ForensicReplayEventKind,
  ForensicReplayGazeAnchorEntry,
  ForensicReplayGazeSample,
  ForensicReplayStringEntry,
  ForensicReplayViewport,
  TimedSignatureStroke,
} from "./types";

const MAX_STORED_STRING_LENGTH = REPLAY_FORMAT_LIMITS.maxStoredStringLength;
const MAX_FIELD_SNAPSHOT_LENGTH = REPLAY_FORMAT_LIMITS.maxFieldSnapshotLength;
const MAX_CLIPBOARD_PREVIEW = REPLAY_FORMAT_LIMITS.maxClipboardPreview;

export type ReplayStringKind = ForensicReplayStringEntry["kind"];
type ReplayGazeAnchorAttribute = ForensicReplayGazeAnchorEntry["attribute"];
export type TargetSource = EventTarget | Element | string | null | undefined;
export type RecordedGazeAnchor = {
  attribute: ReplayGazeAnchorAttribute;
  value: string;
  offsetX: number;
  offsetY: number;
};

export type RecordedReplayEvent =
  | { type: "scroll"; at: number; scrollY: number; scrollMax: number }
  | {
      type: "click";
      at: number;
      target: string | null;
      x: number;
      y: number;
      button: number;
    }
  | {
      type: "key";
      at: number;
      target: string | null;
      key: string;
      modifiers: number;
    }
  | { type: "focus"; at: number; target: string | null }
  | { type: "blur"; at: number; target: string | null }
  | { type: "visibility"; at: number; hidden: boolean }
  | {
      type: "highlight";
      at: number;
      target: string | null;
      label: string | null;
    }
  | {
      type: "navigation";
      at: number;
      direction: keyof typeof REPLAY_NAV_DIRECTION_CODES;
      target: string | null;
      index: number;
    }
  | { type: "page"; at: number; page: number; totalPages: number }
  | { type: "modal"; at: number; name: string; open: boolean }
  | {
      type: "signatureStart";
      at: number;
      target: string | null;
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
  | {
      type: "signatureCommit";
      at: number;
      target: string | null;
      strokes: TimedSignatureStroke[];
    }
  | { type: "signatureClear"; at: number; target: string | null }
  | { type: "fieldCommit"; at: number; target: string | null; value: string }
  | {
      type: "clipboard";
      at: number;
      target: string | null;
      action: keyof typeof REPLAY_CLIPBOARD_ACTION_CODES;
      summary: string;
    }
  | {
      type: "contextMenu";
      at: number;
      target: string | null;
      x: number;
      y: number;
    }
  // Gaze tracking events (premium)
  | {
      type: "gazePoint";
      at: number;
      x: number;
      y: number;
      confidence: number;
      anchor: RecordedGazeAnchor | null;
    }
  | {
      type: "gazeFixation";
      at: number;
      x: number;
      y: number;
      durationMs: number;
      target: string | null;
    }
  | {
      type: "gazeSaccade";
      at: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      velocityDegPerS: number;
    }
  | { type: "gazeBlink"; at: number; durationMs: number }
  | {
      type: "gazeCalibration";
      at: number;
      accuracy: number;
      pointCount: number;
    }
  | { type: "gazeLost"; at: number; reason: number };

export type FinalizeContext = {
  core: { encodeSignature: (s: TimedSignatureStroke[]) => Promise<string> };
  registerTarget: (descriptor: string | null | undefined) => number;
  registerString: (kind: ReplayStringKind, value: string) => number;
  registerGazeAnchor: (anchor: RecordedGazeAnchor | null) => number;
  gazeSamples: ForensicReplayGazeSample[];
};

export function round(value: number) {
  return Math.round(value);
}

export function byte(v: number) {
  return Math.max(0, Math.min(255, round(v)));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function gazeQ(normalized: number) {
  return Math.max(0, Math.min(1000, round(normalized * 1000)));
}

export function nowMs() {
  return Date.now();
}

export function fnv1a64(input: string) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_STORED_STRING_LENGTH);
}

export function normalizeStoredString(kind: ReplayStringKind, value: string) {
  if (kind === "value" || kind === "signature") {
    return value.slice(0, MAX_STORED_STRING_LENGTH);
  }
  return normalizeText(value);
}

export function snapshotValue(value: string) {
  if (value.length <= MAX_FIELD_SNAPSHOT_LENGTH) return value;
  return `__forensic_large__:${value.length}:${fnv1a64(value)}`;
}

function normalizeAnchorValue(value: string | null) {
  return (value ?? "").trim().slice(0, 128);
}

export function summarizeClipboard(text: string | null | undefined) {
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

export function canonicalizeTarget(target: TargetSource) {
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
      return {
        element: current,
        attribute: "data-field-id" as const,
        value: fieldId,
      };
    }
    const forensicId = normalizeAnchorValue(current.getAttribute("data-forensic-id"));
    if (forensicId) {
      return {
        element: current,
        attribute: "data-forensic-id" as const,
        value: forensicId,
      };
    }
    current = current.parentElement;
  }
  return null;
}

export function resolveGazeAnchor(x: number, y: number): RecordedGazeAnchor | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const viewportWidth = Math.max(1, window.innerWidth || 1);
  const viewportHeight = Math.max(1, window.innerHeight || 1);
  const px = clamp(x, 0, 1) * viewportWidth;
  const py = clamp(y, 0, 1) * viewportHeight;

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
  const se = document.scrollingElement ?? document.documentElement;
  const scrollY = se.scrollTop || window.scrollY || 0;
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

export function getViewport(): ForensicReplayViewport {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return {
      width: 0,
      height: 0,
      devicePixelRatio: 1,
      scrollWidth: 0,
      scrollHeight: 0,
    };
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

export function eventKind(event: RecordedReplayEvent): ForensicReplayEventKind {
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

function encodeExtendedEvent(
  event: RecordedReplayEvent,
  delta: number,
  ctx: FinalizeContext,
): ForensicReplayEncodedEvent | null {
  switch (event.type) {
    case "contextMenu":
      return {
        type: "contextMenu",
        delta,
        targetId: ctx.registerTarget(event.target),
        x: event.x,
        y: event.y,
      };
    case "gazePoint":
      ctx.gazeSamples.push({
        anchorId: ctx.registerGazeAnchor(event.anchor),
        offsetX: event.anchor?.offsetX ?? 0,
        offsetY: event.anchor?.offsetY ?? 0,
      });
      return {
        type: "gazePoint",
        delta,
        x: event.x,
        y: event.y,
        confidence: event.confidence,
      };
    case "gazeFixation":
      return {
        type: "gazeFixation",
        delta,
        x: event.x,
        y: event.y,
        durationMs: event.durationMs,
        targetId: ctx.registerTarget(event.target),
      };
    case "gazeSaccade":
      return {
        type: "gazeSaccade",
        delta,
        fromX: event.fromX,
        fromY: event.fromY,
        toX: event.toX,
        toY: event.toY,
        velocityDegPerS: event.velocityDegPerS,
      };
    case "gazeBlink":
      return { type: "gazeBlink", delta, durationMs: event.durationMs };
    case "gazeCalibration":
      return {
        type: "gazeCalibration",
        delta,
        accuracy: event.accuracy,
        pointCount: event.pointCount,
      };
    case "gazeLost":
      return { type: "gazeLost", delta, reason: event.reason };
    default:
      return null;
  }
}

export async function encodeOneEvent(
  event: RecordedReplayEvent,
  delta: number,
  ctx: FinalizeContext,
  fallbackEncodeSignature: (strokes: TimedSignatureStroke[]) => string,
): Promise<ForensicReplayEncodedEvent | null> {
  switch (event.type) {
    case "scroll":
      return {
        type: "scroll",
        delta,
        scrollY: event.scrollY,
        scrollMax: event.scrollMax,
      };
    case "click":
      return {
        type: "click",
        delta,
        targetId: ctx.registerTarget(event.target),
        x: event.x,
        y: event.y,
        button: event.button,
      };
    case "key":
      return {
        type: "key",
        delta,
        targetId: ctx.registerTarget(event.target),
        keyId: ctx.registerString("key", event.key),
        modifiers: event.modifiers,
      };
    case "focus":
      return {
        type: "focus",
        delta,
        targetId: ctx.registerTarget(event.target),
      };
    case "blur":
      return {
        type: "blur",
        delta,
        targetId: ctx.registerTarget(event.target),
      };
    case "visibility":
      return { type: "visibility", delta, hidden: event.hidden };
    case "highlight":
      return {
        type: "highlight",
        delta,
        targetId: ctx.registerTarget(event.target),
        labelId: event.label ? ctx.registerString("label", event.label) : 0,
      };
    case "navigation":
      return {
        type: "navigation",
        delta,
        direction: event.direction,
        targetId: ctx.registerTarget(event.target),
        index: event.index,
      };
    case "page":
      return {
        type: "page",
        delta,
        page: event.page,
        totalPages: event.totalPages,
      };
    case "modal":
      return {
        type: "modal",
        delta,
        nameId: ctx.registerString("label", event.name),
        open: event.open,
      };
    case "signatureStart":
      return {
        type: "signatureStart",
        delta,
        targetId: ctx.registerTarget(event.target),
        strokeId: event.strokeId,
        x: event.x,
        y: event.y,
        pressure: event.pressure,
      };
    case "signaturePoint":
      return {
        type: "signaturePoint",
        delta,
        strokeId: event.strokeId,
        x: event.x,
        y: event.y,
        pressure: event.pressure,
      };
    case "signatureEnd":
      return { type: "signatureEnd", delta, strokeId: event.strokeId };
    case "signatureCommit": {
      let signature: string;
      try {
        signature = await ctx.core.encodeSignature(event.strokes);
      } catch {
        signature = fallbackEncodeSignature(event.strokes);
      }
      return {
        type: "signatureCommit",
        delta,
        targetId: ctx.registerTarget(event.target),
        signatureId: ctx.registerString("signature", signature),
      };
    }
    case "signatureClear":
      return {
        type: "signatureClear",
        delta,
        targetId: ctx.registerTarget(event.target),
      };
    case "fieldCommit":
      return {
        type: "fieldCommit",
        delta,
        targetId: ctx.registerTarget(event.target),
        valueId: ctx.registerString("value", event.value),
      };
    case "clipboard":
      return {
        type: "clipboard",
        delta,
        action: event.action,
        targetId: ctx.registerTarget(event.target),
        summaryId: ctx.registerString("clipboard", event.summary),
      };
    default:
      return encodeExtendedEvent(event, delta, ctx);
  }
}
