import { decodeTimedSignatureSync, encodeTimedSignatureSync } from "./replay-codec";
import type { REPLAY_CLIPBOARD_ACTION_CODES, REPLAY_NAV_DIRECTION_CODES } from "./replay-format";
import type { ForensicReplayTarget, TimedSignatureStroke } from "./types";

export function encodeTimedSignature(strokes: TimedSignatureStroke[]) {
  return encodeTimedSignatureSync(strokes);
}

export function decodeTimedSignature(encoded: string): TimedSignatureStroke[] {
  return decodeTimedSignatureSync(encoded);
}

export type DecodedForensicReplayEvent =
  | { type: "scroll"; at: number; scrollY: number; scrollMax: number }
  | {
      type: "click";
      at: number;
      target: ForensicReplayTarget | null;
      x: number;
      y: number;
      button: number;
    }
  | {
      type: "key";
      at: number;
      target: ForensicReplayTarget | null;
      key: string;
      modifiers: {
        shift: boolean;
        ctrl: boolean;
        alt: boolean;
        meta: boolean;
        repeat: boolean;
      };
    }
  | { type: "focus"; at: number; target: ForensicReplayTarget | null }
  | { type: "blur"; at: number; target: ForensicReplayTarget | null }
  | { type: "visibility"; at: number; hidden: boolean }
  | {
      type: "highlight";
      at: number;
      target: ForensicReplayTarget | null;
      label: string | null;
    }
  | {
      type: "navigation";
      at: number;
      direction: keyof typeof REPLAY_NAV_DIRECTION_CODES;
      target: ForensicReplayTarget | null;
      index: number;
    }
  | { type: "page"; at: number; page: number; totalPages: number }
  | { type: "modal"; at: number; name: string; open: boolean }
  | {
      type: "signatureStart";
      at: number;
      target: ForensicReplayTarget | null;
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
      target: ForensicReplayTarget | null;
      signature: string;
    }
  | { type: "signatureClear"; at: number; target: ForensicReplayTarget | null }
  | {
      type: "fieldCommit";
      at: number;
      target: ForensicReplayTarget | null;
      value: string;
    }
  | {
      type: "clipboard";
      at: number;
      target: ForensicReplayTarget | null;
      action: keyof typeof REPLAY_CLIPBOARD_ACTION_CODES;
      summary: string;
    }
  | {
      type: "contextMenu";
      at: number;
      target: ForensicReplayTarget | null;
      x: number;
      y: number;
    }
  // Gaze tracking events (premium)
  | { type: "gazePoint"; at: number; x: number; y: number; confidence: number }
  | {
      type: "gazeFixation";
      at: number;
      x: number;
      y: number;
      durationMs: number;
      target: ForensicReplayTarget | null;
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

export type ForensicReplayHandlers = {
  onEvent?: (event: DecodedForensicReplayEvent) => void;
  onScroll?: (event: Extract<DecodedForensicReplayEvent, { type: "scroll" }>) => void;
  onClick?: (event: Extract<DecodedForensicReplayEvent, { type: "click" }>) => void;
  onKey?: (event: Extract<DecodedForensicReplayEvent, { type: "key" }>) => void;
  onFocus?: (event: Extract<DecodedForensicReplayEvent, { type: "focus" }>) => void;
  onBlur?: (event: Extract<DecodedForensicReplayEvent, { type: "blur" }>) => void;
  onHighlight?: (event: Extract<DecodedForensicReplayEvent, { type: "highlight" }>) => void;
  onNavigation?: (event: Extract<DecodedForensicReplayEvent, { type: "navigation" }>) => void;
  onPage?: (event: Extract<DecodedForensicReplayEvent, { type: "page" }>) => void;
  onModal?: (event: Extract<DecodedForensicReplayEvent, { type: "modal" }>) => void;
  onSignatureStart?: (event: Extract<DecodedForensicReplayEvent, { type: "signatureStart" }>) => void;
  onSignaturePoint?: (event: Extract<DecodedForensicReplayEvent, { type: "signaturePoint" }>) => void;
  onSignatureEnd?: (event: Extract<DecodedForensicReplayEvent, { type: "signatureEnd" }>) => void;
  onSignatureCommit?: (event: Extract<DecodedForensicReplayEvent, { type: "signatureCommit" }>) => void;
  onSignatureClear?: (event: Extract<DecodedForensicReplayEvent, { type: "signatureClear" }>) => void;
  onFieldCommit?: (event: Extract<DecodedForensicReplayEvent, { type: "fieldCommit" }>) => void;
  onClipboard?: (event: Extract<DecodedForensicReplayEvent, { type: "clipboard" }>) => void;
  onContextMenu?: (event: Extract<DecodedForensicReplayEvent, { type: "contextMenu" }>) => void;
  onGazePoint?: (event: Extract<DecodedForensicReplayEvent, { type: "gazePoint" }>) => void;
  onGazeFixation?: (event: Extract<DecodedForensicReplayEvent, { type: "gazeFixation" }>) => void;
  onGazeSaccade?: (event: Extract<DecodedForensicReplayEvent, { type: "gazeSaccade" }>) => void;
  onGazeBlink?: (event: Extract<DecodedForensicReplayEvent, { type: "gazeBlink" }>) => void;
  onGazeCalibration?: (event: Extract<DecodedForensicReplayEvent, { type: "gazeCalibration" }>) => void;
  onGazeLost?: (event: Extract<DecodedForensicReplayEvent, { type: "gazeLost" }>) => void;
};

export { decodeForensicReplay, replayForensicTape } from "./replay-decode";
export { DeterministicReplayRecorder } from "./replay-recorder";
