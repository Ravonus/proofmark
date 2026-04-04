/**
 * Client-Side Forensic Fingerprinting
 *
 * Collects device fingerprint + behavioral signals at signing time.
 * Uses multi-layer persistence so the visitor ID survives partial storage clears.
 *
 * Split into focused modules:
 *  - hash.ts       — SHA-256 + ID generation
 *  - persistence.ts — cookie/localStorage/sessionStorage/IndexedDB storage
 *  - probes.ts     — individual device/browser signal probes
 */

import type { ClientFingerprint, BehavioralSignals, GazeLivenessSummary, TimedSignatureStroke } from "./types";
import { generateId, sha256 } from "./hash";
import { getOrCreatePersistentId } from "./persistence";
import { DeterministicReplayRecorder } from "./replay";
import {
  getCanvasHash,
  getWebGLHash,
  getAudioHash,
  getFontsHash,
  getPluginsHash,
  getBatteryInfo,
  getConnectionInfo,
  getColorGamut,
  getHdr,
  getReducedMotion,
  getDarkMode,
  getGpuInfo,
  parseBrowserMajor,
  getMathFingerprint,
  getWebRtcLocalIps,
} from "./probes";

/* ── Typed navigator shorthand ──────────────────────────────── */

const nav = () => navigator as unknown as Record<string, unknown>;

/* ── Main fingerprint collection ────────────────────────────── */

export async function collectFingerprint(): Promise<ClientFingerprint> {
  // Run async probes in parallel
  const [persistent, canvasHash, webglHash, audioHash, fontsHash, pluginsHash, batteryInfo, mathFp, webRtcIps] =
    await Promise.all([
      getOrCreatePersistentId(),
      getCanvasHash(),
      getWebGLHash(),
      getAudioHash(),
      getFontsHash(),
      getPluginsHash(),
      getBatteryInfo(),
      getMathFingerprint(),
      getWebRtcLocalIps(),
    ]);

  // Sync probes
  const conn = getConnectionInfo();
  const colorGamut = getColorGamut();
  const hdr = getHdr();
  const reducedMotion = getReducedMotion();
  const darkMode = getDarkMode();
  const gpu = getGpuInfo();
  const browserMajor = parseBrowserMajor();

  // Compose visitor ID from all stable hardware/browser signals
  const visitorId = await sha256(
    [
      canvasHash,
      webglHash,
      audioHash,
      navigator.hardwareConcurrency?.toString() ?? "0",
      nav().deviceMemory?.toString() ?? "0",
      navigator.platform ?? "",
      screen.width,
      screen.height,
      screen.colorDepth,
      window.devicePixelRatio,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.language,
      fontsHash,
      pluginsHash,
      mathFp,
      colorGamut ?? "",
      reducedMotion,
      darkMode,
      gpu.vendor ?? "",
      gpu.renderer ?? "",
      browserMajor ?? "",
      webRtcIps.join(","),
    ]
      .map(String)
      .join("|"),
  );

  return {
    visitorId,
    canvasHash,
    webglHash,
    audioHash,
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}@${window.devicePixelRatio}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    languages: [...navigator.languages],
    cpuCores: navigator.hardwareConcurrency ?? 0,
    deviceMemory: (nav().deviceMemory as number) ?? null,
    platform: navigator.platform ?? "unknown",
    touchPoints: navigator.maxTouchPoints ?? 0,
    webdriver: !!nav().webdriver,
    fontsHash,
    pluginsHash,
    doNotTrack: navigator.doNotTrack ?? null,
    cookieEnabled: navigator.cookieEnabled,
    persistentId: persistent.id,
    firstSeen: persistent.firstSeen,
    visitCount: persistent.visitCount,
    batteryLevel: batteryInfo.level,
    batteryCharging: batteryInfo.charging,
    connectionType: conn.type,
    connectionDownlink: conn.downlink,
    colorGamut,
    hdr,
    reducedMotion,
    darkMode,
    devicePixelRatio: window.devicePixelRatio,
    gpuVendor: gpu.vendor,
    gpuRenderer: gpu.renderer,
    browserMajor,
    mathFingerprint: mathFp,
    webRtcLocalIps: webRtcIps,
  };
}

function safeTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
  } catch {
    return "unknown";
  }
}

