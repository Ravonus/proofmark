/**
 * Critical automation review indicators — extracted from automation-review.ts
 * to keep files under 650 lines and reduce cognitive complexity.
 */

import type { AutomationReviewIndicator, EnhancedForensicEvidence } from "~/lib/forensic/premium";
import type { buildForensicSessionProfile } from "~/lib/forensic/session";
import { extractReplaySignatureAnalysis } from "~/lib/forensic/signature-analysis";
import type { BehavioralSignals, ForensicFlag } from "~/lib/forensic/types";

type AutomationReviewContext = {
  signMethod?: "WALLET" | "EMAIL_OTP";
  hasHandSignature?: boolean;
};

type IndicatorPush = (indicator: AutomationReviewIndicator) => void;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRITICAL INDICATORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function buildCriticalIndicators(
  evidence: EnhancedForensicEvidence,
  behavioral: BehavioralSignals,
  flags: ForensicFlag[],
  context: AutomationReviewContext,
  profile: ReturnType<typeof buildForensicSessionProfile>,
): AutomationReviewIndicator[] {
  const indicators: AutomationReviewIndicator[] = [];
  const push: IndicatorPush = (i) => indicators.push(i);

  checkCriticalEnvironment(push, evidence, flags, behavioral);
  checkCriticalSignature(push, behavioral, context, profile);
  checkCriticalTiming(push, behavioral, context);
  checkCriticalGaze(push, behavioral, profile);
  checkCriticalLiveness(push, behavioral, profile);
  checkCriticalBaseline(push, evidence);
  checkCriticalReplayTape(push, flags);
  checkCriticalChallenges(push, flags);

  return indicators;
}

function checkCriticalEnvironment(
  push: IndicatorPush,
  evidence: EnhancedForensicEvidence,
  flags: ForensicFlag[],
  behavioral: BehavioralSignals,
): void {
  if (evidence.fingerprint.webdriver) {
    push({
      code: "WEBDRIVER_CRITICAL",
      severity: "critical",
      stage: "critical",
      score: 0.9,
      message: "Critical actions happened in a webdriver-controlled browser.",
    });
  }
  if (flags.some((f) => f.code === "BOT_DETECTED" || f.code === "TOR_DETECTED" || f.code === "HIGH_FRAUD_SCORE")) {
    push({
      code: "NETWORK_EVASION",
      severity: "critical",
      stage: "critical",
      score: 0.25,
      message: "Network intelligence raised strong automation-evasion risk signals.",
    });
  }
  if (!behavioral.replay) {
    push({
      code: "NO_REPLAY_AVAILABLE",
      severity: "critical",
      stage: "critical",
      score: 0.42,
      message: "Critical-step replay data was missing.",
    });
  }
}

function checkCriticalSignature(
  push: IndicatorPush,
  behavioral: BehavioralSignals,
  context: AutomationReviewContext,
  profile: ReturnType<typeof buildForensicSessionProfile>,
): void {
  const replay = behavioral.replay;
  const signatureMotion = extractReplaySignatureAnalysis(replay);
  const signaturePoints = replay?.metrics.signaturePointCount ?? 0;
  const signatureStrokes = replay?.metrics.signatureStrokeCount ?? 0;

  if (context.hasHandSignature && signaturePoints === 0) {
    push({
      code: "SIGNATURE_REPLAY_MISSING",
      severity: "critical",
      stage: "critical",
      score: 0.58,
      message: "A hand signature was submitted without signature motion in the replay tape.",
    });
  }
  if (context.hasHandSignature && signatureMotion) {
    checkSignatureMotionQuality(push, signatureMotion);
  }
  if (profile.signature?.verdict === "bot") {
    push({
      code: "SIGNATURE_PROFILE_SYNTHETIC",
      severity: "warn",
      stage: "critical",
      score: 0.22,
      message: profile.signature.reason,
    });
  } else if (profile.signature?.verdict === "human") {
    push({
      code: "SIGNATURE_PROFILE_MANUAL",
      severity: "info",
      stage: "critical",
      score: -0.14,
      message: profile.signature.reason,
    });
  }
  if (context.hasHandSignature && signatureMotion && isComplexSignature(signatureMotion)) {
    push({
      code: "MANUAL_SIGNATURE_PRESENT",
      severity: "info",
      stage: "critical",
      score: -0.28,
      message: `Critical flow includes varied signature motion with ${signatureMotion.directionChangeCount} direction changes and ${signatureMotion.penLiftCount} pen lifts.`,
    });
  } else if (context.hasHandSignature && signaturePoints >= 8 && signatureStrokes >= 1) {
    push({
      code: "MANUAL_SIGNATURE_PRESENT",
      severity: "info",
      stage: "critical",
      score: -0.18,
      message: "Critical flow includes timed signature motion consistent with manual signing.",
    });
  }
}

