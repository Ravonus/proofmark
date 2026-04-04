/**
 * Shared forensic replay wire-format constants.
 *
 * This file defines the target binary container and opcode vocabulary that the
 * Rust/WASM forensic core should own. The current browser recorder already
 * uses the same event semantics and numeric opcodes, even though its v1 output
 * is still wrapped in JSON metadata plus a base64 tape.
 */

export const REPLAY_ENCODING = "pm-replay-v1" as const;
export const SIGNATURE_ENCODING = "pm-sig-v1" as const;

/**
 * Target container magic for the future Rust/WASM-owned binary bundle.
 * Bytes: 0x50 0x4d 0x52 0x50 => "PMRP"
 */
export const REPLAY_CONTAINER_MAGIC = "PMRP" as const;

/**
 * Chunk IDs for the future compact container.
 * The current recorder emits equivalent logical sections as JSON metadata.
 */
export const REPLAY_CHUNK_IDS = {
  SessionHeader: 1,
  TargetDictionary: 2,
  StringDictionary: 3,
  MainEventStream: 4,
  SignatureStream: 5,
  EditStream: 6,
  IntegrityFooter: 7,
  GazeStream: 8,
} as const;

export const REPLAY_STREAM_IDS = {
  Main: 1,
  Signature: 2,
  Edit: 3,
} as const;

export const REPLAY_OPS = {
  Scroll: 1,
  Click: 2,
  Key: 3,
  Focus: 4,
  Blur: 5,
  Visibility: 6,
  Highlight: 7,
  Navigation: 8,
  Page: 9,
  Modal: 10,
  SignatureStart: 11,
  SignaturePoint: 12,
  SignatureEnd: 13,
  SignatureCommit: 14,
  FieldCommit: 15,
  Clipboard: 16,
  ContextMenu: 17,
  SignatureClear: 18,
  // v2 opcodes
  MouseMove: 19,
  HoverDwell: 20,
  ViewportResize: 21,
  TouchStart: 22,
  TouchMove: 23,
  TouchEnd: 24,
  FieldCorrection: 25,
  ScrollMomentum: 26,
  // v3 opcodes — eye gaze tracking (premium forensic)
  GazePoint: 27,
  GazeFixation: 28,
  GazeSaccade: 29,
  GazeBlink: 30,
  GazeCalibration: 31,
  GazeLost: 32,
} as const;

export const REPLAY_NAV_DIRECTION_CODES = {
  prev: 1,
  next: 2,
  jump: 3,
} as const;

export const REPLAY_CLIPBOARD_ACTION_CODES = {
  copy: 1,
  cut: 2,
  paste: 3,
} as const;

export const REPLAY_STRING_KINDS = {
  key: 1,
  label: 2,
  value: 3,
  signature: 4,
  clipboard: 5,
} as const;

export const REPLAY_FORMAT_LIMITS = {
  timeQuantumMs: 8,
  maxStoredStringLength: 2048,
  maxFieldSnapshotLength: 1024,
  maxClipboardPreview: 48,
  maxTargetDescriptorLength: 256,
  maxTargetAncestors: 4,
  chunkEventCount: 256,
  chunkHashEvery: 4,
  coordinateQuantizationPx: 1,
  pressureBuckets: 256,
  gazeCoordinateScale: 1000, // 0-1000 = 0.1% viewport precision
  gazeMinSampleIntervalMs: 16,
  gazeFixationThresholdMs: 100,
  maxGazePointsPerSession: 18000,
} as const;

export type ReplayOpCode = (typeof REPLAY_OPS)[keyof typeof REPLAY_OPS];
