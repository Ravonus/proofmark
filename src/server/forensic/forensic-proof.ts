// @ts-nocheck -- dynamic premium module imports are untyped; full type coverage deferred until premium types are exported

import {
  type AutomationReview,
  type DocumentAutomationPolicy,
  type EnhancedForensicEvidence,
  type ForensicPdfSummary,
  type ForensicStorageAnchorRef,
  type ForensicStorageMetadata,
  normalizeDocumentAutomationPolicy,
} from "~/lib/forensic/premium";
import {
  buildForensicSessionProfile,
  buildSignerBaselineProfile,
  type PersistedForensicSessionCapture,
} from "~/lib/forensic/session";
import type { ForensicEvidence } from "~/lib/forensic/types";
import { computeIpfsCid, computeSha256 } from "~/lib/ipfs";
import { loadPremiumChains } from "~/lib/platform/premium";
import { logger } from "~/lib/utils/logger";
import type { ReplayTapeVerification } from "~/server/crypto/rust-engine";
import { applyAutomationPolicy, reviewForensicAutomation } from "~/server/forensic/automation-review";

type ProofMode = "PRIVATE" | "HYBRID" | "CRYPTO_NATIVE";

type EnrichForensicEvidenceParams = {
  evidence: ForensicEvidence;
  proofMode: ProofMode;
  automationPolicy?: Partial<DocumentAutomationPolicy> | null;
  reviewContext?: {
    signMethod?: "WALLET" | "EMAIL_OTP";
    hasHandSignature?: boolean;
  };
  /** Context for inline AI review when aiReviewInline policy is enabled */
  aiReviewContext?: {
    documentTitle?: string;
    signerLabel?: string;
    ownerAddress?: string;
    documentId?: string;
  };
  priorSessions?: PersistedForensicSessionCapture[] | null;
};

type AnchorResult = {
  base?: { txHash: string; blockNumber: number };
  baseError?: string;
  sol?: { txHash: string; slot: number };
  solError?: string;
  btc: "queued";
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, inner]) => [key, stableValue(inner)]),
    );
  }
  return value;
}

function stableStringify(value: unknown) {
  return JSON.stringify(stableValue(value));
}

function compact(value: string, prefix = 18, suffix = 12) {
  if (value.length <= prefix + suffix + 3) return value;
  return `${value.slice(0, prefix)}...${value.slice(-suffix)}`;
}

function buildAnchorRefs(anchorResult: AnchorResult | null): ForensicStorageAnchorRef[] {
  if (!anchorResult) {
    return [
      { chain: "base", status: "unavailable" },
      { chain: "sol", status: "unavailable" },
      { chain: "btc", status: "unavailable" },
    ];
  }

  return [
    anchorResult.base
      ? {
          chain: "base",
          status: "anchored",
          txHash: anchorResult.base.txHash,
          blockNumber: anchorResult.base.blockNumber,
        }
      : anchorResult.baseError
        ? { chain: "base", status: "error", error: anchorResult.baseError }
        : { chain: "base", status: "unavailable" },
    anchorResult.sol
      ? {
          chain: "sol",
          status: "anchored",
          txHash: anchorResult.sol.txHash,
          slot: anchorResult.sol.slot,
        }
      : anchorResult.solError
        ? { chain: "sol", status: "error", error: anchorResult.solError }
        : { chain: "sol", status: "unavailable" },
    anchorResult.btc === "queued" ? { chain: "btc", status: "queued" } : { chain: "btc", status: "unavailable" },
  ];
}

