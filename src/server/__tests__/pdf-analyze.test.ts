import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { analyzePdf, type PdfAnalysisResult } from "../documents/pdf-analyze";

const FIXTURES = path.resolve(__dirname, "fixtures");
const loadFixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name));

// ─── Helper to run analysis once and reuse ────────────────────────────────────

let ndaResult: PdfAnalysisResult;

describe("PDF Analyzer — Basic NDA", () => {
  it("parses the PDF without throwing", async () => {
    const buf = loadFixture("basic-nda.pdf");
    ndaResult = await analyzePdf(buf);
    expect(ndaResult).toBeDefined();
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // TITLE & METADATA
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("extracts the correct title", () => {
    expect(ndaResult.title).toBe("Non-Disclosure Agreement (NDA)");
  });

  it("detects document type as NDA", () => {
    expect(ndaResult.documentType).toBe("Non-Disclosure Agreement (NDA)");
  });

  it("detects 2 pages", () => {
    expect(ndaResult.pageCount).toBe(2);
  });

  it("extracts non-empty content", () => {
    expect(ndaResult.content.length).toBeGreaterThan(1000);
  });

  it("content includes the actual agreement text", () => {
    expect(ndaResult.content).toContain("Confidential Information");
    expect(ndaResult.content).toContain("Obligations of Receiving Party");
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SIGNER DETECTION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("suggests 2 signers", () => {
    expect(ndaResult.suggestedSignerCount).toBe(2);
  });

  it("detects exactly 2 signers", () => {
    expect(ndaResult.detectedSigners).toHaveLength(2);
  });

  it("signer 1 has role 'Disclosing Party'", () => {
    const s = ndaResult.detectedSigners[0]!;
    expect(s.role).toBe("Disclosing Party");
  });

  it("signer 2 has role 'Receiving Party'", () => {
    const s = ndaResult.detectedSigners[1]!;
    expect(s.role).toBe("Receiving Party");
  });

  it("both signers have blank names (unfilled PDF)", () => {
    for (const s of ndaResult.detectedSigners) {
      // Label should be the role since no name was filled in
      expect(s.label).toMatch(/Party/);
    }
  });

  it("both signers are linked to a signature block", () => {
    for (const s of ndaResult.detectedSigners) {
      expect(s.signatureBlock).not.toBeNull();
    }
  });

  it("signer 1 signature block is for DISCLOSING PARTY", () => {
    expect(ndaResult.detectedSigners[0]!.signatureBlock!.partyLabel).toBe("DISCLOSING PARTY");
  });

  it("signer 2 signature block is for RECEIVING PARTY", () => {
    expect(ndaResult.detectedSigners[1]!.signatureBlock!.partyLabel).toBe("RECEIVING PARTY");
  });

  it("each signer has associated blank fields", () => {
    for (const s of ndaResult.detectedSigners) {
      const blankFields = s.fields.filter((f) => f.blank);
      expect(blankFields.length).toBeGreaterThan(0);
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SIGNATURE BLOCKS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("detects exactly 2 signature blocks", () => {
    expect(ndaResult.signatureBlocks).toHaveLength(2);
  });

  it("signature block 1 is DISCLOSING PARTY", () => {
    expect(ndaResult.signatureBlocks[0]!.partyLabel).toBe("DISCLOSING PARTY");
  });

  it("signature block 2 is RECEIVING PARTY", () => {
    expect(ndaResult.signatureBlocks[1]!.partyLabel).toBe("RECEIVING PARTY");
  });

  it("each signature block contains a signature field", () => {
    for (const block of ndaResult.signatureBlocks) {
      const sigField = block.fields.find((f) => f.type === "signature");
      expect(sigField).toBeDefined();
      expect(sigField!.blank).toBe(true);
    }
  });

  it("each signature block contains a printed name field", () => {
    for (const block of ndaResult.signatureBlocks) {
      const nameField = block.fields.find((f) => f.type === "name");
      expect(nameField).toBeDefined();
      expect(nameField!.blank).toBe(true);
    }
  });

  it("each signature block contains a date field", () => {
    for (const block of ndaResult.signatureBlocks) {
      const dateField = block.fields.find((f) => f.type === "date");
      expect(dateField).toBeDefined();
      expect(dateField!.blank).toBe(true);
    }
  });

  it("signature blocks have correct line numbers (near end of document)", () => {
    for (const block of ndaResult.signatureBlocks) {
      expect(block.line).toBeGreaterThan(50);
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DETECTED FIELDS — the core "every ______ is an INPUT" system
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("detects at least 12 fields total", () => {
    expect(ndaResult.detectedFields.length).toBeGreaterThanOrEqual(12);
  });

  it("all detected fields have a line number", () => {
    for (const f of ndaResult.detectedFields) {
      expect(f.line).toBeGreaterThan(0);
    }
  });

  // ── Agreement Date ──────────────────────────────────────────────────────

  it("detects the agreement date field (line ~4)", () => {
    const dateField = ndaResult.detectedFields.find((f) => f.type === "date" && f.label === "Agreement Date");
    expect(dateField).toBeDefined();
    expect(dateField!.blank).toBe(true);
    expect(dateField!.partyRole).toBeNull();
  });

  // ── Party Name Fields (top of document) ─────────────────────────────────

  it("detects Disclosing Party name field", () => {
    const field = ndaResult.detectedFields.find((f) => f.type === "name" && f.label === "Disclosing Party Name");
    expect(field).toBeDefined();
    expect(field!.blank).toBe(true);
    expect(field!.partyRole).toBe("Disclosing Party");
  });

  it("detects Receiving Party name field", () => {
    const field = ndaResult.detectedFields.find((f) => f.type === "name" && f.label === "Receiving Party Name");
    expect(field).toBeDefined();
    expect(field!.blank).toBe(true);
    expect(field!.partyRole).toBe("Receiving Party");
  });

  // ── Mailing Address Fields ──────────────────────────────────────────────

  it("detects mailing address fields for Disclosing Party", () => {
    const fields = ndaResult.detectedFields.filter((f) => f.type === "address" && f.partyRole === "Disclosing Party");
    expect(fields.length).toBeGreaterThanOrEqual(1);
    expect(fields.every((f) => f.blank)).toBe(true);
  });

  it("detects mailing address fields for Receiving Party", () => {
    const fields = ndaResult.detectedFields.filter((f) => f.type === "address" && f.partyRole === "Receiving Party");
    expect(fields.length).toBeGreaterThanOrEqual(1);
    expect(fields.every((f) => f.blank)).toBe(true);
  });

  // ── Signature Fields (bottom of document) ───────────────────────────────

  it("detects exactly 2 signature fields", () => {
    const sigFields = ndaResult.detectedFields.filter((f) => f.type === "signature");
    expect(sigFields).toHaveLength(2);
    expect(sigFields.every((f) => f.blank)).toBe(true);
  });

  it("signature fields are assigned to the correct parties", () => {
    const sigFields = ndaResult.detectedFields.filter((f) => f.type === "signature");
    const roles = sigFields.map((f) => f.partyRole?.toLowerCase().replace(/\s+/g, " "));
    expect(roles).toContain("disclosing party");
    expect(roles).toContain("receiving party");
  });

  // ── Printed Name Fields (in signature blocks) ──────────────────────────

  it("detects exactly 2 printed name fields in signature blocks", () => {
    const nameFields = ndaResult.detectedFields.filter((f) => f.type === "name" && f.label === "Printed Name");
    expect(nameFields).toHaveLength(2);
  });

  // ── Date Fields in Signature Blocks ─────────────────────────────────────

  it("detects date fields in signature blocks (not the agreement date)", () => {
    const sigDates = ndaResult.detectedFields.filter((f) => f.type === "date" && f.label === "Date" && f.partyRole);
    expect(sigDates).toHaveLength(2);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FIELD TYPE DISTRIBUTION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("has the correct field type distribution", () => {
    const blanks = ndaResult.detectedFields.filter((f) => f.blank);
    const counts: Record<string, number> = {};
    for (const f of blanks) counts[f.type] = (counts[f.type] || 0) + 1;

    expect(counts.signature).toBe(2);
    expect(counts.name).toBe(4); // 2 party names + 2 printed names
    expect(counts.address).toBeGreaterThanOrEqual(2);
    expect(counts.date).toBe(3); // 1 agreement date + 2 sig block dates
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FALSE POSITIVE REJECTION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("does not detect copyright lines as signers", () => {
    const labels = ndaResult.detectedSigners.map((s) => s.label.toLowerCase());
    expect(labels.every((l) => !l.includes("copyright"))).toBe(true);
    expect(labels.every((l) => !l.includes("nondisclosureagreement.com"))).toBe(true);
  });

  it("does not detect section headings as signers", () => {
    const labels = ndaResult.detectedSigners.map((s) => s.label.toLowerCase());
    expect(labels.every((l) => !l.includes("definition"))).toBe(true);
    expect(labels.every((l) => !l.includes("exclusions"))).toBe(true);
    expect(labels.every((l) => !l.includes("obligations"))).toBe(true);
    expect(labels.every((l) => !l.includes("time periods"))).toBe(true);
  });

  it("does not detect legal boilerplate as signers", () => {
    const labels = ndaResult.detectedSigners.map((s) => s.label.toLowerCase());
    expect(labels.every((l) => !l.includes("agreement"))).toBe(true);
    expect(labels.every((l) => !l.includes("typed or printed name"))).toBe(true);
    expect(labels.every((l) => !l.includes("nondisclosure"))).toBe(true);
  });

  it("does not detect 'Confidential Information' as a signer", () => {
    const labels = ndaResult.detectedSigners.map((s) => s.label.toLowerCase());
    expect(labels.every((l) => !l.includes("confidential"))).toBe(true);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // WALLET ADDRESS DETECTION (none expected in this PDF)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("detects no wallet addresses in a standard NDA", () => {
    expect(ndaResult.detectedAddresses).toHaveLength(0);
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // PARTY-FIELD LINKAGE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("links party definition fields (name+address) to the correct signer", () => {
    const disclosing = ndaResult.detectedSigners.find((s) => s.role === "Disclosing Party")!;
    const nameField = disclosing.fields.find((f) => f.type === "name" && f.label.includes("Disclosing"));
    expect(nameField).toBeDefined();
  });

  it("links signature block fields to the correct signer", () => {
    const disclosing = ndaResult.detectedSigners.find((s) => s.role === "Disclosing Party")!;
    expect(disclosing.signatureBlock).not.toBeNull();
    const sigField = disclosing.signatureBlock!.fields.find((f) => f.type === "signature");
    expect(sigField).toBeDefined();
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FIELD ORDERING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("fields appear in document order (by line number)", () => {
    const lines = ndaResult.detectedFields.map((f) => f.line);
    const sorted = [...lines].sort((a, b) => a - b);
    expect(lines).toEqual(sorted);
  });

  it("party definition fields appear before signature block fields", () => {
    const nameFields = ndaResult.detectedFields.filter((f) => f.type === "name" && f.label.includes("Party Name"));
    const sigFields = ndaResult.detectedFields.filter((f) => f.type === "signature");

    if (nameFields.length > 0 && sigFields.length > 0) {
      const maxNameLine = Math.max(...nameFields.map((f) => f.line));
      const minSigLine = Math.min(...sigFields.map((f) => f.line));
      expect(maxNameLine).toBeLessThan(minSigLine);
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UNIT TESTS — synthetic inputs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("PDF Analyzer — Edge cases (synthetic)", () => {
  // These tests use the same NDA result since we don't have more PDFs,
  // but validate the structural properties any PDF should produce.

  it("never produces duplicate signers for the same role", () => {
    const roles = ndaResult.detectedSigners.filter((s) => s.role).map((s) => s.role!.toLowerCase());
    const unique = new Set(roles);
    expect(unique.size).toBe(roles.length);
  });

  it("every field has a valid type", () => {
    const validTypes = ["name", "address", "date", "signature", "title", "email", "company", "other"];
    for (const f of ndaResult.detectedFields) {
      expect(validTypes).toContain(f.type);
    }
  });

  it("every signature block has at least one field", () => {
    for (const block of ndaResult.signatureBlocks) {
      expect(block.fields.length).toBeGreaterThan(0);
    }
  });

  it("every signature block has a valid signerIndex", () => {
    for (let i = 0; i < ndaResult.signatureBlocks.length; i++) {
      expect(ndaResult.signatureBlocks[i]!.signerIndex).toBe(i);
    }
  });

  it("suggestedSignerCount is at least as many as detected signers", () => {
    expect(ndaResult.suggestedSignerCount).toBeGreaterThanOrEqual(ndaResult.detectedSigners.length);
  });

  it("suggestedSignerCount is at least as many as signature blocks", () => {
    expect(ndaResult.suggestedSignerCount).toBeGreaterThanOrEqual(ndaResult.signatureBlocks.length);
  });

  it("content does not contain null bytes", () => {
    expect(ndaResult.content).not.toContain("\0");
  });

  it("title is not empty", () => {
    expect(ndaResult.title.length).toBeGreaterThan(0);
  });

  it("title does not contain copyright notice", () => {
    expect(ndaResult.title.toLowerCase()).not.toContain("copyright");
  });
});
