import { decodeForensicReplay } from "./replay";
import type {
  ForensicSessionGazeProfile,
  ForensicSessionLivenessProfile,
  ForensicSessionProfile,
  ForensicSessionSignal,
  ForensicSessionSignatureProfile,
  ForensicSessionTypingProfile,
} from "./session";
import { extractGazeBehaviorFeatures } from "./session";
import { extractReplaySignatureAnalysis } from "./signature-analysis";
import { FORENSIC_PROFILE_THRESHOLDS } from "./thresholds";
import type { BehavioralSignals, ForensicReplayTape } from "./types";

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

function buildTypingProfile(cadence: number[]): ForensicSessionTypingProfile {
  const avgDelay = average(cadence);
  const delayStdDev = stdDev(cadence);
  const typingCv = avgDelay > 0 ? delayStdDev / avgDelay : 0;
  const typingAutocorrelation = lagOneAutocorrelation(cadence);

  let verdict: ForensicSessionTypingProfile["verdict"] = "unknown";
  let reason = "Insufficient keystroke cadence data.";
  if (cadence.length >= 5) {
    if (
      typingCv < FORENSIC_PROFILE_THRESHOLDS.typing.botCvMax ||
      (avgDelay < FORENSIC_PROFILE_THRESHOLDS.typing.botAvgDelayMsMax && cadence.length > 5)
    ) {
      verdict = "bot";
      reason = `Typing cadence is highly uniform (cv=${typingCv.toFixed(3)}, avg=${avgDelay.toFixed(0)}ms).`;
    } else if (
      Math.abs(typingAutocorrelation) < FORENSIC_PROFILE_THRESHOLDS.typing.botAutocorrelationAbsMax &&
      cadence.length > 8
    ) {
      verdict = "bot";
      reason = `Typing delays look decorrelated like synthetic jitter (lag1=${typingAutocorrelation.toFixed(3)}).`;
    } else if (
      typingCv > FORENSIC_PROFILE_THRESHOLDS.typing.humanCvMin &&
      typingAutocorrelation > FORENSIC_PROFILE_THRESHOLDS.typing.humanAutocorrelationMin
    ) {
      verdict = "human";
      reason = `Typing cadence shows natural variation and motor persistence (cv=${typingCv.toFixed(3)}, lag1=${typingAutocorrelation.toFixed(3)}).`;
    }
  }
  return {
    sampleCount: cadence.length,
    averageDelayMs: avgDelay,
    stdDevMs: delayStdDev,
    coefficientOfVariation: typingCv,
    lagOneAutocorrelation: typingAutocorrelation,
    verdict,
    reason,
  };
}

function classifySignatureFromAnalysis(analysis: NonNullable<ReturnType<typeof extractReplaySignatureAnalysis>>): {
  verdict: ForensicSessionSignatureProfile["verdict"];
  reason: string;
} {
  const t = FORENSIC_PROFILE_THRESHOLDS.signature;
  if (
    analysis.motionUniformityScore >= t.syntheticUniformityMin &&
    analysis.velocityCoefficientOfVariation <= t.syntheticVelocityCvMax &&
    analysis.directionChangeCount <= t.syntheticDirectionChangesMax
  ) {
    return {
      verdict: "bot",
      reason: `Signature motion is unusually uniform (uniformity=${analysis.motionUniformityScore.toFixed(2)}, turns=${analysis.directionChangeCount}).`,
    };
  }
  if (
    analysis.motionComplexityScore >= t.humanComplexityMin ||
    analysis.directionChangeCount >= t.humanDirectionChangesMin ||
    analysis.penLiftCount >= 1 ||
    analysis.velocityCoefficientOfVariation >= t.humanVelocityCvMin
  ) {
    return {
      verdict: "human",
      reason: `Signature motion shows varied curvature, timing, or pen lifts (complexity=${analysis.motionComplexityScore.toFixed(2)}).`,
    };
  }
  return {
    verdict: "unknown",
    reason: "Signature motion exists but is not decisive.",
  };
}

function classifySignatureFromReplay(replay: ForensicReplayTape | null | undefined): {
  verdict: ForensicSessionSignatureProfile["verdict"];
  reason: string;
} {
  const pointDensity =
    (replay?.metrics.signaturePointCount ?? 0) / Math.max(1, replay?.metrics.signatureStrokeCount ?? 1);
  if (pointDensity < 3) {
    return {
      verdict: "bot",
      reason: `Signature replay contains too few points per stroke (${pointDensity.toFixed(1)}).`,
    };
  }
  if ((replay?.metrics.signaturePointCount ?? 0) > 20) {
    return {
      verdict: "human",
      reason: `Signature replay contains dense motion samples (${replay?.metrics.signaturePointCount} points).`,
    };
  }
  return {
    verdict: "unknown",
    reason: "Signature motion exists but is not decisive.",
  };
}

