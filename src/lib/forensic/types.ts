/**
 * Forensic Evidence Types
 *
 * Shared types for client-side fingerprinting and server-side
 * forensic evidence collection used to build court-admissible
 * identity proof at signing time.
 */

/* ── Client-side fingerprint (collected in browser) ─────────── */

export interface ClientFingerprint {
  /** Stable visitor ID derived from device characteristics */
  visitorId: string;
  /** Canvas rendering hash */
  canvasHash: string;
  /** WebGL renderer + vendor string hash */
  webglHash: string;
  /** AudioContext oscillator fingerprint hash */
  audioHash: string;
  /** Screen width x height x depth x pixel ratio */
  screen: string;
  /** Intl.DateTimeFormat timezone */
  timezone: string;
  /** navigator.language + languages */
  languages: string[];
  /** navigator.hardwareConcurrency */
  cpuCores: number;
  /** navigator.deviceMemory (if available) */
  deviceMemory: number | null;
  /** navigator.platform */
  platform: string;
  /** Touch support: maxTouchPoints */
  touchPoints: number;
  /** navigator.webdriver flag (bot indicator) */
  webdriver: boolean;
  /** List of installed/available fonts (hash) */
  fontsHash: string;
  /** Plugins hash */
  pluginsHash: string;
  /** Do Not Track header */
  doNotTrack: string | null;
  /** Cookie enabled */
  cookieEnabled: boolean;
  /** Persistent tracker ID (survives cookie clears via storage redundancy) */
  persistentId: string;
  /** First seen timestamp for this persistent ID */
  firstSeen: string;
  /** Number of times this persistent ID has been seen on this domain */
  visitCount: number;
  /** Battery level 0-1 (from navigator.getBattery()) */
  batteryLevel: number | null;
  /** Whether device is currently charging */
  batteryCharging: boolean | null;
  /** Network connection effective type (e.g. "4g", "3g") */
  connectionType: string | null;
  /** Network downlink speed in Mbps */
  connectionDownlink: number | null;
  /** Display color gamut ("p3", "srgb", "rec2020", or null) */
  colorGamut: string | null;
  /** Whether display supports HDR (dynamic-range: high) */
  hdr: boolean | null;
  /** Whether user prefers reduced motion */
  reducedMotion: boolean;
  /** Whether user prefers dark color scheme */
  darkMode: boolean;
  /** Window device pixel ratio */
  devicePixelRatio: number;
  /** Raw GPU vendor string from WebGL debug info */
  gpuVendor: string | null;
  /** Raw GPU renderer string from WebGL debug info */
  gpuRenderer: string | null;
  /** Browser name + major version parsed from UA (e.g. "Chrome/120") */
  browserMajor: string | null;
  /** Hash of Math function outputs (hardware/OS-specific floating point) */
  mathFingerprint: string;
  /** Local IPs discovered via WebRTC (reveals real IP behind VPN) */
  webRtcLocalIps: string[];
  /** Cross-domain provider visitor ID (if pluggable provider is configured) */
  externalVisitorId?: string;
  /** External provider name (e.g. "fingerprintjs-pro", "ipqs") */
  externalProvider?: string;
}

/* ── Behavioral signals (collected during signing session) ──── */

export type GazeLivenessChallengeKind = "look_target" | "blink";

export interface GazeLivenessChallengePlanStep {
  id: string;
  kind: GazeLivenessChallengeKind;
  prompt: string;
  targetX: number | null;
  targetY: number | null;
  radius: number | null;
  holdMs: number | null;
  timeoutMs: number;
}

export interface GazeLivenessStepResult extends GazeLivenessChallengePlanStep {
  passed: boolean;
  reactionMs: number | null;
  observedConfidence: number | null;
}

export interface GazeLivenessSummary {
  required: boolean;
  completed: boolean;
  challengeCount: number;
  passedCount: number;
  failedCount: number;
  passRatio: number;
  averageReactionMs: number | null;
  suspicious: boolean;
  steps: GazeLivenessStepResult[];
}

export interface BehavioralSignals {
  /** Total time on signing page before submission (ms) */
  timeOnPage: number;
  /** Whether user scrolled to bottom of document */
  scrolledToBottom: boolean;
  /** Maximum scroll depth as percentage (0-100) */
  maxScrollDepth: number;
  /** Number of mouse move events recorded */
  mouseMoveCount: number;
  /** Number of click events on the page */
  clickCount: number;
  /** Number of key press events (form fields) */
  keyPressCount: number;
  /** Whether the page was ever hidden/tabbed away */
  pageWasHidden: boolean;
  /** Total time page was hidden (ms) */
  hiddenDuration: number;
  /** Interaction timestamps for key actions */
  interactionTimeline: { action: string; ts: number }[];
  /** Inter-keystroke delays in ms (capped at last 50) */
  typingCadence: number[];
  /** Average mouse velocity across session (pixels/ms) */
  mouseVelocityAvg: number;
  /** Hash of mouse acceleration bucket distribution (unique per user) */
  mouseAccelerationPattern: string;
  /** Average touch pressure if on touch device */
  touchPressureAvg: number | null;
  /** Scroll velocities in px/ms at each scroll event (capped at last 30) */
  scrollPattern: number[];
  /** Number of times focus changed between fields */
  focusChanges: number;
  /** Number of paste events (indicates copy-paste vs typing) */
  pasteEvents: number;
  /** Number of copy events captured during signing */
  copyEvents: number;
  /** Number of cut events captured during signing */
  cutEvents: number;
  /** Number of right-click (context menu) events */
  rightClicks: number;
  gazeTrackingActive: boolean;
  gazePointCount: number;
  gazeFixationCount: number;
  gazeFixationAvgMs: number;
  gazeBlinkCount: number;
  gazeBlinkRate: number;
  /** 0-1, fraction of session with valid gaze tracking */
  gazeTrackingCoverage: number;
  gazeLiveness?: GazeLivenessSummary | null;
  /** Ms into the session when calibration/liveness ended and document viewing began.
   *  Replay viewer uses this to filter out pre-document gaze points. 0 = no calibration. */
  documentViewingStartedMs?: number;
  /** Compact deterministic replay tape for session reconstruction */
  replay: ForensicReplayTape | null;
}

