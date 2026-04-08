import {
  type AutomationAssessment,
  type AutomationPolicyOutcome,
  type AutomationReview,
  type AutomationReviewIndicator,
  type AutomationReviewStage,
  DEFAULT_DOCUMENT_AUTOMATION_POLICY,
  type DocumentAutomationPolicy,
  type EnhancedForensicEvidence,
  normalizeDocumentAutomationPolicy,
} from "~/lib/forensic/premium";
import { buildForensicSessionProfile } from "~/lib/forensic/session";
import type { BehavioralSignals, ForensicFlag } from "~/lib/forensic/types";
import { buildCriticalIndicators } from "./automation-review-indicators";

type AutomationReviewContext = {
  signMethod?: "WALLET" | "EMAIL_OTP";
  hasHandSignature?: boolean;
};

type IndicatorPush = (indicator: AutomationReviewIndicator) => void;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function scoreToVerdict(score: number): AutomationAssessment {
  if (score >= 0.72) return "agent";
  if (score <= 0.22) return "human";
  return "uncertain";
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

function variance(values: number[]) {
  if (values.length < 2) return 0;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PREPARATION INDICATORS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildPreparationIndicators(
  evidence: EnhancedForensicEvidence,
  behavioral: BehavioralSignals,
  flags: ForensicFlag[],
  profile: ReturnType<typeof buildForensicSessionProfile>,
): AutomationReviewIndicator[] {
  const indicators: AutomationReviewIndicator[] = [];
  const push: IndicatorPush = (i) => indicators.push(i);

  checkPrepTiming(push, behavioral);
  checkPrepInput(push, behavioral);
  checkPrepReplay(push, behavioral);
  checkPrepFlags(push, flags);
  checkPrepProfile(push, profile);
  checkPrepGaze(push, behavioral, profile);
  checkPrepBaseline(push, evidence);

  return indicators;
}

function checkPrepTiming(push: IndicatorPush, b: BehavioralSignals): void {
  if (b.timeOnPage > 0 && b.timeOnPage < 4_000) {
    push({
      code: "RAPID_COMPLETION",
      severity: "warn",
      stage: "preparation",
      score: 0.24,
      message: `Session completed in ${Math.max(1, Math.round(b.timeOnPage / 1000))}s.`,
    });
  }
}

function checkPrepInput(push: IndicatorPush, b: BehavioralSignals): void {
  if (b.pasteEvents > 0 && b.keyPressCount <= Math.max(2, b.pasteEvents * 2)) {
    push({
      code: "PASTE_HEAVY_PREP",
      severity: "warn",
      stage: "preparation",
      score: 0.28,
      message: "Field preparation relied heavily on paste activity instead of incremental typing.",
    });
  }
  if (b.copyEvents + b.cutEvents + b.pasteEvents >= Math.max(2, b.keyPressCount)) {
    push({
      code: "CLIPBOARD_DOMINANT",
      severity: "info",
      stage: "preparation",
      score: 0.2,
      message: "Clipboard operations dominated the preparation flow.",
    });
  }
  if (b.mouseMoveCount === 0 && b.clickCount <= 1 && b.focusChanges <= 1) {
    push({
      code: "LOW_POINTER_ACTIVITY",
      severity: "warn",
      stage: "preparation",
      score: 0.24,
      message: "Preparation showed almost no pointer or field-navigation activity.",
    });
  }
}

function checkPrepReplay(push: IndicatorPush, b: BehavioralSignals): void {
  if ((b.replay?.metrics.eventCount ?? 0) < 5) {
    push({
      code: "THIN_REPLAY",
      severity: "warn",
      stage: "preparation",
      score: 0.18,
      message: "Replay tape is unusually small for a full signing session.",
    });
  }
  const cadenceVariance = variance(b.typingCadence);
  if (b.typingCadence.length >= 5 && cadenceVariance < 80) {
    push({
      code: "UNIFORM_TYPING",
      severity: "info",
      stage: "preparation",
      score: 0.12,
      message: "Typing cadence is unusually uniform for manual entry.",
    });
  }
  if ((b.replay?.metrics.eventCount ?? 0) >= 12 || b.mouseMoveCount >= 12 || b.scrollPattern.length >= 3) {
    push({
      code: "MANUAL_PREP_SIGNALS",
      severity: "info",
      stage: "preparation",
      score: -0.12,
      message: "Preparation included rich manual scrolling, movement, or field interaction.",
    });
  }
}

function checkPrepFlags(push: IndicatorPush, flags: ForensicFlag[]): void {
  if (flags.some((flag) => flag.code === "WEBDRIVER_DETECTED")) {
    push({
      code: "WEBDRIVER_PREP",
      severity: "critical",
      stage: "preparation",
      score: 0.55,
      message: "Browser reported webdriver automation during preparation.",
    });
  }
}

function checkPrepProfile(push: IndicatorPush, profile: ReturnType<typeof buildForensicSessionProfile>): void {
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
}

function checkPrepGaze(
  push: IndicatorPush,
  b: BehavioralSignals,
  profile: ReturnType<typeof buildForensicSessionProfile>,
): void {
  if (!profile.gaze.active) return;
  if (profile.gaze.verdict === "absent") {
    push({
      code: "NO_GAZE_DATA",
      severity: "warn",
      stage: "preparation",
      score: 0.3,
      message: profile.gaze.reasons.join(" "),
    });
    return;
  }
  if (profile.gaze.verdict === "synthetic") {
    push({
      code: "SYNTHETIC_GAZE_PREP",
      severity: "warn",
      stage: "preparation",
      score: 0.28,
      message: profile.gaze.reasons.join(" "),
    });
    return;
  }
  if (profile.gaze.verdict === "weak") {
    push({
      code: "WEAK_GAZE_PREP",
      severity: "info",
      stage: "preparation",
      score: 0.1,
      message: profile.gaze.reasons.join(" "),
    });
    return;
  }
  if (profile.gaze.verdict === "natural") {
    const gazeF = profile.gaze.features;
    const sessionSec = (b.timeOnPage || 1) / 1000;
    const gazeRate = gazeF ? gazeF.pointCount / sessionSec : 0;
    const isPlausible = gazeRate >= 15 && (!gazeF || gazeF.readingPatternScore < 0.8);
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

function checkPrepBaseline(push: IndicatorPush, evidence: EnhancedForensicEvidence): void {
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