function buildSignatureProfile(replay: ForensicReplayTape | null | undefined): ForensicSessionSignatureProfile | null {
  const signatureAnalysis = extractReplaySignatureAnalysis(replay);
  if (!replay?.metrics.signatureStrokeCount && !signatureAnalysis) return null;

  const { verdict, reason } = signatureAnalysis
    ? classifySignatureFromAnalysis(signatureAnalysis)
    : classifySignatureFromReplay(replay);

  return {
    verdict,
    reason,
    strokeCount: signatureAnalysis?.strokeCount ?? replay?.metrics.signatureStrokeCount ?? 0,
    pointCount: signatureAnalysis?.pointCount ?? replay?.metrics.signaturePointCount ?? 0,
    durationMs: signatureAnalysis?.durationMs ?? 0,
    motionComplexityScore: signatureAnalysis?.motionComplexityScore ?? null,
    motionUniformityScore: signatureAnalysis?.motionUniformityScore ?? null,
  };
}

function buildGazeProfile(
  behavioral: BehavioralSignals,
  replay: ForensicReplayTape | null | undefined,
): ForensicSessionGazeProfile {
  const gazeFeatures = replay ? extractGazeBehaviorFeatures(replay) : null;
  const reasons: string[] = [];
  let verdict: ForensicSessionGazeProfile["verdict"] = behavioral.gazeTrackingActive ? "weak" : "absent";

  if (!behavioral.gazeTrackingActive) {
    reasons.push("Eye tracking was not active for this session.");
    return { active: false, verdict, reasons, features: gazeFeatures };
  }

  if ((behavioral.gazePointCount ?? 0) === 0) {
    return {
      active: true,
      verdict: "absent",
      reasons: ["Eye tracking was active but no gaze points were captured."],
      features: gazeFeatures,
    };
  }

  if (!gazeFeatures) {
    return {
      active: true,
      verdict,
      reasons: ["Gaze tracking was active but replay-derived gaze features were unavailable."],
      features: null,
    };
  }

  verdict = classifyGazeVerdict(gazeFeatures, reasons);
  return { active: true, verdict, reasons, features: gazeFeatures };
}

function classifyGazeVerdict(
  gf: NonNullable<ForensicSessionGazeProfile["features"]>,
  reasons: string[],
): ForensicSessionGazeProfile["verdict"] {
  const t = FORENSIC_PROFILE_THRESHOLDS.gaze;
  let verdict: ForensicSessionGazeProfile["verdict"] = "weak";

  if (
    gf.fixationCount >= t.naturalFixationCountMin &&
    gf.avgFixationMs >= t.naturalAvgFixationMsMin &&
    gf.avgFixationMs <= t.naturalAvgFixationMsMax &&
    gf.fixationCoefficientOfVariation >= t.naturalFixationCvMin &&
    gf.blinkRate >= t.naturalBlinkRateMin &&
    gf.blinkRate <= t.naturalBlinkRateMax &&
    gf.trackingCoverage >= t.naturalCoverageMin &&
    gf.readingPatternScore >= t.naturalReadingScoreMin
  ) {
    verdict = "natural";
    reasons.push("Fixation timing, blinking, coverage, and reading progression look human.");
  }

  if (gf.pointCount > t.syntheticPointCountMin && hasSyntheticGazeSignals(gf)) {
    verdict = "synthetic";
    reasons.length = 0;
    collectSyntheticGazeReasons(gf, reasons);
  } else if (verdict !== "natural") {
    if (gf.trackingCoverage < t.weakCoverageMax)
      reasons.push(`Tracking coverage is only ${Math.round(gf.trackingCoverage * 100)}%.`);
    if (gf.confidenceAvg > 0 && gf.confidenceAvg < t.weakConfidenceAvgMax)
      reasons.push("Average gaze confidence is weak.");
    if (reasons.length === 0) reasons.push("Gaze data exists but is not strong enough to classify confidently.");
  }

  return verdict;
}