function safeLanguages(): string[] {
  try {
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0)
      return Array.from<string>(navigator.languages);
    if (navigator.language) return [navigator.language];
  } catch {
    /* */
  }
  return ["unknown"];
}

async function buildFallbackFingerprint(): Promise<ClientFingerprint> {
  const persistent = await getOrCreatePersistentId().catch(() => ({
    id: generateId(),
    firstSeen: new Date().toISOString(),
    visitCount: 1,
  }));

  const conn = getConnectionInfo();
  const colorGamut = getColorGamut();
  const hdr = getHdr();
  const reducedMotion = getReducedMotion();
  const darkMode = getDarkMode();
  const browserMajor = parseBrowserMajor();
  const timezone = safeTimezone();
  const languages = safeLanguages();
  const width = typeof screen !== "undefined" ? screen.width : 0;
  const height = typeof screen !== "undefined" ? screen.height : 0;
  const colorDepth = typeof screen !== "undefined" ? screen.colorDepth : 0;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const visitorId = await sha256(
    [
      persistent.id,
      navigator.userAgent ?? "",
      navigator.platform ?? "",
      timezone,
      languages.join(","),
      width,
      height,
      colorDepth,
      dpr,
      navigator.hardwareConcurrency ?? 0,
      nav().deviceMemory?.toString() ?? "0",
      browserMajor ?? "",
      !!nav().webdriver,
    ]
      .map(String)
      .join("|"),
  );

  return {
    visitorId,
    canvasHash: "fallback",
    webglHash: "fallback",
    audioHash: "fallback",
    screen: `${width}x${height}x${colorDepth}@${dpr}`,
    timezone,
    languages,
    cpuCores: navigator.hardwareConcurrency ?? 0,
    deviceMemory: (nav().deviceMemory as number) ?? null,
    platform: navigator.platform ?? "unknown",
    touchPoints: navigator.maxTouchPoints ?? 0,
    webdriver: !!nav().webdriver,
    fontsHash: "fallback",
    pluginsHash: "fallback",
    doNotTrack: navigator.doNotTrack ?? null,
    cookieEnabled: navigator.cookieEnabled,
    persistentId: persistent.id,
    firstSeen: persistent.firstSeen,
    visitCount: persistent.visitCount,
    batteryLevel: null,
    batteryCharging: null,
    connectionType: conn.type,
    connectionDownlink: conn.downlink,
    colorGamut,
    hdr,
    reducedMotion,
    darkMode,
    devicePixelRatio: dpr,
    gpuVendor: null,
    gpuRenderer: null,
    browserMajor,
    mathFingerprint: "fallback",
    webRtcLocalIps: [],
  };
}

export async function collectFingerprintBestEffort(): Promise<ClientFingerprint> {
  try {
    return await collectFingerprint();
  } catch (error) {
    console.warn("[forensic] fingerprint collection failed, using fallback", error);
    return buildFallbackFingerprint();
  }
}

/* ── Behavioral signal tracker ──────────────────────────────── */

export class BehavioralTracker {
  private startTime = Date.now();
  private counters = { mouse: 0, clicks: 0, keys: 0, focus: 0, paste: 0, copy: 0, cut: 0, rightClick: 0 };
  private maxScroll = 0;
  private scrolledBottom = false;
  private pageHidden = false;
  private hiddenStart = 0;
  private totalHidden = 0;
  private timeline: { action: string; ts: number }[] = [];
  private typingDelays: number[] = [];
  private lastKeyTime = 0;
  private mouseVelocities: number[] = [];
  private mouseAccelBuckets = new Array<number>(10).fill(0);
  private lastMousePos: { x: number; y: number; t: number } | null = null;
  private touchPressures: number[] = [];
  private scrollVelocities: number[] = [];
  private lastScrollY = 0;
  private lastScrollTime = 0;
  private teardown: (() => void)[] = [];
  private replay = new DeterministicReplayRecorder();

  private gaze = {
    active: false,
    points: 0,
    fixations: 0,
    blinks: 0,
    fixDurations: [] as number[],
    startMs: 0,
    validMs: 0,
    lastValidT: 0,
    liveness: null as GazeLivenessSummary | null,
  };

  /** Unique ID for this session (this page visit) */
  readonly sessionId: string;
  /** Which visit this is for this signer */
  readonly visitIndex: number;
  /** ISO timestamp when this session started */
  readonly startedAt: string;

