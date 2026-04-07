"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Lock,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Unlock,
  PanelRightClose,
  PanelRightOpen,
  User,
  HelpCircle,
} from "lucide-react";
import { trpc } from "~/lib/platform/trpc";
import { tokenizeDocument } from "~/lib/document/document-tokens";
import { decodeReplayEventsSync, type ForensicReplayEncodedEvent } from "~/lib/forensic/replay-codec";
import { REPLAY_FORMAT_LIMITS } from "~/lib/forensic/replay-format";
import type { BehavioralSignals, ForensicReplayTape } from "~/lib/forensic/types";
import {
  classifyInteractions,
  classifySession,
  type InteractionClassification,
  type SessionClassification,
} from "~/lib/forensic/session";
import { isImageDataUrl } from "~/lib/document/field-values";
import { isFieldRequired, isFieldVisible } from "~/lib/document/field-runtime";
import { DocumentPaper } from "../document-editor/document-paper";
import { InlineFieldInput } from "../signing/sign-document-inline-field";
import { DocumentHeader, SignerList } from "../signing/sign-document-parts";
import { validateField, type SignerInfo } from "../signing/sign-document-helpers";

type Props = { documentId?: string; shareToken?: string };

const SPEEDS = [0.5, 1, 2, 4, 8];
const TQ = REPLAY_FORMAT_LIMITS.timeQuantumMs;
const GAZE_SCALE = 1000;
const GAZE_TRAIL_LENGTH = 20;
const LANE_COLORS = ["#60a5fa", "#f87171", "#34d399", "#fbbf24", "#a78bfa", "#38bdf8", "#fb923c", "#e879f9"];

const noop = () => {
  /* noop */
};
const noopUpload = async () => "" as string;
const noopSuggestions = async () => [] as never[];
const noopPayment = async () => {
  /* noop */
};