function checkSignatureMotionQuality(
  push: IndicatorPush,
  sm: NonNullable<ReturnType<typeof extractReplaySignatureAnalysis>>,
): void {
  if (sm.motionUniformityScore >= 0.78 && sm.velocityCoefficientOfVariation <= 0.18 && sm.directionChangeCount <= 2) {
    push({
      code: "SIGNATURE_MOTION_TOO_UNIFORM",
      severity: "warn",
      stage: "critical",
      score: 0.3,
      message: `Signature motion was unusually uniform with ${sm.boundingBox.aspectRatio.toFixed(2)} shape ratio and limited curvature.`,
    });
  }
  if (sm.durationMs <= 250 && sm.pathLengthPx >= 60 && sm.pointCount >= 8) {
    push({
      code: "SIGNATURE_MOTION_TOO_FAST",
      severity: "warn",
      stage: "critical",
      score: 0.18,
      message: `Signature motion completed in ${Math.max(1, Math.round(sm.durationMs))}ms despite a long path.`,
    });
  }
}

function isComplexSignature(sm: NonNullable<ReturnType<typeof extractReplaySignatureAnalysis>>): boolean {
  return (
    sm.motionComplexityScore >= 0.48 ||
    sm.directionChangeCount >= 3 ||
    sm.penLiftCount >= 1 ||
    sm.velocityCoefficientOfVariation >= 0.22
  );
}

function checkCriticalTiming(
  push: IndicatorPush,
  behavioral: BehavioralSignals,
  context: AutomationReviewContext,
): void {
  if (behavioral.timeOnPage > 0 && behavioral.timeOnPage < 2_500) {
    push({
      code: "INSTANT_FINALIZATION",
      severity: "warn",
      stage: "critical",
      score: 0.22,
      message: "Critical flow finalized almost instantly.",
    });
  }
  if (
    context.signMethod === "EMAIL_OTP" &&
    behavioral.keyPressCount === 0 &&
    (behavioral.replay?.metrics.signaturePointCount ?? 0) === 0
  ) {
    push({
      code: "NO_MANUAL_CONFIRMATION",
      severity: "warn",
      stage: "critical",
      score: 0.2,
      message: "Critical confirmation had little observable manual interaction.",
    });
  }
}

function checkCriticalGaze(
  push: IndicatorPush,
  behavioral: BehavioralSignals,
  profile: ReturnType<typeof buildForensicSessionProfile>,
): void {
  if (!profile.gaze.active) return;
  checkGazeVerdict(push, behavioral, profile);
  checkGazeFeatures(push, behavioral, profile);
}

