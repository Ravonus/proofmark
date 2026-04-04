import { decodeForensicReplay } from "./replay";

/** Gaze behavior features extracted from a forensic replay tape. */
export interface GazeBehaviorFeatures {
  active: boolean;
  pointCount: number;
  fixationCount: number;
  avgFixationMs: number;
  maxFixationMs: number;
  minFixationMs: number;
  fixationStdDev: number;
  fixationCoefficientOfVariation: number;
  saccadeCount: number;
  avgSaccadeVelocity: number;
  maxSaccadeVelocity: number;
  blinkCount: number;
  blinkRate: number;
  avgBlinkDurationMs: number;
  confidenceAvg: number;
  trackingCoverage: number;
  trackingLostCount: number;
  totalTrackingLostMs: number;
  calibrationAccuracy: number | null;
  gazeDispersion: number;
  contentFocusRatio: number;
  readingPatternScore: number;
  horizontalProgressionRatio: number;
  returnSweepCount: number;
  anchorHitRatio: number;
  uniqueAnchorCount: number;
  anchorTransitionCount: number;
}

/** Stub — gaze feature extraction requires the premium eye-tracking module. */
function extractGazeBehaviorFeatures(_replay: ForensicReplayTape): GazeBehaviorFeatures | null {
  return null;
}
import { extractReplaySignatureAnalysis } from "./signature-analysis";
import { FORENSIC_PROFILE_THRESHOLDS } from "./thresholds";
import type { BehavioralSignals, ForensicReplayTape } from "./types";

export interface ForensicSession {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  visitIndex: number;
  replay: ForensicReplayTape | null;
  classification: SessionClassification;
  interactions: InteractionClassification[];
}

export interface SessionClassification {
  verdict: "human" | "bot" | "unknown";
  confidence: number;
  automationScore: number;
  flags: string[];
}

export interface InteractionClassification {
  eventIndex: number;
  atMs: number;
  action: InteractionAction;
  source: "human" | "bot" | "unknown";
  reason: string;
  critical: boolean;
}

export type InteractionAction =
  | "field_commit"
  | "signature_start"
  | "signature_commit"
  | "wallet_auth"
  | "consent_click"
  | "scroll"
  | "keystroke_burst"
  | "clipboard_paste";

export interface SignerForensicSessions {
  signerId: string;
  sessions: ForensicSession[];
  totalDurationMs: number;
  totalEvents: number;
  overallVerdict: SessionClassification;
}

export interface PersistedForensicSessionCapture {
  sessionId: string;
  visitIndex: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  behavioral: BehavioralSignals | Record<string, unknown>;
  replay: ForensicReplayTape | null;
}

export interface ForensicSessionSignal {
  code: string;
  source: "human" | "agent";
  weight: number;
  message: string;
}

export interface ForensicSessionTypingProfile {
  sampleCount: number;
  averageDelayMs: number;
  stdDevMs: number;
  coefficientOfVariation: number;
  lagOneAutocorrelation: number;
  verdict: "human" | "bot" | "unknown";
  reason: string;
}

export interface ForensicSessionSignatureProfile {
  verdict: "human" | "bot" | "unknown";
  reason: string;
  strokeCount: number;
  pointCount: number;
  durationMs: number;
  motionComplexityScore: number | null;
  motionUniformityScore: number | null;
}

export interface ForensicSessionGazeProfile {
  active: boolean;
  verdict: "natural" | "synthetic" | "weak" | "absent";
  reasons: string[];
  features: GazeBehaviorFeatures | null;
}

export interface ForensicSessionLivenessProfile {
  available: boolean;
  verdict: "passed" | "failed" | "missing";
  passRatio: number;
  averageReactionMs: number | null;
  suspicious: boolean;
  reasons: string[];
}

export interface ForensicSessionProfile {
  typing: ForensicSessionTypingProfile;
  pointer: {
    mouseMoveCount: number;
    clickCount: number;
    focusChanges: number;
    clickWithoutMovement: boolean;
  };
  timing: {
    durationMs: number;
    hiddenRatio: number;
    firstReplayEventMs: number | null;
    firstKeyMs: number | null;
    firstSignatureMs: number | null;
  };
  replay: {
    eventCount: number;
    scrollCount: number;
    fieldCommitCount: number;
    clipboardCount: number;
    keyEventCount: number;
    signatureEventCount: number;
  };
  signature: ForensicSessionSignatureProfile | null;
  gaze: ForensicSessionGazeProfile;
  liveness: ForensicSessionLivenessProfile;
  signals: ForensicSessionSignal[];
  humanEvidenceScore: number;
  automationEvidenceScore: number;
}