function hasSyntheticGazeSignals(gf: NonNullable<ForensicSessionGazeProfile["features"]>): boolean {
  const t = FORENSIC_PROFILE_THRESHOLDS.gaze;
  return (
    (gf.blinkCount === 0 && gf.pointCount > t.syntheticNoBlinkPointCountMin) ||
    gf.fixationCount === 0 ||
    (gf.avgFixationMs > 0 && gf.avgFixationMs < t.syntheticFastFixationMsMax && gf.fixationCount >= 3) ||
    (gf.fixationCount >= 6 && gf.fixationCoefficientOfVariation < t.syntheticFixationCvMax) ||
    (gf.pointCount > 80 && gf.readingPatternScore < t.syntheticReadingScoreMax) ||
    (gf.pointCount > 80 && gf.anchorHitRatio < t.syntheticAnchorHitRatioMax)
  );
}

function collectSyntheticGazeReasons(gf: NonNullable<ForensicSessionGazeProfile["features"]>, reasons: string[]): void {
  const t = FORENSIC_PROFILE_THRESHOLDS.gaze;
  if (gf.blinkCount === 0 && gf.pointCount > t.syntheticNoBlinkPointCountMin)
    reasons.push("No blinks were detected across sustained gaze tracking.");
  if (gf.fixationCount === 0) reasons.push("Gaze points were captured without any fixations.");
  if (gf.avgFixationMs > 0 && gf.avgFixationMs < t.syntheticFastFixationMsMax && gf.fixationCount >= 3)
    reasons.push(`Average fixation duration ${Math.round(gf.avgFixationMs)}ms is below human limits.`);
  if (gf.fixationCount >= 6 && gf.fixationCoefficientOfVariation < t.syntheticFixationCvMax)
    reasons.push("Fixation durations cluster too tightly to look natural.");
  if (gf.pointCount > 80 && gf.readingPatternScore < t.syntheticReadingScoreMax)
    reasons.push("Gaze motion does not resemble reading progression.");
  if (gf.pointCount > 80 && gf.anchorHitRatio < t.syntheticAnchorHitRatioMax)
    reasons.push("Gaze rarely lands on instrumented document elements.");
}

interface CollectSignalsInput {
  typing: ForensicSessionTypingProfile;
  signature: ForensicSessionSignatureProfile | null;
  gazeVerdict: ForensicSessionGazeProfile["verdict"];
  gazeReasons: string[];
  liveness: ForensicSessionLivenessProfile;
  behavioral: BehavioralSignals;
  replay: ForensicReplayTape | null | undefined;
  scrollCount: number;
}

function collectTypingSignal(typing: ForensicSessionTypingProfile): ForensicSessionSignal | null {
  if (typing.verdict === "bot")
    return {
      code: "UNIFORM_TYPING",
      source: "agent",
      weight: 0.18,
      message: typing.reason,
    };
  if (typing.verdict === "human")
    return {
      code: "NATURAL_TYPING",
      source: "human",
      weight: 0.14,
      message: typing.reason,
    };
  return null;
}

function collectSignatureSignal(signature: ForensicSessionSignatureProfile | null): ForensicSessionSignal | null {
  if (signature?.verdict === "bot")
    return {
      code: "SIGNATURE_SYNTHETIC",
      source: "agent",
      weight: 0.28,
      message: signature.reason,
    };
  if (signature?.verdict === "human")
    return {
      code: "SIGNATURE_MANUAL",
      source: "human",
      weight: 0.24,
      message: signature.reason,
    };
  return null;
}

function collectGazeSignal(
  gazeVerdict: ForensicSessionGazeProfile["verdict"],
  gazeReasons: string[],
  gazeTrackingActive: boolean,
): ForensicSessionSignal | null {
  const gazeSignalMap: Record<string, ForensicSessionSignal | null> = {
    absent: {
      code: "GAZE_ABSENT",
      source: "agent",
      weight: 0.24,
      message: gazeReasons[0] ?? "Gaze tracking captured no usable data.",
    },
    synthetic: {
      code: "GAZE_SYNTHETIC",
      source: "agent",
      weight: 0.34,
      message: gazeReasons.join(" "),
    },
    natural: {
      code: "GAZE_NATURAL",
      source: "human",
      weight: 0.26,
      message: gazeReasons.join(" "),
    },
  };
  const mapped = gazeSignalMap[gazeVerdict];
  if (mapped) return mapped;
  if (gazeTrackingActive)
    return {
      code: "GAZE_WEAK",
      source: "agent",
      weight: 0.08,
      message: gazeReasons.join(" "),
    };
  return null;
}

