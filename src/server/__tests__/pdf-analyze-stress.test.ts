/**
 * Stress test for the PDF analyzer — exercises the multi-party, multi-clause,
 * named-entity approval block patterns seen in complex commercial contracts.
 *
 * We bypass the actual PDF parser and feed raw text directly into the analysis
 * pipeline via a thin wrapper around analyzePdf that accepts a fake PDF buffer
 * whose text content we control.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { analyzePdf, type PdfAnalysisResult } from "../documents/pdf-analyze";
import { createFakePdf } from "./helpers/fake-pdf";

// ─── Build a contract that mirrors the "final_boss_contract.pdf" structure ────

function buildStressContract(): string {
  const PARTIES = [
    { entity: "Aurora Peak Holdings LLC", role: "Buyer" },
    { entity: "Silverline Infrastructure Inc.", role: "Seller" },
    { entity: "North Ridge Capital Partners LP", role: "Investor" },
    { entity: "Cobalt Legal Group PLLC", role: "Legal Counsel" },
    { entity: "Evergreen Compliance Services LLC", role: "Auditor" },
  ];

  const WALLETS: Record<string, string> = {
    Buyer: "0xFFaa1293bcAA9912dFf99123AbC1234567890Def",
    Seller: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    Investor: "0xA91bD4F3cE12aF9812c1D3A9fF02EAbC12345678",
    "Legal Counsel": "0xFFaa1293bcAA9912dFf99123AbC1234567890Def",
    Auditor: "0xFFaa1293bcAA9912dFf99123AbC1234567890Def",
  };

  const lines: string[] = [];

  lines.push("MASTER DIGITAL ASSET & COMMERCIAL AGREEMENT");
  lines.push("");
  lines.push("This Agreement governs asset transfers, services, and digital interactions between all listed parties,");
  lines.push("including Web3-based settlement layers.");
  lines.push("");

  // Generate 5 clauses with repeated signature blocks
  for (let clause = 1; clause <= 5; clause++) {
    lines.push(`${clause}. COMPLEX CLAUSE ${clause}`);
    lines.push("");

    // Each clause has boilerplate + varying approval blocks
    const clauseParties = PARTIES.slice(0, 2 + (clause % 3)); // rotate which parties appear

    for (const party of clauseParties) {
      lines.push(
        "Each Party agrees that all obligations under this Agreement shall be enforceable to the fullest extent",
      );
      lines.push(
        "permitted by law. The Parties acknowledge the integration of digital asset infrastructure, including",
      );
      lines.push("blockchain-based settlement systems, and agree that wallet addresses provided herein shall be");
      lines.push(
        "considered valid payment destinations. Any failure to maintain custody of cryptographic keys shall not",
      );
      lines.push(`relieve obligations. Signature: ____________________ Date: __________ Initials: ___ Wallet:`);
      lines.push(WALLETS[party.role] ?? "0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
      lines.push("");
      lines.push(`${party.entity} (${party.role}) Approval:`);
      lines.push("Signature: ____________________");
      lines.push("Date: __________");
      lines.push("Initials: ___");
      lines.push("");
    }

    // Multi-party initials line at end of each clause
    lines.push("Buyer Initials: ___ Seller Initials: ___ Investor Initials: ___ Counsel Initials: ___");
    lines.push("");
  }

  // Final execution page
  lines.push("SPECIAL CONDITIONS & EXECUTION CHAOS PAGE");
  lines.push("");
  for (const party of PARTIES) {
    lines.push(
      `Each Party agrees that all obligations... Signature: ____________________ Date: __________ Initials: ___ Wallet:`,
    );
    lines.push(WALLETS[party.role] ?? "0xFFaa1293bcAA9912dFf99123AbC1234567890Def");
    lines.push("");
  }
  lines.push("Buyer Signature: ____________________ Seller Initials: ___");
  lines.push("Date: __________");
  lines.push("Investor Signature: ____________________");
  lines.push("Wallet Confirmation: ____________________");
  lines.push("Legal Counsel Signature: ____________________ Date: __________");

  return lines.join("\n");
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let result: PdfAnalysisResult;

describe("PDF Analyzer — Stress Test (Multi-Party Multi-Clause)", () => {
  beforeAll(async () => {
    const text = buildStressContract();
    const buf = await createFakePdf(text);
    result = await analyzePdf(buf);
  });

  // ━━━ TITLE & METADATA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("extracts the title", () => {
    expect(result.title.toLowerCase()).toContain("master digital asset");
  });

  it("extracts non-empty content", () => {
    expect(result.content.length).toBeGreaterThan(500);
  });

  // ━━━ SIGNATURE BLOCKS (deduplication) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("deduplicates signature blocks — should have at most 5 unique roles", () => {
    // Even though each role appears in multiple clauses, we should get one block per role
    expect(result.signatureBlocks.length).toBeLessThanOrEqual(5);
    expect(result.signatureBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it("signature blocks have unique party roles", () => {
    const roles = result.signatureBlocks.map((b) => b.partyRole.toLowerCase());
    const uniqueRoles = new Set(roles);
    expect(uniqueRoles.size).toBe(roles.length);
  });

  it("Buyer signature block exists", () => {
    const block = result.signatureBlocks.find((b) => b.partyRole.toLowerCase() === "buyer");
    expect(block).toBeDefined();
  });

  it("Seller signature block exists", () => {
    const block = result.signatureBlocks.find((b) => b.partyRole.toLowerCase() === "seller");
    expect(block).toBeDefined();
  });

  it("signature blocks include entity name in partyLabel", () => {
    const buyerBlock = result.signatureBlocks.find((b) => b.partyRole.toLowerCase() === "buyer");
    expect(buyerBlock?.partyLabel).toContain("Aurora Peak");
  });

  // ━━━ SIGNERS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("detects at least 2 distinct signers", () => {
    expect(result.detectedSigners.length).toBeGreaterThanOrEqual(2);
  });

  it("each signer has a role", () => {
    for (const s of result.detectedSigners) {
      expect(s.role).toBeTruthy();
    }
  });

  it("signer labels include entity names (not just role)", () => {
    const labels = result.detectedSigners.map((s) => s.label);
    // At least one should have the actual company name
    expect(labels.some((l) => /aurora|silverline|north ridge|cobalt|evergreen/i.test(l))).toBe(true);
  });

  // ━━━ WALLET ADDRESSES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("detects wallet addresses (EVM and BTC)", () => {
    expect(result.detectedAddresses.length).toBeGreaterThanOrEqual(2);
  });

  it("detects the BTC address", () => {
    const btc = result.detectedAddresses.find((a) => a.chain === "BTC");
    expect(btc).toBeDefined();
    expect(btc!.address).toBe("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh");
  });

  it("detects EVM addresses", () => {
    const evm = result.detectedAddresses.filter((a) => a.chain === "ETH");
    expect(evm.length).toBeGreaterThanOrEqual(1);
  });

  // ━━━ INITIALS DETECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("detects initials fields", () => {
    const initials = result.detectedFields.filter((f) => f.type === "initials");
    expect(initials.length).toBeGreaterThan(0);
  });

  it("multi-party initials lines are correctly attributed to different parties", () => {
    const initialsFields = result.detectedFields.filter((f) => f.type === "initials");
    const roles = new Set(initialsFields.map((f) => f.partyRole?.toLowerCase()).filter(Boolean));
    // Should have Buyer, Seller, Investor, Counsel from the multi-party initials lines
    expect(roles.size).toBeGreaterThanOrEqual(3);
  });

  it("Buyer initials are labeled for Buyer", () => {
    const buyerInitials = result.detectedFields.find((f) => f.type === "initials" && f.partyRole === "Buyer");
    expect(buyerInitials).toBeDefined();
  });

  it("Seller initials are labeled for Seller", () => {
    const sellerInitials = result.detectedFields.find((f) => f.type === "initials" && f.partyRole === "Seller");
    expect(sellerInitials).toBeDefined();
  });

  // ━━━ WALLET FIELD DETECTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("detects wallet fields with values", () => {
    const wallets = result.detectedFields.filter((f) => f.type === "wallet");
    expect(wallets.length).toBeGreaterThan(0);
  });

  it("wallet fields have non-null values", () => {
    const wallets = result.detectedFields.filter((f) => f.type === "wallet");
    for (const w of wallets) {
      expect(w.value).toBeTruthy();
      expect(w.blank).toBe(false);
    }
  });

  // ━━━ NO FALSE POSITIVES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("doesn't create hundreds of duplicate fields from repeated clauses", () => {
    // With 5 clauses each having ~5 parties, raw fields could be 100+.
    // After dedup of signature blocks, we should have a reasonable count.
    expect(result.signatureBlocks.length).toBeLessThanOrEqual(10);
  });

  // ━━━ BALANCED FIELD DISTRIBUTION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  it("no single signer has more than 20 fields", () => {
    for (const s of result.detectedSigners) {
      expect(s.fields.length).toBeLessThanOrEqual(20);
    }
  });

  it("fields are distributed across signers (not all on one)", () => {
    const signersWithFields = result.detectedSigners.filter((s) => s.fields.length > 0);
    // At least 2 signers should have fields
    expect(signersWithFields.length).toBeGreaterThanOrEqual(2);
  });

  it("each signer with a signature block has at least a signature field", () => {
    for (const s of result.detectedSigners) {
      if (s.signatureBlock) {
        expect(s.fields.some((f) => f.type === "signature" || f.type === "initials")).toBe(true);
      }
    }
  });
});