function buildPdfSummary(params: {
  evidence: EnhancedForensicEvidence;
  hash: string;
  cid: string;
  storage: ForensicStorageMetadata;
}): ForensicPdfSummary {
  const { evidence, hash, cid, storage } = params;
  const replay = evidence.behavioral.replay;
  const review = evidence.automationReview;
  const outcome = evidence.policyOutcome;
  const anchorSummary = storage.anchors
    .map((anchor) => {
      if (anchor.status === "anchored") return `${anchor.chain.toUpperCase()}:${compact(anchor.txHash ?? "", 10, 8)}`;
      if (anchor.status === "queued") return `${anchor.chain.toUpperCase()}:QUEUED`;
      if (anchor.status === "error") return `${anchor.chain.toUpperCase()}:ERROR`;
      return `${anchor.chain.toUpperCase()}:NA`;
    })
    .join(" | ");

  if (storage.mode === "external_cid") {
    return {
      mode: storage.mode,
      lines: [
        "Forensic mode: external object",
        `Object CID: ${compact(cid, 20, 14)}`,
        `Anchor hash: ${compact(hash, 18, 12)}`,
        `Anchors: ${anchorSummary}`,
        `Automation: ${(review?.verdict ?? "uncertain").toUpperCase()} @ ${Math.round((review?.confidence ?? 0) * 100)}%`,
        `Policy: ${outcome?.action ?? "ALLOW"}${outcome?.blocked ? " (BLOCKED)" : ""}`,
      ],
    };
  }

  return {
    mode: storage.mode,
    lines: [
      `Evidence SHA-256: ${hash}`,
      `Object CID: ${cid}`,
      `Time on page: ${Math.max(1, Math.round(evidence.behavioral.timeOnPage / 1000))}s, Scroll: ${evidence.behavioral.maxScrollDepth}%`,
      replay
        ? `Replay: ${replay.metrics.eventCount} events, ${replay.metrics.byteLength} bytes, ${replay.metrics.signatureStrokeCount} strokes`
        : "Replay: not captured",
      evidence.sessionProfile?.liveness.available
        ? `Liveness: ${evidence.sessionProfile.liveness.verdict.toUpperCase()} @ ${Math.round(evidence.sessionProfile.liveness.passRatio * 100)}%`
        : "Liveness: not captured",
      evidence.signerBaseline
        ? `Signer baseline: ${evidence.signerBaseline.verdict.toUpperCase()} (${evidence.signerBaseline.sampleCount} prior sessions)`
        : "Signer baseline: unavailable",
      `Clipboard: paste ${evidence.behavioral.pasteEvents}, copy ${evidence.behavioral.copyEvents}, cut ${evidence.behavioral.cutEvents}`,
      `Automation: ${(review?.verdict ?? "uncertain").toUpperCase()} / policy ${outcome?.action ?? "ALLOW"}`,
    ],
  };
}

async function validateReplayTape(params: EnrichForensicEvidenceParams): Promise<ReplayTapeVerification | null> {
  const replay = params.evidence.behavioral.replay;
  if (!replay?.tapeBase64) return null;

  try {
    const { validateReplayTape: validate } = await import("~/server/crypto/rust-engine");
    const result = await validate(
      replay.tapeBase64,
      replay.metrics as unknown as Record<string, unknown>,
      params.evidence.behavioral as unknown as Record<string, unknown>,
    );
    if (result.mismatches.length > 0) {
      for (const m of result.mismatches) {
        params.evidence.flags.push({
          code: "REPLAY_METRICS_MISMATCH",
          severity: m.severity as "info" | "warn" | "critical",
          message: m.message,
        });
      }
      logger.warn("forensic", `Replay tape validation found ${result.mismatches.length} metric mismatches`);
    }
    if (result.anomalies.length > 0) {
      for (const a of result.anomalies) {
        params.evidence.flags.push({
          code: a.code,
          severity: a.severity as "info" | "warn" | "critical",
          message: a.message,
        });
      }
      logger.warn("forensic", `Replay tape validation found ${result.anomalies.length} anomalies`);
    }
    return result;
  } catch (err) {
    logger.warn("forensic", `Replay tape validation failed (non-blocking): ${String(err)}`);
    return null;
  }
}

async function runInlineAiReview(
  heuristicReview: AutomationReview,
  enrichedBaseEvidence: EnhancedForensicEvidence,
  params: EnrichForensicEvidenceParams,
): Promise<{ review: AutomationReview; aiReview: AutomationReview | null }> {
  const policy = normalizeDocumentAutomationPolicy(params.automationPolicy);
  if (!policy.aiReviewInline) {
    return { review: heuristicReview, aiReview: null };
  }

  try {
    const automationMod = await import("~/generated/premium/ai/automation-review");
    const keyMod = await import("~/generated/premium/ai/key-resolver");
    const providers = keyMod.getPlatformProviders().filter((p) => p.available);
    const first = providers[0];
    if (!first) return { review: heuristicReview, aiReview: null };

    const ownerAddress = params.aiReviewContext?.ownerAddress ?? "system";
    const resolved = await keyMod.resolveKeyWithFallback(ownerAddress, first.provider);
    if (!resolved) return { review: heuristicReview, aiReview: null };

    const result = await automationMod.reviewAutomationEvidence({
      ownerAddress,
      documentId: params.aiReviewContext?.documentId,
      provider: first.provider,
      model: resolved.model,
      key: resolved.key,
      documentTitle: params.aiReviewContext?.documentTitle,
      signerLabel: params.aiReviewContext?.signerLabel,
      evidence: {
        ...enrichedBaseEvidence,
        automationReview: heuristicReview,
      } as EnhancedForensicEvidence,
      policy: params.automationPolicy,
    });
    const aiReview = result.review as AutomationReview;
    // Use the stricter verdict between heuristic and AI
    const review =
      aiReview.automationScore > heuristicReview.automationScore
        ? { ...aiReview, source: "hybrid" as const }
        : { ...heuristicReview, source: "hybrid" as const };
    return { review, aiReview };
  } catch (err) {
    logger.warn("forensic", `Inline AI review failed, using heuristic only: ${String(err)}`);
    return { review: heuristicReview, aiReview: null };
  }
}

