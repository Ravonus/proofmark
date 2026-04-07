import { PDFParse } from "pdf-parse";
import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFSignature } from "pdf-lib";
import { isEvmAddress, isBitcoinAddress, isSolanaAddress, type WalletChain } from "~/lib/crypto/chains";

// Re-export types from the shared file (safe for client imports)
export type {
  FieldType,
  DetectedField,
  SignatureBlock,
  DetectedSigner,
  DetectedAddress,
  PdfAnalysisResult,
} from "~/lib/document/pdf-types";

import type {
  FieldType,
  DetectedField,
  SignatureBlock,
  DetectedSigner,
  DetectedAddress,
  PdfAnalysisResult,
} from "~/lib/document/pdf-types";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONSTANTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ANALYSIS_TIMEOUT_MS = 20_000;

/** Matches ANY blank-field indicator: underscores, dots, or dashes (3+) */
const BLANK_RE = /(?:_{3,}|\.{5,}|-{5,})/;
const BLANK_RE_G = /(?:_{3,}|\.{5,}|-{5,})/g;

/** Matches lines with 2+ party initials */
const MULTI_PARTY_INITIALS_RE =
  /\b[A-Za-z]+\s+Initials\s*:\s*(?:_{3,}|\.{3,}|-{3,}).*\b[A-Za-z]+\s+Initials\s*:\s*(?:_{3,}|\.{3,}|-{3,})/i;
const MULTI_PARTY_INITIALS_CAPTURE_RE = /\b([A-Za-z]+)\s+Initials\s*:\s*(?:_{3,}|\.{3,}|-{3,})/gi;

// Named party approval roles
const PARTY_ROLES_RE =
  /Buyer|Seller|Investor|Borrower|Lender|Licensor|Licensee|Landlord|Tenant|Legal\s*Counsel|Counsel|Auditor|Guarantor|Contractor|Client|Vendor|Supplier|Agent|Broker|Trustee|Beneficiary|Employer|Employee|Consultant|Service\s*Provider|Recipient|Grantor|Grantee|Assignor|Assignee|Mortgagor|Mortgagee|Pledgor|Pledgee|Principal|Surety|Indemnitor|Indemnitee|Obligor|Obligee|Franchisor|Franchisee|Lessor|Lessee|Partner|Member|Manager|Director|Officer|Shareholder|Stakeholder|Underwriter|Arranger|Servicer|Originator|Custodian/;

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
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const form = doc.getForm();
  const pdfFields = form.getFields();
  if (pdfFields.length === 0) return [];

  const results: DetectedField[] = [];

  for (const field of pdfFields) {
    const name = field.getName();
    const isReadOnly = field.isReadOnly();
    if (isReadOnly) continue;

    // Determine field type and value from the AcroForm field class
    let type: FieldType;
    let value: string | null = null;
    let blank = true;

    if (field instanceof PDFTextField) {
      type = classifyAcroFieldName(name);
      value = field.getText() || null;
      blank = !value;
    } else if (field instanceof PDFCheckBox) {
      type = "checkbox";
      blank = !field.isChecked();
      value = field.isChecked() ? "true" : null;
    } else if (field instanceof PDFSignature) {
      type = "signature";
    } else if (field instanceof PDFDropdown) {
      type = "other";
      const selected = field.getSelected();
      value = selected.length > 0 ? selected[0]! : null;
      blank = !value;
    } else if (field instanceof PDFRadioGroup) {
      type = "other";
      value = field.getSelected() || null;
      blank = !value;
    } else {
      type = "other";
    }

    // Extract page number and position from widget annotation
    let line = 0;
    let position = 0;
    try {
      const widgets = field.acroField.getWidgets();
      if (widgets.length > 0) {
        const rect = widgets[0]!.getRectangle();
        position = Math.round(rect.x);
        // Use Y position to approximate line number (higher Y = earlier in doc)
        line = Math.round(rect.y);
      }
    } catch {
      /* widget extraction can fail on malformed PDFs */
    }

    results.push({
      type,
      label: cleanAcroFieldName(name),
      value,
      blank,
      partyRole: inferPartyFromFieldName(name),
      line,
      position,
    });
  }

  return results;
}

/** Classify an AcroForm field name into our FieldType */
function classifyAcroFieldName(name: string): FieldType {
  const l = name.toLowerCase();
  if (l.includes("sign") && !l.includes("initial")) return "signature";
  if (l.includes("initial")) return "initials";
  if (/company|entity|corp|org/.test(l)) return "company";
  if (/name|print/.test(l)) return "name";
  if (l.includes("date")) return "date";
  if (/title|role|position/.test(l)) return "title";
  if (/mail|address/.test(l)) return "address";
  if (/email|e-?mail/.test(l)) return "email";
  if (/phone|tel|fax/.test(l)) return "phone";
  if (/wallet|eth|btc|sol/.test(l)) return "wallet";
  if (/amount|price|fee/.test(l)) return "amount";
  if (l.includes("witness")) return "witness";
  if (l.includes("notary")) return "notary";
  if (/account|ref|ein|ssn|tax/.test(l)) return "reference";
  return "other";
}

/** Clean AcroForm field names for display: "Typed or Printed Name_2" → "Printed Name (2)" */
function cleanAcroFieldName(name: string): string {
  // Remove trailing _N suffix (Acrobat auto-numbering)
  const m = /^(.+?)(?:_(\d+))?$/.exec(name);
  const base = m?.[1] ?? name;
  const suffix = m?.[2] ? ` (${m[2]})` : "";
  return base.replace(/^(?:typed\s+or\s+)/i, "").trim() + suffix;
}

/** Try to infer party role from field name: "Disclosing Party" → "Disclosing Party" */
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
 * Text-based fields are the primary source (they have correct line numbers for
 * block association). AcroForm fields supplement with any that text missed.
 * If an AcroForm field has a filled value that the text-based field didn't catch,
 * we update the text field's value.
 */
