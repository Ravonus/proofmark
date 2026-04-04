/**
 * Test against the ACTUAL structure of final_boss_contract.pdf.
 * Reproduces the exact text layout from pdf-parse extraction.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { analyzePdf, type PdfAnalysisResult } from "../pdf-analyze";
import { createFakePdf } from "./helpers/fake-pdf";

function buildRealContract(): string {
  const lines: string[] = [];

  lines.push("MASTER DIGITAL ASSET & COMMERCIAL");
  lines.push("AGREEMENT");
  lines.push("This Agreement governs asset transfers, services, and digital interactions between all listed parties,");
  lines.push("including Web3-based settlement layers.");
  lines.push("1. COMPLEX CLAUSE 1");

  // The REAL structure: boilerplate paragraphs with inline Sig/Date/Init/Wallet
  // THEN a named approval block. Repeat per party, per clause.
  const boilerplate = (wallet: string) => {
    lines.push(
      "Each Party agrees that all obligations under this Agreement shall be enforceable to the fullest extent",
    );
    lines.push("permitted by law. The Parties acknowledge the integration of digital asset infrastructure, including");
    lines.push("blockchain-based settlement systems, and agree that wallet addresses provided herein shall be");
    lines.push(
      "considered valid payment destinations. Any failure to maintain custody of cryptographic keys shall not",
    );
    lines.push(`relieve obligations. Signature: ____________________ Date: __________ Initials: ___ Wallet:`);
    lines.push(wallet);
  };

  const approvalBlock = (entity: string, role: string) => {
    lines.push(`${entity} (${role}) Approval:`);
    lines.push("Signature: ____________________");
    lines.push("Date: __________");
    lines.push("Initials: ___");
  };

  const multiInitials = () => {
    lines.push("Buyer Initials: ___ Seller Initials: ___ Investor Initials: ___ Counsel Initials: ___");
  };

  // Clause 1 - mirrors the real PDF
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  approvalBlock("Aurora Peak Holdings LLC", "Buyer");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  boilerplate("0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678");
  approvalBlock("Cobalt Legal Group PLLC", "Legal Counsel");

  // Page break effect - Initials on new "page" line
  lines.push("Initials: ___");
  boilerplate("0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678");
  approvalBlock("Cobalt Legal Group PLLC", "Legal Counsel");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  approvalBlock("Aurora Peak Holdings LLC", "Buyer");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  approvalBlock("North Ridge Capital Partners LP", "Investor");
  multiInitials();

  // Clause 2
  lines.push("2. COMPLEX CLAUSE 2");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  approvalBlock("Cobalt Legal Group PLLC", "Legal Counsel");
  boilerplate("0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  approvalBlock("North Ridge Capital Partners LP", "Investor");
  multiInitials();

  // Clause 3
  lines.push("3. COMPLEX CLAUSE 3");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  approvalBlock("Cobalt Legal Group PLLC", "Legal Counsel");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  approvalBlock("Silverline Infrastructure Inc.", "Seller");
  boilerplate("0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  approvalBlock("North Ridge Capital Partners LP", "Investor");
  multiInitials();

  // Clause 4
  lines.push("4. COMPLEX CLAUSE 4");
  boilerplate("0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678");
  approvalBlock("Silverline Infrastructure Inc.", "Seller");
  boilerplate("0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678");
  boilerplate("0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678");
  approvalBlock("Cobalt Legal Group PLLC", "Legal Counsel");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  boilerplate("0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678");
  approvalBlock("North Ridge Capital Partners LP", "Investor");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  approvalBlock("North Ridge Capital Partners LP", "Investor");
  boilerplate("0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678");
  multiInitials();

  // Clause 5
  lines.push("5. COMPLEX CLAUSE 5");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  approvalBlock("Silverline Infrastructure Inc.", "Seller");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  approvalBlock("Aurora Peak Holdings LLC", "Buyer");
  boilerplate("0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678");
  boilerplate("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  boilerplate("0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  approvalBlock("Evergreen Compliance Services LLC", "Auditor");
  boilerplate("0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
  approvalBlock("Cobalt Legal Group PLLC", "Legal Counsel");
  multiInitials();

  // Execution page
  lines.push("SPECIAL CONDITIONS & EXECUTION CHAOS PAGE");
  for (let i = 0; i < 10; i++) {
    boilerplate(
      [
        "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
        "0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678",
        "0xFFaa1293bcAA9912dFf99123AbC1234567890Def",
      ][i % 3]!,
    );
  }
  lines.push("Buyer Signature: ____________________ Seller Initials: ___");
  lines.push("Date: __________");
  lines.push("Investor Signature: ____________________");
  lines.push("Wallet Confirmation: ____________________");
  lines.push("Legal Counsel Signature: ____________________ Date: __________");

  return lines.join("\n");
}

let result: PdfAnalysisResult;

describe("Real-world stress test (final_boss_contract structure)", () => {
  beforeAll(async () => {
    const text = buildRealContract();
    const buf = await createFakePdf(text);
    result = await analyzePdf(buf);
  });

  // ━━━ CRITICAL: Field distribution ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("no signer has more than 10 fields", () => {
    for (const s of result.detectedSigners) {
      console.log(`  ${s.label} (${s.role}): ${s.fields.length} fields [${s.source}]`);
      for (const f of s.fields) {
        console.log(`    - ${f.type}: ${f.label} ${f.blank ? "(blank)" : (f.value ?? "")}`);
      }
    }
    for (const s of result.detectedSigners) {
      expect(s.fields.length, `${s.label} has too many fields`).toBeLessThanOrEqual(10);
    }
  });

  it("at least 3 signers have fields", () => {
    const withFields = result.detectedSigners.filter((s) => s.fields.length > 0);
    expect(withFields.length).toBeGreaterThanOrEqual(3);
  });

  it("detects all 5 named parties", () => {
    const labels = result.detectedSigners.map((s) => s.label.toLowerCase());
    expect(labels.some((l) => l.includes("aurora"))).toBe(true);
    expect(labels.some((l) => l.includes("cobalt"))).toBe(true);
    expect(labels.some((l) => l.includes("north ridge"))).toBe(true);
    expect(labels.some((l) => l.includes("silverline"))).toBe(true);
    expect(labels.some((l) => l.includes("evergreen"))).toBe(true);
  });

  it("each named signer has Signature + Date + Initials fields", () => {
    const namedSigners = result.detectedSigners.filter((s) => s.signatureBlock);
    for (const s of namedSigners) {
      const types = new Set(s.fields.map((f) => f.type));
      expect(types.has("signature"), `${s.label} missing signature`).toBe(true);
      expect(types.has("date"), `${s.label} missing date`).toBe(true);
      expect(types.has("initials"), `${s.label} missing initials`).toBe(true);
    }
  });

  it("deduplicates to at most 5 signature blocks", () => {
    expect(result.signatureBlocks.length).toBeLessThanOrEqual(5);
  });

  it("total detected fields is reasonable (not 200+)", () => {
    const totalSignerFields = result.detectedSigners.reduce((sum, s) => sum + s.fields.length, 0);
    expect(totalSignerFields).toBeLessThan(50);
  });
});
