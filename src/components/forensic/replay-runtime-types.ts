import type { ForensicReplayTape } from "~/lib/forensic/types";

export interface ReplayParticipantSummary {
  signerId: string;
  label: string;
  replay: ForensicReplayTape;
  status?: string;
  signedAt?: string | Date | null;
  forensicHash?: string | null;
  automationReview?: {
    verdict: string;
    confidence: number;
    source: string;
    automationScore: number;
    recommendedAction: string;
    rationale?: string;
    createdAt?: string;
  } | null;
  policyOutcome?: {
    action: string;
    blocked: boolean;
    reason: string;
  } | null;
  storage?: {
    mode: string;
    objectCid: string | null;
    objectHash: string | null;
    byteLength: number;
    anchored: boolean;
    anchors: Array<{
      chain: string;
      status: string;
      txHash?: string | null;
    }>;
  } | null;
  signatureMotion?: {
    strokeCount: number;
    pointCount: number;
    durationMs: number;
    penLiftCount: number;
    pathLengthPx: number;
    averageVelocityPxPerMs: number;
    velocityCoefficientOfVariation: number;
    directionChangeCount: number;
    pauseCount: number;
    maxPauseMs: number;
    motionComplexityScore: number;
    motionUniformityScore: number;
    boundingBox: {
      width: number;
      height: number;
      aspectRatio: number;
    };
  } | null;
}

type ReplayEventBase = {
  lane: number;
  atMs: number;
  deltaMs: number;
};

export type ReplayLaneEvent =
  | (ReplayEventBase & { type: "scroll"; scrollY: number; scrollMax: number })
  | (ReplayEventBase & {
      type: "click";
      target: string | null;
      x: number;
      y: number;
      button: number;
    })
  | (ReplayEventBase & {
      type: "key";
      target: string | null;
      key: string;
      modifiers: number;
    })
  | (ReplayEventBase & { type: "focus"; target: string | null })
  | (ReplayEventBase & { type: "blur"; target: string | null })
  | (ReplayEventBase & { type: "visibility"; hidden: boolean })
  | (ReplayEventBase & {
      type: "highlight";
      target: string | null;
      label: string | null;
    })
  | (ReplayEventBase & {
      type: "navigation";
      direction: string;
      target: string | null;
      index: number;
    })
  | (ReplayEventBase & { type: "page"; page: number; totalPages: number })
  | (ReplayEventBase & { type: "modal"; name: string; open: boolean })
  | (ReplayEventBase & {
      type: "signatureStart";
      target: string | null;
      strokeId: number;
      x: number;
      y: number;
      pressure: number;
    })
  | (ReplayEventBase & {
      type: "signaturePoint";
      strokeId: number;
      x: number;
      y: number;
      pressure: number;
    })
  | (ReplayEventBase & { type: "signatureEnd"; strokeId: number })
  | (ReplayEventBase & {
      type: "signatureCommit";
      target: string | null;
      signature: string;
    })
  | (ReplayEventBase & { type: "signatureClear"; target: string | null })
  | (ReplayEventBase & {
      type: "fieldCommit";
      target: string | null;
      value: string;
    })
  | (ReplayEventBase & {
      type: "clipboard";
      action: string;
      target: string | null;
      summary: string;
    })
  | (ReplayEventBase & {
      type: "contextMenu";
      target: string | null;
      x: number;
      y: number;
    })
  // Gaze tracking events (premium)
  | (ReplayEventBase & {
      type: "gazePoint";
      x: number;
      y: number;
      confidence: number;
    })
  | (ReplayEventBase & {
      type: "gazeFixation";
      x: number;
      y: number;
      durationMs: number;
      target: string | null;
    })
  | (ReplayEventBase & {
      type: "gazeSaccade";
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      velocityDegPerS: number;
    })
  | (ReplayEventBase & { type: "gazeBlink"; durationMs: number })
  | (ReplayEventBase & {
      type: "gazeCalibration";
      accuracy: number;
      pointCount: number;
    })
  | (ReplayEventBase & { type: "gazeLost"; reason: number });

export interface PreparedReplayLane extends ReplayParticipantSummary {
  lane: number;
  durationMs: number;
  eventCount: number;
  events: ReplayLaneEvent[];
  source: "wasm" | "ts";
}

export interface PreparedReplaySession {
  source: "wasm" | "ts";
  durationMs: number;
  lanes: PreparedReplayLane[];
  mergedEvents: ReplayLaneEvent[];
}