function collectLivenessSignal(
  liveness: ForensicSessionLivenessProfile,
  gazeTrackingActive: boolean,
): ForensicSessionSignal | null {
  if (liveness.available && liveness.verdict === "passed")
    return {
      code: "GAZE_LIVENESS_PASSED",
      source: "human",
      weight: 0.22,
      message: liveness.reasons.join(" "),
    };
  if (liveness.available && liveness.verdict === "failed")
    return {
      code: "GAZE_LIVENESS_FAILED",
      source: "agent",
      weight: 0.28,
      message: liveness.reasons.join(" "),
    };
  if (!liveness.available && gazeTrackingActive)
    return {
      code: "GAZE_LIVENESS_MISSING",
      source: "agent",
      weight: 0.08,
      message: liveness.reasons.join(" "),
    };
  return null;
}

function collectSignals({
  typing,
  signature,
  gazeVerdict,
  gazeReasons,
  liveness,
  behavioral,
  replay,
  scrollCount,
}: CollectSignalsInput): ForensicSessionSignal[] {
  const signals: ForensicSessionSignal[] = [];

  const maybeTyping = collectTypingSignal(typing);
  if (maybeTyping) signals.push(maybeTyping);

  const maybeSig = collectSignatureSignal(signature);
  if (maybeSig) signals.push(maybeSig);

  const maybeGaze = collectGazeSignal(gazeVerdict, gazeReasons, behavioral.gazeTrackingActive);
  if (maybeGaze) signals.push(maybeGaze);

  const maybeLiveness = collectLivenessSignal(liveness, behavioral.gazeTrackingActive);
  if (maybeLiveness) signals.push(maybeLiveness);

  if (behavioral.mouseMoveCount === 0 && behavioral.clickCount > 0)
    signals.push({
      code: "NO_MOUSE_WITH_CLICKS",
      source: "agent",
      weight: 0.2,
      message: "Clicks occurred without any recorded mouse movement.",
    });

  if (behavioral.timeOnPage < 3000 && behavioral.keyPressCount > 10)
    signals.push({
      code: "RAPID_HIGH_ACTIVITY",
      source: "agent",
      weight: 0.14,
      message: "The session compressed substantial typing into an extremely short duration.",
    });

  if ((replay?.metrics.eventCount ?? 0) >= 12 || behavioral.mouseMoveCount >= 20 || scrollCount >= 3)
    signals.push({
      code: "RICH_MANUAL_ACTIVITY",
      source: "human",
      weight: 0.1,
      message: "Replay shows rich manual scrolling, pointer movement, or page interaction.",
    });

  return signals;
}

export function buildForensicSessionProfile(behavioral: BehavioralSignals): ForensicSessionProfile {
  const typing = buildTypingProfile(behavioral.typingCadence ?? []);
  const replay = behavioral.replay;
  const events = replay ? decodeForensicReplay(replay) : [];
  const signature = buildSignatureProfile(replay);
  const gaze = buildGazeProfile(behavioral, replay);
  const liveness = buildLivenessProfile(behavioral);
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

  const signals = collectSignals({
    typing,
    signature,
    gazeVerdict: gaze.verdict,
    gazeReasons: gaze.reasons,
    liveness,
    behavioral,
    replay,
    scrollCount,
  });

  return buildProfileResult({
    typing,
    signature,
    gaze,
    liveness,
    signals,
    behavioral,
    replay,
    events,
    scrollCount,
    fieldCommitCount,
    clipboardCount,
    keyEventCount,
    signatureEventCount,
    firstReplayEventMs,
    firstKeyMs,
    firstSignatureMs,
  });
}

interface BuildProfileResultInput {
  typing: ForensicSessionTypingProfile;
  signature: ForensicSessionSignatureProfile | null;
  gaze: ForensicSessionGazeProfile;
  liveness: ForensicSessionLivenessProfile;
  signals: ForensicSessionSignal[];
  behavioral: BehavioralSignals;
  replay: ForensicReplayTape | null | undefined;
  events: { at: number; type: string }[];
  scrollCount: number;
  fieldCommitCount: number;
  clipboardCount: number;
  keyEventCount: number;
  signatureEventCount: number;
  firstReplayEventMs: number | null;
  firstKeyMs: number | null;
  firstSignatureMs: number | null;
}

function buildProfileResult({
  typing,
  signature,
  gaze,
  liveness,
  signals,
  behavioral,
  replay,
  events: _events,
  scrollCount,
  fieldCommitCount,
  clipboardCount,
  keyEventCount,
  signatureEventCount,
  firstReplayEventMs,
  firstKeyMs,
  firstSignatureMs,
}: BuildProfileResultInput): ForensicSessionProfile {
  return {
    typing,
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
    gaze,
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

// Re-export baseline profile builder from dedicated module
export { buildSignerBaselineProfile } from "./session-baseline";
