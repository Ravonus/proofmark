/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFSignature, PDFTextField } from "pdf-lib";
import { PDFParse } from "pdf-parse";

// Re-export types from the shared file (safe for client imports)
export type {
  DetectedAddress,
  DetectedField,
  DetectedSigner,
  FieldType,
  PdfAnalysisResult,
  SignatureBlock,
} from "~/lib/document/pdf-types";

import type { DetectedField, FieldType, PdfAnalysisResult } from "~/lib/document/pdf-types";

// Import helpers from split modules
import { detectFields, titleCase } from "./pdf-analyze-fields";
import {
  buildSignerList,
  detectPartyDefinitions,
  detectSignatureBlocks,
  estimateSignerCount,
  findWalletAddresses,
} from "./pdf-analyze-signers";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ANALYSIS_TIMEOUT_MS = 20_000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEXT NORMALIZATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Normalize PDF text quirks before regex matching */
function normalizeText(text: string): string {
  return (
    text
      // Ligatures
      .replace(/\uFB00/g, "ff")
      .replace(/\uFB01/g, "fi")
      .replace(/\uFB02/g, "fl")
      .replace(/\uFB03/g, "ffi")
      .replace(/\uFB04/g, "ffl")
      // Smart quotes → ASCII
      .replace(/[\u2018\u2019\u201A\uFF07]/g, "'")
      .replace(/[\u201C\u201D\u201E\uFF02]/g, '"')
      // Dashes → standard
      .replace(/[\u2013\u2014\u2015]/g, "-")
      // Non-breaking space → space
      .replace(/\u00A0/g, " ")
      // Section symbol normalization
      .replace(/\u00A7/g, "§")
      // Zero-width chars
      .replace(/[\u200B\u200C\u200D\uFEFF]/g, "")
      // Multiple spaces → single
      .replace(/[ \t]{2,}/g, " ")
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export async function analyzePdf(buffer: Buffer): Promise<PdfAnalysisResult> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let text: string;
  let pageCount: number;

  try {
    const textResult = await parser.getText();
    text = textResult.text;
    pageCount = textResult.total;
  } finally {
    await parser.destroy().catch(() => {
      /* ignore destroy errors */
    });
  }

  // Extract AcroForm fields (actual PDF form fields) in parallel
  const acroFields = await extractAcroFormFields(buffer).catch(() => []);

  return new Promise<PdfAnalysisResult>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("PDF analysis timed out — file may be too complex.")),
      ANALYSIS_TIMEOUT_MS,
    );

    try {
      const capped = text.length > 500_000 ? text.slice(0, 500_000) : text;
      const normalized = normalizeText(capped);
      const lines = stripHeadersFooters(normalized.split("\n"));
      const title = extractTitle(lines);
      const content = cleanContent(lines.join("\n"));
      const documentType = detectDocumentType(normalized);

      // Detect structural zones
      const witnessIdx = findWitnessWhereofLine(lines);
      const recitalZone = findRecitalZone(lines);

      // Text-based field detection
      const textFields = detectFields(lines, recitalZone);

      // Merge AcroForm fields with text-based fields
      const mergedFields = mergeAcroFormFields(textFields, acroFields);

      // Deduplicate fields
      const detectedFields = deduplicateFields(mergedFields);

      const signatureBlocks = detectSignatureBlocks(lines, detectedFields, witnessIdx);
      const partyDefs = detectPartyDefinitions(lines, detectedFields);
      const detectedAddresses = findWalletAddresses(normalized);
      const detectedSigners = buildSignerList(partyDefs, signatureBlocks, detectedAddresses, detectedFields);

      const suggestedSignerCount = Math.max(
        detectedSigners.length,
        signatureBlocks.length,
        estimateSignerCount(normalized, lines),
      );

      clearTimeout(timer);
      resolve({
        title,
        content,
        pageCount,
        documentType,
        detectedSigners,
        detectedAddresses,
        signatureBlocks,
        detectedFields,
        suggestedSignerCount: suggestedSignerCount || 2,
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ACROFORM FIELD EXTRACTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function extractAcroFormFields(buffer: Buffer): Promise<DetectedField[]> {
  const doc = await PDFDocument.load(buffer, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  const form = doc.getForm();
  const pdfFields = form.getFields();
  if (pdfFields.length === 0) return [];

  const results: DetectedField[] = [];

  for (const field of pdfFields) {
    const name = field.getName();
    const isReadOnly = field.isReadOnly();
    if (isReadOnly) continue;

    const fieldData = classifyAcroField(field, name);
    const { line, position } = extractWidgetPosition(field);

    results.push({
      type: fieldData.type,
      label: cleanAcroFieldName(name),
      value: fieldData.value,
      blank: fieldData.blank,
      partyRole: inferPartyFromFieldName(name),
      line,
      position,
    });
  }

  return results;
}

/** Classify a single AcroForm field into type/value/blank */
function classifyAcroField(field: any, name: string): { type: FieldType; value: string | null; blank: boolean } {
  if (field instanceof PDFTextField) {
    const value = field.getText() || null;
    return { type: classifyAcroFieldName(name), value, blank: !value };
  }
  if (field instanceof PDFCheckBox) {
    return {
      type: "checkbox",
      value: field.isChecked() ? "true" : null,
      blank: !field.isChecked(),
    };
  }
  if (field instanceof PDFSignature) {
    return { type: "signature", value: null, blank: true };
  }
  if (field instanceof PDFDropdown) {
    const selected = field.getSelected();
    const value = selected.length > 0 ? selected[0]! : null;
    return { type: "other", value, blank: !value };
  }
  if (field instanceof PDFRadioGroup) {
    const value = field.getSelected() || null;
    return { type: "other", value, blank: !value };
  }
  return { type: "other", value: null, blank: true };
}

/** Extract page position from widget annotation */
function extractWidgetPosition(field: any): { line: number; position: number } {
  try {
    const widgets = field.acroField.getWidgets();
    if (widgets.length > 0) {
      const rect = widgets[0]!.getRectangle();
      return { position: Math.round(rect.x), line: Math.round(rect.y) };
    }
  } catch {
    /* widget extraction can fail on malformed PDFs */
  }
  return { line: 0, position: 0 };
}

/** Classify an AcroForm field name into our FieldType */
function classifyAcroFieldName(name: string): FieldType {
  const l = name.toLowerCase();
  const lookup: Array<[RegExp, FieldType]> = [
    [/sign(?!.*initial)/, "signature"],
    [/initial/, "initials"],
    [/company|entity|corp|org/, "company"],
    [/name|print/, "name"],
    [/date/, "date"],
    [/title|role|position/, "title"],
    [/email|e-?mail/, "email"],
    [/mail|address/, "address"],
    [/phone|tel|fax/, "phone"],
    [/wallet|eth|btc|sol/, "wallet"],
    [/amount|price|fee/, "amount"],
    [/witness/, "witness"],
    [/notary/, "notary"],
    [/account|ref|ein|ssn|tax/, "reference"],
  ];
  for (const [pattern, type] of lookup) {
    if (pattern.test(l)) return type;
  }
  return "other";
}

/** Clean AcroForm field names for display: "Typed or Printed Name_2" → "Printed Name (2)" */
function cleanAcroFieldName(name: string): string {
  const m = /^(.+?)(?:_(\d+))?$/.exec(name);
  const base = m?.[1] ?? name;
  const suffix = m?.[2] ? ` (${m[2]})` : "";
  return base.replace(/^(?:typed\s+or\s+)/i, "").trim() + suffix;
}

/** Try to infer party role from field name */
function inferPartyFromFieldName(name: string): string | null {
  const m =
    /\b(Disclosing|Receiving|First|Second|Third|Fourth|Buyer|Seller|Investor|Lender|Borrower|Landlord|Tenant|Employer|Employee)\s*(?:Party)?\b/i.exec(
      name,
    );
  if (m) return titleCase(m[0]);
  return null;
}

/**
 * Merge AcroForm fields with text-detected fields.
 */
function mergeAcroFormFields(textFields: DetectedField[], acroFields: DetectedField[]): DetectedField[] {
  if (acroFields.length === 0) return textFields;

  const textByType = new Map<string, DetectedField[]>();
  for (const f of textFields) {
    const key = f.type;
    if (!textByType.has(key)) textByType.set(key, []);
    textByType.get(key)!.push(f);
  }

  const newFields: DetectedField[] = [];

  for (const acro of acroFields) {
    const candidates = textByType.get(acro.type) || [];
    const match = candidates.find(
      (tf) =>
        tf.label.toLowerCase().includes(acro.label.toLowerCase().split(" ")[0]!) ||
        acro.label.toLowerCase().includes(tf.label.toLowerCase().split(" ")[0]!),
    );

    if (match) {
      if (acro.value && match.blank) {
        match.value = acro.value;
        match.blank = false;
      }
      if (acro.partyRole && !match.partyRole) {
        match.partyRole = acro.partyRole;
      }
    } else if (acro.type !== "other") {
      newFields.push(acro);
    }
  }

  newFields.sort((a, b) => b.line - a.line);
  return [...textFields, ...newFields];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAGE HEADER / FOOTER STRIPPING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function stripHeadersFooters(lines: string[]): string[] {
  return lines.filter((line) => {
    const t = line.trim();
    if (/^(?:page\s+)?\d+\s*(?:of\s+\d+)?$/i.test(t)) return false;
    if (/^-\s*\d+\s*-$/.test(t)) return false;
    if (/^[A-Z]{2,6}\d{4,10}$/.test(t)) return false;
    if (/^(?:DRAFT|CONFIDENTIAL|PRIVILEGED|SAMPLE)$/i.test(t)) return false;
    return true;
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STRUCTURAL ZONE DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function findWitnessWhereofLine(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/\bin\s+witness\s+whereof\b/i.test(lines[i]!)) return i;
  }
  return -1;
}

function findRecitalZone(lines: string[]): { start: number; end: number } | null {
  let start = -1;
  let end = -1;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (start === -1 && /^(?:RECITALS|WHEREAS)\b/i.test(t)) {
      start = i;
    }
    if (start !== -1 && end === -1) {
      if (/^(?:NOW,?\s+THEREFORE|AGREEMENT|1\.\s)/i.test(t)) {
        end = i;
        break;
      }
    }
  }

  if (start !== -1 && end === -1) end = Math.min(start + 30, lines.length);
  return start !== -1 ? { start, end } : null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIELD DEDUPLICATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function deduplicateFields(fields: DetectedField[]): DetectedField[] {
  const seen = new Set<string>();
  const result: DetectedField[] = [];

  for (const f of fields) {
    const key = `${f.type}:${f.label}:${f.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(f);
  }

  result.sort((a, b) => a.line - b.line || a.position - b.position);
  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DOCUMENT TYPE & TITLE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function extractTitle(lines: string[]): string {
  const skip = /^(page|date|section|article|clause|copyright|©|\(c\)|--|draft|confidential|$)/i;
  for (const line of lines.slice(0, 15)) {
    const t = line.trim();
    if (!t || skip.test(t)) continue;
    if (t === t.toUpperCase() && t.length > 5 && t.length < 120 && /[A-Z]/.test(t)) {
      return titleCase(t);
    }
  }
  for (const line of lines.slice(0, 8)) {
    const t = line.trim();
    if (!t || skip.test(t)) continue;
    if (t.length > 4 && t.length < 120 && !/^\d+$/.test(t)) return t;
  }
  return "Uploaded Document";
}

function cleanContent(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const DOCUMENT_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\bnon[\s-]?disclosure\s+agreement\b/i, "Non-Disclosure Agreement (NDA)"],
  [/\bconfidentiality\s+agreement\b/i, "Confidentiality Agreement"],
  [/\bmaster\s+service\s+agreement\b/i, "Master Service Agreement"],
  [/\bservice\s+(?:level\s+)?agreement\b/i, "Service Agreement"],
  [/\bconsulting\s+agreement\b/i, "Consulting Agreement"],
  [/\bemployment\s+(agreement|contract)\b/i, "Employment Agreement"],
  [/\bindependent\s+contractor\b/i, "Independent Contractor Agreement"],
  [/\blicense\s+agreement\b/i, "License Agreement"],
  [/\blease\s+agreement\b/i, "Lease Agreement"],
  [/\bpartnership\s+agreement\b/i, "Partnership Agreement"],
  [/\bmemorandum\s+of\s+understanding\b/i, "Memorandum of Understanding"],
  [/\bletter\s+of\s+intent\b/i, "Letter of Intent"],
  [/\bterms\s+(of\s+service|and\s+conditions)\b/i, "Terms of Service"],
  [/\bsimple\s+agreement\s+for\s+future\s+(tokens|equity)\b/i, "SAFT/SAFE Agreement"],
  [/\btoken\s+(purchase|sale)\s+agreement\b/i, "Token Purchase Agreement"],
  [/\bpower\s+of\s+attorney\b/i, "Power of Attorney"],
  [/\boperating\s+agreement\b/i, "Operating Agreement (LLC)"],
  [/\bshareholder[s']?\s+agreement\b/i, "Shareholder Agreement"],
  [/\bstock\s+purchase\s+agreement\b/i, "Stock Purchase Agreement"],
  [/\bstock\s+option\s+agreement\b/i, "Stock Option Agreement"],
  [/\bsubscription\s+agreement\b/i, "Subscription Agreement"],
  [/\bboard\s+resolution\b/i, "Board Resolution"],
  [/\bunanimous\s+written\s+consent\b/i, "Written Consent"],
  [/\bsecretary['s]*\s+certificate\b/i, "Secretary's Certificate"],
  [/\bbylaws\b/i, "Corporate Bylaws"],
  [/\barticles\s+of\s+(?:incorporation|organization)\b/i, "Articles of Incorporation"],
  [/\bpromissory\s+note\b/i, "Promissory Note"],
  [/\bconvertible\s+(?:promissory\s+)?note\b/i, "Convertible Note"],
  [/\bloan\s+agreement\b/i, "Loan Agreement"],
  [/\bsecurity\s+agreement\b/i, "Security Agreement"],
  [/\bguarant[ey]\s+agreement\b/i, "Guarantee Agreement"],
  [/\bindemnification\s+agreement\b/i, "Indemnification Agreement"],
  [/\bescrow\s+agreement\b/i, "Escrow Agreement"],
  [/\bpurchase\s+and\s+sale\s+agreement\b/i, "Purchase & Sale Agreement"],
  [/\bdeed\s+of\s+trust\b/i, "Deed of Trust"],
  [/\b(?:warranty|quitclaim|grant)\s+deed\b/i, "Deed"],
  [/\bsublease\b/i, "Sublease Agreement"],
  [/\bnon[\s-]?compete\s+agreement\b/i, "Non-Compete Agreement"],
  [/\bnon[\s-]?solicitation\s+agreement\b/i, "Non-Solicitation Agreement"],
  [/\binvention\s+assignment\b/i, "Invention Assignment Agreement"],
  [/\b(?:ip|intellectual\s+property)\s+assignment\b/i, "IP Assignment Agreement"],
  [/\bsettlement\s+agreement\b/i, "Settlement Agreement"],
  [/\brelease\s+and\s+waiver\b/i, "Release and Waiver"],
  [/\barbitration\s+agreement\b/i, "Arbitration Agreement"],
  [/\bbill\s+of\s+sale\b/i, "Bill of Sale"],
  [/\bassignment\s+(?:and\s+assumption\s+)?agreement\b/i, "Assignment Agreement"],
  [/\bjoint\s+venture\s+agreement\b/i, "Joint Venture Agreement"],
  [/\bdata\s+processing\s+agreement\b/i, "Data Processing Agreement"],
  [/\b(?:first|second|third|\d+(?:st|nd|rd|th))?\s*amendment\s+to\b/i, "Amendment"],
  [/\baddendum\s+to\b/i, "Addendum"],
  [/\blast\s+will\s+and\s+testament\b/i, "Last Will and Testament"],
  [/\b(?:revocable|irrevocable)\s+trust\b/i, "Trust Agreement"],
  [/\bstatement\s+of\s+work\b/i, "Statement of Work"],
  [/\bletter\s+agreement\b/i, "Letter Agreement"],
  [/\bdao\s+charter\b/i, "DAO Charter"],
  [/\bdigital\s+asset\b.*\bagreement\b/i, "Digital Asset Agreement"],
  [/\bcustody\s+agreement\b/i, "Custody Agreement"],
  [/\btreasury\s+management\b/i, "Treasury Management Agreement"],
  [/\bsmart\s+contract\s+(?:audit|agreement)\b/i, "Smart Contract Agreement"],
];

function detectDocumentType(text: string): string | null {
  for (const [pattern, label] of DOCUMENT_TYPE_PATTERNS) {
    if (pattern.test(text)) return label;
  }
  return null;
}