  constructor(visitIndex = 0) {
    // Generate a unique session ID
    const bytes = new Uint8Array(12);
    if (typeof crypto !== "undefined") crypto.getRandomValues(bytes);
    else for (let i = 0; i < 12; i++) bytes[i] = Math.floor(Math.random() * 256);
    this.sessionId = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    this.visitIndex = visitIndex;
    this.startedAt = new Date().toISOString();
  }
  private collected: Promise<BehavioralSignals> | null = null;

  start() {
    this.bind("mousemove", (e: MouseEvent) => {
      this.counters.mouse++;
      const now = Date.now();
      if (this.lastMousePos) {
        const dt = now - this.lastMousePos.t;
        if (dt > 0) {
          const dx = e.clientX - this.lastMousePos.x;
          const dy = e.clientY - this.lastMousePos.y;
          const v = Math.sqrt(dx * dx + dy * dy) / dt;
          this.mouseVelocities.push(v);
          this.mouseAccelBuckets[Math.min(9, Math.floor(v * 2))] =
            (this.mouseAccelBuckets[Math.min(9, Math.floor(v * 2))] ?? 0) + 1;
        }
      }
      this.lastMousePos = { x: e.clientX, y: e.clientY, t: now };
    });

    this.bind("click", (e: MouseEvent) => {
      this.counters.clicks++;
      this.addTimeline(`click:${(e.target as HTMLElement)?.tagName ?? "?"}`);
      this.replay.recordClick(e);
    });

    this.bind("keydown", (e: KeyboardEvent) => {
      this.counters.keys++;
      const now = Date.now();
      if (this.lastKeyTime > 0) {
        this.typingDelays.push(now - this.lastKeyTime);
        if (this.typingDelays.length > 50) this.typingDelays.shift();
      }
      this.lastKeyTime = now;
      this.replay.recordKey(e);
    });

    this.bind(
      "scroll",
      () => {
        const top = document.scrollingElement?.scrollTop ?? window.scrollY ?? document.documentElement.scrollTop;
        const height = Math.max(
          document.body?.scrollHeight ?? 0,
          document.documentElement?.scrollHeight ?? 0,
          document.scrollingElement?.scrollHeight ?? 0,
        );
        const client = window.innerHeight || document.documentElement.clientHeight;
        const depth = Math.round(((top + client) / height) * 100);
        this.maxScroll = Math.max(this.maxScroll, depth);
        if (depth >= 95) this.scrolledBottom = true;

        const now = Date.now();
        if (this.lastScrollTime > 0) {
          const dt = now - this.lastScrollTime;
          if (dt > 0) {
            this.scrollVelocities.push(Math.abs(top - this.lastScrollY) / dt);
            if (this.scrollVelocities.length > 30) this.scrollVelocities.shift();
          }
        }
        this.lastScrollY = top;
        this.lastScrollTime = now;
        this.replay.recordScroll(top, Math.max(0, height - client));
      },
      window,
    );

    this.bind("visibilitychange", () => {
      if (document.hidden) {
        this.pageHidden = true;
        this.hiddenStart = Date.now();
        this.addTimeline("page_hidden");
        this.replay.recordVisibility(true);
      } else if (this.hiddenStart) {
        this.totalHidden += Date.now() - this.hiddenStart;
        this.hiddenStart = 0;
        this.addTimeline("page_visible");
        this.replay.recordVisibility(false);
      }
    });

    this.bind("touchstart", (e: TouchEvent) => {
      try {
        for (const t of Array.from(e.touches)) {
          if (t && typeof t.force === "number" && t.force > 0) this.touchPressures.push(t.force);
        }
      } catch {
        /* */
      }
    });

    this.bind("focusin", (e: FocusEvent) => {
      this.counters.focus++;
      this.replay.recordFocus(e.target);
    });
    this.bind("focusout", (e: FocusEvent) => {
      this.replay.recordBlur(e.target);
      const fieldId = this.resolveClosestFieldId(e.target);
      if (fieldId) this.replay.flushFieldValue(fieldId);
    });
    this.bind("paste", (e: ClipboardEvent) => {
      this.counters.paste++;
      this.addTimeline("paste");
      this.replay.recordClipboard("paste", e.target, e.clipboardData?.getData("text/plain"));
    });
    this.bind("copy", (e: ClipboardEvent) => {
      this.counters.copy++;
      this.addTimeline("copy");
      this.replay.recordClipboard("copy", e.target, e.clipboardData?.getData("text/plain"));
    });
    this.bind("cut", (e: ClipboardEvent) => {
      this.counters.cut++;
      this.addTimeline("cut");
      this.replay.recordClipboard("cut", e.target, e.clipboardData?.getData("text/plain"));
    });
    this.bind("contextmenu", (e: MouseEvent) => {
      this.counters.rightClick++;
      this.replay.recordContextMenu(e);
    });
  }

