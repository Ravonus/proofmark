"use client";

/**
 * Mobile gaze gate — 2-phase flow (vs 3-phase desktop):
 *   1. Touch calibration (5 points with large targets)
 *   2. Section liveness (2 wider zones with longer dwell)
 *
 * Text interaction tasks are omitted — touch text selection is unreliable
 * across mobile browsers and adds friction without meaningful training data.
 *
 * Same callback contract as GazeGate — drop-in replacement.
 */

import { useEffect, useRef, useState } from "react";
import { Eye, Camera, Loader2 } from "lucide-react";
import { buildGazeLivenessSummary } from "~/lib/forensic/gaze-liveness";
import type { GazeLivenessStepResult, GazeLivenessSummary } from "~/lib/forensic/types";
// DeviceProfile type inlined to avoid hard import from premium/
type DeviceProfile = {
  isMobile: boolean;
  hasCamera: boolean;
  screenDiag: number;
  dpr: number;
  os: string;
  browser: string;
  cameraLabel?: string;
  viewportW: number;
  viewportH: number;
};

type Props = {
  mode: "full" | "signing_only";
  gazeReady: boolean;
  gazeError: string | null;
  gazePoint: { x: number; y: number; confidence: number } | null;
  gazeBlinkCount: number;
  device: DeviceProfile;
  onLivenessComplete: (summary: GazeLivenessSummary) => void;
  onStart: () => Promise<boolean>;
  skipCalibration?: boolean;
  onCalibrationComplete?: (trainingClicks: number) => void;
  onPauseTraining?: () => void;
  onResumeTraining?: () => void;
  onSetLightSmoothing?: (light: boolean) => void;
  onDocumentViewingStarted?: () => void;
  children: React.ReactNode;
};

// Mobile liveness sections — wider zones than desktop (+10% each side)
type ScreenSection = { id: string; label: string; prompt: string; x1: number; y1: number; x2: number; y2: number };

function createMobileSections(): ScreenSection[] {
  const sections: ScreenSection[] = [
    { id: "top", label: "Top", prompt: "Look at the top of the screen", x1: 0.05, y1: 0, x2: 0.95, y2: 0.45 },
    { id: "bottom", label: "Bottom", prompt: "Look at the bottom of the screen", x1: 0.05, y1: 0.55, x2: 0.95, y2: 1 },
    { id: "left", label: "Left", prompt: "Look at the left side", x1: 0, y1: 0.05, x2: 0.45, y2: 0.95 },
    { id: "right", label: "Right", prompt: "Look at the right side", x1: 0.55, y1: 0.05, x2: 1, y2: 0.95 },
    { id: "center", label: "Center", prompt: "Look at the center", x1: 0.15, y1: 0.15, x2: 0.85, y2: 0.85 },
  ];
  // Pick 2 random sections (vs 3 desktop) — shorter flow for mobile
  return sections.sort(() => Math.random() - 0.5).slice(0, 2);
}

const DWELL_REQUIRED_MS = 800;  // vs 500ms desktop
const SECTION_TIMEOUT_MS = 12_000; // vs 8s desktop

