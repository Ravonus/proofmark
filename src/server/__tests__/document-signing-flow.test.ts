import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDocument, buildSigner, resetBuilderCounters } from "./helpers/builders";

// Mock the Rust engine
vi.mock("~/server/rust-engine", () => {
  const { createHash } = require("crypto");
  return {
    hashDocument: vi.fn(async (content: string) => {
      return createHash("sha256").update(content).digest("hex");
    }),
  };
});

// Mock delivery (sendSignerInvite)
vi.mock("~/server/delivery", () => ({
  sendSignerInvite: vi.fn(async () => {}),
  resolveDocumentBranding: vi.fn(async () => ({
    companyName: "Test",
    logoUrl: null,
    accentColor: "#000",
    emailReplyTo: null,
  })),
}));

// Mock email
vi.mock("~/server/email", () => ({
  sendCompletionEmail: vi.fn(async () => {}),
}));

// Mock audit + search index
vi.mock("~/server/audit", () => ({
  logAuditEvent: vi.fn(async () => {}),
}));
vi.mock("~/server/search-index", () => ({
  indexDocument: vi.fn(async () => {}),
}));

beforeEach(() => {
  resetBuilderCounters();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("computeDocumentStateHash", () => {
  it("returns a 64-char hex string", async () => {
    const { computeDocumentStateHash } = await import("~/server/api/routers/document-helpers");
    const hash = await computeDocumentStateHash({
      contentHash: "abc123",
      docSigners: [],
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same inputs produce same hash", async () => {
    const { computeDocumentStateHash } = await import("~/server/api/routers/document-helpers");
    const params = {
      contentHash: "abc123",
      docSigners: [{ fieldValues: { name: "Alice" } }],
    };
    const hash1 = await computeDocumentStateHash(params);
    const hash2 = await computeDocumentStateHash(params);
    expect(hash1).toBe(hash2);
  });

  it("different field values produce different hashes", async () => {
    const { computeDocumentStateHash } = await import("~/server/api/routers/document-helpers");
    const hash1 = await computeDocumentStateHash({
      contentHash: "abc123",
      docSigners: [{ fieldValues: { name: "Alice" } }],
    });
    const hash2 = await computeDocumentStateHash({
      contentHash: "abc123",
      docSigners: [{ fieldValues: { name: "Bob" } }],
    });
    expect(hash1).not.toBe(hash2);
  });

  it("different contentHash produces different output", async () => {
    const { computeDocumentStateHash } = await import("~/server/api/routers/document-helpers");
    const hash1 = await computeDocumentStateHash({
      contentHash: "hash-A",
      docSigners: [{ fieldValues: { name: "Alice" } }],
    });
    const hash2 = await computeDocumentStateHash({
      contentHash: "hash-B",
      docSigners: [{ fieldValues: { name: "Alice" } }],
    });
    expect(hash1).not.toBe(hash2);
  });

  it("merges current signer values at correct index", async () => {
    const { computeDocumentStateHash } = await import("~/server/api/routers/document-helpers");
    // Signer 0 already has values, signer 1 is about to submit
    const hash = await computeDocumentStateHash({
      contentHash: "abc123",
      docSigners: [
        { fieldValues: { name: "Alice" } },
        { fieldValues: null },
      ],
      currentSignerFieldValues: { name: "Bob" },
      currentSignerIndex: 1,
    });

    // Should be different from when signer 1 has no values
    const hashWithout = await computeDocumentStateHash({
      contentHash: "abc123",
      docSigners: [
        { fieldValues: { name: "Alice" } },
        { fieldValues: null },
      ],
    });

    expect(hash).not.toBe(hashWithout);
  });

  it("handles null and empty field values", async () => {
    const { computeDocumentStateHash } = await import("~/server/api/routers/document-helpers");
    const hashNull = await computeDocumentStateHash({
      contentHash: "abc123",
      docSigners: [{ fieldValues: null }],
    });
    const hashEmpty = await computeDocumentStateHash({
      contentHash: "abc123",
      docSigners: [{ fieldValues: {} }],
    });
    // Both should produce the same hash since neither has actual values
    expect(hashNull).toBe(hashEmpty);
  });

  it("signer ordering matters — same values at different positions produce different hashes", async () => {
    const { computeDocumentStateHash } = await import("~/server/api/routers/document-helpers");
    const hash1 = await computeDocumentStateHash({
      contentHash: "abc123",
      docSigners: [
        { fieldValues: { name: "Alice" } },
        { fieldValues: { name: "Bob" } },
      ],
    });
    const hash2 = await computeDocumentStateHash({
      contentHash: "abc123",
      docSigners: [
        { fieldValues: { name: "Bob" } },
        { fieldValues: { name: "Alice" } },
      ],
    });
    expect(hash1).not.toBe(hash2);
  });
});

describe("propagateGroupSignature", () => {
  it("does not propagate when groupId is null", async () => {
    const { propagateGroupSignature } = await import("~/server/api/routers/document-helpers");
    const doc = buildDocument({ groupId: null });
    const signer = buildSigner({ groupRole: "discloser" });

    const result = await propagateGroupSignature({
      db: {} as never,
      doc,
      signer,
      signData: buildSignData(),
    });

    expect(result.propagatedCount).toBe(0);
  });

  it("does not propagate when groupRole is not discloser", async () => {
    const { propagateGroupSignature } = await import("~/server/api/routers/document-helpers");
    const doc = buildDocument({ groupId: "group-1" });
    const signer = buildSigner({ groupRole: "recipient" });

    const result = await propagateGroupSignature({
      db: {} as never,
      doc,
      signer,
      signData: buildSignData(),
    });

    expect(result.propagatedCount).toBe(0);
  });
});

describe("handlePostSignCompletion — sequential notification", () => {
  it("sends invite to next signer in sequential mode", async () => {
    const { sendSignerInvite } = await import("~/server/delivery");
    const { handlePostSignCompletion } = await import("~/server/api/routers/document-helpers");

    const doc = buildDocument({ signingOrder: "sequential", currentSignerIndex: 0 });
    const signer0 = buildSigner({
      documentId: doc.id,
      signerOrder: 0,
      status: "SIGNED",
      role: "SIGNER",
    });
    const signer1 = buildSigner({
      documentId: doc.id,
      signerOrder: 1,
      status: "PENDING",
      role: "SIGNER",
      email: "discloser@test.com",
      claimToken: "discloser-claim",
    });

    const mockDb = createMockDb();

    await handlePostSignCompletion({
      db: mockDb as never,
      doc: doc as never,
      docSigners: [signer0, signer1] as never[],
      justSignedId: signer0.id,
      justSignedOrder: 0,
    });

    expect(sendSignerInvite).toHaveBeenCalledOnce();
    expect(sendSignerInvite).toHaveBeenCalledWith(
      expect.objectContaining({
        signer: expect.objectContaining({ email: "discloser@test.com" }),
        signUrl: expect.stringContaining(signer1.claimToken),
      }),
    );
  });

  it("does not send invite in parallel mode", async () => {
    const { sendSignerInvite } = await import("~/server/delivery");
    const { handlePostSignCompletion } = await import("~/server/api/routers/document-helpers");

    const doc = buildDocument({ signingOrder: "parallel" });
    const signer0 = buildSigner({ documentId: doc.id, signerOrder: 0, status: "SIGNED", role: "SIGNER" });
    const signer1 = buildSigner({ documentId: doc.id, signerOrder: 1, status: "PENDING", role: "SIGNER", email: "test@test.com" });

    const mockDb = createMockDb();

    await handlePostSignCompletion({
      db: mockDb as never,
      doc: doc as never,
      docSigners: [signer0, signer1] as never[],
      justSignedId: signer0.id,
      justSignedOrder: 0,
    });

    expect(sendSignerInvite).not.toHaveBeenCalled();
  });

  it("does not send invite when all signers are done", async () => {
    const { sendSignerInvite } = await import("~/server/delivery");
    const { handlePostSignCompletion } = await import("~/server/api/routers/document-helpers");

    const doc = buildDocument({ signingOrder: "sequential", currentSignerIndex: 1 });
    const signer0 = buildSigner({ documentId: doc.id, signerOrder: 0, status: "SIGNED", role: "SIGNER" });
    const signer1 = buildSigner({ documentId: doc.id, signerOrder: 1, status: "SIGNED", role: "SIGNER", email: "test@test.com" });

    const mockDb = createMockDb();

    await handlePostSignCompletion({
      db: mockDb as never,
      doc: doc as never,
      docSigners: [signer0, signer1] as never[],
      justSignedId: signer1.id,
      justSignedOrder: 1,
    });

    // Should not invite — should complete instead
    expect(sendSignerInvite).not.toHaveBeenCalled();
  });

  it("handles next signer without email gracefully", async () => {
    const { sendSignerInvite } = await import("~/server/delivery");
    const { handlePostSignCompletion } = await import("~/server/api/routers/document-helpers");

    const doc = buildDocument({ signingOrder: "sequential", currentSignerIndex: 0 });
    const signer0 = buildSigner({ documentId: doc.id, signerOrder: 0, status: "SIGNED", role: "SIGNER" });
    const signer1 = buildSigner({ documentId: doc.id, signerOrder: 1, status: "PENDING", role: "SIGNER", email: null, phone: null });

    const mockDb = createMockDb();

    await handlePostSignCompletion({
      db: mockDb as never,
      doc: doc as never,
      docSigners: [signer0, signer1] as never[],
      justSignedId: signer0.id,
      justSignedOrder: 0,
    });

    expect(sendSignerInvite).not.toHaveBeenCalled();
  });
});

// ── Helpers ──

function buildSignData() {
  return {
    address: "0xtest",
    chain: "ETH" as const,
    signature: "0xsig",
    signedAt: new Date(),
    scheme: "EIP191",
    email: null,
    handSignatureData: null,
    handSignatureHash: null,
    fieldValues: { name: "Test" },
    lastIp: "1.2.3.4",
    ipUpdatedAt: new Date(),
    userAgent: "test-agent",
    identityLevel: "L0_WALLET",
    forensicEvidence: {},
    forensicHash: "fhash",
    documentStateHash: "dshash",
  };
}

function createMockDb() {
  const setFn = vi.fn().mockReturnThis();
  const whereFn = vi.fn().mockResolvedValue(undefined);
  return {
    update: vi.fn(() => ({ set: setFn.mockReturnValue({ where: whereFn }) })),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })) })) })),
    query: {
      documents: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      signers: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    },
  };
}