export type ForensicReplayEventKind =
  | "scroll"
  | "click"
  | "key"
  | "focus"
  | "blur"
  | "visibility"
  | "highlight"
  | "navigation"
  | "page"
  | "modal"
  | "signature"
  | "field"
  | "clipboard"
  | "contextmenu"
  | "gaze";

export interface ForensicReplayViewport {
  width: number;
  height: number;
  devicePixelRatio: number;
  scrollWidth: number;
  scrollHeight: number;
}

export interface ForensicReplayTarget {
  id: number;
  hash: string;
  descriptor: string;
}

export interface ForensicReplayStringEntry {
  id: number;
  kind: "key" | "label" | "value" | "signature" | "clipboard";
  hash: string;
  value: string;
}

export interface ForensicReplayGazeAnchorEntry {
  id: number;
  attribute: "data-field-id" | "data-forensic-id";
  value: string;
}

export interface ForensicReplayGazeSample {
  anchorId: number;
  offsetX: number;
  offsetY: number;
}

export interface ForensicReplayGazeMetadata {
  scale: number;
  anchors: ForensicReplayGazeAnchorEntry[];
  samples: ForensicReplayGazeSample[];
}

export interface ForensicReplayTape {
  version: number;
  encoding: "pm-replay-v1";
  timeQuantumMs: number;
  viewport: ForensicReplayViewport;
  targets: ForensicReplayTarget[];
  strings: ForensicReplayStringEntry[];
  gazeAnchors?: ForensicReplayGazeMetadata | null;
  tapeBase64: string;
  tapeHash: string;
  capabilities: ForensicReplayEventKind[];
  metrics: {
    eventCount: number;
    byteLength: number;
    targetCount: number;
    stringCount: number;
    signatureStrokeCount: number;
    signaturePointCount: number;
    clipboardEventCount: number;
    maxTimestampMs: number;
    gazePointCount: number;
    gazeFixationCount: number;
    gazeBlinkCount: number;
  };
}

export interface TimedSignaturePoint {
  x: number;
  y: number;
  t: number;
  force?: number | null;
}

export type TimedSignatureStroke = TimedSignaturePoint[];

/* ── Server-side geo/network intel ──────────────────────────── */

export interface GeoIntel {
  ip: string;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  isp: string | null;
  org: string | null;
  asn: string | null;
  isVpn: boolean | null;
  isProxy: boolean | null;
  isTor: boolean | null;
  isDatacenter: boolean | null;
  isBot: boolean | null;
  /** Fraud score 0-100 from provider (if available) */
  fraudScore: number | null;
  /** Provider that produced this intel */
  provider: string;
}

/* ── TLS fingerprint (captured at reverse proxy) ────────────── */

export interface TlsFingerprint {
  /** JA3 or JA4 hash */
  hash: string;
  /** JA3 or JA4 */
  type: "ja3" | "ja4";
}

/* ── Complete forensic evidence packet ──────────────────────── */

export interface ForensicEvidence {
  /** Version of forensic evidence schema */
  version: number;
  /** When this evidence was collected */
  collectedAt: string;
  /** Client-side device fingerprint */
  fingerprint: ClientFingerprint;
  /** Behavioral signals from signing session */
  behavioral: BehavioralSignals;
  /** Server-side IP geolocation + network intel */
  geo: GeoIntel | null;
  /** TLS fingerprint if available from reverse proxy headers */
  tls: TlsFingerprint | null;
  /** User agent string */
  userAgent: string | null;
  /** Raw IP address */
  ip: string | null;
  /** SHA-256 hash of entire evidence packet (for tamper detection) */
  evidenceHash: string;
  /** Flags raised during collection */
  flags: ForensicFlag[];
  /** Reverse DNS hostname for the IP */
  reverseDns: string | null;
  /** SHA-256 hash of sorted HTTP header names (browser fingerprint signal) */
  headerFingerprint: string | null;
  /** Accept-Language header value from the request */
  acceptLanguage: string | null;
  /** All proxy hops from X-Forwarded-* headers */
  forwardedChain: string[] | null;
}

export interface ForensicFlag {
  code: string;
  severity: "info" | "warn" | "critical";
  message: string;
}

/* ── Provider interface for pluggable geo/fingerprint APIs ──── */

export interface ForensicGeoProvider {
  name: string;
  lookupIp(ip: string): Promise<GeoIntel>;
}

export interface ForensicFingerprintProvider {
  name: string;
  /** Client-side: returns a script URL or config to inject */
  getClientConfig(): { scriptUrl?: string; apiKey?: string };
}

/* ── Provider config stored in integrationConfigs ───────────── */

export type ForensicProviderConfig = {
  provider:
    | "maxmind"
    | "maxmind-geoip-lite"
    | "ipinfo"
    | "ipapi"
    | "ipqualityscore"
    | "abstractapi"
    | "fingerprintjs-pro"
    | "custom-webhook";
  enabled?: boolean;
  apiKey?: string;
  /** For MaxMind: path to local GeoLite2 database file */
  dbPath?: string;
  /** For custom webhook: URL to POST forensic data to */
  webhookUrl?: string;
};
