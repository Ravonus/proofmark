"use client";

import { Bot, HelpCircle, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ForensicReplayEncodedEvent } from "~/lib/forensic/replay-codec";
import type { InteractionClassification, SessionClassification } from "~/lib/forensic/session";
import type { ForensicReplayTape } from "~/lib/forensic/types";
import type { SignerInfo } from "../signing/sign-document-helpers";
import {
  escapeSelectorValue,
  formatTime,
  laneColor,
  type ReplayGazeAnchor,
  type ReplayGazePoint,
  type ReplayState,
  TQ,
} from "./replay-document-helpers";

export function VerdictBadge({
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

export function ActionIcon({ source }: { source: "human" | "bot" | "unknown" }) {
  if (source === "bot") return <Bot className="h-3 w-3 shrink-0 text-red-400" />;
  if (source === "human") return <User className="h-3 w-3 shrink-0 text-emerald-400" />;
  return <HelpCircle className="h-3 w-3 shrink-0 text-amber-400" />;
}

export type ServerAutomationReview = {
  verdict: string;
  confidence: number;
  automationScore: number;
  source: string;
  rationale?: string;
} | null;

export type ServerSessionProfile = {
  typing: {
    verdict: string;
    reason: string;
    sampleCount: number;
    averageDelayMs: number;
    coefficientOfVariation: number;
  };
  pointer: {
    mouseMoveCount: number;
    clickCount: number;
    focusChanges: number;
    clickWithoutMovement: boolean;
  };
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
  signals: Array<{
    code: string;
    source: string;
    weight: number;
    message: string;
  }>;
  humanEvidenceScore: number;
  automationEvidenceScore: number;
} | null;

export type ServerForensicSession = {
  sessionId: string;
  visitIndex: number;
  startedAt: string;
  durationMs: number;
  classification?: {
    verdict: string;
    automationScore: number;
    flags: string[];
  } | null;
};

export type SignerData = {
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

export type VisibleReplayState = {
  signer: SignerData;
  state: ReplayState | null;
};

export function resolveAnchorElement(root: HTMLDivElement, anchor: ReplayGazeAnchor | null) {
  if (!anchor) return null;
  if (root.getAttribute(anchor.attribute) === anchor.value) return root;
  return root.querySelector<HTMLElement>(`[${anchor.attribute}="${escapeSelectorValue(anchor.value)}"]`);
}

export function projectGazePoint(root: HTMLDivElement, point: ReplayGazePoint | null) {
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

export function ReplayGazeOverlay({
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
          .filter(
            (
              point,
            ): point is {
              left: number;
              top: number;
              confidence: number;
              age: number;
            } => point !== null,
          );

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

export type TimelineEvent = {
  atMs: number;
  type: string;
  label: string;
  icon: string;
  source: "human" | "bot" | "unknown";
  critical: boolean;
};

export function buildTimelineEvents(
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
        timeline.push({
          atMs,
          type: "click",
          label: "Click",
          icon: "🖱",
          source,
          critical: false,
        });
        break;
      case "key":
        // Only show key bursts, not every keystroke
        if (i === 0 || events[i - 1]?.type !== "key") {
          timeline.push({
            atMs,
            type: "key",
            label: "Typing",
            icon: "⌨",
            source,
            critical: false,
          });
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
          timeline.push({
            atMs,
            type: "scroll",
            label: "Scroll",
            icon: "📜",
            source,
            critical: false,
          });
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

export function ReplayTimeline({
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
          style={{
            left: `${(hoveredEvent.atMs / durationMs) * 100}%`,
            transform: "translateX(-50%)",
          }}
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

async function resolveShareToken(shareToken: string) {
  const response = await fetch(`/api/replay/${shareToken}`);
  const payload = (await response.json()) as {
    documentId?: string;
    error?: string;
  };
  if (!response.ok || !payload.documentId) {
    throw new Error(payload.error || "Unable to resolve replay share link");
  }
  return payload.documentId;
}

export function useShareLookup(documentId: string | undefined, shareToken: string | undefined) {
  const [resolvedDocumentId, setResolvedDocumentId] = useState(documentId ?? null);
  const [shareLookupPending, setShareLookupPending] = useState(Boolean(shareToken && !documentId));
  const [shareLookupError, setShareLookupError] = useState<string | null>(null);

  useEffect(() => {
    if (documentId || !shareToken) return;
    let cancelled = false;
    setShareLookupPending(true);
    setShareLookupError(null);

    resolveShareToken(shareToken)
      .then((id) => {
        if (!cancelled) setResolvedDocumentId(id);
      })
      .catch((error) => {
        if (!cancelled)
          setShareLookupError(error instanceof Error ? error.message : "Unable to resolve replay share link");
      })
      .finally(() => {
        if (!cancelled) setShareLookupPending(false);
      });

    return () => {
      cancelled = true;
    };
  }, [documentId, shareToken]);

  return { resolvedDocumentId, shareLookupPending, shareLookupError };
}