  logAction(action: string) {
    this.addTimeline(action);
  }

  recordFieldFocus(fieldId: string) {
    this.addTimeline(`field_focus:${fieldId}`);
    this.replay.recordHighlight(`field:${fieldId}`, "focus");
  }

  recordFieldBlur(fieldId: string) {
    this.addTimeline(`field_blur:${fieldId}`);
    this.replay.flushFieldValue(fieldId);
  }

  recordFieldValue(fieldId: string, value: string) {
    this.replay.recordFieldValue(fieldId, value);
  }

  recordNavigation(direction: "prev" | "next" | "jump", fieldId?: string, index?: number) {
    this.addTimeline(`nav_${direction}${fieldId ? `:${fieldId}` : ""}`);
    this.replay.recordNavigation(direction, fieldId ? `field:${fieldId}` : `nav:${direction}`, index);
  }

  recordPage(page: number, totalPages: number) {
    this.addTimeline(`page:${page}/${totalPages}`);
    this.replay.recordPage(page, totalPages);
  }

  recordModal(name: string, open: boolean) {
    this.addTimeline(`${name}:${open ? "open" : "close"}`);
    this.replay.recordModal(name, open);
  }

  startSignatureStroke(surfaceId: string, x: number, y: number, pressure?: number | null) {
    return this.replay.recordSignatureStrokeStart(`signature:${surfaceId}`, x, y, pressure);
  }

  recordSignaturePoint(strokeId: number, x: number, y: number, pressure?: number | null) {
    this.replay.recordSignaturePoint(strokeId, x, y, pressure);
  }

  endSignatureStroke(strokeId: number) {
    this.replay.recordSignatureStrokeEnd(strokeId);
  }

  commitSignature(surfaceId: string, strokes: TimedSignatureStroke[]) {
    this.replay.recordSignatureCommit(`signature:${surfaceId}`, strokes);
  }

  clearSignature(surfaceId: string) {
    this.replay.recordSignatureClear(`signature:${surfaceId}`);
  }

  /* ── Eye-gaze tracking (premium) ──────────────────────────── */

  activateGazeTracking() {
    const now = Date.now();
    this.gaze.active = true;
    this.gaze.startMs = now;
    this.gaze.lastValidT = now;
    this.addTimeline("gaze_tracking_started");
  }

  /** Reserved for future use — controls whether gaze is recorded in the forensic tape. */
  gazeRecordingEnabled = true;

  recordGazePoint(x: number, y: number, confidence: number) {
    this.gaze.points++;
    const now = Date.now();
    if (this.gaze.lastValidT > 0) this.gaze.validMs += now - this.gaze.lastValidT;
    this.gaze.lastValidT = now;
    this.replay.recordGazePoint(x, y, confidence);
  }

  recordGazeFixation(x: number, y: number, durationMs: number, target?: EventTarget | Element | null) {
    this.gaze.fixations++;
    this.gaze.fixDurations.push(durationMs);
    if (this.gaze.fixDurations.length > 200) this.gaze.fixDurations.shift();
    this.replay.recordGazeFixation(x, y, durationMs, target);
  }

  recordGazeSaccade(fromX: number, fromY: number, toX: number, toY: number, velocityDegPerS: number) {
    this.replay.recordGazeSaccade(fromX, fromY, toX, toY, velocityDegPerS);
  }

  recordGazeBlink(durationMs: number) {
    this.gaze.blinks++;
    this.replay.recordGazeBlink(durationMs);
  }

  recordGazeCalibration(accuracy: number, pointCount: number) {
    this.addTimeline(`gaze_calibration:${Math.round(accuracy * 100)}%`);
    this.replay.recordGazeCalibration(accuracy, pointCount);
  }

  recordGazeLost(reason: number) {
    this.gaze.lastValidT = 0;
    this.replay.recordGazeLost(reason);
  }