function checkGazeVerdict(
  push: IndicatorPush,
  behavioral: BehavioralSignals,
  profile: ReturnType<typeof buildForensicSessionProfile>,
): void {
  if (profile.gaze.verdict === "absent") {
    push({
      code: "NO_GAZE_CRITICAL",
      severity: "critical",
      stage: "critical",
      score: 0.38,
      message: profile.gaze.reasons.join(" "),
    });
    return;
  }
  if (profile.gaze.verdict === "synthetic") {
    push({
      code: "SYNTHETIC_GAZE_CRITICAL",
      severity: "critical",
      stage: "critical",
      score: 0.34,
      message: profile.gaze.reasons.join(" "),
    });
    return;
  }
  if (profile.gaze.verdict === "weak") {
    push({
      code: "WEAK_GAZE_CRITICAL",
      severity: "info",
      stage: "critical",
      score: 0.08,
      message: profile.gaze.reasons.join(" "),
    });
    return;
  }
  if (profile.gaze.verdict === "natural") {
    const gazeF = profile.gaze.features;
    const sessionSec = (behavioral.timeOnPage || 1) / 1000;
    const gazeRate = gazeF ? gazeF.pointCount / sessionSec : 0;
    const hasPlausibleDensity = gazeRate >= 8;
    const hasPlausibleReadingScore = !gazeF || gazeF.readingPatternScore < 0.8;
    const hasPlausibleSaccadeRatio =
      !gazeF || gazeF.saccadeCount === 0 || gazeF.saccadeCount / Math.max(1, gazeF.fixationCount) >= 1.5;
    const isPlausible = hasPlausibleDensity && hasPlausibleReadingScore && hasPlausibleSaccadeRatio;
    push({
      code: "NATURAL_GAZE_CRITICAL",
      severity: "info",
      stage: "critical",
      score: isPlausible ? -0.24 : 0,
      message: isPlausible
        ? profile.gaze.reasons.join(" ")
        : `Gaze classified natural but has anomalies (rate=${gazeRate.toFixed(0)}/sec, reading=${gazeF?.readingPatternScore?.toFixed(2) ?? "?"}, sac/fix=${gazeF ? (gazeF.saccadeCount / Math.max(1, gazeF.fixationCount)).toFixed(1) : "?"}).`,
    });
  }
}

function checkGazeFeatures(
  push: IndicatorPush,
  behavioral: BehavioralSignals,
  profile: ReturnType<typeof buildForensicSessionProfile>,
): void {
  const gf = profile.gaze.features;
  if (!gf) return;

  if (gf.fixationCount >= 6 && gf.fixationCoefficientOfVariation < 0.08) {
    push({
      code: "UNIFORM_FIXATIONS_CRITICAL",
      severity: "warn",
      stage: "critical",
      score: 0.18,
      message: `Fixation timing varies too little during signing (cv=${gf.fixationCoefficientOfVariation.toFixed(2)}).`,
    });
  }
  if (gf.readingPatternScore >= 0.45 && gf.anchorHitRatio >= 0.08) {
    if (gf.readingPatternScore >= 0.8) {
      push({
        code: "READING_PATTERN_TOO_PERFECT",
        severity: "warn",
        stage: "critical",
        score: 0.25,
        message: `Reading pattern score ${(gf.readingPatternScore * 100).toFixed(0)}% is unrealistically high — real reading is more erratic.`,
      });
    } else {
      push({
        code: "READING_PATTERN_CRITICAL",
        severity: "info",
        stage: "critical",
        score: -0.1,
        message: `Gaze followed document content with ${(gf.readingPatternScore * 100).toFixed(0)}% reading-pattern alignment.`,
      });
    }
  }
  checkDeepGazeAnalytics(push, behavioral, gf);
}

