/**
 * AI-powered forensic automation review.
 *
 * Analyzes signer behavioral evidence to determine whether a signing
 * was performed by a human or automated agent. Produces a structured
 * verdict with confidence, signals, and recommendation.
 */

import type { AiRequestContext, AiRawResponse, ForensicEvidence } from "./types";
import { toRawResponse } from "./types";
import { complete } from "./provider-client";

export interface AutomationReviewResult {
  review: {
    verdict: "human" | "automated" | "suspicious" | "inconclusive";
    confidence: number;
    reasoning: string;
    signals: Array<{
      signal: string;
      weight: "strong" | "moderate" | "weak";
      direction: "human" | "automated" | "neutral";
      detail: string;
    }>;
    recommendation: string;
  };
  raw: AiRawResponse;
}

// Evidence sections we include in the prompt (label → evidence key).
const EVIDENCE_SECTIONS: Array<[string, keyof ForensicEvidence]> = [
  ["Device Fingerprint", "deviceFingerprint"],
  ["Behavioral Signals", "behavioralSignals"],
  ["Canvas Challenge Result", "canvasChallenge"],
  ["Signature Replay Data", "signatureReplay"],
  ["Gaze Tracking Data", "gazeBehavior"],
  ["IP/Network Analysis", "ipAnalysis"],
  ["Policy Engine Outcome", "policyOutcome"],
];

function buildPrompt(documentTitle: string, signerLabel: string, evidence: ForensicEvidence, policy?: Record<string, unknown>): string {
  const parts = [
    `You are a forensic analyst reviewing signing evidence for document "${documentTitle}", signer "${signerLabel}".`,
    `Analyze the following evidence and determine whether this signing was performed by a human or an automated agent.`,
  ];

  for (const [label, key] of EVIDENCE_SECTIONS) {
    if (evidence[key]) parts.push(`\n## ${label}\n${JSON.stringify(evidence[key], null, 2)}`);
  }
  if (policy) parts.push(`\n## Signing Policy\n${JSON.stringify(policy, null, 2)}`);

  parts.push(`
## Instructions
Respond with a JSON object:
- "verdict": "human" | "automated" | "suspicious" | "inconclusive"
- "confidence": 0-100
- "reasoning": 2-4 sentence assessment
- "signals": [{ "signal", "weight": "strong"|"moderate"|"weak", "direction": "human"|"automated"|"neutral", "detail" }]
- "recommendation": actionable next step

Key indicators: stroke timing/velocity variance, canvas challenge pass/fail,
headless browser flags, VPN/proxy patterns, gaze naturalness, interaction cadence.

Respond ONLY with the JSON object.`);

  return parts.join("\n");
}

export async function reviewAutomationEvidence(
  params: AiRequestContext & {
    documentTitle: string;
    signerLabel: string;
    evidence: ForensicEvidence;
    policy?: Record<string, unknown>;
  },
): Promise<AutomationReviewResult> {
  const response = await complete(
    {
      provider: params.provider,
      model: params.model,
      messages: [
        { role: "system", content: "You are a forensic automation detection specialist. Respond only with valid JSON." },
        { role: "user", content: buildPrompt(params.documentTitle, params.signerLabel, params.evidence, params.policy) },
      ],
      maxTokens: 2000,
      temperature: 0.1,
      responseFormat: "json",
    },
    params.key,
  );

  let review: AutomationReviewResult["review"];
  try {
    review = JSON.parse(response.content);
  } catch {
    review = {
      verdict: "inconclusive",
      confidence: 0,
      reasoning: `AI response could not be parsed. Raw: ${response.content.slice(0, 200)}`,
      signals: [],
      recommendation: "Manual review required — AI output was unstructured",
    };
  }

  return { review, raw: toRawResponse(response) };
}
