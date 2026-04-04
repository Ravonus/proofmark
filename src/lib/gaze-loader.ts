// @ts-nocheck
// Lazy loader for premium GazeTracker.
// The tracker loads WebGazer from CDN at runtime — no npm/webpack dependency.

// Gaze types inlined to avoid hard import from premium/
// These constants match the values in premium/eye-tracking/gaze-types.ts
const GAZE_LOST_REASONS: Record<string, number> = {
  unknown: 0, face_not_detected: 1, eyes_closed: 2,
  looking_away: 3, low_confidence: 4, camera_error: 5,
};

type GazeTrackerCallbacks = {
  onGazePoint?: (pt: { x: number; y: number; confidence: number; timestamp: number }) => void;
  onFixation?: (fix: { x: number; y: number; durationMs: number; element: Element | null; startedAt: number }) => void;
  onSaccade?: (sac: { fromX: number; fromY: number; toX: number; toY: number; velocityDegPerS: number; timestamp: number }) => void;
  onBlink?: (blink: { durationMs: number; timestamp: number }) => void;
  onCalibrationComplete?: (cal: { accuracy: number; pointCount: number }) => void;
  onTrackingLost?: (reason: number) => void;
  onTrackingRestored?: () => void;
  onPermissionDenied?: () => void;
  onError?: (err: Error) => void;
  onGazeAway?: () => void;
  onGazeReturn?: () => void;
};

export type GazeTrackerLike = {
  start: () => Promise<boolean>;
  stop: () => any;
  getStats: () => { pointCount: number; fixationCount: number; blinkCount: number; trackingCoverage: number };
  recordCalibrationClick?: (screenX: number, screenY: number) => void;
  saveCalibrationToDevice?: (trainingClicks: number) => void;
  clearCalibration?: () => void;
  pauseTraining?: () => void;
  resumeTraining?: () => void;
  setLightSmoothing?: (light: boolean) => void;
  setSmoothingMode?: (mode: "desktop" | "mobile" | "light") => void;
  hasStoredCalibration?: boolean;
};

export type GazeCallbacks = {
  onGazePoint?: (pt: { x: number; y: number; confidence: number; timestamp: number }) => void;
  onFixation?: (fix: { x: number; y: number; durationMs: number; element: Element | null; startedAt: number }) => void;
  onSaccade?: (sac: {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    velocityDegPerS: number;
    timestamp: number;
  }) => void;
  onBlink?: (blink: { durationMs: number; timestamp: number }) => void;
  onCalibrationResult?: (cal: { accuracy: number; pointCount: number }) => void;
  onTrackingLost?: (reason: number) => void;
  onTrackingRestored?: () => void;
  onPermissionDenied?: () => void;
  onError?: (err: Error) => void;
  onGazeAway?: () => void;
  onGazeReturn?: () => void;
};

export async function createGazeTracker(
  config: { showGazeFeedback?: boolean; runCalibration?: boolean; confidenceThreshold?: number; smoothingMode?: "desktop" | "mobile" | "light" },
  callbacks: GazeCallbacks,
): Promise<GazeTrackerLike> {
  if (typeof window === "undefined") throw new Error("Browser only");

  const { GazeTracker } = await import(
    /* webpackIgnore: true */
    "~/premium/eye-tracking/gaze-tracker"
  );
  const adaptedCallbacks: GazeTrackerCallbacks = {
    onGazePoint: callbacks.onGazePoint,
    onFixation: callbacks.onFixation,
    onSaccade: callbacks.onSaccade,
    onBlink: callbacks.onBlink,
    onCalibrationComplete: callbacks.onCalibrationResult
      ? (calibration) =>
          callbacks.onCalibrationResult?.({
            accuracy: calibration.accuracy,
            pointCount: calibration.pointCount,
          })
      : undefined,
    onTrackingLost: callbacks.onTrackingLost
      ? (reason) => callbacks.onTrackingLost?.(GAZE_LOST_REASONS[reason] ?? GAZE_LOST_REASONS.unknown)
      : undefined,
    onTrackingRestored: callbacks.onTrackingRestored,
    onPermissionDenied: callbacks.onPermissionDenied,
    onError: callbacks.onError,
    onGazeAway: callbacks.onGazeAway,
    onGazeReturn: callbacks.onGazeReturn,
  };
  const tracker = new GazeTracker(config, adaptedCallbacks);
  if (config.smoothingMode) {
    tracker.setSmoothingMode(config.smoothingMode);
  }
  return tracker as unknown as GazeTrackerLike;
}