export interface ReplayLaneSnapshot {
  lane: number;
  label: string;
  durationMs: number;
  currentEvent: ReplayLaneEvent | null;
  elapsedEventCount: number;
  progress: number;
  scrollY: number;
  scrollMax: number;
  scrollRatio: number;
  page: number;
  totalPages: number;
  currentTarget: string | null;
  focusedTarget: string | null;
  highlightedLabel: string | null;
  modalName: string | null;
  hidden: boolean;
  recentKeys: string[];
  recentClipboard: Array<{ action: string; summary: string; atMs: number }>;
  recentFields: Array<{ target: string | null; value: string; atMs: number }>;
  signatureStrokes: Array<Array<{ x: number; y: number }>>;
  committedSignature: string | null;
  /** Current gaze position (normalized 0-1000 viewport coordinates) or null if not tracked */
  gazePosition: { x: number; y: number; confidence: number } | null;
  /** Whether gaze tracking is currently lost */
  gazeTrackingLost: boolean;
  /** Recent gaze trail (last N points for heatmap/trail rendering) */
  gazeTrail: Array<{ x: number; y: number; confidence: number; atMs: number }>;
  /** Active fixation in progress (if any) */
  gazeFixation: { x: number; y: number; durationMs: number } | null;
  /** Total blinks so far */
  gazeBlinkCount: number;
  /** Whether gaze tracking is active for this lane */
  gazeActive: boolean;
}

export type WasmPlaybackEvent =
  | {
      type: "scroll";
      lane: number;
      atMs: number;
      deltaMs: number;
      scrollY: number;
      scrollMax: number;
    }
  | {
      type: "click";
      lane: number;
      atMs: number;
      deltaMs: number;
      targetId: number;
      x: number;
      y: number;
      button: number;
    }
  | {
      type: "key";
      lane: number;
      atMs: number;
      deltaMs: number;
      targetId: number;
      keyId: number;
      modifiers: number;
    }
  | {
      type: "focus";
      lane: number;
      atMs: number;
      deltaMs: number;
      targetId: number;
    }
  | {
      type: "blur";
      lane: number;
      atMs: number;
      deltaMs: number;
      targetId: number;
    }
  | {
      type: "visibility";
      lane: number;
      atMs: number;
      deltaMs: number;
      hidden: boolean;
    }
  | {
      type: "highlight";
      lane: number;
      atMs: number;
      deltaMs: number;
      targetId: number;
      labelId: number;
    }
  | {
      type: "navigation";
      lane: number;
      atMs: number;
      deltaMs: number;
      direction: string;
      targetId: number;
      index: number;
    }
  | {
      type: "page";
      lane: number;
      atMs: number;
      deltaMs: number;
      page: number;
      totalPages: number;
    }
  | {
      type: "modal";
      lane: number;
      atMs: number;
      deltaMs: number;
      nameId: number;
      open: boolean;
    }
  | {
      type: "signatureStart";
      lane: number;
      atMs: number;
      deltaMs: number;
      targetId: number;
      strokeId: number;
      x: number;
      y: number;
      pressure: number;
    }
  | {
      type: "signaturePoint";
      lane: number;
      atMs: number;
      deltaMs: number;
      strokeId: number;
      x: number;
      y: number;
      pressure: number;
    }
  | {
      type: "signatureEnd";
      lane: number;
      atMs: number;
      deltaMs: number;
      strokeId: number;
    }
  | {
      type: "signatureCommit";
      lane: number;
      atMs: number;
      deltaMs: number;
      targetId: number;
      signatureId: number;
    }
  | {
      type: "signatureClear";
      lane: number;
      atMs: number;
      deltaMs: number;
      targetId: number;
    }
  | {
      type: "fieldCommit";
      lane: number;
      atMs: number;
      deltaMs: number;
      targetId: number;
      valueId: number;
    }
  | {
      type: "clipboard";
      lane: number;
      atMs: number;
      deltaMs: number;
      action: string;
      targetId: number;
      summaryId: number;
    }
  | {
      type: "contextMenu";
      lane: number;
      atMs: number;
      deltaMs: number;
      targetId: number;
      x: number;
      y: number;
    };

export type WasmPlaybackLane = {
  lane: number;
  label?: string | null;
  durationMs: number;
  eventCount: number;
  events: WasmPlaybackEvent[];
};

export type WasmPlaybackTimeline = {
  durationMs: number;
  laneCount: number;
  eventCount: number;
  lanes: WasmPlaybackLane[];
  events: WasmPlaybackEvent[];
};

export type ForensicPlaybackWasmModule = {
  default: () => Promise<unknown>;
  build_replay_timeline: (tapeBase64: string, lane: number, label?: string | null) => WasmPlaybackTimeline;
  merge_replay_timelines: (lanes: WasmPlaybackLane[]) => WasmPlaybackTimeline;
};