function checkDeepGazeAnalytics(
  push: IndicatorPush,
  behavioral: BehavioralSignals,
  gf: NonNullable<ReturnType<typeof buildForensicSessionProfile>["gaze"]["features"]>,
): void {
  const sessionMs = behavioral.timeOnPage || 1;
  const gazePointsPerSecond = gf.pointCount / (sessionMs / 1000);

  if (gf.pointCount > 10 && gazePointsPerSecond < 8) {
    push({
      code: "GAZE_DENSITY_TOO_LOW",
      severity: "critical",
      stage: "critical",
      score: 0.45,
      message: `Only ${gf.pointCount} gaze points in ${Math.round(sessionMs / 1000)}s (${gazePointsPerSecond.toFixed(1)}/sec) — real eye tracking produces 20-30/sec.`,
    });
  }
  if (gf.fixationCount >= 5 && gf.saccadeCount > 0) {
    const ratio = gf.saccadeCount / gf.fixationCount;
    if (ratio < 1.5) {
      push({
        code: "GAZE_SACCADE_FIXATION_RATIO_LOW",
        severity: "warn",
        stage: "critical",
        score: 0.2,
        message: `Saccade/fixation ratio ${ratio.toFixed(1)} is too low — real eyes produce 3-6 saccades per fixation.`,
      });
    }
  }
  if (gf.saccadeCount >= 5 && gf.avgSaccadeVelocity < 150) {
    push({
      code: "GAZE_SACCADE_VELOCITY_LOW",
      severity: "warn",
      stage: "critical",
      score: 0.15,
      message: `Average saccade velocity ${Math.round(gf.avgSaccadeVelocity)} deg/s — real saccades are 200-900 deg/s.`,
    });
  }
  if (gf.fixationCount >= 6 && gf.fixationCoefficientOfVariation >= 0.08 && gf.fixationCoefficientOfVariation < 0.4) {
    push({
      code: "GAZE_FIXATION_CV_SUSPICIOUSLY_LOW",
      severity: "warn",
      stage: "critical",
      score: 0.18,
      message: `Fixation duration variability (CV=${gf.fixationCoefficientOfVariation.toFixed(2)}) is low — real humans show CV 0.5-0.8.`,
    });
  }
  if (gf.blinkCount > 0 && gf.pointCount > 0 && gf.blinkCount / gf.pointCount > 0.1) {
    push({
      code: "GAZE_BLINK_DENSITY_HIGH",
      severity: "warn",
      stage: "critical",
      score: 0.22,
      message: `${gf.blinkCount} blinks with only ${gf.pointCount} gaze points (ratio ${(gf.blinkCount / gf.pointCount).toFixed(3)}) — real ratio is ~1:300.`,
    });
  }
}

function checkCriticalLiveness(
  push: IndicatorPush,
  behavioral: BehavioralSignals,
  profile: ReturnType<typeof buildForensicSessionProfile>,
): void {
  if (profile.liveness.available && profile.liveness.verdict === "failed") {
    push({
      code: "GAZE_LIVENESS_FAILED",
      severity: "critical",
      stage: "critical",
      score: profile.liveness.suspicious ? 0.42 : 0.32,
      message: profile.liveness.reasons.join(" "),
    });
  } else if (profile.liveness.available && profile.liveness.verdict === "passed") {
    push({
      code: "GAZE_LIVENESS_PASSED",
      severity: "info",
      stage: "critical",
      score: -0.18,
      message: profile.liveness.reasons.join(" "),
    });
  } else if (behavioral.gazeTrackingActive) {
    push({
      code: "GAZE_LIVENESS_MISSING",
      severity: "warn",
      stage: "critical",
      score: 0.12,
      message: "Eye tracking ran without a completed active liveness check.",
    });
  }
}

function checkCriticalBaseline(push: IndicatorPush, evidence: EnhancedForensicEvidence): void {
  const deviations = evidence.signerBaseline?.comparisons.filter((c) => c.stage === "critical" && c.deviates) ?? [];
  if (deviations.length > 0) {
    push({
      code: "SIGNER_BASELINE_DEVIATION_CRITICAL",
      severity: "warn",
      stage: "critical",
      score: Math.min(0.26, 0.1 + (evidence.signerBaseline?.deviationScore ?? 0) * 0.35),
      message: deviations[0]?.message ?? "Critical-stage behavior deviated from signer baseline.",
    });
  }
}

