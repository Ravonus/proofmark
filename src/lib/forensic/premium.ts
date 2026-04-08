import { z } from "zod";
import type { ReplayTapeVerification } from "~/server/crypto/rust-engine";
import type { ForensicSessionProfile, PersistedForensicSessionCapture, SignerBaselineProfile } from "./session";
import type { ForensicEvidence } from "./types";

// GazeBehaviorFeatures is defined inline to avoid hard dependency on premium gaze module
type GazeBehaviorFeatures = Record<string, unknown>;

export const automationDecisionSchema = z.enum(["ALLOW", "FLAG", "DENY"]);
export const automationAssessmentSchema = z.enum(["human", "agent", "mixed", "uncertain"]);
export const automationStageSchema = z.enum(["preparation", "critical"]);
export const automationHumanStepSchema = z.enum(["signature", "consent", "final_submit", "wallet_auth"]);

export const documentAutomationPolicySchema = z.object({
  enabled: z.boolean().default(true),
  onPreparationAutomation: z.enum(["ALLOW", "FLAG"]).default("ALLOW"),
  onCriticalAutomation: z.enum(["FLAG", "DENY"]).default("FLAG"),
  notifyCreator: z.boolean().default(true),
  requireHumanSteps: z
    .array(automationHumanStepSchema)
    .default(["signature", "consent", "final_submit", "wallet_auth"]),
  /** Run AI review inline during the signing request (premium). */
  aiReviewInline: z.boolean().default(false),
  /** Action when AI verdict is "agent". Only applies when aiReviewInline is true. */
  onAiAgentVerdict: z.enum(["ALLOW", "FLAG", "DENY"]).default("FLAG"),
});

export type AutomationDecision = z.infer<typeof automationDecisionSchema>;
export type AutomationAssessment = z.infer<typeof automationAssessmentSchema>;
export type AutomationStage = z.infer<typeof automationStageSchema>;
export type AutomationHumanStep = z.infer<typeof automationHumanStepSchema>;
export type DocumentAutomationPolicy = z.infer<typeof documentAutomationPolicySchema>;

export const DEFAULT_DOCUMENT_AUTOMATION_POLICY: DocumentAutomationPolicy = {
  enabled: true,
  onPreparationAutomation: "ALLOW",
  onCriticalAutomation: "FLAG",
  notifyCreator: true,
  requireHumanSteps: ["signature", "consent", "final_submit", "wallet_auth"],
  aiReviewInline: false,
  onAiAgentVerdict: "FLAG",
};

export function normalizeDocumentAutomationPolicy(
  input?: Partial<DocumentAutomationPolicy> | null,
): DocumentAutomationPolicy {
  return documentAutomationPolicySchema.parse({
    ...DEFAULT_DOCUMENT_AUTOMATION_POLICY,
    ...(input ?? {}),
  });
}

export type ForensicStorageMode = "embedded_pdf" | "external_cid";

export interface ForensicStorageAnchorRef {
  chain: "base" | "sol" | "btc";
  status: "anchored" | "queued" | "unavailable" | "error";
  txHash?: string | null;
  blockNumber?: number | null;
  slot?: number | null;
  error?: string | null;
}

export interface ForensicStorageMetadata {
  version: 1;
  mode: ForensicStorageMode;
  objectCid: string;
  objectHash: string;
  byteLength: number;
  recordedAt: string;
  anchored: boolean;
  anchors: ForensicStorageAnchorRef[];
}

export interface AutomationReviewIndicator {
  code: string;
  severity: "info" | "warn" | "critical";
  stage: AutomationStage;
  score: number;
  message: string;
}

export interface AutomationReviewStage {
  stage: AutomationStage;
  verdict: AutomationAssessment;
  score: number;
  reasons: string[];
}

export interface AutomationReviewComparedModel {
  provider: string;
  model: string;
  verdict: AutomationAssessment;
  confidence: number;
}

export interface AutomationReview {
  version: 1;
  source: "heuristic" | "ai" | "hybrid";
  verdict: AutomationAssessment;
  confidence: number;
  automationScore: number;
  recommendedAction: AutomationDecision;
  rationale: string;
  createdAt: string;
  stages: AutomationReviewStage[];
  indicators: AutomationReviewIndicator[];
  provider?: string;
  model?: string;
  comparedModels?: AutomationReviewComparedModel[];
}

export interface AutomationPolicyOutcome {
  action: AutomationDecision;
  blocked: boolean;
  notifyCreator: boolean;
  reason: string;
  policy: DocumentAutomationPolicy;
}

export interface ForensicPdfSummary {
  mode: ForensicStorageMode;
  lines: string[];
}

export type EnhancedForensicEvidence = ForensicEvidence & {
  storage?: ForensicStorageMetadata;
  automationReview?: AutomationReview;
  policyOutcome?: AutomationPolicyOutcome;
  pdfSummary?: ForensicPdfSummary;
  sessionProfile?: ForensicSessionProfile;
  signerBaseline?: SignerBaselineProfile | null;
  forensicSessions?: PersistedForensicSessionCapture[];
  replayValidation?: ReplayTapeVerification;
  gazeBehavior?: GazeBehaviorFeatures | null;
};
