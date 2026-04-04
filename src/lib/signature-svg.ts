export type SignaturePoint = {
  x: number;
  y: number;
};

export type SignatureStroke = SignaturePoint[];

const SVG_DATA_URL_RE = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)$/i;
const DEFAULT_STROKE_COLOR = "#111111";
const DEFAULT_STROKE_WIDTH = 2.2;

function round(value: number) {
  return Number(value.toFixed(2));
}

function encodeBase64(text: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64");
  }

  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(base64: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(base64, "base64").toString("utf8");
  }

  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function midpoint(a: SignaturePoint, b: SignaturePoint): SignaturePoint {
  return {
    x: round((a.x + b.x) / 2),
    y: round((a.y + b.y) / 2),
  };
}

function formatPoint(point: SignaturePoint) {
  return `${round(point.x)} ${round(point.y)}`;
}

export function strokeToSvgPath(stroke: SignatureStroke) {
  if (stroke.length === 0) return "";
  if (stroke.length === 1) {
    const point = formatPoint(stroke[0]!);
    return `M ${point} L ${point}`;
  }

  let path = `M ${formatPoint(stroke[0]!)}`;

  if (stroke.length === 2) {
    path += ` L ${formatPoint(stroke[1]!)}`;
    return path;
  }

  for (let i = 1; i < stroke.length - 1; i += 1) {
    const current = stroke[i]!;
    const next = stroke[i + 1]!;
    const mid = midpoint(current, next);
    path += ` Q ${formatPoint(current)} ${formatPoint(mid)}`;
  }

  path += ` L ${formatPoint(stroke[stroke.length - 1]!)}`;
  return path;
}

export function signatureStrokesToSvg(
  strokes: SignatureStroke[],
  width: number,
  height: number,
  options?: {
    strokeColor?: string;
    strokeWidth?: number;
  },
) {
  const safeWidth = Math.max(round(width), 1);
  const safeHeight = Math.max(round(height), 1);
  const strokeColor = options?.strokeColor ?? DEFAULT_STROKE_COLOR;
  const strokeWidth = options?.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const paths = strokes
    .filter((stroke) => stroke.length > 0)
    .map(strokeToSvgPath)
    .filter(Boolean)
    .map((path) => `<path d="${path}" />`)
    .join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}" fill="none">`,
    `<g stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">`,
    paths,
    "</g>",
    "</svg>",
  ].join("");
}

export function signatureStrokesToDataUrl(
  strokes: SignatureStroke[],
  width: number,
  height: number,
  options?: {
    strokeColor?: string;
    strokeWidth?: number;
  },
) {
  const svg = signatureStrokesToSvg(strokes, width, height, options);
  return `data:image/svg+xml;base64,${encodeBase64(svg)}`;
}

export function isSvgDataUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && SVG_DATA_URL_RE.test(value.trim());
}

export function extractDataUrlBase64(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const parts = value.split(",", 2);
  return parts.length === 2 ? parts[1]! : null;
}

export function decodeSignatureSvgDataUrl(value: string) {
  const match = SVG_DATA_URL_RE.exec(value.trim());
  if (!match) return null;

  const svg = decodeBase64(match[1]!);
  const viewBoxMatch = /viewBox=["']\s*0(?:\.0+)?\s+0(?:\.0+)?\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(svg);
  const widthMatch = /width=["']([\d.]+)["']/i.exec(svg);
  const heightMatch = /height=["']([\d.]+)["']/i.exec(svg);
  const strokeWidthMatch = /stroke-width=["']([\d.]+)["']/i.exec(svg);
  const strokeColorMatch = /stroke=["']([^"']+)["']/i.exec(svg);
  const paths = Array.from(svg.matchAll(/<path\b[^>]*\bd=["']([^"']+)["'][^>]*\/?>/gi)).map((pathMatch) => pathMatch[1]!);

  const width = Number.parseFloat(viewBoxMatch?.[1] ?? widthMatch?.[1] ?? "320");
  const height = Number.parseFloat(viewBoxMatch?.[2] ?? heightMatch?.[1] ?? "140");
  const strokeWidth = Number.parseFloat(strokeWidthMatch?.[1] ?? `${DEFAULT_STROKE_WIDTH}`);

  return {
    svg,
    width: Number.isFinite(width) && width > 0 ? width : 320,
    height: Number.isFinite(height) && height > 0 ? height : 140,
    strokeWidth: Number.isFinite(strokeWidth) && strokeWidth > 0 ? strokeWidth : DEFAULT_STROKE_WIDTH,
    strokeColor: strokeColorMatch?.[1] ?? DEFAULT_STROKE_COLOR,
    paths,
  };
}