function mergeAcroFormFields(textFields: DetectedField[], acroFields: DetectedField[]): DetectedField[] {
  if (acroFields.length === 0) return textFields;

  // Build a lookup of text-detected fields by type
  const textByType = new Map<string, DetectedField[]>();
  for (const f of textFields) {
    const key = f.type;
    if (!textByType.has(key)) textByType.set(key, []);
    textByType.get(key)!.push(f);
  }

  // Update text fields with AcroForm values where matching, and collect new-only acro fields
  const newFields: DetectedField[] = [];
  // Track which acro fields have been matched (reserved for future refinement)

  for (const acro of acroFields) {
    const candidates = textByType.get(acro.type) || [];
    // Try to find a matching text field by label similarity
    const match = candidates.find(
      (tf) =>
        tf.label.toLowerCase().includes(acro.label.toLowerCase().split(" ")[0]!) ||
        acro.label.toLowerCase().includes(tf.label.toLowerCase().split(" ")[0]!),
    );

    if (match) {
      // Supplement: if acro has a filled value and text field is blank, update
      if (acro.value && match.blank) {
        match.value = acro.value;
        match.blank = false;
      }
      // Transfer party role from acro if text field doesn't have one
      if (acro.partyRole && !match.partyRole) {
        match.partyRole = acro.partyRole;
      }
    } else if (acro.type !== "other") {
      // AcroForm found a field that text detection missed.
      // Only add if it has a meaningful type (skip generic "other" fields).
      newFields.push(acro);
    }
  }

  // Sort new AcroForm fields: they have Y-coords as line numbers, so we
  // append them at the end but sorted among themselves (descending Y = ascending doc order)
  newFields.sort((a, b) => b.line - a.line);

  return [...textFields, ...newFields];
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PAGE HEADER / FOOTER STRIPPING
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function stripHeadersFooters(lines: string[]): string[] {
  return lines.filter((line) => {
    const t = line.trim();
    // Page numbers: "Page 1 of 5", "- 1 -", "1", "Page 1"
    if (/^(?:page\s+)?\d+\s*(?:of\s+\d+)?$/i.test(t)) return false;
    if (/^-\s*\d+\s*-$/.test(t)) return false;
    // Bates numbers: "ABC000123"
    if (/^[A-Z]{2,6}\d{4,10}$/.test(t)) return false;
    // Single-word watermarks/stamps (multi-word handled in excluded zones)
    if (/^(?:DRAFT|CONFIDENTIAL|PRIVILEGED|SAMPLE)$/i.test(t)) return false;
    return true;
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// STRUCTURAL ZONE DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Find "IN WITNESS WHEREOF" line — signature blocks usually start after this */
function findWitnessWhereofLine(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/\bin\s+witness\s+whereof\b/i.test(lines[i]!)) return i;
  }
  return -1;
}

/** Find RECITALS/WHEREAS zone (preamble — skip for field detection) */
function findRecitalZone(lines: string[]): { start: number; end: number } | null {
  let start = -1;
  let end = -1;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (start === -1 && /^(?:RECITALS|WHEREAS)\b/i.test(t)) {
      start = i;
    }
    // Recitals end at "NOW, THEREFORE" or "AGREEMENT" or numbered section 1
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

/** Keep one representative of each field type+label combination */
function dedupeFieldsByType(fields: DetectedField[]): DetectedField[] {
  const seen = new Set<string>();
  const result: DetectedField[] = [];
  for (const f of fields) {
    const key = `${f.type}:${f.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(f);
  }
  return result;
}

function deduplicateFields(fields: DetectedField[]): DetectedField[] {
  const seen = new Set<string>();
  const result: DetectedField[] = [];

  for (const f of fields) {
    // Key: type + label + line (allow same type on different lines)
    const key = `${f.type}:${f.label}:${f.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(f);
  }

  // Sort by line number to maintain document order
  result.sort((a, b) => a.line - b.line || a.position - b.position);
  return result;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIELD DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function detectFields(lines: string[], recitalZone?: { start: number; end: number } | null): DetectedField[] {
  const fields: DetectedField[] = [];
  let currentParty: string | null = null;
  let partySetAt = -1; // line index where currentParty was last set
  const PARTY_SCOPE_LINES = 6; // party context expires after N lines
  let charPos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Skip recital zone (WHEREAS preamble — no fillable fields)
    if (recitalZone && i >= recitalZone.start && i < recitalZone.end) {
      charPos += line.length + 1;
      continue;
    }

    // Track current party context from headers
    const partyHeader = extractPartyHeader(trimmed);
    if (partyHeader) {
      currentParty = partyHeader;
      partySetAt = i;
    }

    // Expire party context after PARTY_SCOPE_LINES — prevents boilerplate
    // between approval blocks from inheriting the wrong party
    if (currentParty && i - partySetAt > PARTY_SCOPE_LINES) {
      currentParty = null;
    }

    // Reset party context at clause/section breaks
    if (
      /^\d+\.\s+(?:COMPLEX\s+)?CLAUSE\s+\d+/i.test(trimmed) ||
      /^(?:ARTICLE|SECTION)\s+\d+/i.test(trimmed) ||
      /^SPECIAL\s+CONDITIONS/i.test(trimmed)
    ) {
      currentParty = null;
    }

    // Find all blank fields on this line
    const blanks = [...line.matchAll(BLANK_RE_G)];
    if (blanks.length > 0) {
      const fieldInfo = classifyBlanks(line, trimmed, i, lines, currentParty);
      for (const f of fieldInfo) {
        fields.push({ ...f, line: i + 1, position: charPos + (f.position || 0) });
      }
    }

    // Detect filled-in labeled fields
    const labeled = detectLabeledValues(trimmed, i, currentParty);
    for (const f of labeled) {
      fields.push({ ...f, line: i + 1, position: charPos });
    }

    // Detect bracket/template/e-sign placeholders
    const placeholders = detectPlaceholders(trimmed, i, currentParty);
    for (const f of placeholders) {
      fields.push({ ...f, line: i + 1, position: charPos });
    }

    // Detect checkboxes on any line: [ ] or [X] or [x]
    for (const match of trimmed.matchAll(/\[\s*([xX\u2713\u2714])?\s*\]/g)) {
      const checked = !!match[1];
      fields.push({
        type: "checkbox",
        label: checked ? "Checked" : "Unchecked",
        value: checked ? "true" : null,
        blank: !checked,
        partyRole: currentParty,
        line: i + 1,
        position: charPos + (match.index ?? 0),
      });
    }

    charPos += line.length + 1;
  }

  return fields;
}

// ─── Party header extraction ────────────────────────────────────────────────

function extractPartyHeader(line: string): string | null {
  // Generic: "DISCLOSING PARTY", "PARTY A"
  const m =
    /^((?:DISCLOSING|RECEIVING|FIRST|SECOND|THIRD|FOURTH|FIFTH|HIRING|CONTRACTING|GUARANTOR|CO-?SIGNING|INDEMNIFYING|INDEMNIFIED)\s+PARTY|PARTY\s+[A-Z\d])\s*$/i.exec(
      line,
    );
  if (m) return titleCase(m[1]!);

  // "Party Disclosing Information:"
  const m2 = /^Party\s+(Disclosing|Receiving|Providing|Requesting)\s+Information\s*:/i.exec(line);
  if (m2) return titleCase(m2[1]! + " Party");

  // Named entity approval: "Aurora Peak Holdings LLC (Buyer) Approval:"
  const namedApproval = new RegExp(
    `^(.+?)\\s+\\(\\s*(${PARTY_ROLES_RE.source})\\s*\\)\\s*(?:Approval|Acknowledgment|Acceptance|Confirmation|Authorization)\\s*:`,
    "i",
  ).exec(line);
  if (namedApproval) return namedApproval[2]!.trim();

  return null;
}

function extractNamedPartyInfo(line: string): { entity: string; role: string } | null {
  const m = new RegExp(
    `^(.+?)\\s+\\(\\s*(${PARTY_ROLES_RE.source})\\s*\\)\\s*(?:Approval|Acknowledgment|Acceptance|Confirmation|Authorization)\\s*:`,
    "i",
  ).exec(line);
  if (m) return { entity: m[1]!.trim(), role: m[2]!.trim() };
  return null;
}

// ─── Blank field classification ─────────────────────────────────────────────

function classifyBlanks(
  rawLine: string,
  trimmed: string,
  lineIdx: number,
  lines: string[],
  currentParty: string | null,
): DetectedField[] {
  const fields: DetectedField[] = [];
  const blankPat = `(?:_{3,}|\\.{5,}|-{5,})`;

  // --- Signature ---
  if (new RegExp(`signature\\s*:\\s*${blankPat}`, "i").test(trimmed)) {
    fields.push(blankField("signature", "Signature", rawLine, currentParty, lineIdx));
  }

  // --- "By: ______" (corporate authorized signature) ---
  if (new RegExp(`\\bBy\\s*:\\s*${blankPat}`, "i").test(trimmed)) {
    fields.push(blankField("signature", "Authorized Signature (By)", rawLine, currentParty, lineIdx));
  }

  // --- "Its: ______" (corporate title after By:) ---
  if (new RegExp(`\\bIts\\s*:\\s*${blankPat}`, "i").test(trimmed)) {
    fields.push(blankField("title", "Corporate Title (Its)", rawLine, currentParty, lineIdx));
  }

  // --- Initials (single) ---
  if (new RegExp(`\\binitials\\s*:\\s*${blankPat}`, "i").test(trimmed) && !MULTI_PARTY_INITIALS_RE.test(trimmed)) {
    fields.push(blankField("initials", "Initials", rawLine, currentParty, lineIdx));
  }

  // --- Multi-party initials ---
  if (MULTI_PARTY_INITIALS_RE.test(trimmed)) {
    for (const match of trimmed.matchAll(MULTI_PARTY_INITIALS_CAPTURE_RE)) {
      const role = match[1]!.trim();
      fields.push({
        type: "initials",
        label: `${role} Initials`,
        value: null,
        blank: true,
        partyRole: role,
        line: lineIdx + 1,
        position: 0,
      });
    }
  }

  // --- Name ---
  const nameMatch = new RegExp(
    `(?:(?:typed\\s+or\\s+)?print(?:ed)?\\s+name|name\\s*\\(print(?:ed)?\\)|^name)\\s*:\\s*(${blankPat}|([A-Za-z\u00C0-\u024F][a-zA-Z\u00C0-\u024F\\s.'-]{1,60}))`,
    "i",
  ).exec(trimmed);
  if (nameMatch) {
    const val = nameMatch[2] || null;
    const isBlank = BLANK_RE.test(nameMatch[1]!);
    fields.push({
      type: "name",
      label: "Printed Name",
      value: isBlank ? null : val,
      blank: isBlank,
      partyRole: currentParty,
      line: lineIdx + 1,
      position: rawLine.indexOf(nameMatch[1]!),
    });
  }

  // --- Date ---
  const dateMatch = new RegExp(
    `\\bDate\\s*:\\s*(${blankPat}|[\\d/.-]+|[A-Z][a-z]+\\s+\\d{1,2},?\\s*\\d{4}|\\d{1,2}\\s+[A-Z][a-z]+\\s+\\d{4})`,
    "i",
  ).exec(trimmed);
  if (dateMatch && !/effective\s+date/i.test(trimmed)) {
    const isBlank = BLANK_RE.test(dateMatch[1]!);
    fields.push({
      type: "date",
      label: "Date",
      value: isBlank ? null : dateMatch[1]!,
      blank: isBlank,
      partyRole: currentParty,
      line: lineIdx + 1,
      position: rawLine.indexOf(dateMatch[1]!),
    });
  }

  // --- Title ---
  const titleMatch = new RegExp(
    `\\bTitle\\s*:\\s*(${blankPat}|([A-Za-z\u00C0-\u024F][a-zA-Z\u00C0-\u024F\\s.'-]{2,40}))`,
    "i",
  ).exec(trimmed);
  if (titleMatch && !/^(?:\d+\.|section|article)/i.test(trimmed)) {
    const val = titleMatch[2] || null;
    const isBlank = BLANK_RE.test(titleMatch[1]!);
    fields.push({
      type: "title",
      label: "Title/Role",
      value: isBlank ? null : val,
      blank: isBlank,
      partyRole: currentParty,
      line: lineIdx + 1,
      position: rawLine.indexOf(titleMatch[1]!),
    });
  }

  // --- Party Info: "Party Disclosing Information: ______" ---
  const partyInfoMatch = new RegExp(
    `^Party\\s+(Disclosing|Receiving|Providing|Requesting)\\s+Information\\s*:\\s*(${blankPat}|([A-Z][A-Za-z\\s.&,'-]+))`,
    "i",
  ).exec(trimmed);
  if (partyInfoMatch) {
    const role = titleCase(partyInfoMatch[1]! + " Party");
    const val = partyInfoMatch[3] || null;
    const isBlank = BLANK_RE.test(partyInfoMatch[2]!);
    fields.push({
      type: "name",
      label: `${role} Name`,
      value: isBlank ? null : val,
      blank: isBlank,
      partyRole: role,
      line: lineIdx + 1,
      position: rawLine.indexOf(partyInfoMatch[2]!),
    });
  }

  // --- Mailing Address ---
  if (
    /mailing\s+address\s+of\s*$/i.test(trimmed) ||
    new RegExp(`mailing\\s+address\\s+of\\s*${blankPat}`, "i").test(trimmed)
  ) {
    const nextLine = lines[lineIdx + 1]?.trim() || "";
    const nextIsBlank = BLANK_RE.test(nextLine);
    fields.push({
      type: "address",
      label: "Mailing Address",
      value: null,
      blank: true,
      partyRole: currentParty,
      line: nextIsBlank ? lineIdx + 2 : lineIdx + 1,
      position: 0,
    });
  }

  // --- Multi-line date: blank after "date of" ---
  if (BLANK_RE.test(trimmed) && /^(?:_{3,}|\.{5,}|-{5,})/.test(trimmed) && fields.length === 0) {
    const prevLine = (lines[lineIdx - 1] || "").trim().toLowerCase();
    if (/(?:date\s+of|as\s+of|effective)\s*$/.test(prevLine)) {
      fields.push(blankField("date", "Agreement Date", rawLine, null, lineIdx));
    }
  }

  // --- "entered into on the date of ______" ---
  if (
    new RegExp(
      `(?:entered\\s+into|made|effective)\\s+(?:on\\s+)?(?:the\\s+)?(?:date\\s+of|as\\s+of)\\s*${blankPat}`,
      "i",
    ).test(trimmed)
  ) {
    fields.push(blankField("date", "Agreement Date", rawLine, null, lineIdx));
  }

  // --- Company/Entity ---
  const companyMatch = new RegExp(
    `\\b(?:Company|Entity|Organization|Corporation)\\s*:\\s*(${blankPat}|([A-Za-z0-9\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F\\s.&,()'/+-]+))`,
    "i",
  ).exec(trimmed);
  if (companyMatch) {
    const val = companyMatch[2] || null;
    const isBlank = BLANK_RE.test(companyMatch[1]!);
    fields.push({
      type: "company",
      label: "Company/Entity",
      value: isBlank ? null : val,
      blank: isBlank,
      partyRole: currentParty,
      line: lineIdx + 1,
      position: rawLine.indexOf(companyMatch[1]!),
    });
  }

  // --- Email ---
  const emailMatch = new RegExp(`\\bE-?mail\\s*:\\s*(${blankPat}|(\\S+@\\S+\\.\\S+))`, "i").exec(trimmed);
  if (emailMatch) {
    const val = emailMatch[2] || null;
    const isBlank = BLANK_RE.test(emailMatch[1]!);
    fields.push({
      type: "email",
      label: "Email",
      value: isBlank ? null : val,
      blank: isBlank,
      partyRole: currentParty,
      line: lineIdx + 1,
      position: rawLine.indexOf(emailMatch[1]!),
    });
  }

  // --- Phone/Fax ---
  const phoneMatch = new RegExp(
    `\\b(?:Phone|Tel(?:ephone)?|Fax|Cell|Mobile|Contact(?:\\s+Number)?)\\s*:\\s*(${blankPat}|([\\d()+\\s.-]{7,20}))`,
    "i",
  ).exec(trimmed);
  if (phoneMatch) {
    const val = phoneMatch[2] || null;
    const isBlank = BLANK_RE.test(phoneMatch[1]!);
    fields.push({
      type: "phone",
      label: "Phone",
      value: isBlank ? null : val,
      blank: isBlank,
      partyRole: currentParty,
      line: lineIdx + 1,
      position: rawLine.indexOf(phoneMatch[1]!),
    });
  }

  // --- Amount/Currency ---
  const amountMatch = new RegExp(
    `\\b(?:Amount|Sum|Price|Fee|Rate|Commission|Salary|Compensation|Consideration)\\s*:?\\s*(${blankPat}|([\\$\\d,.]+))`,
    "i",
  ).exec(trimmed);
  if (amountMatch && !fields.some((f) => f.type === "amount")) {
    const val = amountMatch[2] || null;
    const isBlank = BLANK_RE.test(amountMatch[1]!);
    fields.push({
      type: "amount",
      label: "Amount",
      value: isBlank ? null : val,
      blank: isBlank,
      partyRole: currentParty,
      line: lineIdx + 1,
      position: rawLine.indexOf(amountMatch[1]!),
    });
  }

  // --- Reference/Account/ID ---
  const refMatch = new RegExp(
    `\\b(?:Account\\s*(?:#|No\\.?|Number)|Reference\\s*(?:#|No\\.?)|Invoice\\s*(?:#|No\\.?)|Order\\s*(?:#|No\\.?|ID)|EIN|Tax\\s*ID|SSN|SWIFT|IBAN|ABA|Routing(?:\\s+Number)?)\\s*:?\\s*(${blankPat}|([A-Za-z0-9-]{4,30}))`,
    "i",
  ).exec(trimmed);
  if (refMatch) {
    const val = refMatch[2] || null;
    const isBlank = BLANK_RE.test(refMatch[1]!);
    fields.push({
      type: "reference",
      label: "Reference/ID",
      value: isBlank ? null : val,
      blank: isBlank,
      partyRole: currentParty,
      line: lineIdx + 1,
      position: rawLine.indexOf(refMatch[1]!),
    });
  }

  // --- Wallet (inline) ---
  const walletMatch =
    /\bWallet\s*:\s*(0x[a-fA-F0-9]{40}|(?:bc1|tb1|bcrt1)[a-z0-9]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})/i.exec(trimmed);
  if (walletMatch) {
    fields.push({
      type: "wallet",
      label: "Wallet Address",
      value: walletMatch[1]!,
      blank: false,
      partyRole: currentParty,
      line: lineIdx + 1,
      position: rawLine.indexOf(walletMatch[1]!),
    });
  }

  // --- Wallet (next line) ---
  if (/\bWallet\s*:\s*$/i.test(trimmed)) {
    const nextLine = (lines[lineIdx + 1] || "").trim();
    const nextAddrMatch = /^(0x[a-fA-F0-9]{40}|(?:bc1|tb1|bcrt1)[a-z0-9]{20,}|[13][a-km-zA-HJ-NP-Z1-9]{25,39})$/i.exec(
      nextLine,
    );
    if (nextAddrMatch) {
      fields.push({
        type: "wallet",
        label: "Wallet Address",
        value: nextAddrMatch[1]!,
        blank: false,
        partyRole: currentParty,
        line: lineIdx + 2,
        position: 0,
      });
    }
  }

  // --- Standalone blank with party alias: "______ ("Disclosing Party")" ---
  if (/^(?:_{3,}|\.{5,}|-{5,})\s*\(/.test(trimmed) && fields.length === 0) {
    const prevLine = (lines[lineIdx - 1] || "").trim().toLowerCase();
    if (/mailing\s+address|address\s+of|address\s*:/.test(prevLine)) {
      const aliasMatch = /\(\s*["'\u201C]?([^)"'"\u201C\u201D]+)["'\u201D]?\s*\)/.exec(trimmed);
      fields.push({
        type: "address",
        label: "Mailing Address",
        value: null,
        blank: true,
        partyRole: aliasMatch ? aliasMatch[1]!.trim() : currentParty,
        line: lineIdx + 1,
        position: 0,
      });
    } else {
      const aliasMatch = /\(\s*["'\u201C]?([^)"'"\u201C\u201D]+)["'\u201D]?\s*\)/.exec(trimmed);
      if (aliasMatch) {
        fields.push({
          type: "name",
          label: aliasMatch[1]!.trim() + " Name",
          value: null,
          blank: true,
          partyRole: aliasMatch[1]!.trim(),
          line: lineIdx + 1,
          position: 0,
        });
      }
    }
  }

  // --- Notary venue: "STATE OF ___" / "COUNTY OF ___" ---
  if (new RegExp(`(?:STATE|COUNTY|COMMONWEALTH)\\s+OF\\s*${blankPat}`, "i").test(trimmed)) {
    fields.push(blankField("notary", "Notary Venue", rawLine, null, lineIdx));
  }

  // --- "My Commission Expires: ___" ---
  if (new RegExp(`Commission\\s+Expires\\s*:\\s*${blankPat}`, "i").test(trimmed)) {
    fields.push(blankField("notary", "Commission Expiry", rawLine, null, lineIdx));
  }

  // --- Witness signature ---
  if (new RegExp(`Witness(?:ed)?\\s+(?:Signature|By)\\s*:\\s*${blankPat}`, "i").test(trimmed)) {
    fields.push(blankField("witness", "Witness Signature", rawLine, null, lineIdx));
  }

  return fields;
}

/**
 * Returns true if a line is a boilerplate paragraph line (body text that
 * happens to contain inline fields at the end), as opposed to a dedicated
 * field-only line. Dedicated field lines start directly with a field label.
 */
function isBoilerplateLine(line: string): boolean {
  if (line.length < 10) return false;
  // Dedicated field lines start with a known field label (including multi-word ones)
  if (
    /^(?:Signature|Date|Initials|(?:Typed\s+or\s+)?Print(?:ed)?\s+Name|Name|Title|By|Its|Email|Phone|Company|Wallet|Authorized)\s*:/i.test(
      line,
    )
  )
    return false;
  // Lines that contain sentence-ending punctuation BEFORE a field label are boilerplate.
  // e.g. "relieve obligations. Signature: ____ Date: ____ Initials: ___"
  if (/[.!?;]\s+(?:Signature|Date|Initials|Wallet)\s*:/i.test(line)) return true;
  // Lines starting with common paragraph words that are 60+ chars are boilerplate
  if (
    /^(?:Each|The\s|All\s|Any\s|No\s|In\s|This\s|That\s|Such\s|For\s|If\s|As\s|To\s|Upon\s)/i.test(line) &&
    line.length > 60
  )
    return true;
  return false;
}

/** Helper to create a simple blank field */
function blankField(
  type: FieldType,
  label: string,
  rawLine: string,
  party: string | null,
  lineIdx: number,
): DetectedField {
  return { type, label, value: null, blank: true, partyRole: party, line: lineIdx + 1, position: rawLine.indexOf("_") };
}

// ─── Filled-in labeled fields ───────────────────────────────────────────────

function detectLabeledValues(trimmed: string, _lineIdx: number, currentParty: string | null): DetectedField[] {
  const fields: DetectedField[] = [];

  // "Authorized Signatory: John Smith"
  const sigMatch =
    /\b(?:Authorized\s+(?:Signatory|Representative))\s*:\s*([A-Za-z\u00C0-\u024F][a-zA-Z\u00C0-\u024F\s.'-]{2,60})/i.exec(
      trimmed,
    );
  if (sigMatch) {
    fields.push({
      type: "name",
      label: "Authorized Signatory",
      value: sigMatch[1]!.trim(),
      blank: false,
      partyRole: currentParty,
      line: 0,
      position: 0,
    });
  }

  // "/s/ John Smith"
  const slashSMatch = /\/s\/\s+([A-Za-z\u00C0-\u024F][a-zA-Z\u00C0-\u024F\s.'-]{2,60})/.exec(trimmed);
  if (slashSMatch) {
    fields.push({
      type: "signature",
      label: "Digital Signature (/s/)",
      value: slashSMatch[1]!.trim(),
      blank: false,
      partyRole: currentParty,
      line: 0,
      position: 0,
    });
  }

  // "Phone: 555-123-4567" (filled value, no blank)
  const phoneVal = /\b(?:Phone|Tel(?:ephone)?|Fax|Cell|Mobile)\s*:\s*([\d()+\s.-]{7,20})/i.exec(trimmed);
  if (phoneVal) {
    fields.push({
      type: "phone",
      label: "Phone",
      value: phoneVal[1]!.trim(),
      blank: false,
      partyRole: currentParty,
      line: 0,
      position: 0,
    });
  }

  // "Date: January 15, 2024" or "Date: 01/15/2024" (filled value, no blank)
  const dateVal =
    /\bDate\s*:\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[A-Z][a-z]+\s+\d{1,2},?\s*\d{4}|\d{1,2}\s+[A-Z][a-z]+\s+\d{4})/i.exec(
      trimmed,
    );
  if (dateVal && !/effective\s+date/i.test(trimmed)) {
    fields.push({
      type: "date",
      label: "Date",
      value: dateVal[1]!.trim(),
      blank: false,
      partyRole: currentParty,
      line: 0,
      position: 0,
    });
  }

  return fields;
}

// ─── Placeholder / e-sign tag detection ─────────────────────────────────────

function detectPlaceholders(trimmed: string, _lineIdx: number, currentParty: string | null): DetectedField[] {
  const fields: DetectedField[] = [];

  // [Name Here], [PARTY NAME], [Insert Company Name]
  for (const m of trimmed.matchAll(/\[([A-Za-z][A-Za-z\s_]{1,40}?)\]/g)) {
    const label = m[1]!.trim();
    if (label.length < 2) continue;
    // Skip checkbox patterns like [X], [ ], [x]
    if (/^[xX\u2713\u2714\s]*$/.test(label)) continue;
    fields.push({
      type: classifyPlaceholderLabel(label),
      label,
      value: null,
      blank: true,
      partyRole: currentParty,
      line: 0,
      position: 0,
    });
  }

  // {{Signature_1}}, {{Name_1}}
  for (const m of trimmed.matchAll(/\{\{([^}]+)\}\}/g)) {
    const label = m[1]!.trim();
    fields.push({
      type: classifyPlaceholderLabel(label),
      label,
      value: null,
      blank: true,
      partyRole: currentParty,
      line: 0,
      position: 0,
    });
  }

  // DocuSign tags: \s1\, \n1\, \i1\, \d1\, \t1\, \c1\
  for (const m of trimmed.matchAll(/\\([snditc])(\d+)\\/g)) {
    const typeMap: Record<string, FieldType> = {
      s: "signature",
      n: "name",
      d: "date",
      t: "title",
      i: "initials",
      c: "company",
    };
    fields.push({
      type: typeMap[m[1]!] || "other",
      label: `Signer ${m[2]} ${typeMap[m[1]!] || "field"}`,
      value: null,
      blank: true,
      partyRole: null,
      line: 0,
      position: 0,
    });
  }

  // HelloSign / Dropbox Sign: [sig|req|signer1], [initials|req|signer1], [text|req|signer1|label]
  for (const m of trimmed.matchAll(/\[(\w+)\|(\w+)\|signer(\d+)(?:\|([^\]]+))?\]/g)) {
    const fieldType = m[1]!.toLowerCase();
    const signerNum = m[3];
    const extraLabel = m[4] || "";
    const typeMap: Record<string, FieldType> = {
      sig: "signature",
      signature: "signature",
      initials: "initials",
      initial: "initials",
      date: "date",
      text: "other",
      name: "name",
      title: "title",
      company: "company",
      checkbox: "checkbox",
    };
    fields.push({
      type: typeMap[fieldType] || "other",
      label: extraLabel || `Signer ${signerNum} ${fieldType}`,
      value: null,
      blank: true,
      partyRole: null,
      line: 0,
      position: 0,
    });
  }

  return fields;
}

function classifyPlaceholderLabel(label: string): FieldType {
  const l = label.toLowerCase();
  if (/sign|sig/.test(l) && !l.includes("initial")) return "signature";
  if (l.includes("initial")) return "initials";
  if (/wallet|eth.*addr|btc.*addr/i.test(l)) return "wallet";
  // "Company Name" → company (check company BEFORE name)
  if (/company|entity|corp|org/.test(l)) return "company";
  if (/name|print/.test(l)) return "name";
  if (l.includes("date")) return "date";
  if (/title|role|position/.test(l)) return "title";
  if (/address|addr/.test(l)) return "address";
  if (/email|e-?mail/.test(l)) return "email";
  if (/phone|tel|fax|mobile/.test(l)) return "phone";
  if (/amount|price|fee|sum/.test(l)) return "amount";
  if (l.includes("witness")) return "witness";
  if (/notary|commission/.test(l)) return "notary";
  if (/check|agree|accept|consent/.test(l)) return "checkbox";
  if (/account|ref|invoice|order|ssn|ein|tax.?id|swift|iban/.test(l)) return "reference";
  return "other";
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SIGNATURE BLOCK DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function detectSignatureBlocks(lines: string[], allFields: DetectedField[], _witnessLine = -1): SignatureBlock[] {
  const rawBlocks: SignatureBlock[] = [];
  const excludeZones = findExcludedZoneLines(lines);

  // If we found "IN WITNESS WHEREOF", prioritize searching from there
  // but still scan the full document for party headers
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();

    const header = extractPartyHeader(trimmed);
    if (!header) continue;
    if (excludeZones.has(i)) continue;

    const namedInfo = extractNamedPartyInfo(trimmed);

    // Collect fields from DEDICATED FIELD LINES only (not inline boilerplate).
    // A "field-only line" is short and starts with a known field label.
    // A boilerplate line has paragraph text with fields jammed at the end.
    const blockFields: DetectedField[] = [];
    for (let j = i + 1; j < Math.min(i + 9, lines.length); j++) {
      const lineText = lines[j]?.trim() || "";
      // Stop at next party header
      if (extractPartyHeader(lineText)) break;
      // Skip multi-party initials lines — they self-assign partyRoles
      if (MULTI_PARTY_INITIALS_RE.test(lineText)) continue;
      // Skip boilerplate paragraph lines — these have body text WITH inline
      // fields at the end. We only want DEDICATED field lines like:
      //   "Signature: ____________________"
      //   "Date: __________"
      //   "Initials: ___"
      // NOT: "relieve obligations. Signature: ____ Date: ____ Initials: ___"
      if (isBoilerplateLine(lineText)) continue;
      const fieldsOnLine = allFields.filter((f) => f.line === j + 1);
      blockFields.push(...fieldsOnLine);
    }

    const headerFields = allFields.filter((f) => f.line === i + 1);
    blockFields.push(...headerFields);

    if (blockFields.some((f) => f.type === "signature" || f.type === "initials")) {
      // IMPORTANT: clone fields so we don't mutate the shared allFields objects.
      // Without cloning, partyRole mutations from one block bleed into others.
      const clonedFields = blockFields.map((f) => ({ ...f, partyRole: header }));
      rawBlocks.push({
        partyRole: header,
        partyLabel: namedInfo ? `${namedInfo.entity} (${namedInfo.role})` : trimmed,
        signerIndex: 0,
        fields: clonedFields,
        line: i + 1,
      });
    }
  }

  // Deduplicate by role
  const deduped = new Map<string, SignatureBlock>();
  for (const block of rawBlocks) {
    const key = block.partyRole.toLowerCase();
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, { ...block, fields: [...block.fields] });
    } else {
      const existingTypes = new Set(existing.fields.map((f) => `${f.type}:${f.label}`));
      for (const f of block.fields) {
        if (!existingTypes.has(`${f.type}:${f.label}`)) {
          existing.fields.push(f);
          existingTypes.add(`${f.type}:${f.label}`);
        }
      }
      if (block.partyLabel.includes("(") && !existing.partyLabel.includes("(")) {
        existing.partyLabel = block.partyLabel;
      }
    }
  }

  const blocks = [...deduped.values()];
  blocks.forEach((b, i) => {
    b.signerIndex = i;
  });
  return blocks;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PARTY DEFINITION DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type PartyDef = {
  role: string;
  name: string | null;
  mailingAddress: string | null;
  entityType: string | null; // "a Delaware limited liability company"
  nameField: DetectedField | null;
  addressField: DetectedField | null;
  fields: DetectedField[];
};

function detectPartyDefinitions(lines: string[], allFields: DetectedField[]): PartyDef[] {
  const parties: PartyDef[] = [];

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const trimmed = lines[i]!.trim();

    // "Party [X] Information: ______"
    const partyInfoMatch = /^Party\s+(Disclosing|Receiving|Providing|Requesting)\s+Information\s*:/i.exec(trimmed);
    if (partyInfoMatch) {
      const role = titleCase(partyInfoMatch[1]! + " Party");
      const nameField = allFields.find((f) => f.line === i + 1 && f.type === "name" && f.partyRole === role) || null;
      const addrField =
        allFields.find((f) => f.type === "address" && f.partyRole === role) ||
        allFields.find((f) => f.type === "address" && f.line >= i + 1 && f.line <= i + 3) ||
        null;
      const relatedFields = allFields.filter((f) => f.partyRole === role || (f.line >= i + 1 && f.line <= i + 3));
      parties.push({
        role,
        name: nameField?.value || null,
        mailingAddress: addrField?.value || null,
        entityType: null,
        nameField,
        addressField: addrField,
        fields: relatedFields,
      });
    }

    // "between X and Y"
    const betweenMatch = /\b(?:by\s+and\s+)?between\s*:?\s+(.+)/i.exec(trimmed);
    if (betweenMatch && parties.length === 0) {
      const chunk = lines.slice(i, Math.min(i + 5, lines.length)).join(" ");
      const m = /between\s+(.+?)\s*\(.*?\)\s*(?:,?\s*and\s+)(.+?)\s*\(/i.exec(chunk);
      if (m) {
        const names = [m[1], m[2]].map((n) => n!.replace(/(?:_{3,}|\.{5,}|-{5,})/g, "").trim());
        const aliases = [...chunk.matchAll(/\(\s*["'\u201C]?([^)"'"\u201C\u201D]+?)["'\u201D]?\s*\)/g)].map((a) =>
          a[1]!.trim(),
        );
        // Extract entity types: "a Delaware limited liability company"
        const entityTypes = [
          ...chunk.matchAll(
            /,\s*(a\s+[A-Z][a-z]+\s+(?:limited\s+liability\s+company|corporation|partnership|limited\s+partnership|trust|association))/gi,
          ),
        ].map((a) => a[1]!.trim());
        for (let idx = 0; idx < names.length; idx++) {
          const name = names[idx]!;
          const role = aliases[idx] || `Party ${idx + 1}`;
          parties.push({
            role,
            name: name && name.length > 1 ? name : null,
            entityType: entityTypes[idx] || null,
            mailingAddress: null,
            nameField: null,
            addressField: null,
            fields: [],
          });
        }
      }
    }
  }

  return parties;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SIGNER LIST BUILDER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function buildSignerList(
  partyDefs: PartyDef[],
  signatureBlocks: SignatureBlock[],
  detectedAddresses: DetectedAddress[],
  allFields: DetectedField[],
): DetectedSigner[] {
  const signers: DetectedSigner[] = [];
  const usedRoles = new Set<string>();

  // From party definitions
  for (const party of partyDefs) {
    const sigBlock = signatureBlocks.find((b) => rolesMatch(b.partyRole, party.role));
    const signer: DetectedSigner = {
      label: party.name || party.role,
      role: party.role,
      address: null,
      mailingAddress: party.mailingAddress,
      chain: null,
      confidence: party.name ? "high" : "medium",
      source: "party definition",
      fields: dedupeFieldsByType(party.fields),
      signatureBlock: sigBlock || null,
    };
    matchWalletAddress(signer, detectedAddresses);
    signers.push(signer);
    usedRoles.add(party.role.toLowerCase());
    if (sigBlock) usedRoles.add(sigBlock.partyRole.toLowerCase());
  }

  // From unmatched signature blocks
  for (const block of signatureBlocks) {
    if (usedRoles.has(block.partyRole.toLowerCase())) continue;
    const nameField = block.fields.find((f) => f.type === "name");
    const entityMatch = /^(.+?)\s*\(/.exec(block.partyLabel);
    const entityName = entityMatch?.[1]?.trim();
    const label = nameField?.value || entityName || block.partyRole;
    const signer: DetectedSigner = {
      label,
      role: block.partyRole,
      address: null,
      mailingAddress: null,
      chain: null,
      confidence: nameField?.value || entityName ? "high" : "medium",
      source: "signature block",
      fields: dedupeFieldsByType(block.fields),
      signatureBlock: block,
    };
    matchWalletAddress(signer, detectedAddresses);
    signers.push(signer);
    usedRoles.add(block.partyRole.toLowerCase());
  }

  // Fallback: from detected fields (only if no signers found from blocks/defs)
  if (signers.length === 0) {
    const nameFields = allFields.filter((f) => f.type === "name" && f.blank);
    const sigFields = allFields.filter((f) => f.type === "signature" && f.blank);
    const roles = new Set<string>();
    for (const f of [...nameFields, ...sigFields]) {
      if (f.partyRole) roles.add(f.partyRole);
    }
    if (roles.size > 0) {
      for (const role of roles) {
        // Only take ONE representative of each field type for this role —
        // prevents hundreds of repeated fields from being assigned.
        const relFields = allFields.filter((f) => f.partyRole === role);
        const deduped = dedupeFieldsByType(relFields);
        signers.push({
          label: role,
          role,
          address: null,
          mailingAddress: null,
          chain: null,
          confidence: "low",
          source: "field analysis",
          fields: deduped,
          signatureBlock: null,
        });
      }
    }
  }

  // Unmatched wallet addresses
  for (const addr of detectedAddresses) {
    if (!signers.some((s) => s.address === addr.address)) {
      signers.push({
        label: `Wallet (${addr.chain})`,
        role: null,
        address: addr.address,
        mailingAddress: null,
        chain: addr.chain,
        confidence: "low",
        source: "address detection",
        fields: [],
        signatureBlock: null,
      });
    }
  }

  return signers;
}

function rolesMatch(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/party$/, "")
      .trim();
  return (
    normalize(a) === normalize(b) ||
    a.toLowerCase().includes(b.toLowerCase().split(" ")[0]!) ||
    b.toLowerCase().includes(a.toLowerCase().split(" ")[0]!)
  );
}

function matchWalletAddress(signer: DetectedSigner, addresses: DetectedAddress[]) {
  if (signer.address || !signer.role) return;
  const roleLower = signer.role.toLowerCase();
  const nameLower = (signer.label || "").toLowerCase();

  let bestAddr: DetectedAddress | null = null;
  let bestScore = 0;

  for (const addr of addresses) {
    const ctx = addr.context.toLowerCase();
    let score = 0;

    if (ctx.includes(`(${roleLower}) approval`) || ctx.includes(`(${roleLower}) acknowledgment`)) score += 5;
    if (nameLower.length > 5 && ctx.includes(nameLower)) score += 4;

    const roleWords = roleLower.split(/\s+/).filter((w) => w.length > 3);
    for (const w of roleWords) {
      if (ctx.includes(w)) score += 2;
    }

    const nameWords = nameLower.split(/\s+/).filter((w) => w.length > 3);
    for (const w of nameWords) {
      if (/^(llc|inc|corp|ltd|pllc|group|partners|holdings|capital|services)$/.test(w)) continue;
      if (ctx.includes(w)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestAddr = addr;
    }
  }

  if (bestAddr && bestScore >= 2) {
    signer.address = bestAddr.address;
    signer.chain = bestAddr.chain;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXCLUDED ZONES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function findExcludedZoneLines(lines: string[]): Set<number> {
  const excluded = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim().toLowerCase();

    // Witness blocks (up to 10 lines)
    if (/^(?:witness(?:ed)?(?:\s+by)?|in\s+the\s+presence\s+of)\s*:?/.test(trimmed)) {
      for (let j = i; j < Math.min(i + 10, lines.length); j++) excluded.add(j);
    }

    // Notary (up to 20 lines — notary blocks vary by state)
    if (/^(?:state\s+of|notary\s+public|before\s+me.*notary|subscribed\s+and\s+sworn)/.test(trimmed)) {
      for (let j = i; j < Math.min(i + 20, lines.length); j++) excluded.add(j);
    }

    // Attorney approval (up to 6 lines)
    if (/^(?:approved\s+as\s+to\s+form|legal\s+counsel\s+review)/.test(trimmed)) {
      for (let j = i; j < Math.min(i + 6, lines.length); j++) excluded.add(j);
    }

    // Copyright
    if (/^(?:copyright|©|\(c\))\s*\d{4}/.test(trimmed) || /\ball\s+rights\s+reserved\b/.test(trimmed)) {
      excluded.add(i);
    }

    // Watermarks / draft stamps
    if (/^(?:draft|confidential|sample|do\s+not\s+copy|privileged)\s*$/i.test(trimmed)) {
      excluded.add(i);
    }
  }

  return excluded;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WALLET ADDRESS DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function findWalletAddresses(text: string): DetectedAddress[] {
  const results: DetectedAddress[] = [];
  const seen = new Set<string>();

  const add = (addr: string, chain: WalletChain, idx: number) => {
    const key = chain === "ETH" ? addr.toLowerCase() : addr;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ address: addr, chain, context: getContext(text, idx) });
  };

  // Labeled wallet fields
  for (const m of text.matchAll(
    /\b(?:wallet|eth(?:ereum)?|btc|bitcoin|sol(?:ana)?|receiving|payment|treasury|deposit|payout|public|send\s*to|receive\s*at)\s*(?:address|addr\.?|wallet|key)?\s*:\s*([a-zA-Z0-9]{20,})/gim,
  )) {
    const addr = m[1]!;
    if (isEvmAddress(addr)) add(addr, "ETH", m.index);
    else if (isBitcoinAddress(addr)) add(addr, "BTC", m.index);
    else if (isSolanaAddress(addr) && addr.length >= 32) add(addr, "SOL", m.index);
  }

  // EVM
  for (const m of text.matchAll(/\b(0x[a-fA-F0-9]{40})\b/g)) {
    if (isEvmAddress(m[1]!)) add(m[1]!, "ETH", m.index);
  }

  // BTC
  for (const m of text.matchAll(/\b((?:bc1|tb1|bcrt1)[a-z0-9]{20,})\b/gi)) {
    if (isBitcoinAddress(m[1]!)) add(m[1]!, "BTC", m.index);
  }
  for (const m of text.matchAll(/\b([13][a-km-zA-HJ-NP-Z1-9]{25,39})\b/g)) {
    if (isBitcoinAddress(m[1]!)) add(m[1]!, "BTC", m.index);
  }

  // SOL (only near keywords)
  if (/\b(?:sol(?:ana)?|spl|phantom|anchor|metaplex)\b/i.test(text)) {
    for (const m of text.matchAll(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g)) {
      const addr = m[1]!;
      if (seen.has(addr) || !isSolanaAddress(addr) || isEvmAddress(addr) || isBitcoinAddress(addr)) continue;
      const nearby = text.slice(Math.max(0, m.index - 100), m.index + addr.length + 100).toLowerCase();
      if (/sol|wallet|address|phantom|anchor|spl/.test(nearby)) add(addr, "SOL", m.index);
    }
  }

  // ENS
  for (const m of text.matchAll(/\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+eth)\b/gi)) {
    const ens = m[1]!.toLowerCase();
    if (!seen.has(ens)) {
      seen.add(ens);
      results.push({ address: ens, chain: "ETH", context: getContext(text, m.index) });
    }
  }

  return results;
}

function getContext(text: string, index: number): string {
  const start = Math.max(0, index - 200);
  const end = Math.min(text.length, index + 100);
  let ctx = text.slice(start, end).replace(/\n/g, " ").trim();
  if (start > 0) ctx = "..." + ctx;
  if (end < text.length) ctx = ctx + "...";
  return ctx;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SIGNER COUNT ESTIMATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function estimateSignerCount(text: string, lines: string[]): number {
  let count = 0;
  const excludeLines = findExcludedZoneLines(lines);

  const sigRoles = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (excludeLines.has(i)) continue;
    const trimmed = lines[i]!.trim();
    if (/\b(?:Signature|By)\s*:\s*(?:_{3,}|\.{5,}|-{5,})/i.test(trimmed)) {
      const header = extractPartyHeader(trimmed);
      sigRoles.add(header || `sig-${i}`);
    }
    const namedInfo = extractNamedPartyInfo(trimmed);
    if (namedInfo) sigRoles.add(namedInfo.role.toLowerCase());
  }
  count = sigRoles.size;

  // DocuSign / template tags
  const templateNums = new Set<string>();
  for (const m of text.matchAll(/\\s(\d+)\\/g)) templateNums.add(m[1]!);
  for (const m of text.matchAll(/\{\{(?:Signature|Signer)[\s_]*(\d+)\}\}/gi)) templateNums.add(m[1]!);
  if (templateNums.size > 0) count = Math.max(count, templateNums.size);

  // Party roles
  const parties = new Set<string>();
  const normalized = text.replace(/\n/g, " ");
  for (const m of normalized.matchAll(
    /\b((?:first|second|third|fourth|fifth|disclosing|receiving|hiring|contracting)\s+party)\b/gi,
  )) {
    parties.add(m[1]!.toLowerCase().replace(/\s+/g, " ").trim());
  }
  if (parties.size >= 2) count = Math.max(count, parties.size);

  // "between X and Y"
  if (count < 2 && /\bbetween\b.*\band\b/is.test(text)) count = Math.max(count, 2);

  // "IN WITNESS WHEREOF" — indicates execution section (at least 2 parties)
  if (count < 2 && /\bin\s+witness\s+whereof\b/i.test(text)) count = Math.max(count, 2);

  return count;
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

function titleCase(str: string): string {
  const small = new Set(["a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "by", "at"]);
  return str
    .split(/\s+/)
    .map((w, i) => {
      if (w === w.toUpperCase() && w.length <= 5 && /^[A-Z]+$/.test(w)) return w;
      if (/^\([A-Z]+\)$/.test(w)) return w;
      const lower = w.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      if (lower.includes("-"))
        return lower
          .split("-")
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join("-");
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function cleanContent(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function detectDocumentType(text: string): string | null {
  const patterns: Array<[RegExp, string]> = [
    // Existing
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
    // New — Corporate
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
    // New — Financial
    [/\bpromissory\s+note\b/i, "Promissory Note"],
    [/\bconvertible\s+(?:promissory\s+)?note\b/i, "Convertible Note"],
    [/\bloan\s+agreement\b/i, "Loan Agreement"],
    [/\bsecurity\s+agreement\b/i, "Security Agreement"],
    [/\bguarant[ey]\s+agreement\b/i, "Guarantee Agreement"],
    [/\bindemnification\s+agreement\b/i, "Indemnification Agreement"],
    [/\bescrow\s+agreement\b/i, "Escrow Agreement"],
    // New — Real Estate
    [/\bpurchase\s+and\s+sale\s+agreement\b/i, "Purchase & Sale Agreement"],
    [/\bdeed\s+of\s+trust\b/i, "Deed of Trust"],
    [/\b(?:warranty|quitclaim|grant)\s+deed\b/i, "Deed"],
    [/\bsublease\b/i, "Sublease Agreement"],
    // New — Employment/IP
    [/\bnon[\s-]?compete\s+agreement\b/i, "Non-Compete Agreement"],
    [/\bnon[\s-]?solicitation\s+agreement\b/i, "Non-Solicitation Agreement"],
    [/\binvention\s+assignment\b/i, "Invention Assignment Agreement"],
    [/\b(?:ip|intellectual\s+property)\s+assignment\b/i, "IP Assignment Agreement"],
    // New — Dispute/Resolution
    [/\bsettlement\s+agreement\b/i, "Settlement Agreement"],
    [/\brelease\s+and\s+waiver\b/i, "Release and Waiver"],
    [/\barbitration\s+agreement\b/i, "Arbitration Agreement"],
    // New — Misc
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
    // Web3 specific
    [/\bdao\s+charter\b/i, "DAO Charter"],
    [/\bdigital\s+asset\b.*\bagreement\b/i, "Digital Asset Agreement"],
    [/\bcustody\s+agreement\b/i, "Custody Agreement"],
    [/\btreasury\s+management\b/i, "Treasury Management Agreement"],
    [/\bsmart\s+contract\s+(?:audit|agreement)\b/i, "Smart Contract Agreement"],
  ];
  for (const [pattern, label] of patterns) {
    if (pattern.test(text)) return label;
  }
  return null;
}
