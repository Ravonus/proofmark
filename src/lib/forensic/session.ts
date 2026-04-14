import { buildForensicSessionProfile } from "./session-profile";
import type { BehavioralSignals, ForensicReplayTape } from "./types";

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
export function extractGazeBehaviorFeatures(_replay: ForensicReplayTape): GazeBehaviorFeatures | null {
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

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

export { buildForensicSessionProfile, buildSignerBaselineProfile } from "./session-profile";

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