export interface SignerBaselineComparison {
  metric: string;
  stage: "preparation" | "critical";
  current: number;
  baselineMean: number;
  baselineStdDev: number | null;
  zScore: number | null;
  relativeDeviation: number;
  deviates: boolean;
  message: string;
}

export interface SignerBaselineProfile {
  sampleCount: number;
  verdict: "consistent" | "deviates" | "insufficient_data";
  deviationScore: number;
  indicators: string[];
  comparisons: SignerBaselineComparison[];
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function lagOneAutocorrelation(values: number[]) {
  if (values.length < 3) return 0;
  const mean = average(values);
  const diffs = values.map((value) => value - mean);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < diffs.length; index += 1) {
    denominator += diffs[index]! * diffs[index]!;
    if (index < diffs.length - 1) numerator += diffs[index]! * diffs[index + 1]!;
  }
  return denominator > 0 ? numerator / denominator : 0;
}

function isBehavioralSignals(value: unknown): value is BehavioralSignals {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BehavioralSignals>;
  return (
    typeof candidate.timeOnPage === "number" &&
    typeof candidate.mouseMoveCount === "number" &&
    typeof candidate.clickCount === "number" &&
    typeof candidate.keyPressCount === "number"
  );
}

function relativeDeviation(current: number, baseline: number) {
  if (baseline === 0) return Math.abs(current - baseline);
  return Math.abs(current - baseline) / Math.abs(baseline);
}

function buildLivenessProfile(behavioral: BehavioralSignals): ForensicSessionLivenessProfile {
  const summary = behavioral.gazeLiveness ?? null;
  if (!summary) {
    return {
      available: false,
      verdict: "missing",
      passRatio: 0,
      averageReactionMs: null,
      suspicious: false,
      reasons: behavioral.gazeTrackingActive
        ? ["No active liveness challenge was recorded during eye tracking."]
        : ["Eye tracking was not active, so no liveness challenge ran."],
    };
  }

  const reasons: string[] = [];
  let verdict: ForensicSessionLivenessProfile["verdict"] = "failed";
  if (!summary.completed) {
    reasons.push("The liveness challenge did not complete.");
  } else if (!summary.suspicious && summary.passRatio >= FORENSIC_PROFILE_THRESHOLDS.liveness.minHumanPassRatio) {
    verdict = "passed";
    reasons.push(`Liveness challenge passed ${summary.passedCount}/${summary.challengeCount} steps.`);
  } else {
    reasons.push(`Liveness challenge passed only ${summary.passedCount}/${summary.challengeCount} steps.`);
    if (summary.suspicious) reasons.push("Challenge timing or completion pattern was marked suspicious.");
  }

  return {
    available: true,
    verdict,
    passRatio: summary.passRatio,
    averageReactionMs: summary.averageReactionMs,
    suspicious: summary.suspicious,
    reasons,
  };
}

