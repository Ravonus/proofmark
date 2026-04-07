/**
 * AI feature implementations — scraper fix, editor chat, signer Q&A, summary.
 *
 * Each function: build prompt → call provider → parse response.
 * All share the same pattern: return domain result + raw response metadata.
 */

import type { AiRequestContext, AiRawResponse, AiProviderName } from "./types";
import { toRawResponse } from "./types";
import type { AiChatMessage, AiEditOperation } from "../../src/server/db/schema";
import { complete } from "./provider-client";

// ── Result types ──

export interface AiScraperResult {
  corrected: unknown;
  changes: Array<{ field: string; before: unknown; after: unknown; reason: string }>;
  response: AiRawResponse;
}

export interface AiChatResult {
  response: { text: string; editOperations?: AiEditOperation[] };
  raw: AiRawResponse;
}

export interface AiAnswerResult {
  answer: string;
  raw: AiRawResponse;
}

export interface AiSummaryResult {
  summary: string;
  raw: AiRawResponse;
}

// ── Scraper Fix ──

export async function fixScraperOutput(
  rCtx: AiRequestContext,
  analysisResult: unknown,
  rawContent?: string,
): Promise<AiScraperResult> {
  const response = await complete(
    {
      provider: rCtx.provider,
      model: rCtx.model,
      messages: [
        { role: "system", content: "You are a document analysis correction specialist. Respond only with valid JSON." },
        {
          role: "user",
          content: [
            "A PDF was analyzed by an automated scraper, but the output may contain errors.",
            "",
            "## Scraper Output",
            JSON.stringify(analysisResult, null, 2),
            rawContent ? `\n## Raw PDF Text (first 5000 chars)\n${rawContent.slice(0, 5000)}` : "",
            "",
            "## Instructions",
            'Return JSON: { "corrected": <fixed analysis>, "changes": [{ "field", "before", "after", "reason" }] }',
            "Fix: wrong doc types, bad field types, wrong signer counts, garbled text, missing signatures.",
          ].join("\n"),
        },
      ],
      maxTokens: 4000,
      temperature: 0.1,
      responseFormat: "json",
    },
    rCtx.key,
  );

  let parsed: { corrected: unknown; changes: AiScraperResult["changes"] };
  try {
    parsed = JSON.parse(response.content);
  } catch {
    parsed = { corrected: analysisResult, changes: [] };
  }

  return {
    corrected: parsed.corrected ?? analysisResult,
    changes: parsed.changes ?? [],
    response: toRawResponse(response),
  };
}

// ── Editor Chat ──

export async function chat(
  params: AiRequestContext & {
    documentTitle: string;
    tokens: unknown[];
    signerCount: number;
    signerLabels: string[];
    selectedRange?: { start: number; end: number };
    userMessage: string;
    conversationHistory: AiChatMessage[];
  },
): Promise<AiChatResult> {
  const systemPrompt = `You are an AI document editing assistant for Proofmark. You help users draft, edit, and improve documents.

Document: "${params.documentTitle}"
Signers: ${params.signerLabels.join(", ")} (${params.signerCount} total)

Available edit operations: insert_token, delete_token, update_token, update_field, add_field, remove_field.
To suggest edits, append a JSON array in <edits>...</edits> tags at the end.
If no edits are needed, just respond with text. Be concise and professional.`;

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    ...params.conversationHistory.slice(-10).map((m) => ({ role: m.role, content: m.content })),
  ];

  // Include selected text context if the user highlighted something
  let userContent = params.userMessage;
  if (params.selectedRange) {
    const selected = params.tokens.slice(params.selectedRange.start, params.selectedRange.end + 1);
    userContent = `[Selected text: ${JSON.stringify(selected)}]\n\n${params.userMessage}`;
  }
  messages.push({ role: "user", content: userContent });

  const response = await complete(
    { provider: params.provider, model: params.model, messages, maxTokens: 3000, temperature: 0.5 },
    params.key,
  );

  // Extract inline edit operations if present
  let text = response.content;
  let editOperations: AiEditOperation[] | undefined;
  const match = text.match(/<edits>([\s\S]*?)<\/edits>/);
  if (match) {
    text = text.replace(/<edits>[\s\S]*?<\/edits>/, "").trim();
    try { editOperations = JSON.parse(match[1]!); } catch { /* malformed — skip */ }
  }

  return {
    response: { text, editOperations },
    raw: toRawResponse(response),
  };
}

// ── Signer Q&A ──

export async function answerQuestion(
  params: AiRequestContext & {
    documentTitle: string;
    documentContent: string;
    signerLabel: string;
    signerRole?: string | null;
    signerFields: Array<{ type: string; label: string; required: boolean }>;
    allSignerLabels: string[];
    question: string;
    conversationHistory: AiChatMessage[];
  },
): Promise<AiAnswerResult> {
  const fields = params.signerFields
    .map((f) => `${f.label} (${f.type}${f.required ? ", required" : ""})`)
    .join(", ");

  const systemPrompt = `You help signers understand documents on Proofmark.

Document: "${params.documentTitle}"
Helping: "${params.signerLabel}"${params.signerRole ? ` (${params.signerRole})` : ""}
Other signers: ${params.allSignerLabels.join(", ")}
Fields to fill: ${fields}

## Document Content
${params.documentContent.slice(0, 8000)}

Rules: answer clearly, highlight important clauses, never give legal advice, stay on-topic.`;

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    ...params.conversationHistory.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: params.question },
  ];

  const response = await complete(
    { provider: params.provider, model: params.model, messages, maxTokens: 2000, temperature: 0.3 },
    params.key,
  );

  return { answer: response.content, raw: toRawResponse(response) };
}

// ── Document Summary ──

export async function generateSummary(
  params: AiRequestContext & {
    documentTitle: string;
    documentContent: string;
    signerLabel: string;
    signerRole?: string | null;
    signerFields: Array<{ type: string; label: string; required: boolean }>;
    allSignerLabels: string[];
    conversationHistory: AiChatMessage[];
  },
): Promise<AiSummaryResult> {
  const response = await complete(
    {
      provider: params.provider,
      model: params.model,
      messages: [
        { role: "system", content: "You are a document summarization assistant. Be clear, concise, and factual." },
        {
          role: "user",
          content: [
            `Summarize this document for signer "${params.signerLabel}".`,
            `Document: "${params.documentTitle}"`,
            params.signerRole ? `Role: ${params.signerRole}` : "",
            `Other parties: ${params.allSignerLabels.join(", ")}`,
            "",
            "## Document Content",
            params.documentContent.slice(0, 8000),
            "",
            "## Format",
            "1. Document type (1 sentence)",
            `2. Key obligations/rights for "${params.signerLabel}" (3-5 bullets)`,
            "3. Important dates, deadlines, conditions",
            "4. Unusual or noteworthy clauses",
            `5. Fields "${params.signerLabel}" needs to fill`,
            "",
            "Under 500 words. Plain language. No legal advice.",
          ].filter(Boolean).join("\n"),
        },
      ],
      maxTokens: 1500,
      temperature: 0.2,
    },
    params.key,
  );

  return { summary: response.content, raw: toRawResponse(response) };
}