function applyAiAgentVerdictPolicy(
  aiReview: AutomationReview | null,
  policyOutcome: ReturnType<typeof applyAutomationPolicy>,
  automationPolicy: Partial<DocumentAutomationPolicy> | null | undefined,
): ReturnType<typeof applyAutomationPolicy> {
  const policy = normalizeDocumentAutomationPolicy(automationPolicy);
  if (!aiReview || !policy.aiReviewInline || policy.onAiAgentVerdict === "ALLOW") {
    return policyOutcome;
  }

  const aiVerdict = aiReview.verdict?.toLowerCase();
  if (aiVerdict !== "agent") return policyOutcome;

  if (policy.onAiAgentVerdict === "DENY" && !policyOutcome.blocked) {
    return {
      action: "DENY",
      blocked: true,
      notifyCreator: policy.notifyCreator,
      reason: "AI review classified this signing session as automated and the document policy requires human signers.",
      policy,
    };
  }
  if (policy.onAiAgentVerdict === "FLAG" && policyOutcome.action === "ALLOW") {
    return {
      action: "FLAG",
      blocked: false,
      notifyCreator: policy.notifyCreator,
      reason: "AI review classified this signing session as automated. Flagged for creator review.",
      policy,
    };
  }
  return policyOutcome;
}

async function anchorToChains(
  proofMode: ProofMode,
  objectHash: string,
): Promise<{ anchorResult: AnchorResult | null; useExternalObject: boolean }> {
  if (proofMode === "PRIVATE") {
    return { anchorResult: null, useExternalObject: false };
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- loadPremiumChains returns dynamic untyped module
  const chains = await loadPremiumChains();
  if (!chains) return { anchorResult: null, useExternalObject: false };

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- dynamic premium chains module
    const anchorResult: AnchorResult = await chains.autoAnchorToAllChains(objectHash); // eslint-disable-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return { anchorResult, useExternalObject: true };
  } catch {
    return { anchorResult: null, useExternalObject: true };
  }
}

export async function enrichForensicEvidence(params: EnrichForensicEvidenceParams): Promise<{
  evidence: EnhancedForensicEvidence;
  hash: string;
  canonicalObject: string;
}> {
  const priorSessions = params.priorSessions ?? [];
  const sessionProfile = buildForensicSessionProfile(params.evidence.behavioral);
  const signerBaseline = buildSignerBaselineProfile(params.evidence.behavioral, priorSessions);

  const replayValidation = await validateReplayTape(params);

  const enrichedBaseEvidence: EnhancedForensicEvidence = {
    ...params.evidence,
    sessionProfile,
    signerBaseline,
    forensicSessions: priorSessions,
    replayValidation: replayValidation ?? undefined,
  };
  const heuristicReview = reviewForensicAutomation(enrichedBaseEvidence, params.reviewContext);

  const { review, aiReview } = await runInlineAiReview(heuristicReview, enrichedBaseEvidence, params);

  const basePolicyOutcome = applyAutomationPolicy(review, params.automationPolicy);
  const policyOutcome = applyAiAgentVerdictPolicy(aiReview, basePolicyOutcome, params.automationPolicy);

  const canonicalPayload = stableStringify({
    ...enrichedBaseEvidence,
    evidenceHash: undefined,
    automationReview: review,
    policyOutcome,
  });
  const objectHash = computeSha256(canonicalPayload);
  const objectCid = await computeIpfsCid(canonicalPayload);

  const { anchorResult, useExternalObject } = await anchorToChains(params.proofMode, objectHash);

  const anchorRefs = buildAnchorRefs(anchorResult);
  const storage: ForensicStorageMetadata = {
    version: 1,
    mode: useExternalObject ? "external_cid" : "embedded_pdf",
    objectCid,
    objectHash,
    byteLength: Buffer.byteLength(canonicalPayload, "utf8"),
    recordedAt: new Date().toISOString(),
    anchors: anchorRefs,
    anchored: anchorRefs.some((anchor) => anchor.status === "anchored"),
  };

  const evidence: EnhancedForensicEvidence = {
    ...enrichedBaseEvidence,
    evidenceHash: objectHash,
    automationReview: review,
    policyOutcome,
    storage,
  };
  evidence.pdfSummary = buildPdfSummary({
    evidence,
    hash: objectHash,
    cid: objectCid,
    storage,
  });

  return { evidence, hash: objectHash, canonicalObject: canonicalPayload };
}
