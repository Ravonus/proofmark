import type { ForensicSessionProfile, SignerBaselineComparison, SignerBaselineProfile } from "./session";
import { buildForensicSessionProfile } from "./session-profile";
import { FORENSIC_PROFILE_THRESHOLDS } from "./thresholds";
import type { BehavioralSignals } from "./types";

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

function relativeDeviation(current: number, baseline: number) {
  if (baseline === 0) return Math.abs(current - baseline);
  return Math.abs(current - baseline) / Math.abs(baseline);
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

function compareBaselineMetric(
  metric: string,
  stage: "preparation" | "critical",
  current: number | null | undefined,
  previous: Array<number | null | undefined>,
): { comparison: SignerBaselineComparison; deviates: boolean } | null {
  if (current == null || !Number.isFinite(current)) return null;
  const values = previous.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
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
  return {
    comparison: {
      metric,
      stage,
      current,
      baselineMean,
      baselineStdDev: baselineStdDevValue > 0 ? baselineStdDevValue : null,
      zScore,
      relativeDeviation: relative,
      deviates,
      message,
    },
    deviates,
  };
}

function buildBaselineMetricDefs(
  currentProfile: ForensicSessionProfile,
  priorProfiles: ForensicSessionProfile[],
): Array<{
  metric: string;
  stage: "preparation" | "critical";
  current: number | null;
  previous: Array<number | null>;
}> {
  return [
    {
      metric: "typing_delay_ms",
      stage: "preparation",
      current: currentProfile.typing.averageDelayMs || null,
      previous: priorProfiles.map((p) => p.typing.averageDelayMs || null),
    },
    {
      metric: "typing_cv",
      stage: "preparation",
      current: currentProfile.typing.coefficientOfVariation || null,
      previous: priorProfiles.map((p) => p.typing.coefficientOfVariation || null),
    },
    {
      metric: "session_duration_ms",
      stage: "preparation",
      current: currentProfile.timing.durationMs || null,
      previous: priorProfiles.map((p) => p.timing.durationMs || null),
    },
    {
      metric: "gaze_reading_score",
      stage: "critical",
      current: currentProfile.gaze.features?.readingPatternScore ?? null,
      previous: priorProfiles.map((p) => p.gaze.features?.readingPatternScore ?? null),
    },
    {
      metric: "gaze_liveness_pass_ratio",
      stage: "critical",
      current: currentProfile.liveness.available ? currentProfile.liveness.passRatio : null,
      previous: priorProfiles.map((p) => (p.liveness.available ? p.liveness.passRatio : null)),
    },
    {
      metric: "signature_complexity",
      stage: "critical",
      current: currentProfile.signature?.motionComplexityScore ?? null,
      previous: priorProfiles.map((p) => p.signature?.motionComplexityScore ?? null),
    },
  ];
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

  for (const def of buildBaselineMetricDefs(currentProfile, priorProfiles)) {
    const result = compareBaselineMetric(def.metric, def.stage, def.current, def.previous);
    if (!result) continue;
    comparisons.push(result.comparison);
    if (result.deviates) indicators.push(result.comparison.message);
  }

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
