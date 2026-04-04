// Client-side collection
export {
  collectFingerprint,
  collectFingerprintBestEffort,
  BehavioralTracker,
  enrichWithExternalProvider,
} from "./fingerprint";
export type { ExternalFingerprintProvider } from "./fingerprint";
export {
  DeterministicReplayRecorder,
  decodeForensicReplay,
  replayForensicTape,
  encodeTimedSignature,
  decodeTimedSignature,
} from "./replay";
export {
  configureForensicReplayWasmLoader,
  createTypeScriptReplayCore,
  loadForensicReplayCore,
  resetForensicReplayCore,
  resolveForensicReplayCore,
  warmForensicReplayCore,
} from "./replay-core";
export type { ForensicReplayCore, ForensicReplayCoreKind } from "./replay-core";
export {
  REPLAY_ENCODING,
  SIGNATURE_ENCODING,
  REPLAY_CONTAINER_MAGIC,
  REPLAY_CHUNK_IDS,
  REPLAY_STREAM_IDS,
  REPLAY_OPS,
  REPLAY_NAV_DIRECTION_CODES,
  REPLAY_CLIPBOARD_ACTION_CODES,
  REPLAY_STRING_KINDS,
  REPLAY_FORMAT_LIMITS,
} from "./replay-format";

// Capture adapter (thin browser shell)
export { ForensicCaptureAdapter, snapshotGeometry } from "./capture-adapter";
export type {
  CapturedGeometry,
  CapturedViewport,
  CapturedPage,
  CapturedField,
  CapturedSignaturePad,
  CaptureTarget,
  CaptureString,
  CaptureResult,
} from "./capture-adapter";

// Playback controller (TS fallback)
export { TSPlaybackController, TSMultiSignerController } from "./playback-controller";
export type { PlaybackState, SceneSnapshot, ActiveStroke, StrokePoint } from "./playback-controller";

// Storage tiers
export {
  buildEmbeddedPayload,
  buildExternalPointer,
  estimateEmbeddedSize,
  shouldExternalize,
  EXTERNALIZE_THRESHOLD_BYTES,
} from "./storage";
export type { ReplayStoragePointer, EmbeddedReplayPayload, ExternalReplayPayload } from "./storage";

// Sessions (multi-visit tracking + per-interaction classification)
export {
  generateSessionId,
  buildForensicSessionProfile,
  buildSignerBaselineProfile,
  classifyInteractions,
  classifySession,
  buildForensicSession,
  mergeSignerSessions,
} from "./session";
export type {
  ForensicSession,
  ForensicSessionProfile,
  ForensicSessionLivenessProfile,
  ForensicSessionSignal,
  PersistedForensicSessionCapture,
  SessionClassification,
  InteractionClassification,
  InteractionAction,
  SignerBaselineComparison,
  SignerBaselineProfile,
  SignerForensicSessions,
} from "./session";

// Sub-modules (for advanced usage / testing)
export { sha256, generateId } from "./hash";
export { getOrCreatePersistentId } from "./persistence";
export { analyzeTimedSignature, extractReplaySignatureAnalysis } from "./signature-analysis";

// Types
export type {
  ClientFingerprint,
  BehavioralSignals,
  GeoIntel,
  TlsFingerprint,
  ForensicEvidence,
  ForensicFlag,
  ForensicGeoProvider,
  ForensicFingerprintProvider,
  ForensicProviderConfig,
  ForensicReplayEventKind,
  ForensicReplayViewport,
  ForensicReplayTarget,
  ForensicReplayStringEntry,
  ForensicReplayTape,
  TimedSignaturePoint,
  TimedSignatureStroke,
} from "./types";
