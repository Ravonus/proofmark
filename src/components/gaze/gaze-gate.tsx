"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, Camera, Loader2, Sun, Type, CheckCircle } from "lucide-react";
import { buildGazeLivenessSummary } from "~/lib/forensic/gaze-liveness";
import type { GazeLivenessStepResult, GazeLivenessSummary } from "~/lib/forensic/types";

type Props = {
  mode: "full" | "signing_only";
  gazeReady: boolean;
  gazeError: string | null;
  gazePoint: { x: number; y: number; confidence: number } | null;
  gazeBlinkCount: number;
  onLivenessComplete: (summary: GazeLivenessSummary) => void;
  onStart: () => Promise<boolean>;
  skipCalibration?: boolean;
  onCalibrationComplete?: (trainingClicks: number) => void;
  onPauseTraining?: () => void;
  onResumeTraining?: () => void;
  onSetLightSmoothing?: (light: boolean) => void;
  /** Called when calibration/liveness is done — timestamp marks start of document viewing. */
  onDocumentViewingStarted?: () => void;
  children: React.ReactNode;
};

// Phase 1: Click targets — more points = better regression.
// User must look at the target for 300ms before click is enabled.
const CLICK_TARGETS = [
  { x: 50, y: 50, label: "1" },
  { x: 15, y: 15, label: "2" },
  { x: 85, y: 15, label: "3" },
  { x: 15, y: 85, label: "4" },
  { x: 85, y: 85, label: "5" },
  { x: 50, y: 15, label: "6" },
  { x: 50, y: 85, label: "7" },
  { x: 15, y: 50, label: "8" },
  { x: 85, y: 50, label: "9" },
];

// Phase 2: Text tasks
const TEXT_TASKS = [
  {
    instruction: "Select and copy the bold word below",
    text: "The quick brown fox jumps over the **lazy** dog.",
    targetWord: "lazy",
    action: "copy" as const,
  },
  {
    instruction: "Click on the highlighted word",
    text: "Proofmark uses cryptographic signatures to verify document **integrity** for all parties.",
    targetWord: "integrity",
    action: "click" as const,
  },
];

// Phase 3: Section-based liveness — "look at this region of the screen"
// Uses large screen sections (quadrants/halves) instead of precise hotspots.
// Much more achievable with WebGazer's accuracy.
type ScreenSection = {
  id: string;
  label: string;
  prompt: string;
  // Bounding box in normalized coords (0-1)
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

function createSectionChallenge(): ScreenSection[] {
  const sections: ScreenSection[] = [
    { id: "top", label: "Top", prompt: "Look at the top of the screen", x1: 0.15, y1: 0, x2: 0.85, y2: 0.35 },
    { id: "bottom", label: "Bottom", prompt: "Look at the bottom of the screen", x1: 0.15, y1: 0.65, x2: 0.85, y2: 1 },
    { id: "left", label: "Left", prompt: "Look at the left side of the screen", x1: 0, y1: 0.15, x2: 0.35, y2: 0.85 },
    {
      id: "right",
      label: "Right",
      prompt: "Look at the right side of the screen",
      x1: 0.65,
      y1: 0.15,
      x2: 1,
      y2: 0.85,
    },
    {
      id: "center",
      label: "Center",
      prompt: "Look at the center of the screen",
      x1: 0.25,
      y1: 0.25,
      x2: 0.75,
      y2: 0.75,
    },
  ];
  // Pick 3 random sections
  const shuffled = sections.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 3);
}

function isInSection(gaze: { x: number; y: number }, section: ScreenSection): boolean {
  return gaze.x >= section.x1 && gaze.x <= section.x2 && gaze.y >= section.y1 && gaze.y <= section.y2;
}

