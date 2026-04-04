/**
 * Proofmark Rust engine client — ALL heavy compute goes through the Rust microservice.
 *
 * No fallbacks. No legacy TS implementations. The Rust engine must be running.
 * If it's not, operations fail loudly so you know to start it.
 */

import type { AuditEventType, AuditLogParams } from "~/server/audit";
import type { ForensicEvidence } from "~/lib/forensic/types";
import type { AssembleForensicInput } from "~/server/forensic";
import type { PdfAnalysisResult } from "~/lib/pdf-types";
import type { Document, Signer, PdfStyleSettings } from "~/server/db/schema";

const ENGINE_URL = process.env.RUST_ENGINE_URL ?? "http://127.0.0.1:9090";
const TIMEOUT_MS = 30_000;

// ── HTTP helpers ─────────────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Rust engine ${res.status}: ${err}`);
  }
  return res.json() as T;
}

async function postBytes<T>(
  path: string,
  body: Uint8Array | Buffer,
  contentType = "application/octet-stream",
): Promise<T> {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: body as BodyInit,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Rust engine ${res.status}: ${err}`);
  }
  return res.json() as T;
}

async function postForBytes(path: string, body: unknown): Promise<Uint8Array> {
  const res = await fetch(`${ENGINE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Rust engine ${res.status}: ${err}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map((entry) => readRecord(entry)).filter((entry): entry is Record<string, unknown> => !!entry)
    : [];
}

function normalizePdfAnalysisResult(input: unknown): PdfAnalysisResult {
  const source = readRecord(input) ?? {};
  const detectedFields = readRecordArray(source.detectedFields ?? source.detected_fields);
  const signatureBlocks = readRecordArray(source.signatureBlocks ?? source.signature_blocks);
  const detectedAddresses = readRecordArray(source.detectedAddresses ?? source.detected_addresses);
  const detectedSigners = readRecordArray(source.detectedSigners ?? source.detected_signers);

  const mapDetectedField = (field: Record<string, unknown>): PdfAnalysisResult["detectedFields"][number] => ({
    type: readString(field.type ?? field.field_type, "other") as PdfAnalysisResult["detectedFields"][number]["type"],
    label: readString(field.label),
    value: readNullableString(field.value),
    blank: readBoolean(field.blank),
    partyRole: readNullableString(field.partyRole ?? field.party_role),
    line: readNumber(field.line),
    position: readNumber(field.position),
  });

  const mapSignatureBlock = (block: Record<string, unknown>): PdfAnalysisResult["signatureBlocks"][number] => ({
    partyRole: readString(block.partyRole ?? block.party_role),
    partyLabel: readString(block.partyLabel ?? block.party_label),
    signerIndex: readNumber(block.signerIndex ?? block.signer_index),
    fields: readRecordArray(block.fields).map(mapDetectedField),
    line: readNumber(block.line),
  });

  return {
    title: readString(source.title),
    content: readString(source.content),
    pageCount: readNumber(source.pageCount ?? source.page_count),
    documentType: readNullableString(source.documentType ?? source.document_type),
    detectedFields: detectedFields.map(mapDetectedField),
    signatureBlocks: signatureBlocks.map(mapSignatureBlock),
    detectedAddresses: detectedAddresses.map((address) => ({
      address: readString(address.address),
      chain: readString(address.chain) as PdfAnalysisResult["detectedAddresses"][number]["chain"],
      context: readString(address.context),
    })),
    detectedSigners: detectedSigners.map((signer) => ({
      label: readString(signer.label),
      role: readNullableString(signer.role),
      address: readNullableString(signer.address),
      mailingAddress: readNullableString(signer.mailingAddress ?? signer.mailing_address),
      chain: (signer.chain ?? null) as PdfAnalysisResult["detectedSigners"][number]["chain"],
      confidence: readString(signer.confidence, "low") as PdfAnalysisResult["detectedSigners"][number]["confidence"],
      source: readString(signer.source),
      fields: readRecordArray(signer.fields).map(mapDetectedField),
      signatureBlock: readRecord(signer.signatureBlock ?? signer.signature_block)
        ? mapSignatureBlock(readRecord(signer.signatureBlock ?? signer.signature_block)!)
        : null,
    })),
    suggestedSignerCount: readNumber(source.suggestedSignerCount ?? source.suggested_signer_count, 2),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Crypto — SHA-256, AES-256-GCM, signing messages
// ═══════════════════════════════════════════════════════════════════════════════

export async function hashDocument(content: string): Promise<string> {
  const { hash } = await post<{ hash: string }>("/api/v1/crypto/hash", { content });
  return hash;
}

export async function hashHandSignature(dataUrl: string): Promise<string> {
  const { hash } = await post<{ hash: string }>("/api/v1/crypto/hash-hand-signature", { data_url: dataUrl });
  return hash;
}

export async function buildSigningMessage(params: {
  documentTitle?: string;
  contentHash: string;
  signerLabel: string;
  signerAddress?: string;
  address?: string;
  chain?: string;
  handSignatureHash?: string;
}): Promise<string> {
  const address = params.signerAddress ?? params.address ?? "";
  const { message } = await post<{ message: string }>("/api/v1/crypto/build-signing-message", {
    content_hash: params.contentHash,
    address,
    signer_label: params.signerLabel,
    hand_signature_hash: params.handSignatureHash ?? null,
  });
  return message;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Encryption — AES-256-GCM with HKDF key wrapping
// ═══════════════════════════════════════════════════════════════════════════════

export function isEncryptionAvailable(): boolean {
  return !!process.env.ENCRYPTION_MASTER_KEY;
}

export async function encryptDocument(
  content: string,
): Promise<{ encryptedContent: string; wrappedKey: string } | null> {
  const masterSecret = process.env.ENCRYPTION_MASTER_KEY;
  if (!masterSecret) return null;
  const result = await post<{ encrypted_content: string; wrapped_key: string }>("/api/v1/crypto/encrypt", {
    content,
    master_secret: masterSecret,
  });
  return { encryptedContent: result.encrypted_content, wrappedKey: result.wrapped_key };
}

export async function decryptDocument(encryptedContent: string, wrappedKey: string): Promise<string> {
  const masterSecret = process.env.ENCRYPTION_MASTER_KEY;
  if (!masterSecret) throw new Error("ENCRYPTION_MASTER_KEY not set");
  const { content } = await post<{ content: string }>("/api/v1/crypto/decrypt", {
    encrypted_content: encryptedContent,
    wrapped_key: wrappedKey,
    master_secret: masterSecret,
  });
  return content;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Signature Verification — EVM, Bitcoin, Solana
// ═══════════════════════════════════════════════════════════════════════════════

export async function verifySignature(params: {
  chain: string;
  address: string;
  message: string;
  signature: string;
}): Promise<{ ok: boolean; scheme: string; debug: string[] }> {
  return post("/api/v1/verify/signature", params);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDF — Analysis + Generation
// Analysis and generation both go through the Rust microservice.
// The bridge serializes structured document lines so the Rust renderer can
// preserve inline fields and field summaries without falling back to TS.
// ═══════════════════════════════════════════════════════════════════════════════

export async function analyzePdf(buffer: Buffer): Promise<PdfAnalysisResult> {
  const result = await postBytes<unknown>("/api/v1/pdf/analyze", buffer);
  return normalizePdfAnalysisResult(result);
}

type RustPdfGenerateRequest = {
  title: string;
  content: string;
  content_hash: string;
  document_id: string;
  verify_url: string;
  created_at: string;
  status: string;
  encrypted_at_rest: boolean;
  ipfs_cid: string | null;
  field_summary_style: "hybrid" | "cards" | "table";
  signers: Array<{
    label: string;
    status: string;
    chain: string | null;
    address: string | null;
    scheme: string | null;
    signature: string | null;
    signed_at: string | null;
    hand_signature_hash: string | null;
    hand_signature_data: string | null;
    field_values: Record<string, unknown> | null;
    forensic_evidence: Record<string, unknown> | null;
  }>;
};

function resolveFieldSummaryStyle(
  styleSettings?: PdfStyleSettings | null,
): RustPdfGenerateRequest["field_summary_style"] {
  const style = styleSettings?.fieldSummaryStyle;
  return style === "cards" || style === "table" ? style : "hybrid";
}

function buildRustPdfGenerateRequest(params: {
  doc: Document;
  signers: Signer[];
  verifyUrl: string;
  styleSettings?: PdfStyleSettings | null;
}): RustPdfGenerateRequest {
  const sortedSigners = [...params.signers].sort(
    (left, right) => (left.signerOrder ?? 0) - (right.signerOrder ?? 0) || left.id.localeCompare(right.id),
  );

  return {
    title: params.doc.title,
    content: params.doc.content,
    content_hash: params.doc.contentHash,
    document_id: params.doc.id,
    verify_url: params.verifyUrl,
    created_at: new Date(params.doc.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    status: params.doc.status,
    encrypted_at_rest: params.doc.encryptedAtRest ?? false,
    ipfs_cid: params.doc.ipfsCid ?? null,
    field_summary_style: resolveFieldSummaryStyle(params.styleSettings),
    signers: sortedSigners.map((signer) => ({
      label: signer.label,
      status: signer.status,
      chain: signer.chain ?? null,
      address: signer.address ?? null,
      scheme: signer.scheme ?? null,
      signature: signer.signature ?? null,
      signed_at: signer.signedAt
        ? new Date(signer.signedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
        : null,
      hand_signature_hash: signer.handSignatureHash ?? null,
      hand_signature_data: signer.handSignatureData ?? null,
      field_values: signer.fieldValues ?? null,
      forensic_evidence: signer.forensicEvidence as Record<string, unknown> | null,
    })),
  };
}

export async function generateSignedPDF(params: {
  doc: Document;
  signers: Signer[];
  verifyUrl: string;
  styleSettings?: PdfStyleSettings | null;
}): Promise<Uint8Array> {
  return postForBytes("/api/v1/pdf/generate", buildRustPdfGenerateRequest(params));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Audit Trail — hash computation via Rust, DB ops via Node
// ═══════════════════════════════════════════════════════════════════════════════

export async function computeAuditEventHash(
  prevHash: string | null,
  eventType: string,
  actor: string,
  timestamp: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const { hash } = await post<{ hash: string }>("/api/v1/audit/compute-hash", {
    prev_hash: prevHash,
    event_type: eventType,
    actor,
    timestamp,
    metadata: metadata ?? null,
  });
  return hash;
}

export async function verifyAuditChain(
  events: Array<{
    eventType: string;
    actor: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
    eventHash: string;
    prevEventHash: string | null;
  }>,
): Promise<{ valid: boolean; brokenAt?: number }> {
  return post("/api/v1/audit/verify-chain", {
    events: events.map((e) => ({
      event_type: e.eventType,
      actor: e.actor,
      timestamp: e.timestamp,
      metadata: e.metadata ?? null,
      event_hash: e.eventHash,
      prev_event_hash: e.prevEventHash,
    })),
  });
}

// DB-dependent audit ops — these need Node for DB access but use Rust for hashing
export async function logAuditEvent(params: AuditLogParams): Promise<{ eventId: string; eventHash: string }> {
  const { logAuditEvent: dbLog } = await import("~/server/audit");
  return dbLog(params);
}

export async function getAuditTrail(documentId: string) {
  const { getAuditTrail: dbGet } = await import("~/server/audit");
  return dbGet(documentId);
}

export async function verifyAuditChainByDocId(documentId: string): Promise<{ valid: boolean; brokenAt?: number }> {
  const { verifyAuditChain: dbVerify } = await import("~/server/audit");
  return dbVerify(documentId);
}

export async function computeAuditTrailHash(documentId: string): Promise<string> {
  const { computeAuditTrailHash: dbHash } = await import("~/server/audit");
  return dbHash(documentId);
}

export type { AuditEventType, AuditLogParams };

// ═══════════════════════════════════════════════════════════════════════════════
// QR Code — SVG + PNG
// ═══════════════════════════════════════════════════════════════════════════════

export async function generateQrSvg(text: string, size?: number): Promise<string> {
  const res = await fetch(`${ENGINE_URL}/api/v1/qr/svg`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, size }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Rust engine ${res.status}`);
  return res.text();
}

export async function generateQrDataUrl(text: string, size?: number): Promise<string> {
  const { data_url: dataUrl } = await post<{ data_url: string }>("/api/v1/qr/data-url", { text, size });
  return dataUrl;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Forensic Evidence — I/O in Node, hashing + flags in Rust
// ═══════════════════════════════════════════════════════════════════════════════

export async function hashForensicEvidence(evidence: Record<string, unknown>): Promise<string> {
  const { hash } = await post<{ hash: string }>("/api/v1/forensic/hash", evidence);
  return hash;
}

export async function analyzeForensicFlags(
  evidence: Record<string, unknown>,
): Promise<Array<{ code: string; severity: string; message: string }>> {
  const { flags } = await post<{ flags: Array<{ code: string; severity: string; message: string }> }>(
    "/api/v1/forensic/analyze-flags",
    evidence,
  );
  return flags;
}

export async function assembleForensicEvidence(input: AssembleForensicInput): Promise<ForensicEvidence> {
  // Geo/DNS I/O runs in Node, then Rust hashes the result
  const { assembleForensicEvidence: assemble } = await import("~/server/forensic");
  const evidence = await assemble(input);
  evidence.evidenceHash = await hashForensicEvidence(evidence as unknown as Record<string, unknown>);
  return evidence;
}

/** Server-side replay tape validation — decode tape in Rust and cross-check metrics. */
export type ReplayTapeVerification = {
  valid: boolean;
  error: string | null;
  actual_event_count: number;
  actual_duration_ms: number;
  actual_click_count: number;
  actual_key_count: number;
  actual_mouse_move_count: number;
  actual_signature_point_count: number;
  actual_signature_end_count: number;
  actual_gaze_point_count: number;
  actual_gaze_fixation_count: number;
  actual_gaze_blink_count: number;
  mismatches: Array<{
    field: string;
    claimed: number;
    actual: number;
    severity: string;
    message: string;
  }>;
  anomalies: Array<{ code: string; severity: string; message: string }>;
};

export async function validateReplayTape(
  tapeBase64: string,
  claimedMetrics: Record<string, unknown>,
  claimedBehavioral: Record<string, unknown>,
): Promise<ReplayTapeVerification> {
  return post<ReplayTapeVerification>("/api/v1/forensic/validate-replay", {
    tape_base64: tapeBase64,
    claimed_metrics: claimedMetrics,
    claimed_behavioral: claimedBehavioral,
  });
}

export type { ForensicEvidence, AssembleForensicInput };

// ═══════════════════════════════════════════════════════════════════════════════
// Post-Quantum Encryption — ML-KEM-768 + AES-256-GCM
// ═══════════════════════════════════════════════════════════════════════════════

export type PqKeypair = { publicKey: string; privateKey: string };
export type HybridCiphertext = { ciphertext: string; algorithm: string };

/** Generate ML-KEM-768 keypair (NIST FIPS 203 post-quantum). */
export async function pqGenerateKeypair(): Promise<PqKeypair> {
  const result = await post<{ public_key: string; private_key: string }>("/api/v1/pq/keygen", {});
  return { publicKey: result.public_key, privateKey: result.private_key };
}

/** Encrypt with ML-KEM-768 + AES-256-GCM (quantum-resistant). */
export async function pqEncrypt(plaintext: Buffer, recipientPublicKey: string): Promise<HybridCiphertext> {
  const b64 = plaintext.toString("base64");
  return post("/api/v1/pq/encrypt", { plaintext: b64, recipient_public_key: recipientPublicKey });
}

/** Decrypt ML-KEM-768 + AES-256-GCM ciphertext. */
export async function pqDecrypt(ciphertext: HybridCiphertext, recipientPrivateKey: string): Promise<Buffer> {
  const { plaintext } = await post<{ plaintext: string }>("/api/v1/pq/decrypt", {
    ciphertext,
    recipient_private_key: recipientPrivateKey,
  });
  return Buffer.from(plaintext, "base64");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Zero-Knowledge Proofs
// ═══════════════════════════════════════════════════════════════════════════════

export type DocumentProof = {
  document_hash: string;
  commitment: string;
  challenge: string;
  response: string;
  created_at: string;
  version: number;
};
export type SignatureProof = {
  document_hash: string;
  signer_address: string;
  scheme: string;
  commitment: string;
  challenge: string;
  response: string;
  signature_hash: string;
  created_at: string;
  version: number;
};
export type FieldProof = {
  document_hash: string;
  field_id: string;
  field_value_hash: string;
  commitment: string;
  challenge: string;
  response: string;
  revealed_value: string | null;
  created_at: string;
  version: number;
};

/** Create ZK proof of document knowledge (without revealing content). */
export async function createDocumentProof(documentContent: string): Promise<DocumentProof> {
  return post("/api/v1/zk/document-proof", { document_content: documentContent });
}

/** Verify a ZK document proof. */
export async function verifyDocumentProof(proof: DocumentProof): Promise<boolean> {
  const { valid } = await post<{ valid: boolean }>("/api/v1/zk/verify-document-proof", proof);
  return valid;
}

/** Create ZK proof that a signature exists (without revealing it). */
export async function createSignatureProof(
  documentHash: string,
  signerAddress: string,
  scheme: string,
  signature: string,
): Promise<SignatureProof> {
  return post("/api/v1/zk/signature-proof", {
    document_hash: documentHash,
    signer_address: signerAddress,
    scheme,
    signature,
  });
}

/** Verify a ZK signature proof. */
export async function verifySignatureProof(proof: SignatureProof): Promise<boolean> {
  const { valid } = await post<{ valid: boolean }>("/api/v1/zk/verify-signature-proof", proof);
  return valid;
}

/** Create ZK proof for a field value (optionally revealing it). */
export async function createFieldProof(
  documentHash: string,
  fieldId: string,
  fieldValue: string,
  reveal = false,
): Promise<FieldProof> {
  return post("/api/v1/zk/field-proof", {
    document_hash: documentHash,
    field_id: fieldId,
    field_value: fieldValue,
    reveal,
  });
}

/** Verify a ZK field proof. */
export async function verifyFieldProof(proof: FieldProof): Promise<boolean> {
  const { valid } = await post<{ valid: boolean }>("/api/v1/zk/verify-field-proof", proof);
  return valid;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Engine Status
// ═══════════════════════════════════════════════════════════════════════════════

export async function getEngineStatus(): Promise<{ available: boolean; version?: string }> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      return { available: true, version: data.version };
    }
  } catch {}
  return { available: false };
}
