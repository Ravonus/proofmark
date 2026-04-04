/**
 * Device fingerprint probes.
 *
 * Each function probes a specific browser/hardware signal.
 * All are wrapped in try/catch so unavailable APIs never break collection.
 */

import { sha256 } from "./hash";

/* ── Typed navigator access ─────────────────────────────────── */

const nav = () => navigator as unknown as Record<string, unknown>;

/* ── WebGL context (shared by hash + GPU info probes) ───────── */

interface WebGLProbeResult {
  vendor: string;
  renderer: string;
}

function getWebGLDebugInfo(): WebGLProbeResult | null {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl");
    if (!gl || !(gl instanceof WebGLRenderingContext)) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return null;
    return {
      vendor: (gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string) ?? "unknown",
      renderer: (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) ?? "unknown",
    };
  } catch {
    return null;
  }
}

/* ── Canvas fingerprint ─────────────────────────────────────── */

export async function getCanvasHash(): Promise<string> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "unsupported";

    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#f60";
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = "#069";
    ctx.font = "11pt Arial";
    ctx.fillText("proofmark,fingerprint!@#", 2, 15);
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
    ctx.font = "18pt Arial";
    ctx.fillText("proofmark,fingerprint!@#", 4, 45);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgb(255,0,255)";
    ctx.beginPath();
    ctx.arc(50, 50, 50, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();

    return await sha256(canvas.toDataURL());
  } catch {
    return "error";
  }
}

/* ── WebGL fingerprint hash ─────────────────────────────────── */

export async function getWebGLHash(): Promise<string> {
  const info = getWebGLDebugInfo();
  if (!info) return "unsupported";
  return await sha256(`${info.vendor}~${info.renderer}`);
}

/* ── GPU vendor/renderer (raw strings) ──────────────────────── */

export function getGpuInfo(): { vendor: string | null; renderer: string | null } {
  const info = getWebGLDebugInfo();
  return { vendor: info?.vendor ?? null, renderer: info?.renderer ?? null };
}

/* ── Audio context fingerprint ──────────────────────────────── */

export async function getAudioHash(): Promise<string> {
  try {
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(10000, ctx.currentTime);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-50, ctx.currentTime);
    comp.knee.setValueAtTime(40, ctx.currentTime);
    comp.ratio.setValueAtTime(12, ctx.currentTime);
    comp.attack.setValueAtTime(0, ctx.currentTime);
    comp.release.setValueAtTime(0.25, ctx.currentTime);

    osc.connect(comp);
    comp.connect(ctx.destination);
    osc.start(0);

    const buffer = await ctx.startRendering();
    const sum = buffer
      .getChannelData(0)
      .slice(4500, 5000)
      .reduce((a, v) => a + Math.abs(v), 0);
    return await sha256(sum.toString());
  } catch {
    return "error";
  }
}

/* ── Font detection ─────────────────────────────────────────── */

const TEST_FONTS = [
  "monospace",
  "sans-serif",
  "serif",
  "Arial",
  "Courier New",
  "Georgia",
  "Helvetica",
  "Times New Roman",
  "Verdana",
  "Comic Sans MS",
  "Impact",
  "Lucida Console",
  "Palatino Linotype",
  "Trebuchet MS",
  "Tahoma",
];
const BASE_FONTS = ["monospace", "sans-serif", "serif"] as const;

export async function getFontsHash(): Promise<string> {
  const span = document.createElement("span");
  span.style.position = "absolute";
  span.style.left = "-9999px";
  span.style.fontSize = "72px";
  span.textContent = "mmmmmmmmmmlli";
  document.body.appendChild(span);

  const baseWidths: Record<string, number> = {};
  for (const base of BASE_FONTS) {
    span.style.fontFamily = base;
    baseWidths[base] = span.offsetWidth;
  }

  const detected: string[] = [];
  for (const font of TEST_FONTS) {
    for (const base of BASE_FONTS) {
      span.style.fontFamily = `"${font}", ${base}`;
      if (span.offsetWidth !== baseWidths[base]) {
        detected.push(font);
        break;
      }
    }
  }

  document.body.removeChild(span);
  return await sha256(detected.join(","));
}

