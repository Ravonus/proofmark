// Client-side collection

export type {
  CapturedField,
  CapturedGeometry,
  CapturedPage,
  CapturedSignaturePad,
  CapturedViewport,
  CaptureResult,
  CaptureString,
  CaptureTarget,
} from "./capture-adapter";
// Capture adapter (thin browser shell)
export { ForensicCaptureAdapter, snapshotGeometry } from "./capture-adapter";
export type { ExternalFingerprintProvider } from "./fingerprint";
export {
  BehavioralTracker,
  collectFingerprint,
  collectFingerprintBestEffort,
  enrichWithExternalProvider,
} from "./fingerprint";
// Sub-modules (for advanced usage / testing)
export { generateId, sha256 } from "./hash";
export { getOrCreatePersistentId } from "./persistence";
export type { ActiveStroke, PlaybackState, SceneSnapshot, StrokePoint } from "./playback-controller";
// Playback controller (TS fallback)
export { TSMultiSignerController, TSPlaybackController } from "./playback-controller";
export {
  DeterministicReplayRecorder,
  decodeForensicReplay,
  decodeTimedSignature,
  encodeTimedSignature,
  replayForensicTape,
} from "./replay";
export type { ForensicReplayCore, ForensicReplayCoreKind } from "./replay-core";
export {
  configureForensicReplayWasmLoader,
  createTypeScriptReplayCore,
  loadForensicReplayCore,
  resetForensicReplayCore,
  resolveForensicReplayCore,
  warmForensicReplayCore,
} from "./replay-core";
export {
  REPLAY_CHUNK_IDS,
  REPLAY_CLIPBOARD_ACTION_CODES,
  REPLAY_CONTAINER_MAGIC,
  REPLAY_ENCODING,
  REPLAY_FORMAT_LIMITS,
  REPLAY_NAV_DIRECTION_CODES,
  REPLAY_OPS,
  REPLAY_STREAM_IDS,
  REPLAY_STRING_KINDS,
  SIGNATURE_ENCODING,
} from "./replay-format";
export type {
  ForensicSession,
  ForensicSessionLivenessProfile,
  ForensicSessionProfile,
  ForensicSessionSignal,
  InteractionAction,
  InteractionClassification,
  PersistedForensicSessionCapture,
  SessionClassification,
  SignerBaselineComparison,
  SignerBaselineProfile,
  SignerForensicSessions,
} from "./session";
// Sessions (multi-visit tracking + per-interaction classification)
export {
  buildForensicSession,
  buildForensicSessionProfile,
  buildSignerBaselineProfile,
  classifyInteractions,
  classifySession,
  generateSessionId,
  mergeSignerSessions,
} from "./session";
export { analyzeTimedSignature, extractReplaySignatureAnalysis } from "./signature-analysis";
export type { EmbeddedReplayPayload, ExternalReplayPayload, ReplayStoragePointer } from "./storage";
// Storage tiers
export {
  buildEmbeddedPayload,
  buildExternalPointer,
  EXTERNALIZE_THRESHOLD_BYTES,
  estimateEmbeddedSize,
  shouldExternalize,
} from "./storage";

// Types
export type {
  BehavioralSignals,
  ClientFingerprint,
  ForensicEvidence,
  ForensicFingerprintProvider,
  ForensicFlag,
  ForensicGeoProvider,
  ForensicProviderConfig,
  ForensicReplayEventKind,
  ForensicReplayStringEntry,
  ForensicReplayTape,
  ForensicReplayTarget,
  ForensicReplayViewport,
  GeoIntel,
  TimedSignaturePoint,
  TimedSignatureStroke,
  TlsFingerprint,
} from "./types";
