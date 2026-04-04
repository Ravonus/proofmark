import { computeIpfsCid, computeSha256 } from "~/lib/ipfs";
import { loadPremiumChains } from "~/lib/premium";
import {
  normalizeDocumentAutomationPolicy,
  type AutomationReview,
  type DocumentAutomationPolicy,
  type EnhancedForensicEvidence,
  type ForensicPdfSummary,
  type ForensicStorageAnchorRef,
  type ForensicStorageMetadata,
} from "~/lib/forensic/premium";
import type { ForensicEvidence } from "~/lib/forensic/types";
import {
  buildForensicSessionProfile,
  buildSignerBaselineProfile,
  type PersistedForensicSessionCapture,
} from "~/lib/forensic/session";
import { applyAutomationPolicy, reviewForensicAutomation } from "~/server/automation-review";
import { logger } from "~/lib/logger";

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
      ? { chain: "sol", status: "anchored", txHash: anchorResult.sol.txHash, slot: anchorResult.sol.slot }
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

export async function enrichForensicEvidence(
  params: EnrichForensicEvidenceParams,
): Promise<{ evidence: EnhancedForensicEvidence; hash: string; canonicalObject: string }> {
  const priorSessions = params.priorSessions ?? [];
  const sessionProfile = buildForensicSessionProfile(params.evidence.behavioral);
  const signerBaseline = buildSignerBaselineProfile(params.evidence.behavioral, priorSessions);
  // ── Server-side replay tape validation ──────────────────────────────
  // Decode the binary tape in Rust and cross-check against claimed metrics.
  // Inject any mismatches/anomalies as forensic flags before automation review.
  let replayValidation: import("~/server/rust-engine").ReplayTapeVerification | null = null;
  const replay = params.evidence.behavioral.replay;
  if (replay?.tapeBase64) {
    try {
      const { validateReplayTape } = await import("~/server/rust-engine");
      replayValidation = await validateReplayTape(
        replay.tapeBase64,
        replay.metrics as unknown as Record<string, unknown>,
        params.evidence.behavioral as unknown as Record<string, unknown>,
      );
      // Inject mismatch flags into evidence.flags so automation review picks them up
      if (replayValidation.mismatches.length > 0) {
        for (const m of replayValidation.mismatches) {
          params.evidence.flags.push({
            code: "REPLAY_METRICS_MISMATCH",
            severity: m.severity as "info" | "warn" | "critical",
            message: m.message,
          });
        }
        logger.warn("forensic", `Replay tape validation found ${replayValidation.mismatches.length} metric mismatches`);
      }
      if (replayValidation.anomalies.length > 0) {
        for (const a of replayValidation.anomalies) {
          params.evidence.flags.push({
            code: a.code,
            severity: a.severity as "info" | "warn" | "critical",
            message: a.message,
          });
        }
        logger.warn("forensic", `Replay tape validation found ${replayValidation.anomalies.length} anomalies`);
      }
    } catch (err) {
      logger.warn("forensic", `Replay tape validation failed (non-blocking): ${String(err)}`);
    }
  }

  const enrichedBaseEvidence: EnhancedForensicEvidence = {
    ...params.evidence,
    sessionProfile,
    signerBaseline,
    forensicSessions: priorSessions,
    replayValidation: replayValidation ?? undefined,
  };
  const heuristicReview = reviewForensicAutomation(enrichedBaseEvidence, params.reviewContext);

  // Optionally run AI review inline during the signing request
  const policy = normalizeDocumentAutomationPolicy(params.automationPolicy);
  let review: AutomationReview = heuristicReview;
  let aiReview: AutomationReview | null = null;

  if (policy.aiReviewInline) {
    try {
      const { reviewAutomationEvidence } = await import("~/premium/ai/automation-review");
      const { getPlatformProviders, readPlatformEnv } = await import("~/premium/ai/key-resolver");
      const providers = getPlatformProviders().filter((p) => p.available);
      const first = providers[0];
      if (first) {
        const env = readPlatformEnv(first.provider);
        const result = await reviewAutomationEvidence({
          ownerAddress: params.aiReviewContext?.ownerAddress ?? "system",
          documentId: params.aiReviewContext?.documentId,
          provider: first.provider,
          model: first.defaultModel,
          key: {
            apiKey: env.apiKey ?? "",
            source: "platform" as const,
            provider: first.provider,
            baseUrl: env.baseUrl,
            organizationId: env.organizationId,
          },
          documentTitle: params.aiReviewContext?.documentTitle,
          signerLabel: params.aiReviewContext?.signerLabel,
          evidence: { ...enrichedBaseEvidence, automationReview: heuristicReview } as EnhancedForensicEvidence,
          policy: params.automationPolicy,
        });
        aiReview = result.review;
        // Use the stricter verdict between heuristic and AI
        if (aiReview.automationScore > heuristicReview.automationScore) {
          review = { ...aiReview, source: "hybrid" as const };
        } else {
          review = { ...heuristicReview, source: "hybrid" as const };
        }
      }
    } catch (err) {
      logger.warn("forensic", `Inline AI review failed, using heuristic only: ${String(err)}`);
    }
  }

  let policyOutcome = applyAutomationPolicy(review, params.automationPolicy);

  // Apply AI-specific policy action when AI says "agent"
  if (aiReview && policy.aiReviewInline && policy.onAiAgentVerdict !== "ALLOW") {
    const aiVerdict = aiReview.verdict?.toLowerCase();
    if (aiVerdict === "agent" && policy.onAiAgentVerdict === "DENY" && !policyOutcome.blocked) {
      policyOutcome = {
        action: "DENY",
        blocked: true,
        notifyCreator: policy.notifyCreator,
        reason:
          "AI review classified this signing session as automated and the document policy requires human signers.",
        policy,
      };
    } else if (aiVerdict === "agent" && policy.onAiAgentVerdict === "FLAG" && policyOutcome.action === "ALLOW") {
      policyOutcome = {
        action: "FLAG",
        blocked: false,
        notifyCreator: policy.notifyCreator,
        reason: "AI review classified this signing session as automated. Flagged for creator review.",
        policy,
      };
    }
  }

  const canonicalPayload = stableStringify({
    ...enrichedBaseEvidence,
    evidenceHash: undefined,
    automationReview: review,
    policyOutcome,
  });
  const objectHash = computeSha256(canonicalPayload);
  const objectCid = await computeIpfsCid(canonicalPayload);

  const chains = params.proofMode !== "PRIVATE" ? await loadPremiumChains() : null;
  let anchorResult: AnchorResult | null = null;
  const useExternalObject = params.proofMode !== "PRIVATE" && !!chains;
  if (useExternalObject && chains) {
    try {
      anchorResult = await chains.autoAnchorToAllChains(objectHash);
    } catch {
      anchorResult = null;
    }
  }

  const storage: ForensicStorageMetadata = {
    version: 1,
    mode: useExternalObject ? "external_cid" : "embedded_pdf",
    objectCid,
    objectHash,
    byteLength: Buffer.byteLength(canonicalPayload, "utf8"),
    recordedAt: new Date().toISOString(),
    anchors: buildAnchorRefs(anchorResult),
    anchored: buildAnchorRefs(anchorResult).some((anchor) => anchor.status === "anchored"),
  };

  const evidence: EnhancedForensicEvidence = {
    ...enrichedBaseEvidence,
    evidenceHash: objectHash,
    automationReview: review,
    policyOutcome,
    storage,
  };
  evidence.pdfSummary = buildPdfSummary({ evidence, hash: objectHash, cid: objectCid, storage });

  return { evidence, hash: objectHash, canonicalObject: canonicalPayload };
}
