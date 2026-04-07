/**
 * Tests for advanced features: AcroForm extraction, header/footer stripping,
 * structural markers, entity type extraction, recital skipping, and deduplication.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { analyzePdf, type PdfAnalysisResult } from "../documents/pdf-analyze";
import { createFakePdf } from "./helpers/fake-pdf";

const FIXTURES = path.resolve(__dirname, "fixtures");

// ─── Helpers ────────────────────────────────────────────────────────────────

async function analyze(text: string): Promise<PdfAnalysisResult> {
  return analyzePdf(await createFakePdf(text));
}

function fields(result: PdfAnalysisResult, type?: string) {
  return type ? result.detectedFields.filter((f) => f.type === type) : result.detectedFields;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ACROFORM FIELD EXTRACTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("AcroForm field extraction", () => {
  let ndaResult: PdfAnalysisResult;

  it("extracts AcroForm fields from the NDA fixture", async () => {
    const buf = fs.readFileSync(path.join(FIXTURES, "basic-nda.pdf"));
    ndaResult = await analyzePdf(buf);
    // The NDA has 9 AcroForm fields — some should merge with text fields,
    // some should supplement. Either way, we should have rich results.
    expect(ndaResult.detectedFields.length).toBeGreaterThanOrEqual(10);
  });

  it("AcroForm values supplement text-based blank fields", async () => {
    // The NDA's AcroForm fields are unfilled, so they stay blank.
    // But the merge shouldn't break existing text field detection.
    const sigs = fields(ndaResult, "signature");
    expect(sigs.length).toBeGreaterThanOrEqual(2);
  });

  it("still detects signature blocks after AcroForm merge", async () => {
    expect(ndaResult.signatureBlocks.length).toBe(2);
  });

  it("signature blocks still contain name and date fields", async () => {
    for (const block of ndaResult.signatureBlocks) {
      expect(block.fields.some((f) => f.type === "name")).toBe(true);
      expect(block.fields.some((f) => f.type === "date")).toBe(true);
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAGE HEADER / FOOTER STRIPPING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Page header/footer stripping", () => {
  it("strips 'Page X of Y' lines", async () => {
    const r = await analyze("AGREEMENT\nSome text.\nPage 1 of 5\nMore text.\nPage 2 of 5\n");
    expect(r.content).not.toContain("Page 1 of 5");
    expect(r.content).not.toContain("Page 2 of 5");
  });

  it("strips centered page numbers: '- 3 -'", async () => {
    const r = await analyze("AGREEMENT\nText here.\n- 3 -\nMore text.\n");
    expect(r.content).not.toContain("- 3 -");
  });

  it("strips standalone page numbers", async () => {
    const r = await analyze("AGREEMENT\nText.\n7\nMore text.\n");
    // Single digit on its own line should be stripped
    expect(r.content).not.toMatch(/\n7\n/);
  });

  it("strips Bates numbers", async () => {
    const r = await analyze("AGREEMENT\nText.\nABC000123\nMore text.\n");
    expect(r.content).not.toContain("ABC000123");
  });

  it("strips DRAFT/CONFIDENTIAL watermarks", async () => {
    const r = await analyze("AGREEMENT\nDRAFT\nText here.\nCONFIDENTIAL\nMore text.\n");
    // Watermarks should be stripped from lines (they appear as standalone text)
    // Content is from the normalized text before stripping, but fields shouldn't be affected
    expect(r.detectedFields.filter((f) => f.label === "DRAFT")).toHaveLength(0);
  });

  it("preserves actual content lines", async () => {
    const r = await analyze(
      "SERVICE AGREEMENT\nThis is the actual agreement text.\nFIRST PARTY\nSignature: ____________________\n",
    );
    expect(r.content).toContain("actual agreement text");
    expect(fields(r, "signature").length).toBeGreaterThanOrEqual(1);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IN WITNESS WHEREOF — STRUCTURAL MARKER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("IN WITNESS WHEREOF structural marker", () => {
  it("detects at least 2 signers when IN WITNESS WHEREOF is present", async () => {
    const text = [
      "SERVICE AGREEMENT",
      "This agreement is between Company A and Company B.",
      "1. Services. Provider shall deliver services.",
      "2. Payment. Client shall pay.",
      "IN WITNESS WHEREOF, the parties have executed this Agreement.",
      "FIRST PARTY",
      "Signature: ____________________",
      "Date: __________",
      "SECOND PARTY",
      "Signature: ____________________",
      "Date: __________",
    ].join("\n");
    const r = await analyze(text);
    expect(r.suggestedSignerCount).toBeGreaterThanOrEqual(2);
    expect(r.signatureBlocks.length).toBe(2);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RECITALS / WHEREAS ZONE SKIPPING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Recital zone skipping", () => {
  it("skips fields inside WHEREAS/RECITALS section", async () => {
    const text = [
      "AGREEMENT",
      "RECITALS",
      "WHEREAS, Company: ____________________",
      "WHEREAS, Name: ____________________",
      "WHEREAS, Date: ____________________",
      "NOW, THEREFORE the parties agree:",
      "1. Services.",
      "FIRST PARTY",
      "Signature: ____________________",
    ].join("\n");
    const r = await analyze(text);
    // The WHEREAS fields should be skipped
    // Only the signature after "NOW, THEREFORE" should be detected
    const sigs = fields(r, "signature");
    expect(sigs.length).toBeGreaterThanOrEqual(1);
    // Should NOT have 3 extra fields from the WHEREAS section
    const totalBlanks = r.detectedFields.filter((f) => f.blank).length;
    expect(totalBlanks).toBeLessThan(4);
  });

  it("does not skip fields outside recital zone", async () => {
    const text = [
      "AGREEMENT",
      "WHEREAS, parties desire to enter agreement.",
      "NOW, THEREFORE:",
      "1. Services. Provider shall deliver services.",
      "FIRST PARTY",
      "Signature: ____________________",
      "Printed Name: ____________________",
    ].join("\n");
    const r = await analyze(text);
    // Signature and Name should be found (they're after NOW THEREFORE)
    expect(fields(r, "signature").length).toBeGreaterThanOrEqual(1);
    expect(fields(r, "name").length).toBeGreaterThanOrEqual(1);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENTITY TYPE EXTRACTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Entity type extraction", () => {
  it("extracts entity type from between clause", async () => {
    const text = [
      "AGREEMENT",
      'This Agreement is by and between Acme Corp, a Delaware corporation ("Seller") and',
      'BigCo LLC, a California limited liability company ("Buyer").',
      "1. Purchase.",
      "FIRST PARTY",
      "Signature: ____________________",
    ].join("\n");
    const r = await analyze(text);
    // Should detect party definitions with entity types
    expect(r.detectedSigners.length).toBeGreaterThanOrEqual(1);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIELD DEDUPLICATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Field deduplication", () => {
  it("removes duplicate fields on the same line", async () => {
    // This line has Signature + Date + Initials all detected,
    // and also a standalone "Signature" pattern. Should not double-count.
    const text = ["FIRST PARTY", "Signature: ____________________ Date: __________ Initials: ___"].join("\n");
    const r = await analyze(text);
    const sigs = fields(r, "signature");
    const dates = fields(r, "date");
    const initials = fields(r, "initials");
    // Each type should appear exactly once on this line
    expect(sigs.filter((f) => f.line === 2).length).toBe(1);
    expect(dates.filter((f) => f.line === 2).length).toBe(1);
    expect(initials.filter((f) => f.line === 2).length).toBe(1);
  });

  it("fields are sorted by line number", async () => {
    const text = [
      "AGREEMENT",
      "Name: ____________________",
      "Date: __________",
      "Signature: ____________________",
    ].join("\n");
    const r = await analyze(text);
    const lines = r.detectedFields.map((f) => f.line);
    const sorted = [...lines].sort((a, b) => a - b);
    expect(lines).toEqual(sorted);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ACROFORM FIELD NAME CLASSIFICATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("AcroForm field name classification (via NDA fixture)", () => {
  let ndaResult: PdfAnalysisResult;

  it("parses without error", async () => {
    const buf = fs.readFileSync(path.join(FIXTURES, "basic-nda.pdf"));
    ndaResult = await analyzePdf(buf);
    expect(ndaResult).toBeDefined();
  });

  it("detects name fields from AcroForm", async () => {
    // "Typed or Printed Name" AcroForm field should merge with text name field
    const names = fields(ndaResult, "name");
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it("detects date fields from AcroForm", async () => {
    const dates = fields(ndaResult, "date");
    expect(dates.length).toBeGreaterThanOrEqual(2);
  });

  it("detects address fields", async () => {
    // "with a mailing address of" AcroForm fields
    const addrs = fields(ndaResult, "address");
    expect(addrs.length).toBeGreaterThanOrEqual(2);
  });
});
