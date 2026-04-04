import type {
  GazeLivenessChallengeKind,
  GazeLivenessChallengePlanStep,
  GazeLivenessStepResult,
  GazeLivenessSummary,
} from "./types";
import { FORENSIC_PROFILE_THRESHOLDS } from "./thresholds";

const TARGET_POOL: Array<{ x: number; y: number; label: string }> = [
  { x: 0.18, y: 0.22, label: "top-left target" },
  { x: 0.82, y: 0.24, label: "top-right target" },
  { x: 0.24, y: 0.72, label: "bottom-left target" },
  { x: 0.76, y: 0.68, label: "bottom-right target" },
  { x: 0.5, y: 0.18, label: "top-center target" },
];

function randomIndex(max: number) {
  if (max <= 1) return 0;
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0]! % max;
  }
  return Math.floor(Math.random() * max);
}

function pickTargets(count: number) {
  const pool = [...TARGET_POOL];
  const picked: typeof TARGET_POOL = [];
  while (picked.length < count && pool.length > 0) {
    const index = randomIndex(pool.length);
    picked.push(pool.splice(index, 1)[0]!);
  }
  return picked;
}

function createTargetStep(
  target: { x: number; y: number; label: string },
  order: number,
): GazeLivenessChallengePlanStep {
  return {
    id: `target-${order}-${Math.round(target.x * 100)}-${Math.round(target.y * 100)}`,
    kind: "look_target",
    prompt: `Look at the ${target.label}.`,
    targetX: target.x,
    targetY: target.y,
    radius: FORENSIC_PROFILE_THRESHOLDS.liveness.targetRadius,
    holdMs: FORENSIC_PROFILE_THRESHOLDS.liveness.targetHoldMs,
    timeoutMs: FORENSIC_PROFILE_THRESHOLDS.liveness.stepTimeoutMs,
  };
}

export function createDefaultGazeLivenessPlan(): GazeLivenessChallengePlanStep[] {
  const targets = pickTargets(3);
  return [
    createTargetStep(targets[0] ?? TARGET_POOL[0]!, 1),
    {
      id: "blink-1",
      kind: "blink",
      prompt: "Blink once while keeping your face in frame.",
      targetX: null,
      targetY: null,
      radius: null,
      holdMs: null,
      timeoutMs: FORENSIC_PROFILE_THRESHOLDS.liveness.stepTimeoutMs,
    },
    createTargetStep(targets[1] ?? TARGET_POOL[1]!, 2),
    createTargetStep(targets[2] ?? TARGET_POOL[2]!, 3),
  ];
}

export function buildGazeLivenessSummary(steps: GazeLivenessStepResult[], required = true): GazeLivenessSummary {
  const passedSteps = steps.filter((step) => step.passed);
  const failedCount = steps.length - passedSteps.length;
  const reactionTimes = passedSteps
    .map((step) => step.reactionMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const averageReactionMs =
    reactionTimes.length > 0 ? reactionTimes.reduce((sum, value) => sum + value, 0) / reactionTimes.length : null;
  const passRatio = steps.length > 0 ? passedSteps.length / steps.length : 0;
  return {
    required,
    completed: steps.length > 0,
    challengeCount: steps.length,
    passedCount: passedSteps.length,
    failedCount,
    passRatio,
    averageReactionMs,
    suspicious:
      passRatio < FORENSIC_PROFILE_THRESHOLDS.liveness.minPassRatio ||
      failedCount >= FORENSIC_PROFILE_THRESHOLDS.liveness.suspiciousFailedSteps ||
      (averageReactionMs != null &&
        averageReactionMs > FORENSIC_PROFILE_THRESHOLDS.liveness.suspiciousAverageReactionMs),
    steps,
  };
}

export function isGazeLivenessAccepted(summary: GazeLivenessSummary | null | undefined): boolean {
  if (!summary?.completed) return false;
  if (summary.suspicious) return false;
  return summary.passRatio >= FORENSIC_PROFILE_THRESHOLDS.liveness.minHumanPassRatio;
}

export function describeGazeLivenessStep(kind: GazeLivenessChallengeKind) {
  if (kind === "blink") return "blink verification";
  return "target gaze verification";
}