export function buildForensicSessionProfile(behavioral: BehavioralSignals): ForensicSessionProfile {
  const cadence = behavioral.typingCadence ?? [];
  const avgDelay = average(cadence);
  const delayStdDev = stdDev(cadence);
  const typingCv = avgDelay > 0 ? delayStdDev / avgDelay : 0;
  const typingAutocorrelation = lagOneAutocorrelation(cadence);

  let typingVerdict: ForensicSessionTypingProfile["verdict"] = "unknown";
  let typingReason = "Insufficient keystroke cadence data.";
  if (cadence.length >= 5) {
    if (
      typingCv < FORENSIC_PROFILE_THRESHOLDS.typing.botCvMax ||
      (avgDelay < FORENSIC_PROFILE_THRESHOLDS.typing.botAvgDelayMsMax && cadence.length > 5)
    ) {
      typingVerdict = "bot";
      typingReason = `Typing cadence is highly uniform (cv=${typingCv.toFixed(3)}, avg=${avgDelay.toFixed(0)}ms).`;
    } else if (
      Math.abs(typingAutocorrelation) < FORENSIC_PROFILE_THRESHOLDS.typing.botAutocorrelationAbsMax &&
      cadence.length > 8
    ) {
      typingVerdict = "bot";
      typingReason = `Typing delays look decorrelated like synthetic jitter (lag1=${typingAutocorrelation.toFixed(3)}).`;
    } else if (
      typingCv > FORENSIC_PROFILE_THRESHOLDS.typing.humanCvMin &&
      typingAutocorrelation > FORENSIC_PROFILE_THRESHOLDS.typing.humanAutocorrelationMin
    ) {
      typingVerdict = "human";
      typingReason = `Typing cadence shows natural variation and motor persistence (cv=${typingCv.toFixed(3)}, lag1=${typingAutocorrelation.toFixed(3)}).`;
    }
  }

  const replay = behavioral.replay;
  const events = replay ? decodeForensicReplay(replay) : [];
  const firstReplayEventMs = events[0]?.at ?? null;
  const firstKeyMs = events.find((event) => event.type === "key")?.at ?? null;
  const firstSignatureMs = events.find((event) => event.type === "signatureStart")?.at ?? null;
  const scrollCount = events.filter((event) => event.type === "scroll").length;
  const fieldCommitCount = events.filter((event) => event.type === "fieldCommit").length;
  const clipboardCount = events.filter((event) => event.type === "clipboard").length;
  const keyEventCount = events.filter((event) => event.type === "key").length;
  const signatureEventCount = events.filter(
    (event) =>
      event.type === "signatureStart" ||
      event.type === "signaturePoint" ||
      event.type === "signatureEnd" ||
      event.type === "signatureCommit",
  ).length;

  const signatureAnalysis = extractReplaySignatureAnalysis(replay);
  let signature: ForensicSessionSignatureProfile | null = null;
  if (replay?.metrics.signatureStrokeCount || signatureAnalysis) {
    let verdict: ForensicSessionSignatureProfile["verdict"] = "unknown";
    let reason = "Signature motion exists but is not decisive.";

    if (signatureAnalysis) {
      if (
        signatureAnalysis.motionUniformityScore >= FORENSIC_PROFILE_THRESHOLDS.signature.syntheticUniformityMin &&
        signatureAnalysis.velocityCoefficientOfVariation <=
          FORENSIC_PROFILE_THRESHOLDS.signature.syntheticVelocityCvMax &&
        signatureAnalysis.directionChangeCount <= FORENSIC_PROFILE_THRESHOLDS.signature.syntheticDirectionChangesMax
      ) {
        verdict = "bot";
        reason = `Signature motion is unusually uniform (uniformity=${signatureAnalysis.motionUniformityScore.toFixed(2)}, turns=${signatureAnalysis.directionChangeCount}).`;
      } else if (
        signatureAnalysis.motionComplexityScore >= FORENSIC_PROFILE_THRESHOLDS.signature.humanComplexityMin ||
        signatureAnalysis.directionChangeCount >= FORENSIC_PROFILE_THRESHOLDS.signature.humanDirectionChangesMin ||
        signatureAnalysis.penLiftCount >= 1 ||
        signatureAnalysis.velocityCoefficientOfVariation >= FORENSIC_PROFILE_THRESHOLDS.signature.humanVelocityCvMin
      ) {
        verdict = "human";
        reason = `Signature motion shows varied curvature, timing, or pen lifts (complexity=${signatureAnalysis.motionComplexityScore.toFixed(2)}).`;
      }
    } else {
      const pointDensity =
        (replay?.metrics.signaturePointCount ?? 0) / Math.max(1, replay?.metrics.signatureStrokeCount ?? 1);
      if (pointDensity < 3) {
        verdict = "bot";
        reason = `Signature replay contains too few points per stroke (${pointDensity.toFixed(1)}).`;
      } else if ((replay?.metrics.signaturePointCount ?? 0) > 20) {
        verdict = "human";
        reason = `Signature replay contains dense motion samples (${replay?.metrics.signaturePointCount} points).`;
      }
    }

    signature = {
      verdict,
      reason,
      strokeCount: signatureAnalysis?.strokeCount ?? replay?.metrics.signatureStrokeCount ?? 0,
      pointCount: signatureAnalysis?.pointCount ?? replay?.metrics.signaturePointCount ?? 0,
      durationMs: signatureAnalysis?.durationMs ?? 0,
      motionComplexityScore: signatureAnalysis?.motionComplexityScore ?? null,
      motionUniformityScore: signatureAnalysis?.motionUniformityScore ?? null,
    };
  }

  const gazeFeatures = replay ? extractGazeBehaviorFeatures(replay) : null;
  const gazeReasons: string[] = [];
  let gazeVerdict: ForensicSessionGazeProfile["verdict"] = behavioral.gazeTrackingActive ? "weak" : "absent";
  if (!behavioral.gazeTrackingActive) {
    gazeReasons.push("Eye tracking was not active for this session.");
  } else if ((behavioral.gazePointCount ?? 0) === 0) {
    gazeVerdict = "absent";
    gazeReasons.push("Eye tracking was active but no gaze points were captured.");
  } else if (!gazeFeatures) {
    gazeReasons.push("Gaze tracking was active but replay-derived gaze features were unavailable.");
  } else {
    if (
      gazeFeatures.fixationCount >= FORENSIC_PROFILE_THRESHOLDS.gaze.naturalFixationCountMin &&
      gazeFeatures.avgFixationMs >= FORENSIC_PROFILE_THRESHOLDS.gaze.naturalAvgFixationMsMin &&
      gazeFeatures.avgFixationMs <= FORENSIC_PROFILE_THRESHOLDS.gaze.naturalAvgFixationMsMax &&
      gazeFeatures.fixationCoefficientOfVariation >= FORENSIC_PROFILE_THRESHOLDS.gaze.naturalFixationCvMin &&
      gazeFeatures.blinkRate >= FORENSIC_PROFILE_THRESHOLDS.gaze.naturalBlinkRateMin &&
      gazeFeatures.blinkRate <= FORENSIC_PROFILE_THRESHOLDS.gaze.naturalBlinkRateMax &&
      gazeFeatures.trackingCoverage >= FORENSIC_PROFILE_THRESHOLDS.gaze.naturalCoverageMin &&
      gazeFeatures.readingPatternScore >= FORENSIC_PROFILE_THRESHOLDS.gaze.naturalReadingScoreMin
    ) {
      gazeVerdict = "natural";
      gazeReasons.push("Fixation timing, blinking, coverage, and reading progression look human.");
    }

    if (
      gazeFeatures.pointCount > FORENSIC_PROFILE_THRESHOLDS.gaze.syntheticPointCountMin &&
      ((gazeFeatures.blinkCount === 0 &&
        gazeFeatures.pointCount > FORENSIC_PROFILE_THRESHOLDS.gaze.syntheticNoBlinkPointCountMin) ||
        gazeFeatures.fixationCount === 0 ||
        (gazeFeatures.avgFixationMs > 0 &&
          gazeFeatures.avgFixationMs < FORENSIC_PROFILE_THRESHOLDS.gaze.syntheticFastFixationMsMax &&
          gazeFeatures.fixationCount >= 3) ||
        (gazeFeatures.fixationCount >= 6 &&
          gazeFeatures.fixationCoefficientOfVariation < FORENSIC_PROFILE_THRESHOLDS.gaze.syntheticFixationCvMax) ||
        (gazeFeatures.pointCount > 80 &&
          gazeFeatures.readingPatternScore < FORENSIC_PROFILE_THRESHOLDS.gaze.syntheticReadingScoreMax) ||
        (gazeFeatures.pointCount > 80 &&
          gazeFeatures.anchorHitRatio < FORENSIC_PROFILE_THRESHOLDS.gaze.syntheticAnchorHitRatioMax))
    ) {
      gazeVerdict = "synthetic";
      gazeReasons.length = 0;
      if (
        gazeFeatures.blinkCount === 0 &&
        gazeFeatures.pointCount > FORENSIC_PROFILE_THRESHOLDS.gaze.syntheticNoBlinkPointCountMin
      )
        gazeReasons.push("No blinks were detected across sustained gaze tracking.");
      if (gazeFeatures.fixationCount === 0) gazeReasons.push("Gaze points were captured without any fixations.");
      if (
        gazeFeatures.avgFixationMs > 0 &&
        gazeFeatures.avgFixationMs < FORENSIC_PROFILE_THRESHOLDS.gaze.syntheticFastFixationMsMax &&
        gazeFeatures.fixationCount >= 3
      )
        gazeReasons.push(
          `Average fixation duration ${Math.round(gazeFeatures.avgFixationMs)}ms is below human limits.`,
        );
      if (
        gazeFeatures.fixationCount >= 6 &&
        gazeFeatures.fixationCoefficientOfVariation < FORENSIC_PROFILE_THRESHOLDS.gaze.syntheticFixationCvMax
      )
        gazeReasons.push("Fixation durations cluster too tightly to look natural.");
      if (
        gazeFeatures.pointCount > 80 &&
        gazeFeatures.readingPatternScore < FORENSIC_PROFILE_THRESHOLDS.gaze.syntheticReadingScoreMax
      )
        gazeReasons.push("Gaze motion does not resemble reading progression.");
      if (
        gazeFeatures.pointCount > 80 &&
        gazeFeatures.anchorHitRatio < FORENSIC_PROFILE_THRESHOLDS.gaze.syntheticAnchorHitRatioMax
      )
        gazeReasons.push("Gaze rarely lands on instrumented document elements.");
    } else if (gazeVerdict !== "natural") {
      if (gazeFeatures.trackingCoverage < FORENSIC_PROFILE_THRESHOLDS.gaze.weakCoverageMax)
        gazeReasons.push(`Tracking coverage is only ${Math.round(gazeFeatures.trackingCoverage * 100)}%.`);
      if (
        gazeFeatures.confidenceAvg > 0 &&
        gazeFeatures.confidenceAvg < FORENSIC_PROFILE_THRESHOLDS.gaze.weakConfidenceAvgMax
      )
        gazeReasons.push("Average gaze confidence is weak.");
      if (gazeReasons.length === 0)
        gazeReasons.push("Gaze data exists but is not strong enough to classify confidently.");
    }
  }

  const liveness = buildLivenessProfile(behavioral);

  const signals: ForensicSessionSignal[] = [];
  const pushSignal = (signal: ForensicSessionSignal) => signals.push(signal);

  if (typingVerdict === "bot")
    pushSignal({ code: "UNIFORM_TYPING", source: "agent", weight: 0.18, message: typingReason });
  else if (typingVerdict === "human")
    pushSignal({ code: "NATURAL_TYPING", source: "human", weight: 0.14, message: typingReason });

  if (signature?.verdict === "bot")
    pushSignal({ code: "SIGNATURE_SYNTHETIC", source: "agent", weight: 0.28, message: signature.reason });
  else if (signature?.verdict === "human")
    pushSignal({ code: "SIGNATURE_MANUAL", source: "human", weight: 0.24, message: signature.reason });

  if (gazeVerdict === "absent")
    pushSignal({
      code: "GAZE_ABSENT",
      source: "agent",
      weight: 0.24,
      message: gazeReasons[0] ?? "Gaze tracking captured no usable data.",
    });
  else if (gazeVerdict === "synthetic")
    pushSignal({ code: "GAZE_SYNTHETIC", source: "agent", weight: 0.34, message: gazeReasons.join(" ") });
  else if (gazeVerdict === "natural")
    pushSignal({ code: "GAZE_NATURAL", source: "human", weight: 0.26, message: gazeReasons.join(" ") });
  else if (behavioral.gazeTrackingActive)
    pushSignal({ code: "GAZE_WEAK", source: "agent", weight: 0.08, message: gazeReasons.join(" ") });

  if (liveness.available && liveness.verdict === "passed")
    pushSignal({ code: "GAZE_LIVENESS_PASSED", source: "human", weight: 0.22, message: liveness.reasons.join(" ") });
  else if (liveness.available && liveness.verdict === "failed")
    pushSignal({ code: "GAZE_LIVENESS_FAILED", source: "agent", weight: 0.28, message: liveness.reasons.join(" ") });
  else if (!liveness.available && behavioral.gazeTrackingActive)
    pushSignal({ code: "GAZE_LIVENESS_MISSING", source: "agent", weight: 0.08, message: liveness.reasons.join(" ") });

  if (behavioral.mouseMoveCount === 0 && behavioral.clickCount > 0) {
    pushSignal({
      code: "NO_MOUSE_WITH_CLICKS",
      source: "agent",
      weight: 0.2,
      message: "Clicks occurred without any recorded mouse movement.",
    });
  }

  if (behavioral.timeOnPage < 3000 && behavioral.keyPressCount > 10) {
    pushSignal({
      code: "RAPID_HIGH_ACTIVITY",
      source: "agent",
      weight: 0.14,
      message: "The session compressed substantial typing into an extremely short duration.",
    });
  }

  if ((replay?.metrics.eventCount ?? 0) >= 12 || behavioral.mouseMoveCount >= 20 || scrollCount >= 3) {
    pushSignal({
      code: "RICH_MANUAL_ACTIVITY",
      source: "human",
      weight: 0.1,
      message: "Replay shows rich manual scrolling, pointer movement, or page interaction.",
    });
  }

  return {
    typing: {
      sampleCount: cadence.length,
      averageDelayMs: avgDelay,
      stdDevMs: delayStdDev,
      coefficientOfVariation: typingCv,
      lagOneAutocorrelation: typingAutocorrelation,
      verdict: typingVerdict,
      reason: typingReason,
    },
    pointer: {
      mouseMoveCount: behavioral.mouseMoveCount,
      clickCount: behavioral.clickCount,
      focusChanges: behavioral.focusChanges,
      clickWithoutMovement: behavioral.mouseMoveCount === 0 && behavioral.clickCount > 0,
    },
    timing: {
      durationMs: behavioral.timeOnPage,
      hiddenRatio: behavioral.timeOnPage > 0 ? behavioral.hiddenDuration / behavioral.timeOnPage : 0,
      firstReplayEventMs,
      firstKeyMs,
      firstSignatureMs,
    },
    replay: {
      eventCount: replay?.metrics.eventCount ?? 0,
      scrollCount,
      fieldCommitCount,
      clipboardCount,
      keyEventCount,
      signatureEventCount,
    },
    signature,
    gaze: {
      active: behavioral.gazeTrackingActive,
      verdict: gazeVerdict,
      reasons: gazeReasons,
      features: gazeFeatures,
    },
    liveness,
    signals,
    humanEvidenceScore: clamp(
      signals.filter((signal) => signal.source === "human").reduce((sum, signal) => sum + signal.weight, 0),
    ),
    automationEvidenceScore: clamp(
      signals.filter((signal) => signal.source === "agent").reduce((sum, signal) => sum + signal.weight, 0),
    ),
  };
}

