import type { BehavioralSignals, ForensicFlag } from "~/lib/forensic/types";
import { buildForensicSessionProfile } from "~/lib/forensic/session";
import { extractReplaySignatureAnalysis } from "~/lib/forensic/signature-analysis";
import {
  DEFAULT_DOCUMENT_AUTOMATION_POLICY,
  normalizeDocumentAutomationPolicy,
  type AutomationAssessment,
  type AutomationPolicyOutcome,
  type AutomationReview,
  type AutomationReviewIndicator,
  type AutomationReviewStage,
  type DocumentAutomationPolicy,
  type EnhancedForensicEvidence,
} from "~/lib/forensic/premium";

type AutomationReviewContext = {
  signMethod?: "WALLET" | "EMAIL_OTP";
  hasHandSignature?: boolean;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function scoreToVerdict(score: number): AutomationAssessment {
  if (score >= 0.72) return "agent";
  if (score <= 0.22) return "human";
  return "uncertain";
}

function variance(values: number[]) {
  if (values.length < 2) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
}

function summarizeStage(indicators: AutomationReviewIndicator[], score: number): AutomationReviewStage {
  const reasons = indicators
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((indicator) => indicator.message);
  return {
    stage: indicators[0]?.stage ?? "preparation",
    verdict: scoreToVerdict(score),
    score: clamp(score),
    reasons,
  };
}

function buildPreparationIndicators(
  evidence: EnhancedForensicEvidence,
  behavioral: BehavioralSignals,
  flags: ForensicFlag[],
  profile: ReturnType<typeof buildForensicSessionProfile>,
): AutomationReviewIndicator[] {
  const indicators: AutomationReviewIndicator[] = [];
  const push = (indicator: AutomationReviewIndicator) => indicators.push(indicator);

  if (behavioral.timeOnPage > 0 && behavioral.timeOnPage < 4_000) {
    push({
      code: "RAPID_COMPLETION",
      severity: "warn",
      stage: "preparation",
      score: 0.24,
      message: `Session completed in ${Math.max(1, Math.round(behavioral.timeOnPage / 1000))}s.`,
    });
  }

  if (behavioral.pasteEvents > 0 && behavioral.keyPressCount <= Math.max(2, behavioral.pasteEvents * 2)) {
    push({
      code: "PASTE_HEAVY_PREP",
      severity: "warn",
      stage: "preparation",
      score: 0.28,
      message: "Field preparation relied heavily on paste activity instead of incremental typing.",
    });
  }

  if (behavioral.copyEvents + behavioral.cutEvents + behavioral.pasteEvents >= Math.max(2, behavioral.keyPressCount)) {
    push({
      code: "CLIPBOARD_DOMINANT",
      severity: "info",
      stage: "preparation",
      score: 0.2,
      message: "Clipboard operations dominated the preparation flow.",
    });
  }

  if (behavioral.mouseMoveCount === 0 && behavioral.clickCount <= 1 && behavioral.focusChanges <= 1) {
    push({
      code: "LOW_POINTER_ACTIVITY",
      severity: "warn",
      stage: "preparation",
      score: 0.24,
      message: "Preparation showed almost no pointer or field-navigation activity.",
    });
  }

  if ((behavioral.replay?.metrics.eventCount ?? 0) < 5) {
    push({
      code: "THIN_REPLAY",
      severity: "warn",
      stage: "preparation",
      score: 0.18,
      message: "Replay tape is unusually small for a full signing session.",
    });
  }

  const cadenceVariance = variance(behavioral.typingCadence);
  if (behavioral.typingCadence.length >= 5 && cadenceVariance < 80) {
    push({
      code: "UNIFORM_TYPING",
      severity: "info",
      stage: "preparation",
      score: 0.12,
      message: "Typing cadence is unusually uniform for manual entry.",
    });
  }

  if (
    (behavioral.replay?.metrics.eventCount ?? 0) >= 12 ||
    behavioral.mouseMoveCount >= 12 ||
    behavioral.scrollPattern.length >= 3
  ) {
    push({
      code: "MANUAL_PREP_SIGNALS",
      severity: "info",
      stage: "preparation",
      score: -0.12,
      message: "Preparation included rich manual scrolling, movement, or field interaction.",
    });
  }

  if (flags.some((flag) => flag.code === "WEBDRIVER_DETECTED")) {
    push({
      code: "WEBDRIVER_PREP",
      severity: "critical",
      stage: "preparation",
      score: 0.55,
      message: "Browser reported webdriver automation during preparation.",
    });
  }

  if (profile.typing.verdict === "bot") {
    push({
      code: "SYNTHETIC_TYPING_PREP",
      severity: "warn",
      stage: "preparation",
      score: 0.16,
      message: profile.typing.reason,
    });
  } else if (profile.typing.verdict === "human") {
    push({
      code: "NATURAL_TYPING_PREP",
      severity: "info",
      stage: "preparation",
      score: -0.1,
      message: profile.typing.reason,
    });
  }

  if (profile.gaze.active) {
    if (profile.gaze.verdict === "absent") {
      push({
        code: "NO_GAZE_DATA",
        severity: "warn",
        stage: "preparation",
        score: 0.3,
        message: profile.gaze.reasons.join(" "),
      });
    } else if (profile.gaze.verdict === "synthetic") {
      push({
        code: "SYNTHETIC_GAZE_PREP",
        severity: "warn",
        stage: "preparation",
        score: 0.28,
        message: profile.gaze.reasons.join(" "),
      });
    } else if (profile.gaze.verdict === "weak") {
      push({
        code: "WEAK_GAZE_PREP",
        severity: "info",
        stage: "preparation",
        score: 0.1,
        message: profile.gaze.reasons.join(" "),
      });
    } else if (profile.gaze.verdict === "natural") {
      const gazeF = profile.gaze.features;
      const sessionSec = (behavioral.timeOnPage || 1) / 1000;
      const gazeRate = gazeF ? gazeF.pointCount / sessionSec : 0;
      const hasPlausibleDensity = gazeRate >= 15;
      const hasPlausibleReading = !gazeF || gazeF.readingPatternScore < 0.8;
      const isPlausible = hasPlausibleDensity && hasPlausibleReading;
      push({
        code: "NATURAL_GAZE_PREP",
        severity: "info",
        stage: "preparation",
        score: isPlausible ? -0.18 : 0,
        message: isPlausible
          ? profile.gaze.reasons.join(" ")
          : `Gaze classified natural but has anomalies (rate=${gazeRate.toFixed(0)}/sec, reading=${gazeF?.readingPatternScore?.toFixed(2) ?? "?"}).`,
      });
    }
  }

  if (evidence.signerBaseline?.verdict === "deviates") {
    push({
      code: "SIGNER_BASELINE_DEVIATION_PREP",
      severity: "warn",
      stage: "preparation",
      score: Math.min(0.24, 0.1 + evidence.signerBaseline.deviationScore * 0.3),
      message:
        evidence.signerBaseline.indicators[0] ??
        `Session diverges from ${evidence.signerBaseline.sampleCount} prior signer sessions.`,
    });
  } else if (evidence.signerBaseline?.verdict === "consistent") {
    push({
      code: "SIGNER_BASELINE_CONSISTENT_PREP",
      severity: "info",
      stage: "preparation",
      score: -0.08,
      message: `Preparation pattern stays within the signer's historical baseline across ${evidence.signerBaseline.sampleCount} prior sessions.`,
    });
  }

  return indicators;
}

function buildCriticalIndicators(
  evidence: EnhancedForensicEvidence,
  behavioral: BehavioralSignals,
  flags: ForensicFlag[],
  context: AutomationReviewContext,
  profile: ReturnType<typeof buildForensicSessionProfile>,
): AutomationReviewIndicator[] {
  const indicators: AutomationReviewIndicator[] = [];
  const push = (indicator: AutomationReviewIndicator) => indicators.push(indicator);
  const replay = behavioral.replay;
  const signatureMotion = extractReplaySignatureAnalysis(replay);
  const signaturePoints = replay?.metrics.signaturePointCount ?? 0;
  const signatureStrokes = replay?.metrics.signatureStrokeCount ?? 0;

  if (evidence.fingerprint.webdriver) {
    push({
      code: "WEBDRIVER_CRITICAL",
      severity: "critical",
      stage: "critical",
      score: 0.9,
      message: "Critical actions happened in a webdriver-controlled browser.",
    });
  }

  if (
    flags.some(
      (flag) => flag.code === "BOT_DETECTED" || flag.code === "TOR_DETECTED" || flag.code === "HIGH_FRAUD_SCORE",
    )
  ) {
    push({
      code: "NETWORK_EVASION",
      severity: "critical",
      stage: "critical",
      score: 0.25,
      message: "Network intelligence raised strong automation-evasion risk signals.",
    });
  }

  if (!replay) {
    push({
      code: "NO_REPLAY_AVAILABLE",
      severity: "critical",
      stage: "critical",
      score: 0.42,
      message: "Critical-step replay data was missing.",
    });
  }

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
    if (
      signatureMotion.motionUniformityScore >= 0.78 &&
      signatureMotion.velocityCoefficientOfVariation <= 0.18 &&
      signatureMotion.directionChangeCount <= 2
    ) {
      push({
        code: "SIGNATURE_MOTION_TOO_UNIFORM",
        severity: "warn",
        stage: "critical",
        score: 0.3,
        message: `Signature motion was unusually uniform with ${signatureMotion.boundingBox.aspectRatio.toFixed(2)} shape ratio and limited curvature.`,
      });
    }

    if (signatureMotion.durationMs <= 250 && signatureMotion.pathLengthPx >= 60 && signatureMotion.pointCount >= 8) {
      push({
        code: "SIGNATURE_MOTION_TOO_FAST",
        severity: "warn",
        stage: "critical",
        score: 0.18,
        message: `Signature motion completed in ${Math.max(1, Math.round(signatureMotion.durationMs))}ms despite a long path.`,
      });
    }
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

  if (
    context.hasHandSignature &&
    signatureMotion &&
    (signatureMotion.motionComplexityScore >= 0.48 ||
      signatureMotion.directionChangeCount >= 3 ||
      signatureMotion.penLiftCount >= 1 ||
      signatureMotion.velocityCoefficientOfVariation >= 0.22)
  ) {
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

  if (behavioral.timeOnPage > 0 && behavioral.timeOnPage < 2_500) {
    push({
      code: "INSTANT_FINALIZATION",
      severity: "warn",
      stage: "critical",
      score: 0.22,
      message: "Critical flow finalized almost instantly.",
    });
  }

  if (context.signMethod === "EMAIL_OTP" && behavioral.keyPressCount === 0 && signaturePoints === 0) {
    push({
      code: "NO_MANUAL_CONFIRMATION",
      severity: "warn",
      stage: "critical",
      score: 0.2,
      message: "Critical confirmation had little observable manual interaction.",
    });
  }

  if (profile.gaze.active) {
    if (profile.gaze.verdict === "absent") {
      push({
        code: "NO_GAZE_CRITICAL",
        severity: "critical",
        stage: "critical",
        score: 0.38,
        message: profile.gaze.reasons.join(" "),
      });
    } else if (profile.gaze.verdict === "synthetic") {
      push({
        code: "SYNTHETIC_GAZE_CRITICAL",
        severity: "critical",
        stage: "critical",
        score: 0.34,
        message: profile.gaze.reasons.join(" "),
      });
    } else if (profile.gaze.verdict === "weak") {
      push({
        code: "WEAK_GAZE_CRITICAL",
        severity: "info",
        stage: "critical",
        score: 0.08,
        message: profile.gaze.reasons.join(" "),
      });
    } else if (profile.gaze.verdict === "natural") {
      // Only grant the "natural gaze" bonus if gaze data is truly plausible.
      // Bots can generate data that passes basic threshold checks but with
      // wrong density, ratios, or suspiciously perfect patterns.
      const gazeF = profile.gaze.features;
      const sessionSec = (behavioral.timeOnPage || 1) / 1000;
      const gazeRate = gazeF ? gazeF.pointCount / sessionSec : 0;
      const hasPlausibleDensity = gazeRate >= 8; // real WebGazer = 15-30/sec, lower on slow hardware
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

    const gazeFeatures = profile.gaze.features;
    if (gazeFeatures && gazeFeatures.fixationCount >= 6 && gazeFeatures.fixationCoefficientOfVariation < 0.08) {
      push({
        code: "UNIFORM_FIXATIONS_CRITICAL",
        severity: "warn",
        stage: "critical",
        score: 0.18,
        message: `Fixation timing varies too little during signing (cv=${gazeFeatures.fixationCoefficientOfVariation.toFixed(2)}).`,
      });
    }
    if (gazeFeatures && gazeFeatures.readingPatternScore >= 0.45 && gazeFeatures.anchorHitRatio >= 0.08) {
      // Reading pattern > 0.80 is suspiciously perfect — real humans scan erratically
      if (gazeFeatures.readingPatternScore >= 0.8) {
        push({
          code: "READING_PATTERN_TOO_PERFECT",
          severity: "warn",
          stage: "critical",
          score: 0.25,
          message: `Reading pattern score ${(gazeFeatures.readingPatternScore * 100).toFixed(0)}% is unrealistically high — real reading is more erratic.`,
        });
      } else {
        push({
          code: "READING_PATTERN_CRITICAL",
          severity: "info",
          stage: "critical",
          score: -0.1,
          message: `Gaze followed document content with ${(gazeFeatures.readingPatternScore * 100).toFixed(0)}% reading-pattern alignment.`,
        });
      }
    }

    // ── Deep gaze analytics — detect synthetic gaze data ────────────
    if (gazeFeatures) {
      const sessionMs = behavioral.timeOnPage || 1;
      // Gaze density: points per second of session (WebGazer typically 20-30 fps)
      const gazePointsPerSecond = gazeFeatures.pointCount / (sessionMs / 1000);
      if (gazeFeatures.pointCount > 10 && gazePointsPerSecond < 8) {
        // Less than 8 gaze points/sec — real WebGazer produces 15-30/sec depending on hardware
        push({
          code: "GAZE_DENSITY_TOO_LOW",
          severity: "critical",
          stage: "critical",
          score: 0.45,
          message: `Only ${gazeFeatures.pointCount} gaze points in ${Math.round(sessionMs / 1000)}s (${gazePointsPerSecond.toFixed(1)}/sec) — real eye tracking produces 20-30/sec.`,
        });
      }

      // Saccade-to-fixation ratio: real eyes produce many saccades between fixations
      if (gazeFeatures.fixationCount >= 5 && gazeFeatures.saccadeCount > 0) {
        const saccadeFixRatio = gazeFeatures.saccadeCount / gazeFeatures.fixationCount;
        if (saccadeFixRatio < 1.5) {
          // Real eyes: 3-6 saccades per fixation. Bots often have ~1:1
          push({
            code: "GAZE_SACCADE_FIXATION_RATIO_LOW",
            severity: "warn",
            stage: "critical",
            score: 0.2,
            message: `Saccade/fixation ratio ${saccadeFixRatio.toFixed(1)} is too low — real eyes produce 3-6 saccades per fixation.`,
          });
        }
      }

      // Saccade velocity: real saccades are fast (200-900 deg/sec). Low avg = fabricated
      if (gazeFeatures.saccadeCount >= 5 && gazeFeatures.avgSaccadeVelocity < 150) {
        push({
          code: "GAZE_SACCADE_VELOCITY_LOW",
          severity: "warn",
          stage: "critical",
          score: 0.15,
          message: `Average saccade velocity ${Math.round(gazeFeatures.avgSaccadeVelocity)} deg/s — real saccades are 200-900 deg/s.`,
        });
      }

      // Fixation CV still too low (below 0.18 is current synthetic threshold, but
      // 0.18-0.30 is also suspicious — real humans have 0.5-0.8)
      if (
        gazeFeatures.fixationCount >= 6 &&
        gazeFeatures.fixationCoefficientOfVariation >= 0.08 &&
        gazeFeatures.fixationCoefficientOfVariation < 0.4
      ) {
        push({
          code: "GAZE_FIXATION_CV_SUSPICIOUSLY_LOW",
          severity: "warn",
          stage: "critical",
          score: 0.18,
          message: `Fixation duration variability (CV=${gazeFeatures.fixationCoefficientOfVariation.toFixed(2)}) is low — real humans show CV 0.5-0.8.`,
        });
      }

      // Blink rate vs gaze density sanity check:
      // If claiming high blink rate but few gaze points, the blinks are fabricated
      if (gazeFeatures.blinkCount > 0 && gazeFeatures.pointCount > 0) {
        const blinksPerGazePoint = gazeFeatures.blinkCount / gazeFeatures.pointCount;
        if (blinksPerGazePoint > 0.1) {
          // More than 1 blink per 10 gaze points is suspicious (should be ~1 per 300-500)
          push({
            code: "GAZE_BLINK_DENSITY_HIGH",
            severity: "warn",
            stage: "critical",
            score: 0.22,
            message: `${gazeFeatures.blinkCount} blinks with only ${gazeFeatures.pointCount} gaze points (ratio ${blinksPerGazePoint.toFixed(3)}) — real ratio is ~1:300.`,
          });
        }
      }
    }
  }

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

  const criticalBaselineDeviations =
    evidence.signerBaseline?.comparisons.filter(
      (comparison) => comparison.stage === "critical" && comparison.deviates,
    ) ?? [];
  if (criticalBaselineDeviations.length > 0) {
    push({
      code: "SIGNER_BASELINE_DEVIATION_CRITICAL",
      severity: "warn",
      stage: "critical",
      score: Math.min(0.26, 0.1 + (evidence.signerBaseline?.deviationScore ?? 0) * 0.35),
      message: criticalBaselineDeviations[0]?.message ?? "Critical-stage behavior deviated from signer baseline.",
    });
  }

  // ── Server-side replay tape verification ──────────────────────────
  // If the Rust engine detected mismatches between the binary tape and
  // the claimed behavioral metrics, this is strong evidence of fabrication.
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

  // ── Server-issued signing challenge verification ──────────────────
  const challengeFlags = flags.filter(
    (f) => f.code.startsWith("TIMING_") || f.code.startsWith("LIVENESS_") || f.code.startsWith("CANVAS_"),
  );
  const criticalChallengeFlags = challengeFlags.filter((f) => f.severity === "critical");

  // Missing challenges are a strong signal — real browser clients always provide them
  // Only score missing challenges if they were marked critical (client is expected to provide them)
  const missingCriticalChallenges = challengeFlags.filter(
    (f) => f.code.endsWith("_MISSING") && f.severity === "critical",
  );
  if (missingCriticalChallenges.length > 0) {
    push({
      code: "SIGNING_CHALLENGES_MISSING",
      severity: "critical",
      stage: "critical",
      score: Math.min(0.9, 0.4 + missingCriticalChallenges.length * 0.2),
      message: `${missingCriticalChallenges.length} server-issued challenge(s) missing: ${missingCriticalChallenges.map((f) => f.code.replace("_MISSING", "")).join(", ")}. Client did not complete required verification steps.`,
    });
  }

  // Tampered / invalid tokens
  const tamperedFlags = criticalChallengeFlags.filter((f) => f.code.includes("TAMPERED") || f.code.includes("INVALID"));
  if (tamperedFlags.length > 0) {
    push({
      code: "SIGNING_CHALLENGE_TAMPERED",
      severity: "critical",
      stage: "critical",
      score: 0.8,
      message: `Server challenge token(s) are invalid or tampered: ${tamperedFlags[0]?.message ?? "token verification failed"}.`,
    });
  }

  // Timing analysis flags
  const timingFlags = challengeFlags.filter((f) => f.code.startsWith("TIMING_") && !f.code.endsWith("_MISSING"));
  for (const tf of timingFlags) {
    if (tf.severity === "critical") {
      push({
        code: tf.code,
        severity: "critical",
        stage: "critical",
        score: tf.code === "TIMING_INSTANT_SIGN" ? 0.55 : 0.45,
        message: tf.message,
      });
    }
  }

  // Liveness flags (inhuman reaction, uniform timing)
  const livenessFlags = challengeFlags.filter((f) => f.code.startsWith("LIVENESS_") && !f.code.endsWith("_MISSING"));
  for (const lf of livenessFlags) {
    push({
      code: lf.code,
      severity: lf.severity as "info" | "warn" | "critical",
      stage: "critical",
      score: lf.severity === "critical" ? 0.5 : 0.2,
      message: lf.message,
    });
  }

  // Canvas proof-of-work flags
  const canvasFlags = challengeFlags.filter((f) => f.code.startsWith("CANVAS_") && !f.code.endsWith("_MISSING"));
  for (const cf of canvasFlags) {
    push({
      code: cf.code,
      severity: cf.severity as "info" | "warn" | "critical",
      stage: "critical",
      score: cf.severity === "critical" ? 0.45 : 0.15,
      message: cf.message,
    });
  }

  return indicators;
}

function buildRationale(indicators: AutomationReviewIndicator[], overallVerdict: AutomationAssessment): string {
  const strongest = indicators
    .filter((indicator) => indicator.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((indicator) => indicator.message);

  if (strongest.length === 0) {
    return overallVerdict === "human"
      ? "Session shows normal manual review and signing patterns."
      : "Session did not expose enough abnormal signals to make a strong call.";
  }

  return strongest.join(" ");
}

export function reviewForensicAutomation(
  evidence: EnhancedForensicEvidence,
  context: AutomationReviewContext = {},
): AutomationReview {
  const policy = evidence.policyOutcome?.policy ?? DEFAULT_DOCUMENT_AUTOMATION_POLICY;
  const behavioral = evidence.behavioral;
  const flags = evidence.flags ?? [];
  const profile = evidence.sessionProfile ?? buildForensicSessionProfile(behavioral);

  const preparationIndicators = buildPreparationIndicators(evidence, behavioral, flags, profile);
  const criticalIndicators = buildCriticalIndicators(evidence, behavioral, flags, context, profile);

  const preparationScore = clamp(preparationIndicators.reduce((sum, indicator) => sum + indicator.score, 0));
  const criticalScore = clamp(criticalIndicators.reduce((sum, indicator) => sum + indicator.score, 0));

  const preparationStage = summarizeStage(
    preparationIndicators.length > 0
      ? preparationIndicators
      : [
          {
            code: "PREP_BASELINE",
            severity: "info",
            stage: "preparation",
            score: 0,
            message: "Preparation activity looks ordinary.",
          },
        ],
    preparationScore,
  );
  const criticalStage = summarizeStage(
    criticalIndicators.length > 0
      ? criticalIndicators
      : [
          {
            code: "CRITICAL_BASELINE",
            severity: "info",
            stage: "critical",
            score: 0,
            message: "Critical signing actions look ordinary.",
          },
        ],
    criticalScore,
  );

  let verdict: AutomationReview["verdict"];
  if (criticalScore >= 0.72) verdict = "agent";
  else if (criticalScore < 0.38 && preparationScore >= 0.55) verdict = "mixed";
  else if (criticalScore <= 0.22 && preparationScore <= 0.28) verdict = "human";
  else verdict = "uncertain";

  const automationScore = clamp(Math.max(criticalScore, preparationScore * 0.82));
  const confidence = clamp(
    0.45 +
      Math.max(preparationIndicators.length, criticalIndicators.length) * 0.06 +
      Math.abs(criticalScore - preparationScore) * 0.18,
    0.35,
    0.98,
  );

  let recommendedAction: AutomationReview["recommendedAction"] = "ALLOW";
  if (criticalScore >= 0.55) recommendedAction = policy.onCriticalAutomation === "DENY" ? "DENY" : "FLAG";
  else if (preparationScore >= 0.55 && policy.onPreparationAutomation === "FLAG") recommendedAction = "FLAG";

  const indicators = [...preparationIndicators, ...criticalIndicators];

  return {
    version: 1,
    source: "heuristic",
    verdict,
    confidence,
    automationScore,
    recommendedAction,
    rationale: buildRationale(indicators, verdict),
    createdAt: new Date().toISOString(),
    stages: [preparationStage, criticalStage],
    indicators,
  };
}

export function applyAutomationPolicy(
  review: AutomationReview,
  policyInput?: Partial<DocumentAutomationPolicy> | null,
): AutomationPolicyOutcome {
  const policy = normalizeDocumentAutomationPolicy(policyInput);
  if (!policy.enabled) {
    return {
      action: "ALLOW",
      blocked: false,
      notifyCreator: false,
      reason: "Automation review is disabled for this document.",
      policy,
    };
  }

  const preparationScore = review.stages.find((stage) => stage.stage === "preparation")?.score ?? 0;
  const criticalScore = review.stages.find((stage) => stage.stage === "critical")?.score ?? 0;

  if (criticalScore >= 0.55) {
    const action = policy.onCriticalAutomation;
    return {
      action,
      blocked: action === "DENY",
      notifyCreator: policy.notifyCreator,
      reason:
        action === "DENY"
          ? "Critical signing actions look automated and this document requires a human signer."
          : "Critical signing actions look automated and were flagged for the creator.",
      policy,
    };
  }

  if (preparationScore >= 0.55 && policy.onPreparationAutomation === "FLAG") {
    return {
      action: "FLAG",
      blocked: false,
      notifyCreator: policy.notifyCreator,
      reason: "Preparation activity looks automated and was flagged for the creator.",
      policy,
    };
  }

  return {
    action: "ALLOW",
    blocked: false,
    notifyCreator: false,
    reason: "Session passed the configured automation policy.",
    policy,
  };
}