/* ── Plugins hash ───────────────────────────────────────────── */

export async function getPluginsHash(): Promise<string> {
  const raw = Array.from(navigator.plugins ?? [])
    .map((p) => `${p.name}|${p.filename}`)
    .join(";");
  return await sha256(raw || "none");
}

/* ── Battery ────────────────────────────────────────────────── */

export async function getBatteryInfo(): Promise<{ level: number | null; charging: boolean | null }> {
  try {
    const getBattery = nav().getBattery as (() => Promise<unknown>) | undefined;
    if (typeof getBattery !== "function") return { level: null, charging: null };
    const b = (await getBattery()) as Record<string, unknown>;
    return {
      level: typeof b.level === "number" ? b.level : null,
      charging: typeof b.charging === "boolean" ? b.charging : null,
    };
  } catch {
    return { level: null, charging: null };
  }
}

/* ── Network connection ─────────────────────────────────────── */

export function getConnectionInfo(): { type: string | null; downlink: number | null } {
  try {
    const conn = nav().connection as Record<string, unknown> | undefined;
    if (!conn) return { type: null, downlink: null };
    return {
      type: typeof conn.effectiveType === "string" ? conn.effectiveType : null,
      downlink: typeof conn.downlink === "number" ? conn.downlink : null,
    };
  } catch {
    return { type: null, downlink: null };
  }
}

/* ── Media queries ──────────────────────────────────────────── */

function matchesMedia(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function getColorGamut(): string | null {
  if (matchesMedia("(color-gamut: rec2020)")) return "rec2020";
  if (matchesMedia("(color-gamut: p3)")) return "p3";
  if (matchesMedia("(color-gamut: srgb)")) return "srgb";
  return null;
}

export function getHdr(): boolean | null {
  try {
    return matchesMedia("(dynamic-range: high)");
  } catch {
    return null;
  }
}

export function getReducedMotion(): boolean {
  return matchesMedia("(prefers-reduced-motion: reduce)");
}

export function getDarkMode(): boolean {
  return matchesMedia("(prefers-color-scheme: dark)");
}

/* ── Browser major version ──────────────────────────────────── */

const BROWSER_PATTERNS: [string, RegExp][] = [
  ["Edge", /Edg\/(\d+)/],
  ["Opera", /OPR\/(\d+)/],
  ["Chrome", /Chrome\/(\d+)/],
  ["Firefox", /Firefox\/(\d+)/],
  ["Safari", /Version\/(\d+).*Safari/],
];

export function parseBrowserMajor(): string | null {
  try {
    const ua = navigator.userAgent;
    for (const [name, re] of BROWSER_PATTERNS) {
      const m = ua.match(re);
      if (m) return `${name}/${m[1]}`;
    }
  } catch {
    /* */
  }
  return null;
}

/* ── Math fingerprint (hardware-specific float differences) ─── */

export async function getMathFingerprint(): Promise<string> {
  const results = [
    Math.tan(-1e300),
    Math.sin(1),
    Math.cos(10),
    Math.log(100),
    Math.sqrt(2),
    Math.exp(1),
    Math.pow(Math.PI, -100),
  ]
    .map(String)
    .join(",");
  return await sha256(results);
}

/* ── WebRTC local IP detection (reveals real IP behind VPN) ─── */

export async function getWebRtcLocalIps(): Promise<string[]> {
  return new Promise((resolve) => {
    const ips = new Set<string>();
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel("");
      void pc.createOffer().then((o) => pc.setLocalDescription(o));
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          pc.close();
          resolve([...ips]);
          return;
        }
        const m = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(e.candidate.candidate);
        if (m?.[1]) ips.add(m[1]);
      };
      setTimeout(() => {
        pc.close();
        resolve([...ips]);
      }, 3000);
    } catch {
      resolve([]);
    }
  });
}