export function GazeGate({
  mode,
  gazeReady,
  gazeError,
  gazePoint,
  gazeBlinkCount,
  onLivenessComplete,
  onStart,
  skipCalibration,
  onCalibrationComplete,
  onPauseTraining,
  onResumeTraining,
  onSetLightSmoothing,
  onDocumentViewingStarted,
  children,
}: Props) {
  const [starting, setStarting] = useState(false);
  const [phase, setPhase] = useState<"prompt" | "clicks" | "text" | "liveness" | "done">("prompt");
  const [clickIdx, setClickIdx] = useState(0);
  const [clickReady, setClickReady] = useState(false); // becomes true after 400ms delay per target
  const [textIdx, setTextIdx] = useState(0);
  const [textTaskDone, setTextTaskDone] = useState(false);
  const [totalTrainingClicks, setTotalTrainingClicks] = useState(0);

  // Section-based liveness state
  const [sections] = useState(() => createSectionChallenge());
  const [sectionIdx, setSectionIdx] = useState(0);
  const [sectionResults, setSectionResults] = useState<
    Array<{ section: ScreenSection; passed: boolean; dwellMs: number }>
  >([]);
  const sectionStartRef = useRef<number | null>(null);
  const inSectionRef = useRef<number | null>(null);
  const cumulativeDwellRef = useRef(0);

  const gazePointRef = useRef(gazePoint);
  const blinkCountRef = useRef(gazeBlinkCount);

  useEffect(() => {
    gazePointRef.current = gazePoint;
  }, [gazePoint]);
  useEffect(() => {
    blinkCountRef.current = gazeBlinkCount;
  }, [gazeBlinkCount]);

  // ── Phase transitions ────────────────────────────────────────────

  useEffect(() => {
    if (gazeReady && phase === "prompt") {
      if (skipCalibration) {
        setPhase("liveness");
      } else {
        onSetLightSmoothing?.(true); // lighter smoothing for click calibration
        setPhase("clicks");
      }
    }
  }, [gazeReady, phase, skipCalibration, onSetLightSmoothing]);

  // Delay each click target by 400ms — forces user to look first
  useEffect(() => {
    if (phase !== "clicks") return;
    if (clickIdx >= CLICK_TARGETS.length) {
      setPhase("text");
      return;
    }
    setClickReady(false);
    const t = setTimeout(() => setClickReady(true), 400);
    return () => clearTimeout(t);
  }, [clickIdx, phase]);

  useEffect(() => {
    if (phase === "text" && textIdx >= TEXT_TASKS.length) {
      onCalibrationComplete?.(totalTrainingClicks);
      setPhase("liveness");
    }
  }, [textIdx, phase, totalTrainingClicks, onCalibrationComplete]);

  // Control smoothing and training per phase
  useEffect(() => {
    if (phase === "liveness") {
      onPauseTraining?.();
      onSetLightSmoothing?.(false);
    } else if (phase === "done") {
      onResumeTraining?.();
      onSetLightSmoothing?.(true);
      onDocumentViewingStarted?.(); // Mark: calibration over, document viewing begins
    } else if (phase === "clicks" || phase === "text") {
      onSetLightSmoothing?.(true);
    }
  }, [phase, onPauseTraining, onResumeTraining, onSetLightSmoothing, onDocumentViewingStarted]);

  // ── Section-based liveness execution ─────────────────────────────
  // Check if gaze is in a large screen region for 500ms cumulative.
  // Uses refs to avoid stale closures in the interval.

  useEffect(() => {
    if (phase !== "liveness") return;

    const section = sections[sectionIdx];
    if (!section) {
      const stepResults: GazeLivenessStepResult[] = sectionResults.map((r) => ({
        id: r.section.id,
        kind: "look_target" as const,
        prompt: r.section.prompt,
        targetX: (r.section.x1 + r.section.x2) / 2,
        targetY: (r.section.y1 + r.section.y2) / 2,
        radius: (r.section.x2 - r.section.x1) / 2,
        holdMs: 500,
        timeoutMs: 8000,
        passed: r.passed,
        reactionMs: r.dwellMs,
        observedConfidence: null,
      }));
      const summary = buildGazeLivenessSummary(stepResults);
      onLivenessComplete(summary);
      setPhase("done");
      return;
    }

    // Reset refs for this section
    sectionStartRef.current = Date.now();
    inSectionRef.current = null;
    cumulativeDwellRef.current = 0;

    const timer = window.setInterval(() => {
      const now = Date.now();
      const startedAt = sectionStartRef.current ?? now;

      if (now - startedAt >= 8000) {
        setSectionResults((prev) => [...prev, { section, passed: false, dwellMs: cumulativeDwellRef.current }]);
        setSectionIdx((i) => i + 1);
        clearInterval(timer);
        return;
      }

      const point = gazePointRef.current;
      if (!point) {
        inSectionRef.current = null;
        return;
      }

      if (isInSection(point, section)) {
        if (inSectionRef.current == null) {
          inSectionRef.current = now;
        }
        cumulativeDwellRef.current += 80; // approximate interval time
        if (cumulativeDwellRef.current >= 500) {
          setSectionResults((prev) => [...prev, { section, passed: true, dwellMs: cumulativeDwellRef.current }]);
          setSectionIdx((i) => i + 1);
          clearInterval(timer);
        }
      } else {
        inSectionRef.current = null;
        // Don't reset cumulative — it accumulates across multiple entries
      }
    }, 80);

    return () => clearInterval(timer);
    // Only re-run when the section index changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sectionIdx]);

  // ── Render: done ─────────────────────────────────────────────────

  if (gazeReady && phase === "done") return <>{children}</>;

  // ── Render: Phase 1 — Click targets ──────────────────────────────

  if (gazeReady && phase === "clicks") {
    const pos = CLICK_TARGETS[clickIdx];
    if (!pos) return null;

    return (
      <div className="fixed inset-0 z-[9999] bg-surface">
        {gazePoint && (
          <div
            className="pointer-events-none absolute h-5 w-5 rounded-full opacity-35"
            style={{
              left: `${gazePoint.x * 100}%`,
              top: `${gazePoint.y * 100}%`,
              transform: "translate(-50%, -50%)",
              background: "radial-gradient(circle, rgba(59,130,246,0.5) 0%, transparent 70%)",
            }}
          />
        )}

        <button
          className={`absolute flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold text-white transition-all ${clickReady ? "bg-sky-500 shadow-[0_0_30px_rgba(59,130,246,0.4)] hover:scale-110 active:scale-95" : "scale-75 cursor-not-allowed bg-white/20"}`}
          style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: "translate(-50%, -50%)" }}
          disabled={!clickReady}
          onClick={(e) => {
            if (!clickReady) return;
            try {
              const wg = (window as unknown as Record<string, unknown>).webgazer as
                | { recordScreenPosition?: (x: number, y: number, type: string) => void }
                | undefined;
              wg?.recordScreenPosition?.(e.clientX, e.clientY, "click");
            } catch {
              /* best-effort calibration click */
            }
            setTotalTrainingClicks((c) => c + 1);
            setClickIdx((i) => i + 1);
          }}
        >
          {clickReady ? pos.label : "·"}
        </button>

        <div className="absolute inset-x-0 top-8 text-center">
          <div className="bg-surface-hover/50 text-muted/80 inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs">
            Step 1/3 · {clickReady ? "Look at the circle, then click" : "Look at the dot..."}
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 h-1 w-40 -translate-x-1/2 overflow-hidden rounded-full bg-surface-hover">
          <div
            className="h-full rounded-full bg-sky-400 transition-all"
            style={{ width: `${(clickIdx / CLICK_TARGETS.length) * 33}%` }}
          />
        </div>
      </div>
    );
  }

  // ── Render: Phase 2 — Text interaction ───────────────────────────

  if (gazeReady && phase === "text") {
    const task = TEXT_TASKS[textIdx];
    if (!task) return null;

    const parts = task.text.split(`**${task.targetWord}**`);
    const beforeText = parts[0] ?? "";
    const afterText = parts[1] ?? "";

    const handleTaskComplete = () => {
      setTextTaskDone(false);
      setTextIdx((i) => i + 1);
    };

    const handleWordInteraction = (e: React.MouseEvent) => {
      try {
        const wg = (window as unknown as Record<string, unknown>).webgazer as
          | { recordScreenPosition?: (x: number, y: number, type: string) => void }
          | undefined;
        wg?.recordScreenPosition?.(e.clientX, e.clientY, "click");
      } catch {
        /* best-effort calibration click */
      }
      setTotalTrainingClicks((c) => c + 1);
      if (task.action === "click") {
        setTextTaskDone(true);
        setTimeout(handleTaskComplete, 800);
      }
    };

    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-surface">
        {gazePoint && (
          <div
            className="pointer-events-none absolute h-5 w-5 rounded-full opacity-35"
            style={{
              left: `${gazePoint.x * 100}%`,
              top: `${gazePoint.y * 100}%`,
              transform: "translate(-50%, -50%)",
              background: "radial-gradient(circle, rgba(59,130,246,0.5) 0%, transparent 70%)",
            }}
          />
        )}

        <div className="mx-4 max-w-lg space-y-5 rounded-2xl border border-border bg-surface-card p-8 text-center shadow-2xl">
          <div className="bg-surface-hover/50 text-muted/80 inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs">
            <Type size={12} className="text-emerald-400" />
            Step 2/3 · Training eye tracker
          </div>

          <p className="text-sm text-secondary">{task.instruction}</p>

          <div className="select-text rounded-lg border border-white/[0.06] bg-white/[0.02] p-6 text-left text-base leading-relaxed text-white/70">
            {beforeText}
            <span
              className={`cursor-pointer rounded px-1 py-0.5 font-semibold transition-colors ${textTaskDone ? "bg-emerald-500/30 text-emerald-300" : "bg-sky-500/20 text-sky-300 hover:bg-sky-500/30"}`}
              onClick={handleWordInteraction}
              onCopy={() => {
                if (task.action !== "copy" || textTaskDone) return;
                // Verify the selection actually contains the target word
                const sel = window.getSelection()?.toString().trim().toLowerCase() ?? "";
                if (sel.includes(task.targetWord.toLowerCase())) {
                  setTextTaskDone(true);
                  setTimeout(handleTaskComplete, 800);
                }
              }}
            >
              {task.targetWord}
            </span>
            {afterText}
          </div>

          {textTaskDone && (
            <div className="flex items-center justify-center gap-2 text-sm text-emerald-400">
              <CheckCircle size={16} /> Done!
            </div>
          )}

          {task.action === "copy" && !textTaskDone && (
            <p className="text-muted/40 text-xs">Select the blue word and press Ctrl+C / Cmd+C</p>
          )}

          <button onClick={handleTaskComplete} className="text-muted/25 hover:text-muted/50 text-xs transition-colors">
            Skip this step
          </button>
        </div>

        <div className="absolute bottom-8 left-1/2 h-1 w-40 -translate-x-1/2 overflow-hidden rounded-full bg-surface-hover">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all"
            style={{ width: `${33 + (textIdx / TEXT_TASKS.length) * 33}%` }}
          />
        </div>
      </div>
    );
  }

  // ── Render: Phase 3 — Section-based liveness ─────────────────────

  if (gazeReady && phase === "liveness") {
    const section = sections[sectionIdx];
    if (!section) return null;

    const gazeInSection = gazePoint ? isInSection(gazePoint, section) : false;

    return (
      <div className="fixed inset-0 z-[9999] bg-surface">
        {/* Section highlight — the entire region lights up */}
        <div
          className={`absolute rounded-2xl border-2 transition-all duration-300 ${gazeInSection ? "border-emerald-400/50 bg-emerald-400/10" : "border-border bg-white/[0.02]"}`}
          style={{
            left: `${section.x1 * 100}%`,
            top: `${section.y1 * 100}%`,
            width: `${(section.x2 - section.x1) * 100}%`,
            height: `${(section.y2 - section.y1) * 100}%`,
          }}
        >
          {/* Section label */}
          <div className="flex h-full items-center justify-center">
            <div
              className={`rounded-xl px-6 py-3 transition-colors ${gazeInSection ? "bg-emerald-500/20" : "bg-surface-hover/50"}`}
            >
              <Eye className={`mx-auto h-8 w-8 ${gazeInSection ? "text-emerald-400" : "text-muted/25"}`} />
              <p className={`mt-1 text-sm font-medium ${gazeInSection ? "text-emerald-300" : "text-muted/30"}`}>
                {section.label}
              </p>
            </div>
          </div>
        </div>

        {/* Gaze dot */}
        {gazePoint && (
          <div
            className="pointer-events-none absolute h-7 w-7 rounded-full transition-all duration-100"
            style={{
              left: `${gazePoint.x * 100}%`,
              top: `${gazePoint.y * 100}%`,
              transform: "translate(-50%, -50%)",
              background: gazeInSection
                ? "radial-gradient(circle, rgba(52,211,153,0.8) 0%, transparent 70%)"
                : "radial-gradient(circle, rgba(59,130,246,0.5) 0%, transparent 70%)",
              boxShadow: gazeInSection ? "0 0 20px rgba(52,211,153,0.5)" : undefined,
            }}
          />
        )}

        {/* Instructions */}
        <div className="bg-surface-card/95 absolute inset-x-0 top-4 mx-auto max-w-sm rounded-2xl border border-border px-5 py-3 text-center backdrop-blur-sm">
          <div className="bg-surface-hover/50 text-muted/50 mb-1.5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px]">
            <Eye size={10} className="text-emerald-400" />
            Step 3/3 · Gaze verification
          </div>
          <p className="text-sm text-muted">{section.prompt}</p>
          <p className={`mt-1 text-xs ${gazeInSection ? "text-emerald-400" : "text-muted/25"}`}>
            {gazeInSection ? "✓ In zone — keep looking..." : "Move your gaze to the highlighted area"}
          </p>
          <div className="mt-2 flex justify-center gap-1">
            {sections.map((s, i) => (
              <div
                key={s.id}
                className={`h-1 w-8 rounded-full ${i < sectionIdx ? "bg-emerald-400" : i === sectionIdx ? "animate-pulse bg-sky-400" : "bg-surface-hover/50"}`}
              />
            ))}
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 h-1 w-40 -translate-x-1/2 overflow-hidden rounded-full bg-surface-hover">
          <div
            className="h-full rounded-full bg-violet-400 transition-all"
            style={{ width: `${66 + (sectionIdx / sections.length) * 34}%` }}
          />
        </div>
      </div>
    );
  }

  // ── Render: Prompt ───────────────────────────────────────────────

  const handleStart = async () => {
    setStarting(true);
    const ok = await onStart();
    if (!ok) setPhase("prompt");
    setStarting(false);
  };

  return (
    <div className="bg-surface/95 fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm">
      <div className="mx-4 max-w-md space-y-5 rounded-2xl border border-border bg-surface-card p-7 text-center shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sky-500/10">
          <Eye className="h-7 w-7 text-sky-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-primary">Eye Tracking Required</h2>
          <p className="mt-1.5 text-sm text-muted">
            {mode === "full"
              ? "This document records gaze data as forensic evidence."
              : "Eye tracking is required during signature steps."}
          </p>
        </div>
        <div className="text-muted/60 space-y-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-left text-xs">
          <div className="flex items-start gap-2">
            <Camera size={13} className="mt-0.5 shrink-0 text-sky-400" />
            <span>Camera access needed — video is NOT recorded</span>
          </div>
          <div className="flex items-start gap-2">
            <Sun size={13} className="mt-0.5 shrink-0 text-amber-400" />
            <span>Even lighting on your face works best</span>
          </div>
          <div className="flex items-start gap-2">
            <Eye size={13} className="mt-0.5 shrink-0 text-sky-400" />
            <span>{skipCalibration ? "Quick gaze check — 30 seconds" : "3 quick steps — about 60 seconds"}</span>
          </div>
        </div>
        {gazeError && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
            {gazeError}
          </div>
        )}
        <button
          onClick={handleStart}
          disabled={starting}
          className="w-full rounded-xl bg-sky-500 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition-colors hover:bg-sky-400 disabled:opacity-50"
        >
          {starting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={15} className="animate-spin" /> Starting camera...
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <Camera size={15} /> Enable Camera
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
