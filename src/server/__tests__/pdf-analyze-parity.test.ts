import { beforeAll, describe, expect, it } from "vitest";
import { analyzePdf as analyzePdfTs } from "~/server/documents/pdf-analyze";
import { analyzePdf as analyzePdfRust, getEngineStatus } from "~/server/crypto/rust-engine";
import type { PdfAnalysisResult } from "~/lib/document/pdf-types";
import { createFakePdf } from "./helpers/fake-pdf";

function canonicalize(result: PdfAnalysisResult) {
  return {
    title: result.title,
    content: result.content,
    pageCount: result.pageCount,
    documentType: result.documentType,
    suggestedSignerCount: result.suggestedSignerCount,
    detectedAddresses: [...result.detectedAddresses]
      .map((address) => ({ ...address }))
      .sort((a, b) => a.address.localeCompare(b.address) || a.chain.localeCompare(b.chain)),
    detectedFields: [...result.detectedFields]
      .map((field) => ({ ...field }))
      .sort((a, b) => a.line - b.line || a.position - b.position || a.label.localeCompare(b.label)),
    signatureBlocks: [...result.signatureBlocks]
      .map((block) => ({
        ...block,
        fields: [...block.fields].sort((a, b) => a.line - b.line || a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.line - b.line || a.partyLabel.localeCompare(b.partyLabel)),
    detectedSigners: [...result.detectedSigners]
      .map((signer) => ({
        ...signer,
        fields: [...signer.fields].sort((a, b) => a.line - b.line || a.label.localeCompare(b.label)),
        signatureBlock: signer.signatureBlock
          ? {
              ...signer.signatureBlock,
              fields: [...signer.signatureBlock.fields].sort(
                (a, b) => a.line - b.line || a.label.localeCompare(b.label),
              ),
            }
          : null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label) || (a.role ?? "").localeCompare(b.role ?? "")),
  };
}

async function compare(text: string) {
  const pdf = await createFakePdf(text);
  const [tsResult, rustResult] = await Promise.all([analyzePdfTs(pdf), analyzePdfRust(pdf)]);
  expect(canonicalize(rustResult)).toEqual(canonicalize(tsResult));
}

beforeAll(async () => {
  const status = await getEngineStatus();
  if (!status.available) {
    throw new Error("Rust engine not running on localhost:9090. Start it with: cd rust-service && cargo run --release");
  }
});

describe("pdf analysis parity", () => {
  it("matches the TypeScript analyzer for simple contract blanks", async () => {
    await compare(
      [
        "SERVICE AGREEMENT",
        "",
        "Company Name: ________",
        "Contractor Name: ________",
        "Effective Date: ________",
        "",
        "IN WITNESS WHEREOF",
        "Signature: ________",
        "Printed Name: ________",
        "Title: ________",
      ].join("\n"),
    );
  });

  it("matches the TypeScript analyzer for wallet and multi-party content", async () => {
    await compare(
      [
        "TOKEN PURCHASE AGREEMENT",
        "",
        "Buyer Wallet: 0x1234567890abcdef1234567890abcdef12345678",
        "Seller Wallet: bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080",
        "",
        "Buyer Initials: ________    Seller Initials: ________",
        "",
        "BUYER SIGNATURE: ________",
        "SELLER SIGNATURE: ________",
      ].join("\n"),
    );
  });
});