export function buildSignerBaselineProfile(
  currentBehavioral: BehavioralSignals,
  priorSessions: unknown[] | null | undefined,
): SignerBaselineProfile | null {
  const sessions = Array.isArray(priorSessions) ? priorSessions : [];
  const priorProfiles = sessions
    .map((session) => {
      const behavioral = (session as { behavioral?: unknown } | null)?.behavioral;
      return isBehavioralSignals(behavioral) ? buildForensicSessionProfile(behavioral) : null;
    })
    .filter((profile): profile is ForensicSessionProfile => profile != null);

  if (priorProfiles.length < FORENSIC_PROFILE_THRESHOLDS.baseline.minSamples) {
    return {
      sampleCount: priorProfiles.length,
      verdict: "insufficient_data",
      deviationScore: 0,
      indicators: [],
      comparisons: [],
    };
  }

  const currentProfile = buildForensicSessionProfile(currentBehavioral);
  const comparisons: SignerBaselineComparison[] = [];
  const indicators: string[] = [];

  const compareMetric = (
    metric: string,
    stage: "preparation" | "critical",
    current: number | null | undefined,
    previous: Array<number | null | undefined>,
  ) => {
    if (current == null || !Number.isFinite(current)) return;
    const values = previous.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (values.length === 0) return;
    const baselineMean = average(values);
    const baselineStdDevValue =
      values.length >= FORENSIC_PROFILE_THRESHOLDS.baseline.preferredSamples ? stdDev(values) : 0;
    const zScore = baselineStdDevValue > 0 ? (current - baselineMean) / baselineStdDevValue : null;
    const relative = relativeDeviation(current, baselineMean);
    const deviates =
      zScore != null
        ? Math.abs(zScore) >= FORENSIC_PROFILE_THRESHOLDS.baseline.zScoreDeviationMin
        : relative >= FORENSIC_PROFILE_THRESHOLDS.baseline.relativeDeviationMin;
    const message = `${metric} deviated from signer baseline (current=${current.toFixed(3)}, baseline=${baselineMean.toFixed(3)}).`;
    comparisons.push({
      metric,
      stage,
      current,
      baselineMean,
      baselineStdDev: baselineStdDevValue > 0 ? baselineStdDevValue : null,
      zScore,
      relativeDeviation: relative,
      deviates,
      message,
    });
    if (deviates) indicators.push(message);
  };

  compareMetric(
    "typing_delay_ms",
    "preparation",
    currentProfile.typing.averageDelayMs || null,
    priorProfiles.map((profile) => profile.typing.averageDelayMs || null),
  );
  compareMetric(
    "typing_cv",
    "preparation",
    currentProfile.typing.coefficientOfVariation || null,
    priorProfiles.map((profile) => profile.typing.coefficientOfVariation || null),
  );
  compareMetric(
    "session_duration_ms",
    "preparation",
    currentProfile.timing.durationMs || null,
    priorProfiles.map((profile) => profile.timing.durationMs || null),
  );
  compareMetric(
    "gaze_reading_score",
    "critical",
    currentProfile.gaze.features?.readingPatternScore ?? null,
    priorProfiles.map((profile) => profile.gaze.features?.readingPatternScore ?? null),
  );
  compareMetric(
    "gaze_liveness_pass_ratio",
    "critical",
    currentProfile.liveness.available ? currentProfile.liveness.passRatio : null,
    priorProfiles.map((profile) => (profile.liveness.available ? profile.liveness.passRatio : null)),
  );
  compareMetric(
    "signature_complexity",
    "critical",
    currentProfile.signature?.motionComplexityScore ?? null,
    priorProfiles.map((profile) => profile.signature?.motionComplexityScore ?? null),
  );

  const deviationScore = clamp(
    comparisons
      .filter((comparison) => comparison.deviates)
      .reduce((sum, comparison) => {
        const weight = comparison.stage === "critical" ? 0.22 : 0.14;
        const magnitude =
          comparison.zScore != null
            ? Math.min(2, Math.abs(comparison.zScore) / 3)
            : Math.min(2, comparison.relativeDeviation / 0.5);
        return sum + weight * magnitude;
      }, 0),
  );

  return {
    sampleCount: priorProfiles.length,
    verdict: indicators.length === 0 ? "consistent" : "deviates",
    deviationScore,
    indicators,
    comparisons,
  };
}

