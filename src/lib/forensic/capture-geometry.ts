// ── Target resolution helpers ──���─────────────────────────────

export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, "0");
}

export function normalizeText(v: string, max: number): string {
  return v.trim().replace(/\s+/g, " ").slice(0, max);
}

function readDescriptor(el: Element, maxString: number): string {
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
  if (fid) parts.push(`id:${normalizeText(fid, maxString).slice(0, 64)}`);
  if (role) parts.push(`role:${normalizeText(role, maxString).slice(0, 32)}`);
  if (type) parts.push(`type:${normalizeText(type, maxString).slice(0, 32)}`);
  return parts.join("|");
}

export function canonicalize(
  target: EventTarget | Element | string | null | undefined,
  maxString: number,
): string | null {
  if (target == null) return null;
  if (typeof target === "string") return `synthetic|${normalizeText(target, maxString).slice(0, 96)}`;
  const el =
    target instanceof Element
      ? target
      : (target as Node).nodeType === Node.ELEMENT_NODE
        ? (target as Element)
        : (target as Node).parentElement;
  if (!el) return "synthetic|unknown";
  const parts: string[] = [];
  let cur: Element | null = el;
  for (let d = 0; cur && d < 4; d++) {
    parts.push(readDescriptor(cur, maxString));
    cur = cur.parentElement;
  }
  return parts.join(">");
}

// ── Geometry interfaces and snapshots ────────────────────────

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

function snapshotViewport(): CapturedViewport {
  if (typeof window === "undefined")
    return {
      width: 0,
      height: 0,
      devicePixelRatio: 1,
      scrollWidth: 0,
      scrollHeight: 0,
    };
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
      targetId: 0,
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