  recordGazeRestored() {
    this.gaze.lastValidT = Date.now();
  }

  recordGazeLiveness(summary: GazeLivenessSummary) {
    this.gaze.liveness = summary;
    this.addTimeline(`gaze_liveness:${summary.passedCount}/${summary.challengeCount}`);
  }

  /** Mark the timestamp when document viewing started (calibration/liveness ended).
   *  The replay viewer uses this to filter out pre-document gaze data. */
  documentViewingStartedMs = 0;
  markDocumentViewingStarted() {
    this.documentViewingStartedMs = Date.now() - this.startTime;
    this.addTimeline("document_viewing_started");
  }

  async collect(): Promise<BehavioralSignals> {
    if (this.collected) return this.collected;
    this.collected = (async () => {
      if (this.hiddenStart) {
        this.totalHidden += Date.now() - this.hiddenStart;
        this.hiddenStart = 0;
      }
      this.teardown.forEach((fn) => fn());
      this.teardown = [];

      const avgArr = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

      let replay: BehavioralSignals["replay"] = null;
      try {
        replay = await this.replay.finalize();
      } catch (error) {
        console.warn("[forensic] replay finalize failed, continuing without replay", error);
      }

      return {
        timeOnPage: Date.now() - this.startTime,
        scrolledToBottom: this.scrolledBottom,
        maxScrollDepth: this.maxScroll,
        mouseMoveCount: this.counters.mouse,
        clickCount: this.counters.clicks,
        keyPressCount: this.counters.keys,
        pageWasHidden: this.pageHidden,
        hiddenDuration: this.totalHidden,
        interactionTimeline: this.timeline.slice(-50),
        typingCadence: [...this.typingDelays],
        mouseVelocityAvg: avgArr(this.mouseVelocities),
        mouseAccelerationPattern: await sha256(this.mouseAccelBuckets.join(",")),
        touchPressureAvg: this.touchPressures.length > 0 ? avgArr(this.touchPressures) : null,
        scrollPattern: [...this.scrollVelocities],
        focusChanges: this.counters.focus,
        pasteEvents: this.counters.paste,
        copyEvents: this.counters.copy,
        cutEvents: this.counters.cut,
        rightClicks: this.counters.rightClick,
        gazeTrackingActive: this.gaze.active,
        gazePointCount: this.gaze.points,
        gazeFixationCount: this.gaze.fixations,
        gazeFixationAvgMs: avgArr(this.gaze.fixDurations),
        gazeBlinkCount: this.gaze.blinks,
        gazeBlinkRate: this.gazeElapsedMs() > 0 ? (this.gaze.blinks / this.gazeElapsedMs()) * 60000 : 0,
        gazeTrackingCoverage: this.gazeElapsedMs() > 0 ? this.gaze.validMs / this.gazeElapsedMs() : 0,
        gazeLiveness: this.gaze.liveness,
        documentViewingStartedMs: this.documentViewingStartedMs || undefined,
        replay,
      };
    })();
    return this.collected;
  }

  /* ── Internal helpers ───────────────────────────────────────── */

  private gazeElapsedMs() {
    return this.gaze.active ? Date.now() - this.gaze.startMs : 0;
  }

  private addTimeline(action: string) {
    this.timeline.push({ action, ts: Date.now() - this.startTime });
  }

  private resolveClosestFieldId(target: EventTarget | null) {
    if (!(target instanceof Element)) return null;
    return target.closest("[id]")?.id ?? null;
  }

  private bind<K extends keyof DocumentEventMap>(
    event: K,
    handler: (e: DocumentEventMap[K]) => void,
    target: EventTarget = document,
  ) {
    target.addEventListener(event as string, handler as EventListener, { passive: true });
    this.teardown.push(() => target.removeEventListener(event as string, handler as EventListener));
  }
}

/* ── External provider enrichment ───────────────────────────── */

export interface ExternalFingerprintProvider {
  name: string;
  getVisitorId(): Promise<string>;
}

export async function enrichWithExternalProvider(
  fp: ClientFingerprint,
  provider: ExternalFingerprintProvider,
): Promise<ClientFingerprint> {
  try {
    return { ...fp, externalVisitorId: await provider.getVisitorId(), externalProvider: provider.name };
  } catch {
    return fp;
  }
}
