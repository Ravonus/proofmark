/**
 * Integration tests for the Rust engine bridge.
 *
 * These tests verify every function in ~/server/rust-engine hits the Rust
 * microservice and returns correct results. The Rust engine MUST be running
 * on localhost:9090 for these to pass.
 *
 * Run: npx vitest run src/server/__tests__/rust-engine.test.ts
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  hashDocument,
  hashHandSignature,
  buildSigningMessage,
  isEncryptionAvailable,
  encryptDocument,
  decryptDocument,
  verifySignature,
  analyzePdf,
  generateSignedPDF,
  computeAuditEventHash,
  verifyAuditChain,
  generateQrSvg,
  generateQrDataUrl,
  hashForensicEvidence,
  analyzeForensicFlags,
  getEngineStatus,
} from "~/server/rust-engine";
import { createFakePdf } from "./helpers/fake-pdf";

// ── Preflight: ensure engine is running ──────────────────────────────────────

beforeAll(async () => {
  const status = await getEngineStatus();
  if (!status.available) {
    throw new Error("Rust engine not running on localhost:9090. Start it with: cd rust-service && cargo run --release");
  }
});

// ── Crypto ───────────────────────────────────────────────────────────────────

describe("crypto", () => {
  it("hashDocument returns correct SHA-256", async () => {
    const hash = await hashDocument("hello world");
    expect(hash).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("hashDocument is deterministic", async () => {
    const a = await hashDocument("test content");
    const b = await hashDocument("test content");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("hashHandSignature hashes base64 data", async () => {
    const hash = await hashHandSignature("data:image/png;base64,iVBORw0KGgo=");
    expect(hash).toHaveLength(64);
  });

  it("buildSigningMessage constructs the correct format", async () => {
    const msg = await buildSigningMessage({
      contentHash: "abc123",
      signerAddress: "0xDEAD",
      signerLabel: "Alice",
    });
    expect(msg).toContain("proofmark:");
    expect(msg).toContain("abc123");
    expect(msg.toLowerCase()).toContain("0xdead");
    expect(msg).toContain("Alice");
  });

  it("buildSigningMessage with legacy params", async () => {
    const msg = await buildSigningMessage({
      documentTitle: "Test Doc",
      contentHash: "hash123",
      signerLabel: "Bob",
      signerAddress: "0xBEEF",
      chain: "ETH",
      handSignatureHash: "inkhash",
    });
    expect(msg).toContain("hash123");
    expect(msg).toContain("Bob");
  });
});

// ── Encryption ───────────────────────────────────────────────────────────────

describe("encryption", () => {
  it("isEncryptionAvailable returns boolean", () => {
    const result = isEncryptionAvailable();
    expect(typeof result).toBe("boolean");
  });

  it("encrypt + decrypt roundtrip", async () => {
    // Set env for test
    const originalKey = process.env.ENCRYPTION_MASTER_KEY;
    process.env.ENCRYPTION_MASTER_KEY = "test-key-for-vitest-2024";

    try {
      const content = "This is a secret legal document.";
      const encrypted = await encryptDocument(content);
      expect(encrypted).not.toBeNull();
      expect(encrypted!.encryptedContent).toBeTruthy();
      expect(encrypted!.wrappedKey).toBeTruthy();

      const decrypted = await decryptDocument(encrypted!.encryptedContent, encrypted!.wrappedKey);
      expect(decrypted).toBe(content);
    } finally {
      if (originalKey) process.env.ENCRYPTION_MASTER_KEY = originalKey;
      else delete process.env.ENCRYPTION_MASTER_KEY;
    }
  });

  it("encryptDocument returns null without master key", async () => {
    const originalKey = process.env.ENCRYPTION_MASTER_KEY;
    delete process.env.ENCRYPTION_MASTER_KEY;

    try {
      const result = await encryptDocument("test");
      expect(result).toBeNull();
    } finally {
      if (originalKey) process.env.ENCRYPTION_MASTER_KEY = originalKey;
    }
  });
});

// ── Signature Verification ───────────────────────────────────────────────────

describe("signature verification", () => {
  it("rejects invalid ETH signature", async () => {
    const result = await verifySignature({
      chain: "ETH",
      address: "0x0000000000000000000000000000000000000001",
      message: "test",
      signature: "0x" + "00".repeat(65),
    });
    expect(result.ok).toBe(false);
    expect(result.scheme).toBe("EIP191");
  });

  it("rejects invalid SOL signature", async () => {
    const result = await verifySignature({
      chain: "SOL",
      address: "11111111111111111111111111111112",
      message: "test",
      signature: Buffer.alloc(64).toString("base64"),
    });
    expect(result.ok).toBe(false);
  });

  it("returns debug info for BTC", async () => {
    const result = await verifySignature({
      chain: "BTC",
      address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
      message: "test",
      signature: Buffer.alloc(65).toString("base64"),
    });
    expect(result).toHaveProperty("ok");
    expect(result).toHaveProperty("scheme");
    expect(result).toHaveProperty("debug");
  });
});

// ── PDF ──────────────────────────────────────────────────────────────────────

describe("pdf", () => {
  it("analyzes PDFs through the Rust engine", async () => {
    const pdf = await createFakePdf(
      [
        "NON-DISCLOSURE AGREEMENT",
        "",
        "Disclosing Party Name: ________",
        "Receiving Party Name: ________",
        "Signature: ________",
      ].join("\n"),
    );

    const result = await analyzePdf(pdf);

    expect(result.title).toBe("Non-Disclosure Agreement");
    expect(result.pageCount).toBe(1);
    expect(result.documentType).toBe("Non-Disclosure Agreement (NDA)");
    expect(result.detectedFields.some((field) => field.type === "signature")).toBe(true);
    expect(result.suggestedSignerCount).toBeGreaterThanOrEqual(2);
  });

  it("generates a signed PDF", async () => {
    const pdf = await generateSignedPDF({
      doc: {
        id: "test-doc-id",
        title: "Test Document",
        content: "This is a test.\n\nSection 1\nContent here.",
        contentHash: "abcdef1234567890",
        createdAt: new Date(),
        status: "COMPLETED",
      } as unknown as Parameters<typeof generateSignedPDF>[0]["doc"],
      signers: [
        {
          label: "Alice",
          status: "SIGNED",
          chain: "ETH",
          address: "0x1234567890abcdef1234567890abcdef12345678",
          scheme: "EIP191",
          signature: "0x" + "ab".repeat(65),
          signedAt: new Date(),
          handSignatureHash: null,
          handSignatureData: null,
          fieldValues: null,
          forensicEvidence: null,
        } as unknown as Parameters<typeof generateSignedPDF>[0]["signers"][number],
      ],
      verifyUrl: "https://example.com/verify/abcdef",
    });
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(pdf.length).toBeGreaterThan(100);
    // PDF magic bytes
    expect(pdf[0]).toBe(0x25); // %
    expect(pdf[1]).toBe(0x50); // P
    expect(pdf[2]).toBe(0x44); // D
    expect(pdf[3]).toBe(0x46); // F
  });
});

// ── Audit ────────────────────────────────────────────────────────────────────

describe("audit", () => {
  it("computes deterministic event hash", async () => {
    const a = await computeAuditEventHash(null, "CREATED", "alice", "2024-01-01T00:00:00Z");
    const b = await computeAuditEventHash(null, "CREATED", "alice", "2024-01-01T00:00:00Z");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("chain hash depends on previous", async () => {
    const h1 = await computeAuditEventHash(null, "CREATED", "alice", "2024-01-01T00:00:00Z");
    const h2 = await computeAuditEventHash(h1, "SIGNED", "bob", "2024-01-01T01:00:00Z");
    expect(h1).not.toBe(h2);
  });

  it("verifies valid chain", async () => {
    const h1 = await computeAuditEventHash(null, "CREATED", "alice", "2024-01-01T00:00:00Z");
    const h2 = await computeAuditEventHash(h1, "SIGNED", "bob", "2024-01-01T01:00:00Z");

    const result = await verifyAuditChain([
      { eventType: "CREATED", actor: "alice", timestamp: "2024-01-01T00:00:00Z", eventHash: h1, prevEventHash: null },
      { eventType: "SIGNED", actor: "bob", timestamp: "2024-01-01T01:00:00Z", eventHash: h2, prevEventHash: h1 },
    ]);
    expect(result.valid).toBe(true);
  });

  it("detects tampered chain", async () => {
    const h1 = await computeAuditEventHash(null, "CREATED", "alice", "2024-01-01T00:00:00Z");

    const result = await verifyAuditChain([
      { eventType: "CREATED", actor: "alice", timestamp: "2024-01-01T00:00:00Z", eventHash: h1, prevEventHash: null },
      {
        eventType: "SIGNED",
        actor: "bob",
        timestamp: "2024-01-01T01:00:00Z",
        eventHash: "tampered",
        prevEventHash: h1,
      },
    ]);
    expect(result.valid).toBe(false);
    // Rust returns snake_case: broken_at
    expect((result as Record<string, unknown>).broken_at ?? result.brokenAt).toBe(1);
  });
});

// ── QR Code ──────────────────────────────────────────────────────────────────

describe("qr", () => {
  it("generates SVG", async () => {
    const svg = await generateQrSvg("https://proofmark.io", 200);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("rect");
  });

  it("generates PNG data URL", async () => {
    const url = await generateQrDataUrl("test", 128);
    expect(url).toMatch(/^data:image\/png;base64,/);
    expect(url.length).toBeGreaterThan(50);
  });
});

// ── Forensic ─────────────────────────────────────────────────────────────────

describe("forensic", () => {
  it("hashes evidence deterministically", async () => {
    const evidence = { version: 1, fingerprint: { visitorId: "abc" }, geo: null };
    const a = await hashForensicEvidence(evidence);
    const b = await hashForensicEvidence(evidence);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("analyzes flags from evidence", async () => {
    const flags = await analyzeForensicFlags({
      geo: { isVpn: true, isTor: true },
      fingerprint: { webdriver: true },
      behavioral: { timeOnPage: 500, mouseMoveCount: 0, scrolledToBottom: false, maxScrollDepth: 5 },
    });
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.some((f) => f.code === "VPN_DETECTED")).toBe(true);
    expect(flags.some((f) => f.code === "TOR_DETECTED")).toBe(true);
    expect(flags.some((f) => f.code === "WEBDRIVER_DETECTED")).toBe(true);
    expect(flags.some((f) => f.code === "RAPID_SIGNING")).toBe(true);
  });

  it("returns empty flags for clean evidence", async () => {
    const flags = await analyzeForensicFlags({
      geo: { isVpn: false, isTor: false },
      fingerprint: { webdriver: false, cookieEnabled: true },
      behavioral: { timeOnPage: 60000, mouseMoveCount: 100, scrolledToBottom: true, maxScrollDepth: 100 },
    });
    expect(flags.length).toBe(0);
  });
});

// ── Engine Status ────────────────────────────────────────────────────────────

describe("engine status", () => {
  it("reports engine as available", async () => {
    const status = await getEngineStatus();
    expect(status.available).toBe(true);
    expect(status.version).toBe("0.1.0");
  });
});

// ── Post-Quantum Encryption ──────────────────────────────────────────────────

import {
  pqGenerateKeypair,
  pqEncrypt,
  pqDecrypt,
  createDocumentProof,
  verifyDocumentProof,
  createSignatureProof,
  verifySignatureProof,
  createFieldProof,
  verifyFieldProof,
} from "~/server/rust-engine";

describe("post-quantum encryption", () => {
  it("generates ML-KEM-768 keypair", async () => {
    const kp = await pqGenerateKeypair();
    expect(kp.publicKey).toHaveLength(1184 * 2); // hex
    expect(kp.privateKey).toHaveLength(2400 * 2);
  });

  it("encrypts and decrypts roundtrip", async () => {
    const kp = await pqGenerateKeypair();
    const plaintext = Buffer.from("quantum-safe secret document");
    const ct = await pqEncrypt(plaintext, kp.publicKey);
    expect(ct.algorithm).toBe("ML-KEM-768+AES-256-GCM");

    const decrypted = await pqDecrypt(ct, kp.privateKey);
    expect(decrypted.toString()).toBe("quantum-safe secret document");
  });

  it("wrong key fails decryption", async () => {
    const kp1 = await pqGenerateKeypair();
    const kp2 = await pqGenerateKeypair();
    const ct = await pqEncrypt(Buffer.from("secret"), kp1.publicKey);
    await expect(pqDecrypt(ct, kp2.privateKey)).rejects.toThrow();
  });
});

// ── Zero-Knowledge Proofs ────────────────────────────────────────────────────

describe("zero-knowledge proofs", () => {
  it("creates and verifies document proof", async () => {
    const proof = await createDocumentProof("This is a confidential agreement.");
    expect(proof.version).toBe(1);
    expect(proof.document_hash).toHaveLength(64);
    const valid = await verifyDocumentProof(proof);
    expect(valid).toBe(true);
  });

  it("tampered document proof fails", async () => {
    const proof = await createDocumentProof("original content");
    proof.document_hash = "0".repeat(64);
    const valid = await verifyDocumentProof(proof);
    expect(valid).toBe(false);
  });

  it("creates and verifies signature proof", async () => {
    const sig = Buffer.from("fake-sig-for-testing").toString("base64");
    const proof = await createSignatureProof("doc_hash_abc", "0x1234", "EIP191", sig);
    expect(proof.scheme).toBe("EIP191");
    const valid = await verifySignatureProof(proof);
    expect(valid).toBe(true);
  });

  it("creates hidden field proof", async () => {
    const proof = await createFieldProof("doc_hash", "amount", "$50,000", false);
    expect(proof.revealed_value).toBeNull();
    const valid = await verifyFieldProof(proof);
    expect(valid).toBe(true);
  });

  it("creates revealed field proof and verifies value", async () => {
    const proof = await createFieldProof("doc_hash", "name", "Alice", true);
    expect(proof.revealed_value).toBe("Alice");
    const valid = await verifyFieldProof(proof);
    expect(valid).toBe(true);
  });

  it("detects tampered revealed field value", async () => {
    const proof = await createFieldProof("doc_hash", "amount", "$10,000", true);
    proof.revealed_value = "$1,000,000";
    const valid = await verifyFieldProof(proof);
    expect(valid).toBe(false);
  });
});
