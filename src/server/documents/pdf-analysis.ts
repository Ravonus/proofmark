import { env } from "~/env";
import type { PdfAnalysisResult } from "~/lib/document/pdf-types";
import { analyzePdf } from "~/server/crypto/rust-engine";

export class PdfUploadError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "PdfUploadError";
    this.status = status;
  }
}

export const MAX_PDF_UPLOAD_MB = env.PDF_UPLOAD_MAX_MB;
export const MAX_PDF_UPLOAD_BYTES = MAX_PDF_UPLOAD_MB * 1024 * 1024;

/**
 * Lightweight fallback when the Rust engine is unavailable.
 * Uses pdf-parse (pure JS) for text extraction and basic field detection.
 */
async function analyzePdfFallback(buffer: Buffer): Promise<PdfAnalysisResult> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });

  let text = "";
  let pageCount = 1;
  try {
    const result = await parser.getText();
    text = result.text;
    pageCount = result.total ?? 1;
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  const lines = text.split("\n").filter((line: string) => line.trim());

  let title = "Uploaded Document";
  for (const line of lines.slice(0, 15)) {
    const trimmed = line.trim();
    if (trimmed.length > 5 && trimmed.length < 120 && trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed)) {
      title = trimmed
        .split(" ")
        .map((word: string) => word.charAt(0) + word.slice(1).toLowerCase())
        .join(" ");
      break;
    }
  }

  const sample = text.slice(0, 3000).toLowerCase();
  let documentType: string | null = null;
  const typePatterns: [RegExp, string][] = [
    [/non-?disclosure\s+agreement/i, "Non-Disclosure Agreement (NDA)"],
    [/confidentiality\s+agreement/i, "Confidentiality Agreement"],
    [/employment\s+agreement|offer\s+letter/i, "Employment Agreement"],
    [/lease\s+agreement|rental\s+agreement/i, "Lease Agreement"],
    [/service\s+agreement|consulting\s+agreement/i, "Service Agreement"],
    [/purchase\s+agreement|sale\s+agreement/i, "Purchase Agreement"],
    [/loan\s+agreement|promissory\s+note/i, "Loan Agreement"],
    [/partnership\s+agreement/i, "Partnership Agreement"],
    [/license\s+agreement/i, "Licensing Agreement"],
    [/power\s+of\s+attorney/i, "Power of Attorney"],
  ];
  for (const [pattern, label] of typePatterns) {
    if (pattern.test(sample)) {
      documentType = label;
      break;
    }
  }

  const detectedFields: PdfAnalysisResult["detectedFields"] = [];
  const sigLineRe = /(?:signature|sign\s*here|by)\s*:\s*(?:_{3,}|\.{5,}|-{5,})/i;
  const nameLineRe = /(?:print(?:ed)?\s*name|name)\s*:\s*(?:_{3,}|\.{5,}|-{5,})/i;
  const dateLineRe = /date\s*:\s*(?:_{3,}|\.{5,}|-{5,})/i;
  const titleLineRe = /title\s*:\s*(?:_{3,}|\.{5,}|-{5,})/i;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (sigLineRe.test(line)) {
      detectedFields.push({
        type: "signature",
        label: "Signature",
        value: null,
        blank: true,
        partyRole: null,
        line: index + 1,
        position: 0,
      });
    }
    if (nameLineRe.test(line)) {
      detectedFields.push({
        type: "name",
        label: "Printed Name",
        value: null,
        blank: true,
        partyRole: null,
        line: index + 1,
        position: 0,
      });
    }
    if (dateLineRe.test(line)) {
      detectedFields.push({
        type: "date",
        label: "Date",
        value: null,
        blank: true,
        partyRole: null,
        line: index + 1,
        position: 0,
      });
    }
    if (titleLineRe.test(line)) {
      detectedFields.push({
        type: "title",
        label: "Title/Role",
        value: null,
        blank: true,
        partyRole: null,
        line: index + 1,
        position: 0,
      });
    }
  }

  const signatureCount = detectedFields.filter((field) => field.type === "signature").length;
  const suggestedSignerCount = Math.max(signatureCount, 2);
  const content = lines.join("\n");

  return {
    title,
    content,
    pageCount,
    documentType,
    detectedSigners: [],
    detectedAddresses: [],
    signatureBlocks: [],
    detectedFields,
    suggestedSignerCount,
    acroformFields: [],
    sections: [],
    isFilled: false,
    blankFieldCount: detectedFields.filter((field) => field.blank).length,
    filledFieldCount: 0,
    walkthrough: [],
  };
}

export async function analyzePdfFile(file: File): Promise<PdfAnalysisResult> {
  if (!file.type.includes("pdf")) {
    throw new PdfUploadError("File must be a PDF");
  }

  if (file.size > MAX_PDF_UPLOAD_BYTES) {
    throw new PdfUploadError(`File too large (max ${MAX_PDF_UPLOAD_MB} MB)`);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    return await analyzePdf(buffer);
  } catch {
    console.warn("Rust engine unavailable, using JS fallback for PDF analysis");
    return analyzePdfFallback(buffer);
  }
}