export function GazeGateMobile({
  mode,
  gazeReady,
  gazeError,
  gazePoint,
  device,
  onLivenessComplete,
  onStart,
  skipCalibration,
  onCalibrationComplete,
  onPauseTraining,
  onSetLightSmoothing,
  onDocumentViewingStarted,
  children,
}: Props) {
  const [phase, setPhase] = useState<"prompt" | "calibrating" | "liveness" | "done">("prompt");
  const [starting, setStarting] = useState(false);
  const [calibrationClicks, setCalibrationClicks] = useState(0);

  // Liveness state
  const [sections] = useState(() => createMobileSections());
  const [sectionIdx, setSectionIdx] = useState(0);
  const [dwellMs, setDwellMs] = useState(0);
  const [sectionFailed, setSectionFailed] = useState(false);
  const stepResults = useRef<GazeLivenessStepResult[]>([]);
  const dwellAccum = useRef(0);
  const lastTick = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Handle gaze start
  const handleStart = async () => {
    setStarting(true);
    const ok = await onStart();
    setStarting(false);
    if (ok) {
      if (skipCalibration) {
        setPhase("liveness");
        onPauseTraining?.();
      } else {
        setPhase("calibrating");
        onSetLightSmoothing?.(true);
      }
    }
  };

  // Calibration complete callback
  const handleCalibrationDone = (clicks: number) => {
    setCalibrationClicks(clicks);
    onCalibrationComplete?.(clicks);
    onSetLightSmoothing?.(false);
    onPauseTraining?.();
    setPhase("liveness");
  };

  // Liveness: track gaze dwell in current section
  useEffect(() => {
    if (phase !== "liveness" || !gazePoint) return;

    const section = sections[sectionIdx];
    if (!section) return;

    const now = performance.now();
    const dt = lastTick.current ? now - lastTick.current : 0;
    lastTick.current = now;

    const inSection =
      gazePoint.x >= section.x1 && gazePoint.x <= section.x2 &&
      gazePoint.y >= section.y1 && gazePoint.y <= section.y2;

    if (inSection) {
      dwellAccum.current += dt;
      setDwellMs(dwellAccum.current);
    }

    if (dwellAccum.current >= DWELL_REQUIRED_MS) {
      // Section passed
      stepResults.current.push({
        section: section.id,
        passed: true,
        dwellMs: dwellAccum.current,
        timeoutMs: 0,
      });

      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      const next = sectionIdx + 1;
      if (next >= sections.length) {
        // All sections done
        const summary = buildGazeLivenessSummary(stepResults.current);
        onLivenessComplete(summary);
        onDocumentViewingStarted?.();
        setPhase("done");
      } else {
        setSectionIdx(next);
        dwellAccum.current = 0;
        lastTick.current = 0;
        setDwellMs(0);
        setSectionFailed(false);
      }
    }
  }, [gazePoint, phase, sectionIdx, sections, onLivenessComplete, onDocumentViewingStarted]);

  // Section timeout
  useEffect(() => {
    if (phase !== "liveness") return;

    timeoutRef.current = setTimeout(() => {
      stepResults.current.push({
        section: sections[sectionIdx]?.id ?? "unknown",
        passed: false,
        dwellMs: dwellAccum.current,
        timeoutMs: SECTION_TIMEOUT_MS,
      });
      setSectionFailed(true);

      // Auto-advance after brief pause
      setTimeout(() => {
        const next = sectionIdx + 1;
        if (next >= sections.length) {
          const summary = buildGazeLivenessSummary(stepResults.current);
          onLivenessComplete(summary);
          onDocumentViewingStarted?.();
          setPhase("done");
        } else {
          setSectionIdx(next);
          dwellAccum.current = 0;
          lastTick.current = 0;
          setDwellMs(0);
          setSectionFailed(false);
        }
      }, 1000);
    }, SECTION_TIMEOUT_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [phase, sectionIdx, sections, onLivenessComplete, onDocumentViewingStarted]);

  // -- Render phases --

  if (phase === "done") return <>{children}</>;

  if (phase === "prompt") {
    return (
      <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/90 backdrop-blur-sm">
        <div className="mx-4 max-w-sm space-y-5 rounded-2xl border border-white/10 bg-[#0c121d] p-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sky-500/15">
            {starting ? <Loader2 className="h-7 w-7 animate-spin text-sky-400" /> : <Camera className="h-7 w-7 text-sky-400" />}
          </div>
          <h2 className="text-lg font-bold text-white">Eye Tracking Required</h2>
          <p className="text-sm leading-relaxed text-white/60">
            This document requires gaze verification. Hold your phone at eye level.
          </p>
          {gazeError && <p className="text-sm text-red-400">{gazeError}</p>}
          <button
            onClick={handleStart}
            disabled={starting}
            className="w-full rounded-xl bg-sky-500/20 py-3 text-sm font-semibold text-sky-300 transition-colors hover:bg-sky-500/30 disabled:opacity-50"
          >
            {starting ? "Starting Camera..." : "Enable Eye Tracking"}
          </button>
        </div>
      </div>
    );
  }

  if (phase === "calibrating") {
    // Dynamic import of mobile calibration overlay
    let CalibrationOverlay: React.ComponentType<any>;
    try {
      const modPath = "~/premium/eye-tracking/mobile/calibration-overlay";
      CalibrationOverlay = require(/* webpackIgnore: true */ modPath).MobileCalibrationOverlay;
    } catch {
      return <div className="p-8 text-center text-sm text-muted">Eye tracking calibration requires premium features.</div>;
    }
    return (
      <CalibrationOverlay
        tracker={(globalThis as Record<string, unknown>).__gazeTracker}
        device={device}
        onGazeSample={() => {}}
        onComplete={(result: { pointCount: number }) => handleCalibrationDone(result.pointCount)}
        onSkip={() => handleCalibrationDone(0)}
      />
    );
  }

  // Liveness phase
  const section = sections[sectionIdx];
  const progress = Math.min(1, dwellMs / DWELL_REQUIRED_MS);
  const totalProgress = (sectionIdx + progress) / sections.length;

  return (
    <div className="fixed inset-0 z-[100000] flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm">
      {/* Progress bar */}
      <div className="fixed left-0 right-0 top-0 h-1.5 bg-white/5">
        <div className="h-full bg-sky-500 transition-all" style={{ width: `${totalProgress * 100}%` }} />
      </div>

      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/15">
        <Eye className="h-6 w-6 text-sky-400" />
      </div>

      <p className="mt-4 text-lg font-semibold text-white">
        {sectionFailed ? "Missed — moving on" : section?.prompt}
      </p>

      <p className="mt-2 text-sm text-white/40">
        Hold your gaze for {(DWELL_REQUIRED_MS / 1000).toFixed(1)}s
      </p>

      {/* Dwell progress ring */}
      <div className="mt-6">
        <svg width={80} height={80}>
          <circle cx={40} cy={40} r={36} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={4} />
          <circle
            cx={40} cy={40} r={36}
            fill="none" stroke="rgba(56, 189, 248, 0.8)" strokeWidth={4}
            strokeDasharray={Math.PI * 72}
            strokeDashoffset={Math.PI * 72 * (1 - progress)}
            transform="rotate(-90 40 40)"
          />
        </svg>
      </div>

      {/* Gaze indicator dot */}
      {gazePoint && (
        <div
          className="fixed h-3 w-3 rounded-full bg-sky-400/50"
          style={{
            left: `${gazePoint.x * 100}%`,
            top: `${gazePoint.y * 100}%`,
            transform: "translate(-50%, -50%)",
            transition: "left 0.05s, top 0.05s",
          }}
        />
      )}

      {/* Section highlight */}
      {section && (
        <div
          className="fixed border-2 border-sky-400/20 bg-sky-400/5 rounded-lg"
          style={{
            left: `${section.x1 * 100}%`,
            top: `${section.y1 * 100}%`,
            width: `${(section.x2 - section.x1) * 100}%`,
            height: `${(section.y2 - section.y1) * 100}%`,
          }}
        />
      )}
    </div>
  );
}