export function generateSessionId(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== "undefined") crypto.getRandomValues(bytes);
  else for (let index = 0; index < 12; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function classifyInteractions(
  replay: ForensicReplayTape,
  behavioral: BehavioralSignals,
): InteractionClassification[] {
  const profile = buildForensicSessionProfile(behavioral);
  const classifications: InteractionClassification[] = [];

  if (replay.metrics.eventCount > 0 && profile.typing.verdict !== "unknown") {
    classifications.push({
      eventIndex: -1,
      atMs: 0,
      action: "keystroke_burst",
      source: profile.typing.verdict,
      reason: profile.typing.reason,
      critical: false,
    });
  }

  if (profile.replay.fieldCommitCount > 0 && profile.typing.verdict !== "unknown") {
    classifications.push({
      eventIndex: -1,
      atMs: profile.timing.firstKeyMs ?? 0,
      action: "field_commit",
      source: profile.typing.verdict,
      reason: `${profile.replay.fieldCommitCount} field commits were preceded by ${profile.typing.verdict === "bot" ? "synthetic-looking" : "natural-looking"} typing cadence.`,
      critical: false,
    });
  }

  if (profile.signature) {
    classifications.push({
      eventIndex: -1,
      atMs: profile.timing.firstSignatureMs ?? 0,
      action: "signature_commit",
      source: profile.signature.verdict,
      reason: profile.signature.reason,
      critical: true,
    });
  }

  if (profile.gaze.active && profile.gaze.verdict === "synthetic") {
    classifications.push({
      eventIndex: -1,
      atMs: 0,
      action: "scroll",
      source: "bot",
      reason: profile.gaze.reasons.join(" "),
      critical: false,
    });
  } else if (profile.gaze.active && profile.gaze.verdict === "natural") {
    classifications.push({
      eventIndex: -1,
      atMs: 0,
      action: "scroll",
      source: "human",
      reason: profile.gaze.reasons.join(" "),
      critical: false,
    });
  }

  if (profile.liveness.available) {
    classifications.push({
      eventIndex: -1,
      atMs: 0,
      action: "wallet_auth",
      source: profile.liveness.verdict === "passed" ? "human" : "bot",
      reason: profile.liveness.reasons.join(" "),
      critical: true,
    });
  }

  if (behavioral.pasteEvents > 0) {
    classifications.push({
      eventIndex: -1,
      atMs: 0,
      action: "clipboard_paste",
      source: profile.typing.verdict === "bot" ? "bot" : "unknown",
      reason: `${behavioral.pasteEvents} paste events were captured during signing.`,
      critical: false,
    });
  }

  return classifications;
}

export function classifySession(
  interactions: InteractionClassification[],
  behavioral: BehavioralSignals,
): SessionClassification {
  const profile = buildForensicSessionProfile(behavioral);
  const flags: string[] = [];
  const botInteractions = interactions.filter((interaction) => interaction.source === "bot");
  const humanInteractions = interactions.filter((interaction) => interaction.source === "human");
  const criticalBot = botInteractions.filter((interaction) => interaction.critical);
  const criticalHuman = humanInteractions.filter((interaction) => interaction.critical);

  let automationScore = profile.automationEvidenceScore * 100 - profile.humanEvidenceScore * 55;

  for (const interaction of botInteractions) {
    automationScore += interaction.critical ? 20 : 10;
    flags.push(`AGENT_${interaction.action.toUpperCase()}: ${interaction.reason}`);
  }
  for (const interaction of humanInteractions) {
    automationScore -= interaction.critical ? 14 : 8;
    flags.push(`HUMAN_${interaction.action.toUpperCase()}: ${interaction.reason}`);
  }
  for (const signal of profile.signals) {
    if (signal.source === "agent") flags.push(`AGENT_${signal.code}: ${signal.message}`);
    else if (signal.weight >= 0.14) flags.push(`HUMAN_${signal.code}: ${signal.message}`);
  }

  automationScore = Math.max(0, Math.min(100, automationScore));

  let verdict: SessionClassification["verdict"] = "unknown";
  if (criticalBot.length > 0 || automationScore >= 45) verdict = "bot";
  else if (
    criticalHuman.length > 0 ||
    (automationScore <= 22 && (profile.humanEvidenceScore >= 0.18 || humanInteractions.length > 0))
  )
    verdict = "human";

  const evidenceGap = Math.abs(profile.automationEvidenceScore - profile.humanEvidenceScore);
  let confidence = clamp(
    0.42 + evidenceGap * 0.7 + botInteractions.length * 0.05 + criticalBot.length * 0.06,
    0.35,
    0.99,
  );
  if (verdict === "unknown") confidence = Math.min(confidence, 0.68);

  return { verdict, confidence, automationScore, flags };
}

export function buildForensicSession(
  sessionId: string,
  visitIndex: number,
  startedAt: string,
  behavioral: BehavioralSignals,
  replay: ForensicReplayTape | null,
): ForensicSession {
  const interactions = replay ? classifyInteractions(replay, behavioral) : [];
  const classification = classifySession(interactions, behavioral);
  return {
    sessionId,
    startedAt,
    endedAt: new Date().toISOString(),
    durationMs: behavioral.timeOnPage,
    visitIndex,
    replay,
    classification,
    interactions,
  };
}

export function mergeSignerSessions(signerId: string, sessions: ForensicSession[]): SignerForensicSessions {
  const totalDurationMs = sessions.reduce((sum, session) => sum + session.durationMs, 0);
  const totalEvents = sessions.reduce((sum, session) => sum + (session.replay?.metrics.eventCount ?? 0), 0);

  let worstScore = 0;
  const allFlags: string[] = [];
  for (const session of sessions) {
    if (session.classification.automationScore > worstScore) worstScore = session.classification.automationScore;
    allFlags.push(...session.classification.flags.map((flag) => `[session ${session.visitIndex}] ${flag}`));
  }

  const hasCriticalBot = sessions.some((session) =>
    session.interactions.some((interaction) => interaction.critical && interaction.source === "bot"),
  );

  let overallVerdict: SessionClassification["verdict"] = "unknown";
  if (hasCriticalBot || worstScore >= 40) overallVerdict = "bot";
  else if (sessions.some((session) => session.classification.verdict === "human")) overallVerdict = "human";

  return {
    signerId,
    sessions,
    totalDurationMs,
    totalEvents,
    overallVerdict: {
      verdict: overallVerdict,
      confidence: Math.min(1, 0.3 + worstScore / 100),
      automationScore: worstScore,
      flags: allFlags,
    },
  };
}