function checkCriticalReplayTape(push: IndicatorPush, flags: ForensicFlag[]): void {
  const replayMismatches = flags.filter((f) => f.code === "REPLAY_METRICS_MISMATCH");
  const criticalMismatches = replayMismatches.filter((f) => f.severity === "critical");
  const tapeAnomalies = flags.filter((f) => f.code.startsWith("TAPE_"));
  const criticalAnomalies = tapeAnomalies.filter((f) => f.severity === "critical");

  if (criticalMismatches.length > 0) {
    push({
      code: "REPLAY_TAPE_FABRICATION",
      severity: "critical",
      stage: "critical",
      score: Math.min(0.85, 0.45 + criticalMismatches.length * 0.15),
      message: `Server-side tape decode found ${criticalMismatches.length} critical metric mismatch(es): ${criticalMismatches[0]?.message ?? "claimed metrics do not match tape contents"}.`,
    });
  } else if (replayMismatches.length > 0) {
    push({
      code: "REPLAY_TAPE_METRICS_DRIFT",
      severity: "warn",
      stage: "critical",
      score: Math.min(0.35, 0.1 + replayMismatches.length * 0.08),
      message: `Server-side tape decode found ${replayMismatches.length} metric discrepanc${replayMismatches.length === 1 ? "y" : "ies"} between claimed behavioral data and actual tape contents.`,
    });
  }
  if (criticalAnomalies.length > 0) {
    push({
      code: "REPLAY_TAPE_STRUCTURAL_ANOMALY",
      severity: "critical",
      stage: "critical",
      score: Math.min(0.65, 0.3 + criticalAnomalies.length * 0.15),
      message: `Replay tape contains ${criticalAnomalies.length} structural anomal${criticalAnomalies.length === 1 ? "y" : "ies"}: ${criticalAnomalies[0]?.message ?? "suspicious tape structure"}.`,
    });
  } else if (tapeAnomalies.length > 0) {
    push({
      code: "REPLAY_TAPE_ANOMALY",
      severity: "warn",
      stage: "critical",
      score: Math.min(0.25, 0.08 + tapeAnomalies.length * 0.06),
      message: `Replay tape contains ${tapeAnomalies.length} non-critical anomal${tapeAnomalies.length === 1 ? "y" : "ies"}.`,
    });
  }
}

function checkCriticalChallenges(push: IndicatorPush, flags: ForensicFlag[]): void {
  const challengeFlags = flags.filter(
    (f) => f.code.startsWith("TIMING_") || f.code.startsWith("LIVENESS_") || f.code.startsWith("CANVAS_"),
  );
  const missingCritical = challengeFlags.filter((f) => f.code.endsWith("_MISSING") && f.severity === "critical");
  if (missingCritical.length > 0) {
    push({
      code: "SIGNING_CHALLENGES_MISSING",
      severity: "critical",
      stage: "critical",
      score: Math.min(0.9, 0.4 + missingCritical.length * 0.2),
      message: `${missingCritical.length} server-issued challenge(s) missing: ${missingCritical.map((f) => f.code.replace("_MISSING", "")).join(", ")}. Client did not complete required verification steps.`,
    });
  }
  const tampered = challengeFlags.filter(
    (f) => f.severity === "critical" && (f.code.includes("TAMPERED") || f.code.includes("INVALID")),
  );
  if (tampered.length > 0) {
    push({
      code: "SIGNING_CHALLENGE_TAMPERED",
      severity: "critical",
      stage: "critical",
      score: 0.8,
      message: `Server challenge token(s) are invalid or tampered: ${tampered[0]?.message ?? "token verification failed"}.`,
    });
  }
  for (const tf of challengeFlags.filter(
    (f) => f.code.startsWith("TIMING_") && !f.code.endsWith("_MISSING") && f.severity === "critical",
  )) {
    push({
      code: tf.code,
      severity: "critical",
      stage: "critical",
      score: tf.code === "TIMING_INSTANT_SIGN" ? 0.55 : 0.45,
      message: tf.message,
    });
  }
  for (const lf of challengeFlags.filter((f) => f.code.startsWith("LIVENESS_") && !f.code.endsWith("_MISSING"))) {
    push({
      code: lf.code,
      severity: lf.severity,
      stage: "critical",
      score: lf.severity === "critical" ? 0.5 : 0.2,
      message: lf.message,
    });
  }
  for (const cf of challengeFlags.filter((f) => f.code.startsWith("CANVAS_") && !f.code.endsWith("_MISSING"))) {
    push({
      code: cf.code,
      severity: cf.severity,
      stage: "critical",
      score: cf.severity === "critical" ? 0.45 : 0.15,
      message: cf.message,
    });
  }
}