function formatTime(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function laneColor(index: number) {
  return LANE_COLORS[index % LANE_COLORS.length] ?? "#60a5fa";
}

function escapeSelectorValue(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function resolveFieldId(tape: ForensicReplayTape, targetId: number) {
  const target = tape.targets.find((entry) => entry.id === targetId);
  if (!target) return null;
  const match = /field:([^\s>|]+)/.exec(target.descriptor) ?? /\bid:([^\s>|]+)/.exec(target.descriptor);
  return match?.[1] ?? null;
}

function resolveString(tape: ForensicReplayTape, id: number) {
  return tape.strings.find((entry) => entry.id === id)?.value ?? "";
}

function classifyFromTape(tape: ForensicReplayTape, events: ForensicReplayEncodedEvent[]) {
  const keyTimesMs: number[] = [];
  let atMs = 0;
  let clickCount = 0;
  let focusChanges = 0;
  let pasteEvents = 0;
  let copyEvents = 0;
  let cutEvents = 0;
  let mouseMoveCount = 0;
  let maxScrollDepth = 0;

  // Gaze reconstruction from tape events
  let gazePointCount = 0;
  let gazeFixationCount = 0;
  let gazeFixTotalMs = 0;
  let gazeBlinkCount = 0;
  let gazeTrackingLostMs = 0;
  let gazeLastLostAt: number | null = null;

  for (const event of events) {
    atMs += event.delta * TQ;
    switch (event.type) {
      case "key":
        keyTimesMs.push(atMs);
        break;
      case "click":
        clickCount++;
        break;
      case "focus":
        focusChanges++;
        break;
      case "scroll": {
        const depth = event.scrollMax > 0 ? event.scrollY / event.scrollMax : 0;
        if (depth > maxScrollDepth) maxScrollDepth = depth;
        mouseMoveCount += 2; // scrolling implies pointer activity
        break;
      }
      case "clipboard": {
        if (event.action === "paste") pasteEvents++;
        else if (event.action === "copy") copyEvents++;
        else if (event.action === "cut") cutEvents++;
        break;
      }
      case "gazePoint":
        gazePointCount++;
        if (gazeLastLostAt !== null) {
          gazeTrackingLostMs += atMs - gazeLastLostAt;
          gazeLastLostAt = null;
        }
        break;
      case "gazeFixation": {
        gazeFixationCount++;
        gazeFixTotalMs += event.durationMs ?? 0;
        break;
      }
      case "gazeBlink":
        gazeBlinkCount++;
        break;
      case "gazeLost":
        gazeLastLostAt = atMs;
        break;
    }
  }

  const cadence: number[] = [];
  for (let index = 1; index < keyTimesMs.length; index += 1) {
    cadence.push(keyTimesMs[index]! - keyTimesMs[index - 1]!);
  }

  const sessionMs = atMs || 1;
  const gazeValidMs = sessionMs - gazeTrackingLostMs;
  const gazeActive = gazePointCount > 0 || (tape.metrics.gazePointCount ?? 0) > 0;
  const effectiveGazePoints = gazePointCount || (tape.metrics.gazePointCount ?? 0);
  const effectiveFixations = gazeFixationCount || (tape.metrics.gazeFixationCount ?? 0);
  const effectiveBlinks = gazeBlinkCount || (tape.metrics.gazeBlinkCount ?? 0);

  const behavioral: BehavioralSignals = {
    timeOnPage: atMs,
    scrolledToBottom: maxScrollDepth > 0.85,
    maxScrollDepth: Math.round(maxScrollDepth * 100),
    mouseMoveCount,
    clickCount,
    keyPressCount: keyTimesMs.length,
    pageWasHidden: false,
    hiddenDuration: 0,
    interactionTimeline: [],
    typingCadence: cadence,
    mouseVelocityAvg: 0,
    mouseAccelerationPattern: "",
    touchPressureAvg: null,
    scrollPattern: [],
    focusChanges,
    pasteEvents,
    copyEvents,
    cutEvents,
    rightClicks: 0,
    gazeTrackingActive: gazeActive,
    gazePointCount: effectiveGazePoints,
    gazeFixationCount: effectiveFixations,
    gazeFixationAvgMs: effectiveFixations > 0 ? gazeFixTotalMs / effectiveFixations : 0,
    gazeBlinkCount: effectiveBlinks,
    gazeBlinkRate: sessionMs > 0 ? (effectiveBlinks / sessionMs) * 60000 : 0,
    gazeTrackingCoverage: gazeActive ? Math.max(0, Math.min(1, gazeValidMs / sessionMs)) : 0,
    replay: tape,
  };

  const interactions = classifyInteractions(tape, behavioral);
  const classification = classifySession(interactions, behavioral);
  return { classification, interactions };
}

function VerdictBadge({
  classification,
  serverReview,
}: {
  classification: SessionClassification | null;
  serverReview?: ServerAutomationReview;
}) {
  // Prefer server-side heuristic review (has full behavioral data) over client-side tape reconstruction
  const verdict = serverReview?.verdict ?? classification?.verdict ?? null;
  if (!verdict) {
    return <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted">No replay</span>;
  }

  const normalized = verdict.toLowerCase();
  const isHuman = normalized === "human";
  const isBot = normalized === "agent" || normalized === "bot";
  const tone = isHuman
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
    : isBot
      ? "border-red-500/30 bg-red-500/10 text-red-300"
      : "border-amber-500/30 bg-amber-500/10 text-amber-300";

  const Icon = isBot ? Bot : isHuman ? User : HelpCircle;
  const label = normalized === "agent" ? "bot" : normalized;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${tone}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function ActionIcon({ source }: { source: "human" | "bot" | "unknown" }) {
  if (source === "bot") return <Bot className="h-3 w-3 shrink-0 text-red-400" />;
  if (source === "human") return <User className="h-3 w-3 shrink-0 text-emerald-400" />;
  return <HelpCircle className="h-3 w-3 shrink-0 text-amber-400" />;
}

type ReplayGazeAnchor = {
  attribute: "data-field-id" | "data-forensic-id";
  value: string;
  offsetX: number;
  offsetY: number;
};

type ReplayGazePoint = {
  x: number;
  y: number;
  docY: number;
  confidence: number;
  anchor: ReplayGazeAnchor | null;
};

type ReplayState = {
  scrollY: number;
  scrollMax: number;
  scrollRatio: number;
  focusedFieldId: string | null;
  fieldTexts: Record<string, string>;
  hidden: boolean;
  modalOpen: string | null;
  lastAction: string;
  lastActionAt: number;
  eventIndex: number;
  gaze: {
    active: boolean;
    current: ReplayGazePoint | null;
    trail: Array<ReplayGazePoint & { age: number }>;
  };
  // Signature drawing state
  signatureStrokes: Array<{ strokeId: number; points: Array<{ x: number; y: number; pressure: number }> }>;
  /** Previous attempts (after clear) — rendered grayed out */
  clearedStrokes: Array<Array<{ strokeId: number; points: Array<{ x: number; y: number; pressure: number }> }>>;
  activeStrokeId: number | null;
  signatureCommitted: boolean;
};

function resolveGazeAnchorSample(tape: ForensicReplayTape, sampleIndex: number): ReplayGazeAnchor | null {
  const metadata = tape.gazeAnchors;
  if (!metadata) return null;
  const sample = metadata.samples[sampleIndex];
  if (!sample?.anchorId) return null;
  const anchor = metadata.anchors.find((entry) => entry.id === sample.anchorId);
  if (!anchor) return null;
  const scale = metadata.scale || GAZE_SCALE;
  return {
    attribute: anchor.attribute,
    value: anchor.value,
    offsetX: sample.offsetX / scale,
    offsetY: sample.offsetY / scale,
  };
}

function buildStateAt(
  tape: ForensicReplayTape,
  events: ForensicReplayEncodedEvent[],
  targetMs: number,
  docViewStartMs = 0,
): ReplayState {
  const state: ReplayState = {
    scrollY: 0,
    scrollMax: 1,
    scrollRatio: 0,
    focusedFieldId: null,
    fieldTexts: {},
    hidden: false,
    modalOpen: null,
    lastAction: "",
    lastActionAt: 0,
    eventIndex: 0,
    gaze: {
      active: false,
      current: null,
      trail: [],
    },
    signatureStrokes: [],
    clearedStrokes: [],
    activeStrokeId: null,
    signatureCommitted: false,
  };

  let atMs = 0;
  let gazeSampleIndex = 0;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    atMs += event.delta * TQ;
    if (atMs > targetMs) break;

    state.eventIndex = index + 1;
    state.lastActionAt = atMs;

    switch (event.type) {
      case "scroll":
        state.scrollY = event.scrollY;
        state.scrollMax = Math.max(1, event.scrollMax);
        state.scrollRatio = state.scrollY / state.scrollMax;
        state.lastAction = `Scrolled ${Math.round(state.scrollRatio * 100)}%`;
        break;
      case "signatureStart": {
        state.signatureStrokes.push({
          strokeId: event.strokeId,
          points: [{ x: event.x, y: event.y, pressure: event.pressure }],
        });
        state.activeStrokeId = event.strokeId;
        state.lastAction = "Signing...";
        break;
      }
      case "signaturePoint": {
        // After decoding, signaturePoint has absolute x/y (decoder reconstructs from deltas)
        const stroke = state.signatureStrokes.find((s) => s.strokeId === event.strokeId);
        if (stroke) stroke.points.push({ x: event.x, y: event.y, pressure: event.pressure });
        break;
      }
      case "signatureEnd":
        state.activeStrokeId = null;
        state.lastAction = "Stroke complete";
        break;
      case "signatureCommit":
        state.signatureCommitted = true;
        state.lastAction = "Signature committed";
        break;
      case "signatureClear":
        if (state.signatureStrokes.length > 0) {
          state.clearedStrokes.push([...state.signatureStrokes]);
        }
        state.signatureStrokes = [];
        state.signatureCommitted = false;
        state.lastAction = "Signature cleared";
        break;
      case "click":
        state.lastAction = "Clicked";
        break;
      case "key":
        state.lastAction = `Key "${resolveString(tape, event.keyId)}"`;
        break;
      case "focus":
        state.focusedFieldId = resolveFieldId(tape, event.targetId);
        state.lastAction = state.focusedFieldId ? `Focused ${state.focusedFieldId}` : "Focused";
        break;
      case "blur":
        state.focusedFieldId = null;
        break;
      case "visibility":
        state.hidden = event.hidden;
        state.lastAction = event.hidden ? "Tab hidden" : "Tab visible";
        break;
      case "modal":
        state.modalOpen = event.open ? resolveString(tape, event.nameId) : null;
        state.lastAction = event.open ? `Modal: ${resolveString(tape, event.nameId)}` : "Closed modal";
        break;
      case "fieldCommit": {
        const fieldId = resolveFieldId(tape, event.targetId);
        const value = resolveString(tape, event.valueId);
        if (fieldId) state.fieldTexts[fieldId] = value;
        state.lastAction = fieldId ? `${fieldId} updated` : "Field updated";
        break;
      }
      case "gazePoint": {
        // Skip gaze points from calibration/liveness phase (before document viewing started)
        if (docViewStartMs > 0 && atMs < docViewStartMs) {
          gazeSampleIndex += 1;
          break;
        }
        const gx = event.x / GAZE_SCALE;
        const gy = event.y / GAZE_SCALE; // viewport-relative [0, 1]
        // Reconstruct document-absolute Y from viewport-relative gaze + scroll position.
        // scrollMax = total scrollable distance (scrollHeight - viewportHeight).
        // state.scrollY = current pixel scroll offset from the last scroll event.
        const vpH = tape.viewport.height || 1;
        const totalH = Math.max(vpH, state.scrollMax + vpH);
        const docY = Math.max(0, Math.min(1, (state.scrollY + gy * vpH) / totalH));
        const point: ReplayGazePoint = {
          x: gx,
          y: gy,
          docY,
          confidence: (event.confidence ?? 0) / 255,
          anchor: resolveGazeAnchorSample(tape, gazeSampleIndex),
        };
        gazeSampleIndex += 1;
        state.gaze.active = true;
        state.gaze.current = point;
        state.gaze.trail.push({ ...point, age: 0 });
        if (state.gaze.trail.length > GAZE_TRAIL_LENGTH) state.gaze.trail.shift();
        for (let trailIndex = 0; trailIndex < state.gaze.trail.length - 1; trailIndex += 1) {
          state.gaze.trail[trailIndex]!.age += 1;
        }
        break;
      }
      case "gazeFixation":
        state.lastAction = `Fixation (${event.durationMs}ms)`;
        break;
      case "gazeBlink":
        state.lastAction = "Blink";
        break;
      case "gazeLost":
        state.gaze.active = false;
        state.gaze.current = null;
        break;
      default:
        break;
    }
  }

  return state;
}

type ServerAutomationReview = {
  verdict: string;
  confidence: number;
  automationScore: number;
  source: string;
  rationale?: string;
} | null;

type ServerSessionProfile = {
  typing: {
    verdict: string;
    reason: string;
    sampleCount: number;
    averageDelayMs: number;
    coefficientOfVariation: number;
  };
  pointer: { mouseMoveCount: number; clickCount: number; focusChanges: number; clickWithoutMovement: boolean };
  timing: { durationMs: number; hiddenRatio: number };
  signature: {
    verdict: string;
    reason: string;
    strokeCount: number;
    pointCount: number;
    durationMs: number;
    motionComplexityScore: number | null;
    motionUniformityScore: number | null;
  } | null;
  gaze: { active: boolean; verdict: string; reasons: string[] };
  liveness?: { available: boolean; verdict: string; passRatio: number };
  signals: Array<{ code: string; source: string; weight: number; message: string }>;
  humanEvidenceScore: number;
  automationEvidenceScore: number;
} | null;

type ServerForensicSession = {
  sessionId: string;
  visitIndex: number;
  startedAt: string;
  durationMs: number;
  classification?: { verdict: string; automationScore: number; flags: string[] } | null;
};

type SignerData = {
  id: string;
  label: string;
  status: string;
  index: number;
  tape: ForensicReplayTape | null;
  events: ForensicReplayEncodedEvent[];
  durationMs: number;
  classification: SessionClassification | null;
  interactions: InteractionClassification[];
  serverReview: ServerAutomationReview;
  sessionProfile: ServerSessionProfile;
  forensicSessions: ServerForensicSession[];
  fieldValues: Record<string, string> | null;
  handSignatureData: string | null;
  signedAt: string | Date | null;
  address: string | null;
  chain: string | null;
  email?: string | null;
  role?: SignerInfo["role"];
  canSign?: boolean;
  documentViewingStartedMs: number;
};

type VisibleReplayState = {
  signer: SignerData;
  state: ReplayState | null;
};

function resolveAnchorElement(root: HTMLDivElement, anchor: ReplayGazeAnchor | null) {
  if (!anchor) return null;
  if (root.getAttribute(anchor.attribute) === anchor.value) return root;
  return root.querySelector<HTMLElement>(`[${anchor.attribute}="${escapeSelectorValue(anchor.value)}"]`);
}

function projectGazePoint(root: HTMLDivElement, point: ReplayGazePoint | null) {
  if (!point) return null;

  // Raw viewport-relative position mapped onto the paper
  const rawLeft = point.x * root.clientWidth;
  const rawTop = point.docY * root.offsetHeight;

  // If we have an anchor, use it — anchors are resolution-independent because
  // they reference actual DOM elements that reflow to the current viewport.
  const anchored = resolveAnchorElement(root, point.anchor);
  if (anchored) {
    const rootRect = root.getBoundingClientRect();
    const rect = anchored.getBoundingClientRect();

    // Position within the anchor element using the stored offsets
    const anchorLeft = rect.left - rootRect.left + point.anchor!.offsetX * rect.width;
    const anchorTop = rect.top - rootRect.top + point.anchor!.offsetY * rect.height;

    // For fields (small targets): use anchor position directly
    if (point.anchor!.attribute === "data-field-id") {
      return { left: anchorLeft, top: anchorTop, confidence: point.confidence };
    }

    // For document elements: blend anchor with raw, favoring anchor for Y
    // (Y mapping is the most fragile across viewports due to text reflow)
    return {
      left: anchorLeft * 0.6 + rawLeft * 0.4,
      top: anchorTop * 0.8 + rawTop * 0.2, // Trust anchor Y heavily
      confidence: point.confidence,
    };
  }

  // No anchor — fall back to raw coordinate mapping
  return { left: rawLeft, top: rawTop, confidence: point.confidence };
}

function ReplayGazeOverlay({
  paperRef,
  lanes,
}: {
  paperRef: React.RefObject<HTMLDivElement | null>;
  lanes: VisibleReplayState[];
}) {
  const paper = paperRef.current;
  if (!paper) return null;

  return (
    <>
      {lanes.map(({ signer, state }) => {
        if (!state?.gaze.active) return null;

        const current = projectGazePoint(paper, state.gaze.current);
        const trail = state.gaze.trail
          .map((point) => {
            const resolved = projectGazePoint(paper, point);
            if (!resolved) return null;
            return { ...resolved, age: point.age };
          })
          .filter((point): point is { left: number; top: number; confidence: number; age: number } => point !== null);

        if (!current && trail.length === 0) return null;
        const color = laneColor(signer.index);

        return (
          <div key={`gaze-${signer.id}`} className="absolute inset-0">
            {trail.map((point, index) => {
              const size = Math.max(8, 18 - point.age * 0.5);
              const opacity = Math.max(0.08, 0.45 - point.age * 0.03) * point.confidence;
              return (
                <div
                  key={`trail-${signer.id}-${index}`}
                  className="absolute rounded-full"
                  style={{
                    left: point.left,
                    top: point.top,
                    width: size,
                    height: size,
                    transform: "translate(-50%, -50%)",
                    background: color,
                    boxShadow: `0 0 18px ${color}`,
                    opacity,
                  }}
                />
              );
            })}
            {current && (
              <>
                <div
                  className="absolute rounded-full border-2 border-white/80"
                  style={{
                    left: current.left,
                    top: current.top,
                    width: 24,
                    height: 24,
                    transform: "translate(-50%, -50%)",
                    background: color,
                    boxShadow: `0 0 30px ${color}`,
                    opacity: Math.max(0.2, current.confidence),
                  }}
                />
                <div
                  className="pointer-events-none absolute whitespace-nowrap text-[8px] font-bold"
                  style={{
                    left: current.left + 16,
                    top: current.top - 8,
                    color,
                    textShadow: "0 0 4px rgba(0,0,0,0.8)",
                  }}
                >
                  {signer.label.split(" ")[0]}
                </div>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── Signature drawing overlay ──────────────────────────────────────────

// ── Timeline event bar ─────────────────────────────────────────────────

type TimelineEvent = {
  atMs: number;
  type: string;
  label: string;
  icon: string;
  source: "human" | "bot" | "unknown";
  critical: boolean;
};

function buildTimelineEvents(
  events: ForensicReplayEncodedEvent[],
  interactions: InteractionClassification[],
  _durationMs: number,
  docViewStartMs = 0,
): TimelineEvent[] {
  const timeline: TimelineEvent[] = [];
  let atMs = 0;

  const classMap = new Map<number, InteractionClassification>();
  for (const ic of interactions) {
    classMap.set(ic.eventIndex, ic);
  }

  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    atMs += ev.delta * TQ;

    // Skip calibration/liveness events — only show document interaction
    if (docViewStartMs > 0 && atMs < docViewStartMs) continue;

    const classified = classMap.get(i);
    const source = classified?.source ?? "unknown";

    switch (ev.type) {
      case "click":
        timeline.push({ atMs, type: "click", label: "Click", icon: "🖱", source, critical: false });
        break;
      case "key":
        // Only show key bursts, not every keystroke
        if (i === 0 || events[i - 1]?.type !== "key") {
          timeline.push({ atMs, type: "key", label: "Typing", icon: "⌨", source, critical: false });
        }
        break;
      case "fieldCommit":
        timeline.push({
          atMs,
          type: "field",
          label: "Field filled",
          icon: "📝",
          source: classified?.source ?? "unknown",
          critical: true,
        });
        break;
      case "signatureStart":
        timeline.push({
          atMs,
          type: "sig_start",
          label: "Signing",
          icon: "✍️",
          source: classified?.source ?? "unknown",
          critical: true,
        });
        break;
      case "signatureCommit":
        timeline.push({
          atMs,
          type: "sig_commit",
          label: "Signature done",
          icon: "✅",
          source: classified?.source ?? "unknown",
          critical: true,
        });
        break;
      case "scroll":
        // Only show every 5th scroll
        if (timeline.length === 0 || timeline[timeline.length - 1]?.type !== "scroll") {
          timeline.push({ atMs, type: "scroll", label: "Scroll", icon: "📜", source, critical: false });
        }
        break;
      case "clipboard": {
        timeline.push({
          atMs,
          type: "clipboard",
          label: ev.action ?? "clipboard",
          icon: "📋",
          source,
          critical: false,
        });
        break;
      }
      case "gazeBlink":
        // Only show blinks if they're interesting
        break;
      case "gazeCalibration":
        timeline.push({
          atMs,
          type: "gaze_cal",
          label: "Gaze calibrated",
          icon: "👁",
          source: "unknown",
          critical: false,
        });
        break;
      default:
        break;
    }
  }

  return timeline;
}

function ReplayTimeline({
  events,
  interactions,
  durationMs,
  cursorMs,
  onSeek,
  color,
  docViewStartMs,
}: {
  events: ForensicReplayEncodedEvent[];
  interactions: InteractionClassification[];
  durationMs: number;
  cursorMs: number;
  onSeek: (ms: number) => void;
  color: string;
  docViewStartMs?: number;
}) {
  const timeline = useMemo(
    () => buildTimelineEvents(events, interactions, durationMs, docViewStartMs),
    [events, interactions, durationMs, docViewStartMs],
  );
  const [hovered, setHovered] = useState<number | null>(null);
  if (durationMs <= 0) return null;

  const hoveredEvent = hovered !== null ? timeline[hovered] : null;

  return (
    <div
      className="relative h-3 w-full cursor-pointer rounded-full bg-white/5"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        onSeek(Math.round(pct * durationMs));
      }}
    >
      {/* Progress fill */}
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-white/[0.03]"
        style={{ width: `${(cursorMs / durationMs) * 100}%` }}
      />
      {/* Event dots */}
      {timeline.map((ev, i) => {
        const pct = (ev.atMs / durationMs) * 100;
        const sc = ev.source === "bot" ? "#f87171" : ev.source === "human" ? "#34d399" : "#6b7280";
        const size = ev.critical ? 7 : 4;
        return (
          <div
            key={`tl-${i}`}
            className="absolute top-1/2 rounded-full transition-transform hover:z-10 hover:scale-[2.5]"
            style={{
              left: `${pct}%`,
              width: size,
              height: size,
              transform: "translate(-50%, -50%)",
              background: sc,
              boxShadow: ev.critical ? `0 0 6px ${sc}` : undefined,
            }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(ev.atMs);
            }}
          />
        );
      })}
      {/* Playhead */}
      <div
        className="absolute top-0 h-full w-0.5 rounded-full"
        style={{ left: `${(cursorMs / durationMs) * 100}%`, background: color }}
      />
      {/* Tooltip */}
      {hoveredEvent && hovered !== null && (
        <div
          className="pointer-events-none absolute bottom-full z-50 mb-2 whitespace-nowrap rounded-lg border border-white/10 bg-[#0d1117] px-3 py-1.5 text-[10px] shadow-xl"
          style={{ left: `${(hoveredEvent.atMs / durationMs) * 100}%`, transform: "translateX(-50%)" }}
        >
          <span className="mr-1">{hoveredEvent.icon}</span>
          <span className="font-medium text-white/80">{hoveredEvent.label}</span>
          <span className="ml-2 text-white/30">{formatTime(hoveredEvent.atMs)}</span>
          <span
            className="ml-2"
            style={{
              color:
                hoveredEvent.source === "bot" ? "#f87171" : hoveredEvent.source === "human" ? "#34d399" : "#6b7280",
            }}
          >
            {hoveredEvent.source === "bot" ? "🤖" : hoveredEvent.source === "human" ? "👤" : "❓"}
          </span>
        </div>
      )}
    </div>
  );
}

export function ReplayDocumentViewer({ documentId, shareToken }: Props) {
  const [resolvedDocumentId, setResolvedDocumentId] = useState(documentId ?? null);
  const [shareLookupPending, setShareLookupPending] = useState(Boolean(shareToken && !documentId));
  const [shareLookupError, setShareLookupError] = useState<string | null>(null);

  useEffect(() => {
    if (documentId || !shareToken) return;
    let cancelled = false;

    void (async () => {
      setShareLookupPending(true);
      setShareLookupError(null);
      try {
        const response = await fetch(`/api/replay/${shareToken}`);
        const payload = (await response.json()) as { documentId?: string; error?: string };
        if (!response.ok || !payload.documentId) {
          throw new Error(payload.error || "Unable to resolve replay share link");
        }
        if (!cancelled) setResolvedDocumentId(payload.documentId);
      } catch (error) {
        if (!cancelled) {
          setShareLookupError(error instanceof Error ? error.message : "Unable to resolve replay share link");
        }
      } finally {
        if (!cancelled) setShareLookupPending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId, shareToken]);

  const query = trpc.document.getForensicReplay.useQuery(
    { id: resolvedDocumentId ?? "" },
    { enabled: Boolean(resolvedDocumentId) },
  );

  const [cursorMs, setCursorMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [followIndex, setFollowIndex] = useState<number | null>(null);
  const [followEnabled, setFollowEnabled] = useState(true);
  const [soloIndex, setSoloIndex] = useState<number | null>(null);
  const [hiddenSigners, setHiddenSigners] = useState<Set<number>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [expandedSigners, setExpandedSigners] = useState<Set<number>>(new Set());
  const [barMinimized, setBarMinimized] = useState(false);

  const lastTickRef = useRef(0);
  const rafRef = useRef(0);
  const paperRef = useRef<HTMLDivElement>(null);

  const speed = SPEEDS[speedIndex] ?? 1;
  const data = query.data;

  const signers: SignerData[] = useMemo(() => {
    if (!data?.signers) return [];
    return data.signers.map((signer, index) => {
      const tape = signer.replay ?? null;
      const events = tape?.tapeBase64 ? decodeReplayEventsSync(tape.tapeBase64) : [];
      const durationMs = events.reduce((total, event) => total + event.delta * TQ, 0);
      const { classification, interactions } = tape
        ? classifyFromTape(tape, events)
        : { classification: null, interactions: [] as InteractionClassification[] };
      const signerExt = signer as typeof signer & {
        automationReview?: ServerAutomationReview;
        sessionProfile?: ServerSessionProfile;
        forensicSessions?: ServerForensicSession[];
        documentViewingStartedMs?: number;
      };
      const serverReview = signerExt.automationReview ?? null;
      const sessionProfile = signerExt.sessionProfile ?? null;
      const forensicSessions = signerExt.forensicSessions ?? [];
      return {
        id: signer.id,
        label: signer.label,
        status: signer.status,
        index,
        tape,
        events,
        durationMs,
        classification,
        interactions,
        serverReview,
        sessionProfile,
        forensicSessions,
        fieldValues: signer.fieldValues ?? null,
        handSignatureData: signer.handSignatureData ?? null,
        signedAt: signer.signedAt,
        address: signer.address ?? null,
        chain: signer.chain ?? null,
        email: signer.email ?? null,
        role: signer.role ?? "SIGNER",
        canSign: signer.canSign ?? false,
        documentViewingStartedMs: signerExt.documentViewingStartedMs ?? 0,
      };
    });
  }, [data]);

  const visibleSigners = useMemo(() => {
    return signers.filter((signer) =>
      soloIndex !== null ? signer.index === soloIndex : !hiddenSigners.has(signer.index),
    );
  }, [hiddenSigners, signers, soloIndex]);

  const totalDurationMs = Math.max(...signers.map((signer) => signer.durationMs), 0);
  const durationMs = soloIndex !== null ? (signers[soloIndex]?.durationMs ?? 0) : totalDurationMs;
  const effectiveCursorMs = Math.min(cursorMs, durationMs);

  const states = useMemo(() => {
    return signers.map((signer) => ({
      signer,
      state: signer.tape
        ? buildStateAt(signer.tape, signer.events, effectiveCursorMs, signer.documentViewingStartedMs)
        : null,
    }));
  }, [effectiveCursorMs, signers]);

  const visibleStates = useMemo(() => {
    return states.filter(({ signer }) =>
      soloIndex !== null ? signer.index === soloIndex : !hiddenSigners.has(signer.index),
    );
  }, [hiddenSigners, soloIndex, states]);

  const tokens = useMemo(() => {
    if (!data?.content) return [];
    return tokenizeDocument(data.content, data.signers.length).tokens;
  }, [data?.content, data?.signers.length]);

  const mergedFieldValues = useMemo(() => {
    const values: Record<string, string> = {};
    // Base layer: DB-stored field values from all visible signers
    for (const { signer } of visibleStates) {
      if (signer.fieldValues) {
        for (const [fieldId, value] of Object.entries(signer.fieldValues)) {
          values[fieldId] = value;
        }
      }
    }
    // Overlay: replay state field values (overwrite with what the replay cursor has reached)
    for (const { state } of visibleStates) {
      if (state) {
        for (const [fieldId, value] of Object.entries(state.fieldTexts)) {
          values[fieldId] = value;
        }
      }
    }
    return values;
  }, [visibleStates]);

  const activeSignerIndex = !followEnabled
    ? null
    : followIndex !== null
      ? followIndex
      : (visibleStates.find(({ state }) => state?.gaze.current)?.signer.index ?? visibleSigners[0]?.index ?? null);
  const activeState = activeSignerIndex !== null ? (states[activeSignerIndex]?.state ?? null) : null;

  const followTargetRef = useRef(0);

  useEffect(() => {
    if (!playing || !followEnabled || !paperRef.current) return;

    const activeLane =
      activeSignerIndex !== null
        ? states[activeSignerIndex]
        : (visibleStates.find(({ state }) => state?.gaze.current) ?? visibleStates[0]);
    if (!activeLane?.state) return;

    const paper = paperRef.current;
    const paperRect = paper.getBoundingClientRect();
    const paperTop = window.scrollY + paperRect.top;
    const paperBottom = paperTop + paper.offsetHeight;
    const gazePoint = activeLane.state.gaze.current;

    let target: number;

    if (gazePoint) {
      const projected = projectGazePoint(paper, gazePoint);
      if (projected && projected.top >= 0 && projected.top <= paper.offsetHeight) {
        target = paperTop + projected.top - window.innerHeight / 2;
      } else {
        // Gaze dot is outside paper bounds — use scroll position fallback
        target = paperTop + activeLane.state.scrollRatio * paper.offsetHeight - window.innerHeight / 2;
      }
    } else {
      target = paperTop + activeLane.state.scrollRatio * paper.offsetHeight - window.innerHeight / 2;
    }

    target = Math.max(0, Math.min(target, paperBottom - window.innerHeight));

    // Smooth follow: lerp toward target instead of jumping
    const current = followTargetRef.current || window.scrollY;
    const diff = target - current;
    // Only scroll if the target has moved significantly (> 20px)
    if (Math.abs(diff) < 20) return;
    // Lerp: move 25% of the way each frame
    const smoothed = current + diff * 0.25;
    followTargetRef.current = smoothed;
    window.scrollTo({ top: Math.max(0, smoothed) });
  }, [activeSignerIndex, effectiveCursorMs, followEnabled, playing, states, visibleStates]);

  useEffect(() => {
    if (!playing) return;
    lastTickRef.current = performance.now();

    const loop = () => {
      const now = performance.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      setCursorMs((current) => {
        const next = Math.min(current + delta * speed, durationMs);
        if (next >= durationMs) setPlaying(false);
        return next;
      });
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [durationMs, playing, speed]);

  const signerListItems: SignerInfo[] = useMemo(() => {
    return signers.map((signer) => ({
      id: signer.id,
      label: signer.label,
      address: signer.address,
      chain: signer.chain,
      status: signer.status,
      signedAt: signer.signedAt ? new Date(signer.signedAt) : null,
      scheme: null,
      isYou: false,
      isClaimed: Boolean(signer.address || signer.email),
      email: signer.email ?? null,
      role: signer.role ?? "SIGNER",
      canSign: signer.canSign ?? false,
      fieldValues: signer.fieldValues,
    }));
  }, [signers]);

  const handlePlayPause = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (effectiveCursorMs >= durationMs) setCursorMs(0);
    setPlaying(true);
  };

  const handleSeek = (nextMs: number) => {
    setCursorMs(Math.max(0, Math.min(nextMs, durationMs)));
  };

  const handleToggleSigner = (index: number) => {
    setHiddenSigners((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else {
        next.add(index);
        if (followIndex === index) setFollowIndex(null);
      }
      return next;
    });
  };

  const handleSoloSigner = (index: number) => {
    setSoloIndex((current) => (current === index ? null : index));
    setHiddenSigners(new Set());
    setFollowIndex(index);
  };

  if (shareLookupPending || query.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--replay-page-bg)]">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (shareLookupError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--replay-page-bg)] px-4">
        <div className="glass-card max-w-md rounded-2xl p-6 text-center text-sm text-red-300">{shareLookupError}</div>
      </div>
    );
  }

  if (query.error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--replay-page-bg)] px-4">
        <div className="glass-card max-w-md rounded-2xl p-6 text-center text-sm text-muted">
          {query.error?.message ?? "Replay data is not available for this document."}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--replay-page-bg)]">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 pb-32">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-accent/70 text-[10px] font-semibold uppercase tracking-[0.3em]">Forensic Replay</p>
            <p className="text-sm text-muted">
              Playback runs on the same paper document renderer used during signing, with gaze points resolved against
              live document anchors.
            </p>
          </div>
          <button
            onClick={() => setDrawerOpen((current) => !current)}
            className="rounded-xl border border-border bg-surface-card p-2 text-secondary transition-colors hover:text-primary"
            aria-label={drawerOpen ? "Hide replay panel" : "Show replay panel"}
          >
            {drawerOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        </div>

        <DocumentHeader
          doc={{ title: data.title, status: data.status, signers: signerListItems }}
          signedCount={signerListItems.filter((signer) => signer.status === "SIGNED").length}
          totalRecipients={signerListItems.length}
        />

        <DocumentPaper
          paperRef={paperRef}
          tokens={tokens}
          overlay={<ReplayGazeOverlay paperRef={paperRef} lanes={visibleStates} />}
          renderField={({ field, forensicId }) => {
            if (!isFieldVisible(field, mergedFieldValues)) return null;
            const value = mergedFieldValues[field.id];
            // Find which signer owns this field and their automation verdict
            const ownerSigner = signers.find((s) => s.index === field.signerIdx);
            const ownerVerdict = ownerSigner?.serverReview?.verdict;
            const verdictIcon =
              ownerVerdict === "agent"
                ? "🤖"
                : ownerVerdict === "human"
                  ? "👤"
                  : ownerVerdict === "uncertain"
                    ? "❓"
                    : null;
            const verdictColor =
              ownerVerdict === "agent" ? "#f87171" : ownerVerdict === "human" ? "#34d399" : "#9ca3af";
            return (
              <div className="relative inline-flex items-center gap-1">
                <InlineFieldInput
                  key={field.id}
                  documentId={data.documentId}
                  claimToken={null}
                  field={field}
                  forensicId={forensicId}
                  active={activeState?.focusedFieldId === field.id}
                  canEdit={false}
                  value={value}
                  signatureReady={Boolean(value)}
                  allValues={mergedFieldValues}
                  isFilled={
                    !validateField(field, value, { signatureReady: Boolean(value), allValues: mergedFieldValues })
                  }
                  isRequired={isFieldRequired(field, mergedFieldValues)}
                  onApplyAddressSuggestion={noop}
                  onLoadAddressSuggestions={noopSuggestions}
                  onChange={noop}
                  onFillMatching={noop}
                  onUploadAttachment={noopUpload}
                  onRunIdentityCheck={noopUpload}
                  onStartPayment={noopPayment}
                  onStartSocialVerify={noop}
                  onRequestSignature={noop}
                  onRequestPhoneDraw={noop}
                  onFocus={noop}
                  onBlur={noop}
                />
                {verdictIcon && value && (
                  <span
                    className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none"
                    style={{
                      background: `${verdictColor}15`,
                      color: verdictColor,
                      border: `1px solid ${verdictColor}30`,
                    }}
                    title={`${ownerSigner?.label}: ${ownerVerdict}`}
                  >
                    {verdictIcon}
                  </span>
                )}
              </div>
            );
          }}
          renderSignatureBlock={({ signerIdx }) => {
            const signer = signers[signerIdx];
            const replayState = states.find((s) => s.signer.index === signerIdx)?.state ?? null;
            const hasStrokes = replayState && replayState.signatureStrokes.length > 0;
            const isCommitted = replayState?.signatureCommitted ?? false;

            // Verdict badge for this signer
            const sigVerdict = signer?.serverReview?.verdict;
            const sigVerdictIcon =
              sigVerdict === "agent" ? "🤖" : sigVerdict === "human" ? "👤" : sigVerdict === "uncertain" ? "❓" : null;
            const sigVerdictColor = sigVerdict === "agent" ? "#f87171" : sigVerdict === "human" ? "#34d399" : "#9ca3af";
            const verdictBadge = sigVerdictIcon ? (
              <span
                className="ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none"
                style={{
                  background: `${sigVerdictColor}15`,
                  color: sigVerdictColor,
                  border: `1px solid ${sigVerdictColor}30`,
                }}
                title={`${signer?.label}: ${sigVerdict}`}
              >
                {sigVerdictIcon} {sigVerdict}
              </span>
            ) : null;

            // During replay: show progressive stroke animation until committed
            const hasClearedStrokes = replayState && replayState.clearedStrokes.length > 0;
            if ((hasStrokes || hasClearedStrokes) && !isCommitted) {
              // Collect all points (cleared + active) for viewBox calculation
              const clearedPts = (replayState?.clearedStrokes ?? []).flatMap((attempt) =>
                attempt.flatMap((s) => s.points),
              );
              const activePts = (replayState?.signatureStrokes ?? []).flatMap((s) => s.points);
              const allPts = [...clearedPts, ...activePts];
              if (allPts.length >= 2) {
                let minX = Infinity,
                  minY = Infinity,
                  maxX = -Infinity,
                  maxY = -Infinity;
                for (const p of allPts) {
                  if (p.x < minX) minX = p.x;
                  if (p.y < minY) minY = p.y;
                  if (p.x > maxX) maxX = p.x;
                  if (p.y > maxY) maxY = p.y;
                }
                const pad = 8;
                minX -= pad;
                minY -= pad;
                maxX += pad;
                maxY += pad;
                const vbW = Math.max(1, maxX - minX);
                const color = laneColor(signerIdx);
                const sw = Math.max(1.5, vbW * 0.007);
                return (
                  <div
                    className="inline-block rounded-md border border-black/10 bg-[var(--sig-bg)] px-3 py-2 shadow-sm"
                    data-forensic-id={`signature-${signer?.label?.toLowerCase().split(" ")[0] ?? signerIdx}`}
                  >
                    <div className="relative h-14 w-48">
                      <svg
                        viewBox={`${minX} ${minY} ${vbW} ${Math.max(1, maxY - minY)}`}
                        preserveAspectRatio="xMidYMid meet"
                        className="h-full w-full"
                      >
                        {/* Cleared attempts — grayed out */}
                        {(replayState?.clearedStrokes ?? []).map((attempt, ai) =>
                          attempt.map((stroke) => {
                            if (stroke.points.length < 2) return null;
                            const d = stroke.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
                            return (
                              <path
                                key={`cleared-${ai}-${stroke.strokeId}`}
                                d={d}
                                fill="none"
                                stroke="#555"
                                strokeWidth={sw}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                opacity={0.25}
                              />
                            );
                          }),
                        )}
                        {/* Active strokes — full color */}
                        {(replayState?.signatureStrokes ?? []).map((stroke) => {
                          if (stroke.points.length < 2) return null;
                          const d = stroke.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
                          return (
                            <path
                              key={`active-${stroke.strokeId}`}
                              d={d}
                              fill="none"
                              stroke={color}
                              strokeWidth={sw}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          );
                        })}
                      </svg>
                      <div className="absolute -bottom-0.5 left-0 flex items-center">
                        <span className="text-[8px] font-medium" style={{ color }}>
                          ✍️{" "}
                          {hasClearedStrokes
                            ? `Attempt ${(replayState?.clearedStrokes.length ?? 0) + 1}`
                            : "Drawing..."}
                        </span>
                        {verdictBadge}
                      </div>
                    </div>
                  </div>
                );
              }
            }

            // After commit or when replay is past the signature: show final image
            if (signer?.status === "SIGNED" && signer.handSignatureData && isImageDataUrl(signer.handSignatureData)) {
              return (
                <div
                  className="inline-block rounded-md border border-black/10 bg-[var(--sig-bg)] px-3 py-2 shadow-sm"
                  data-forensic-id={`signature-${signer.label?.toLowerCase().split(" ")[0] ?? signerIdx}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL signature, not a remote image */}
                  <img
                    src={signer.handSignatureData}
                    alt={`${signer.label} signature`}
                    className="sig-theme-img h-12 w-auto object-contain"
                  />
                  <div className="mt-1 flex items-center">
                    <span className="text-[9px] text-emerald-600/60">
                      Signed by {signer.label}
                      {signer.signedAt && ` (${new Date(signer.signedAt).toLocaleDateString()})`}
                    </span>
                    {verdictBadge}
                  </div>
                </div>
              );
            }
            if (signer?.status === "SIGNED") {
              return (
                <div className="inline-flex items-center gap-2 text-sm text-green-400/80">
                  Signed by {signer.label} {verdictBadge}
                </div>
              );
            }
            return (
              <div
                className="inline-block h-8 w-48 border-b-2 border-border"
                data-forensic-id={`signature-${signer?.label?.toLowerCase().split(" ")[0] ?? signerIdx}`}
              />
            );
          }}
        />

        <SignerList signers={signerListItems} currentAddress={null} />
      </div>

      {drawerOpen && (
        <aside className="glass-card fixed right-4 top-24 z-30 max-h-[calc(100vh-10rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border p-4 shadow-2xl">
          <div className="space-y-1 border-b border-border pb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Replay Lanes</p>
            <p className="text-sm text-secondary">
              {visibleStates.length} visible of {signers.length} signer{signers.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="mt-4 space-y-3">
            {signers.map((signer) => {
              const state = states[signer.index]?.state ?? null;
              const hidden = soloIndex === null && hiddenSigners.has(signer.index);
              const active = activeSignerIndex === signer.index;
              return (
                <div
                  key={signer.id}
                  className={`rounded-2xl border px-4 py-3 ${active ? "border-accent/40 bg-accent/10" : "border-border bg-surface-card"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: laneColor(signer.index) }}
                        />
                        <p className="text-sm font-medium text-primary">{signer.label}</p>
                      </div>
                      <VerdictBadge classification={signer.classification} serverReview={signer.serverReview} />
                      <p className="text-xs text-muted">{state?.lastAction || "Waiting for replay activity"}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setFollowIndex((current) => (current === signer.index ? null : signer.index))}
                        className="rounded-lg p-2 text-secondary transition-colors hover:bg-surface-elevated hover:text-primary"
                        aria-label={`Follow ${signer.label}`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleToggleSigner(signer.index)}
                        className="rounded-lg p-2 text-secondary transition-colors hover:bg-surface-elevated hover:text-primary"
                        aria-label={`${hidden ? "Show" : "Hide"} ${signer.label}`}
                      >
                        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => handleSoloSigner(signer.index)}
                        className={`rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                          soloIndex === signer.index ? "bg-accent text-white" : "bg-surface-elevated text-secondary"
                        }`}
                      >
                        {soloIndex === signer.index ? "Sync" : "Solo"}
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      setExpandedSigners((prev) => {
                        const next = new Set(prev);
                        if (next.has(signer.index)) {
                          next.delete(signer.index);
                        } else {
                          next.add(signer.index);
                        }
                        return next;
                      })
                    }
                    className="text-muted/60 mt-2 w-full text-left text-[10px] transition-colors hover:text-muted"
                  >
                    {expandedSigners.has(signer.index) ? "Hide details" : "Show details"}
                  </button>

                  {expandedSigners.has(signer.index) && (
                    <>
                      {/* Category Profiles */}
                      {signer.sessionProfile &&
                        (() => {
                          // If overall verdict is "agent", override per-category "human" verdicts
                          const overallVerdict = signer.serverReview?.verdict;
                          const overrideToAgent = overallVerdict === "agent";
                          const resolveVerdict = (catVerdict: string, humanLabel: string) => {
                            if (overrideToAgent && catVerdict === humanLabel) return "overridden";
                            return catVerdict;
                          };
                          const verdictLabel = (v: string) => (v === "overridden" ? "⚠ flagged" : v);
                          const verdictColor = (v: string) =>
                            v === "overridden"
                              ? "text-amber-400"
                              : v === "human" || v === "natural" || v === "passed"
                                ? "text-emerald-400"
                                : v === "bot" || v === "synthetic" || v === "absent"
                                  ? "text-red-400"
                                  : "text-muted";
                          const verdictSource = (v: string): "human" | "bot" | "unknown" =>
                            v === "overridden"
                              ? "bot"
                              : v === "human" || v === "natural" || v === "passed"
                                ? "human"
                                : v === "bot" || v === "synthetic" || v === "absent"
                                  ? "bot"
                                  : "unknown";

                          return (
                            <div className="mt-3 space-y-2">
                              <p className="text-muted/70 text-[10px] font-semibold uppercase tracking-[0.18em]">
                                Category Analysis
                              </p>
                              {overrideToAgent && (
                                <p className="text-[9px] text-amber-400/70">
                                  Overall verdict: agent — individual signals may appear human but deeper analysis
                                  detected automation.
                                </p>
                              )}
                              {/* Typing */}
                              {(() => {
                                const v = resolveVerdict(signer.sessionProfile.typing.verdict, "human");
                                return (
                                  <div className="flex items-center gap-2 text-[11px]">
                                    <ActionIcon source={verdictSource(v)} />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center justify-between">
                                        <span className="font-medium text-secondary">Typing</span>
                                        <span className={`text-[9px] font-semibold uppercase ${verdictColor(v)}`}>
                                          {verdictLabel(v)}
                                        </span>
                                      </div>
                                      <p className="truncate text-[10px] text-muted">
                                        {signer.sessionProfile.typing.reason}
                                      </p>
                                    </div>
                                  </div>
                                );
                              })()}
                              {/* Signature */}
                              {signer.sessionProfile.signature &&
                                (() => {
                                  const v = resolveVerdict(signer.sessionProfile.signature.verdict, "human");
                                  return (
                                    <div className="flex items-center gap-2 text-[11px]">
                                      <ActionIcon source={verdictSource(v)} />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between">
                                          <span className="font-medium text-secondary">Signature</span>
                                          <span className={`text-[9px] font-semibold uppercase ${verdictColor(v)}`}>
                                            {verdictLabel(v)}
                                          </span>
                                        </div>
                                        <p className="truncate text-[10px] text-muted">
                                          {signer.sessionProfile.signature.reason}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })()}
                              {/* Eye Gaze */}
                              {signer.sessionProfile.gaze.active &&
                                (() => {
                                  const v = resolveVerdict(signer.sessionProfile.gaze.verdict, "natural");
                                  return (
                                    <div className="flex items-center gap-2 text-[11px]">
                                      <ActionIcon source={verdictSource(v)} />
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between">
                                          <span className="font-medium text-secondary">Eye Gaze</span>
                                          <span className={`text-[9px] font-semibold uppercase ${verdictColor(v)}`}>
                                            {verdictLabel(v)}
                                          </span>
                                        </div>
                                        <p className="truncate text-[10px] text-muted">
                                          {signer.sessionProfile.gaze.reasons[0] ?? ""}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })()}
                              {/* Pointer */}
                              {(() => {
                                const rawV = signer.sessionProfile.pointer.clickWithoutMovement
                                  ? "bot"
                                  : signer.sessionProfile.pointer.mouseMoveCount > 20
                                    ? "human"
                                    : "unknown";
                                const v = resolveVerdict(rawV, "human");
                                return (
                                  <div className="flex items-center gap-2 text-[11px]">
                                    <ActionIcon source={verdictSource(v)} />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center justify-between">
                                        <span className="font-medium text-secondary">Pointer</span>
                                        <span className={`text-[9px] font-semibold uppercase ${verdictColor(v)}`}>
                                          {verdictLabel(v)}
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-muted">
                                        {signer.sessionProfile.pointer.mouseMoveCount} moves,{" "}
                                        {signer.sessionProfile.pointer.clickCount} clicks
                                      </p>
                                    </div>
                                  </div>
                                );
                              })()}
                              {/* Liveness */}
                              {signer.sessionProfile.liveness?.available && (
                                <div className="flex items-center gap-2 text-[11px]">
                                  <ActionIcon
                                    source={signer.sessionProfile.liveness.verdict === "passed" ? "human" : "bot"}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium text-secondary">Liveness</span>
                                      <span
                                        className={`text-[9px] font-semibold uppercase ${signer.sessionProfile.liveness.verdict === "passed" ? "text-emerald-400" : "text-red-400"}`}
                                      >
                                        {signer.sessionProfile.liveness.verdict}
                                      </span>
                                    </div>
                                    <p className="text-[10px] text-muted">
                                      {Math.round(signer.sessionProfile.liveness.passRatio * 100)}% pass rate
                                    </p>
                                  </div>
                                </div>
                              )}
                              {/* Overall scores */}
                              <div className="mt-2 flex gap-3 text-[10px]">
                                <span className="text-emerald-400/80">
                                  Human: {Math.round(signer.sessionProfile.humanEvidenceScore * 100)}%
                                </span>
                                <span className="text-red-400/80">
                                  Agent: {Math.round(signer.sessionProfile.automationEvidenceScore * 100)}%
                                </span>
                              </div>
                            </div>
                          );
                        })()}

                      {/* Stats grid */}
                      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs text-muted">
                        <div>
                          <p className="text-muted/70 text-[10px] uppercase tracking-[0.18em]">Duration</p>
                          <p className="mt-1 text-secondary">{formatTime(signer.durationMs)}</p>
                        </div>
                        <div>
                          <p className="text-muted/70 text-[10px] uppercase tracking-[0.18em]">Events</p>
                          <p className="mt-1 text-secondary">{signer.tape?.metrics.eventCount ?? 0}</p>
                        </div>
                        <div>
                          <p className="text-muted/70 text-[10px] uppercase tracking-[0.18em]">Gaze</p>
                          <p className="mt-1 text-secondary">{signer.tape?.metrics.gazePointCount ?? 0} pts</p>
                        </div>
                        <div>
                          <p className="text-muted/70 text-[10px] uppercase tracking-[0.18em]">Focus</p>
                          <p className="mt-1 text-secondary">{state?.focusedFieldId ?? "None"}</p>
                        </div>
                      </div>

                      {/* Sessions */}
                      {signer.forensicSessions.length > 0 && (
                        <div className="mt-3 border-t border-border pt-3">
                          <p className="text-muted/70 mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
                            Sessions ({signer.forensicSessions.length})
                          </p>
                          <div className="space-y-1.5">
                            {signer.forensicSessions.map((session, i) => (
                              <div key={session.sessionId ?? i} className="flex items-center gap-2 text-[11px]">
                                <ActionIcon
                                  source={
                                    session.classification?.verdict === "bot"
                                      ? "bot"
                                      : session.classification?.verdict === "human"
                                        ? "human"
                                        : "unknown"
                                  }
                                />
                                <span className="text-secondary">Session {session.visitIndex + 1}</span>
                                <span className="text-muted">{formatTime(session.durationMs)}</span>
                                <span
                                  className={`ml-auto text-[9px] font-semibold uppercase ${session.classification?.verdict === "human" ? "text-emerald-400" : session.classification?.verdict === "bot" ? "text-red-400" : "text-amber-400"}`}
                                >
                                  {session.classification?.verdict ?? "?"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Per-action breakdown */}
                      {signer.interactions.length > 0 && (
                        <div className="mt-3 border-t border-border pt-3">
                          <p className="text-muted/70 mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
                            Actions
                          </p>
                          <div className="space-y-1.5">
                            {signer.interactions.map((interaction, i) => (
                              <div key={i} className="flex items-start gap-2 text-[11px]">
                                <ActionIcon source={interaction.source} />
                                <div className="min-w-0">
                                  <span
                                    className={`font-medium ${interaction.critical ? "text-amber-300" : "text-secondary"}`}
                                  >
                                    {interaction.action.replace(/_/g, " ")}
                                    {interaction.critical && (
                                      <span className="ml-1 text-[9px] text-amber-400/70">(critical)</span>
                                    )}
                                  </span>
                                  <p className="mt-0.5 truncate text-[10px] leading-tight text-muted">
                                    {interaction.reason}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {signer.serverReview?.rationale && (
                        <div className="mt-3 border-t border-border pt-3">
                          <p className="text-muted/70 mb-1 text-[10px] font-semibold uppercase tracking-[0.18em]">
                            Rationale
                          </p>
                          <p className="text-[11px] leading-relaxed text-secondary">{signer.serverReview.rationale}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      )}

      <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 pb-4">
        <div
          className="glass-card pointer-events-auto flex w-full max-w-4xl flex-col rounded-2xl border border-border shadow-2xl"
          style={{ backdropFilter: "blur(20px)", background: "var(--glass-bg)" }}
        >
          {/* Minimize toggle bar */}
          <button
            onClick={() => setBarMinimized((v) => !v)}
            className="text-muted/60 flex w-full items-center justify-center gap-2 px-4 py-1.5 text-[10px] transition-colors hover:text-muted"
          >
            {barMinimized ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            <span>{barMinimized ? "Show controls" : ""}</span>
            {barMinimized && (
              <span className="font-medium text-secondary">
                {formatTime(effectiveCursorMs)} / {formatTime(durationMs)}
              </span>
            )}
          </button>

          {!barMinimized && (
            <div className="flex flex-col gap-3 px-4 pb-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSeek(effectiveCursorMs - 5000)}
                  className="rounded-xl bg-surface-elevated p-2 text-secondary transition-colors hover:text-primary"
                  aria-label="Back 5 seconds"
                >
                  <SkipBack className="h-4 w-4" />
                </button>
                <button
                  onClick={handlePlayPause}
                  className="rounded-xl bg-accent p-2 text-white transition-colors hover:bg-accent-hover"
                  aria-label={playing ? "Pause replay" : "Play replay"}
                >
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => handleSeek(effectiveCursorMs + 5000)}
                  className="rounded-xl bg-surface-elevated p-2 text-secondary transition-colors hover:text-primary"
                  aria-label="Forward 5 seconds"
                >
                  <SkipForward className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setPlaying(false);
                    setCursorMs(0);
                  }}
                  className="rounded-xl bg-surface-elevated p-2 text-secondary transition-colors hover:text-primary"
                  aria-label="Restart replay"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>

                <div className="min-w-0 flex-1">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(durationMs, 1)}
                    step={Math.max(100, TQ)}
                    value={effectiveCursorMs}
                    onChange={(event) => handleSeek(Number(event.target.value))}
                    className="w-full accent-[var(--accent)]"
                  />
                </div>

                <button
                  onClick={() => setSpeedIndex((current) => (current + 1) % SPEEDS.length)}
                  className="rounded-xl bg-surface-elevated px-3 py-2 text-xs font-semibold text-secondary transition-colors hover:text-primary"
                >
                  {speed}x
                </button>

                <button
                  onClick={() => {
                    setFollowEnabled((v) => !v);
                    if (followEnabled) setFollowIndex(null);
                  }}
                  className={`rounded-xl p-2 text-xs font-semibold transition-colors ${followEnabled ? "bg-accent/20 text-accent" : "bg-surface-elevated text-secondary"}`}
                  aria-label={followEnabled ? "Disable auto-follow" : "Enable auto-follow"}
                  title={followEnabled ? "Following — click to disable" : "Follow disabled — click to enable"}
                >
                  {followEnabled ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                </button>
              </div>

              {/* Per-signer event timelines */}
              {visibleStates.map(({ signer }) => (
                <div key={`tl-${signer.id}`} className="flex items-center gap-2">
                  <span className="text-muted/60 w-16 truncate text-[10px]" title={signer.label}>
                    {signer.label.split(" ")[0]}
                  </span>
                  <div className="flex-1">
                    <ReplayTimeline
                      events={signer.events}
                      interactions={signer.interactions}
                      durationMs={signer.durationMs}
                      cursorMs={effectiveCursorMs}
                      onSeek={handleSeek}
                      color={laneColor(signer.index)}
                      docViewStartMs={signer.documentViewingStartedMs}
                    />
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-between gap-3 text-xs text-muted">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-secondary">
                    {formatTime(effectiveCursorMs)} / {formatTime(durationMs)}
                  </span>
                  <span>{activeState?.lastAction || "Waiting for replay"}</span>
                </div>
                <span>
                  {!followEnabled
                    ? "Follow disabled"
                    : activeSignerIndex !== null
                      ? `Following ${signers[activeSignerIndex]?.label ?? "signer"}`
                      : "Following visible lanes"}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
