/**
 * PDF field detection helpers — extracted from pdf-analyze.ts
 * to keep files under 650 lines.
 */
import type { DetectedField, FieldType } from "~/lib/document/pdf-types";
import { detectLabeledValues, detectPlaceholders, titleCase } from "./pdf-analyze-utils";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SHARED CONSTANTS (also used by pdf-analyze.ts via import)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** Matches ANY blank-field indicator: underscores, dots, or dashes (3+) */
export const BLANK_RE = /(?:_{3,}|\.{5,}|-{5,})/;
export const BLANK_RE_G = /(?:_{3,}|\.{5,}|-{5,})/g;

/** Matches lines with 2+ party initials */
export const MULTI_PARTY_INITIALS_RE =
  /\b[A-Za-z]+\s+Initials\s*:\s*(?:_{3,}|\.{3,}|-{3,}).*\b[A-Za-z]+\s+Initials\s*:\s*(?:_{3,}|\.{3,}|-{3,})/i;
export const MULTI_PARTY_INITIALS_CAPTURE_RE = /\b([A-Za-z]+)\s+Initials\s*:\s*(?:_{3,}|\.{3,}|-{3,})/gi;

// Named party approval roles
export const PARTY_ROLES_RE =
  /Buyer|Seller|Investor|Borrower|Lender|Licensor|Licensee|Landlord|Tenant|Legal\s*Counsel|Counsel|Auditor|Guarantor|Contractor|Client|Vendor|Supplier|Agent|Broker|Trustee|Beneficiary|Employer|Employee|Consultant|Service\s*Provider|Recipient|Grantor|Grantee|Assignor|Assignee|Mortgagor|Mortgagee|Pledgor|Pledgee|Principal|Surety|Indemnitor|Indemnitee|Obligor|Obligee|Franchisor|Franchisee|Lessor|Lessee|Partner|Member|Manager|Director|Officer|Shareholder|Stakeholder|Underwriter|Arranger|Servicer|Originator|Custodian/;

const BLANK_PAT = `(?:_{3,}|\\.{5,}|-{5,})`;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FIELD DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

type PartyState = {
  currentParty: string | null;
  partySetAt: number;
};

const PARTY_SCOPE_LINES = 6;

export function detectFields(lines: string[], recitalZone?: { start: number; end: number } | null): DetectedField[] {
  const fields: DetectedField[] = [];
  const state: PartyState = { currentParty: null, partySetAt: -1 };
  let charPos = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (recitalZone && i >= recitalZone.start && i < recitalZone.end) {
      charPos += line.length + 1;
      continue;
    }

    updatePartyContext(state, line.trim(), i);
    processLineFields({
      fields,
      line,
      i,
      lines,
      currentParty: state.currentParty,
      charPos,
    });
    charPos += line.length + 1;
  }

  return fields;
}

function updatePartyContext(state: PartyState, trimmed: string, i: number): void {
  const partyHeader = extractPartyHeader(trimmed);
  if (partyHeader) {
    state.currentParty = partyHeader;
    state.partySetAt = i;
  }

  if (state.currentParty && i - state.partySetAt > PARTY_SCOPE_LINES) {
    state.currentParty = null;
  }

  if (isSectionBreak(trimmed)) {
    state.currentParty = null;
  }
}

function isSectionBreak(trimmed: string): boolean {
  return (
    /^\d+\.\s+(?:COMPLEX\s+)?CLAUSE\s+\d+/i.test(trimmed) ||
    /^(?:ARTICLE|SECTION)\s+\d+/i.test(trimmed) ||
    /^SPECIAL\s+CONDITIONS/i.test(trimmed)
  );
}

type LineFieldCtx = {
  fields: DetectedField[];
  line: string;
  i: number;
  lines: string[];
  currentParty: string | null;
  charPos: number;
};

function processLineFields(ctx: LineFieldCtx): void {
  const { fields, line, i, lines, currentParty, charPos } = ctx;
  const trimmed = line.trim();

  // Blank fields
  if (BLANK_RE_G.test(line)) {
    BLANK_RE_G.lastIndex = 0; // reset after test
    const fieldInfo = classifyBlanks(line, trimmed, i, lines, currentParty);
    for (const f of fieldInfo) {
      fields.push({ ...f, line: i + 1, position: charPos + (f.position || 0) });
    }
  }

  // Filled-in labeled fields
  for (const f of detectLabeledValues(trimmed, i, currentParty)) {
    fields.push({ ...f, line: i + 1, position: charPos });
  }

  // Bracket/template/e-sign placeholders
  for (const f of detectPlaceholders(trimmed, i, currentParty)) {
    fields.push({ ...f, line: i + 1, position: charPos });
  }

  // Checkboxes
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
}

// ─── Party header extraction ────────────────────────────────────────────────

export function extractPartyHeader(line: string): string | null {
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

export function extractNamedPartyInfo(line: string): { entity: string; role: string } | null {
  const m = new RegExp(
    `^(.+?)\\s+\\(\\s*(${PARTY_ROLES_RE.source})\\s*\\)\\s*(?:Approval|Acknowledgment|Acceptance|Confirmation|Authorization)\\s*:`,
    "i",
  ).exec(line);
  if (m) return { entity: m[1]!.trim(), role: m[2]!.trim() };
  return null;
}

// ─── Blank field classification (split into sub-classifiers) ───────────────

type ClassifyCtx = {
  fields: DetectedField[];
  rawLine: string;
  trimmed: string;
  lineIdx: number;
  lines: string[];
  currentParty: string | null;
};

function classifyBlanks(
  rawLine: string,
  trimmed: string,
  lineIdx: number,
  lines: string[],
  currentParty: string | null,
): DetectedField[] {
  const ctx: ClassifyCtx = {
    fields: [],
    rawLine,
    trimmed,
    lineIdx,
    lines,
    currentParty,
  };

  classifySignatureAndInitials(ctx);
  classifyNameDateTitle(ctx);
  classifyPartyInfo(ctx);
  classifyContactFields(ctx);
  classifyFinancialFields(ctx);
  classifyWalletFields(ctx);
  classifyStandaloneAndNotary(ctx);

  return ctx.fields;
}

// ── Sub-classifiers ────────────────────────────────────────────────────────

function classifySignatureAndInitials(ctx: ClassifyCtx): void {
  const { fields, rawLine, trimmed, lineIdx, currentParty } = ctx;
  // Signature
  if (new RegExp(`signature\\s*:\\s*${BLANK_PAT}`, "i").test(trimmed)) {
    fields.push(blankField("signature", "Signature", rawLine, currentParty, lineIdx));
  }

  // "By: ______" (corporate authorized signature)
  if (new RegExp(`\\bBy\\s*:\\s*${BLANK_PAT}`, "i").test(trimmed)) {
    fields.push(blankField("signature", "Authorized Signature (By)", rawLine, currentParty, lineIdx));
  }

  // "Its: ______" (corporate title after By:)
  if (new RegExp(`\\bIts\\s*:\\s*${BLANK_PAT}`, "i").test(trimmed)) {
    fields.push(blankField("title", "Corporate Title (Its)", rawLine, currentParty, lineIdx));
  }

  // Initials (single)
  if (new RegExp(`\\binitials\\s*:\\s*${BLANK_PAT}`, "i").test(trimmed) && !MULTI_PARTY_INITIALS_RE.test(trimmed)) {
    fields.push(blankField("initials", "Initials", rawLine, currentParty, lineIdx));
  }

  // Multi-party initials
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
}

function classifyNameDateTitle(ctx: ClassifyCtx): void {
  const { fields, rawLine, trimmed, lineIdx, lines, currentParty } = ctx;
  // Name
  const nameMatch = new RegExp(
    `(?:(?:typed\\s+or\\s+)?print(?:ed)?\\s+name|name\\s*\\(print(?:ed)?\\)|^name)\\s*:\\s*(${BLANK_PAT}|([A-Za-z\u00C0-\u024F][a-zA-Z\u00C0-\u024F\\s.'-]{1,60}))`,
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

  // Date
  const dateMatch = new RegExp(
    `\\bDate\\s*:\\s*(${BLANK_PAT}|[\\d/.-]+|[A-Z][a-z]+\\s+\\d{1,2},?\\s*\\d{4}|\\d{1,2}\\s+[A-Z][a-z]+\\s+\\d{4})`,
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

  // Title
  const titleMatch = new RegExp(
    `\\bTitle\\s*:\\s*(${BLANK_PAT}|([A-Za-z\u00C0-\u024F][a-zA-Z\u00C0-\u024F\\s.'-]{2,40}))`,
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

  // Multi-line date: blank after "date of"
  if (BLANK_RE.test(trimmed) && /^(?:_{3,}|\.{5,}|-{5,})/.test(trimmed) && fields.length === 0) {
    const prevLine = (lines[lineIdx - 1] || "").trim().toLowerCase();
    if (/(?:date\s+of|as\s+of|effective)\s*$/.test(prevLine)) {
      fields.push(blankField("date", "Agreement Date", rawLine, null, lineIdx));
    }
  }

  // "entered into on the date of ______"
  if (
    new RegExp(
      `(?:entered\\s+into|made|effective)\\s+(?:on\\s+)?(?:the\\s+)?(?:date\\s+of|as\\s+of)\\s*${BLANK_PAT}`,
      "i",
    ).test(trimmed)
  ) {
    fields.push(blankField("date", "Agreement Date", rawLine, null, lineIdx));
  }
}

function classifyPartyInfo(ctx: ClassifyCtx): void {
  const { fields, rawLine, trimmed, lineIdx, lines, currentParty } = ctx;
  // "Party Disclosing Information: ______"
  const partyInfoMatch = new RegExp(
    `^Party\\s+(Disclosing|Receiving|Providing|Requesting)\\s+Information\\s*:\\s*(${BLANK_PAT}|([A-Z][A-Za-z\\s.&,'-]+))`,
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

  // Mailing Address
  if (
    /mailing\s+address\s+of\s*$/i.test(trimmed) ||
    new RegExp(`mailing\\s+address\\s+of\\s*${BLANK_PAT}`, "i").test(trimmed)
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

  // Company/Entity
  const companyMatch = new RegExp(
    `\\b(?:Company|Entity|Organization|Corporation)\\s*:\\s*(${BLANK_PAT}|([A-Za-z0-9\u00C0-\u024F][A-Za-z0-9\u00C0-\u024F\\s.&,()'/+-]+))`,
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
}

function classifyContactFields(ctx: ClassifyCtx): void {
  const { fields, rawLine, trimmed, lineIdx, currentParty } = ctx;
  // Email
  const emailMatch = new RegExp(`\\bE-?mail\\s*:\\s*(${BLANK_PAT}|(\\S+@\\S+\\.\\S+))`, "i").exec(trimmed);
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

  // Phone/Fax
  const phoneMatch = new RegExp(
    `\\b(?:Phone|Tel(?:ephone)?|Fax|Cell|Mobile|Contact(?:\\s+Number)?)\\s*:\\s*(${BLANK_PAT}|([\\d()+\\s.-]{7,20}))`,
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
}

function classifyFinancialFields(ctx: ClassifyCtx): void {
  const { fields, rawLine, trimmed, lineIdx, currentParty } = ctx;
  // Amount/Currency
  const amountMatch = new RegExp(
    `\\b(?:Amount|Sum|Price|Fee|Rate|Commission|Salary|Compensation|Consideration)\\s*:?\\s*(${BLANK_PAT}|([\\$\\d,.]+))`,
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

  // Reference/Account/ID
  const refMatch = new RegExp(
    `\\b(?:Account\\s*(?:#|No\\.?|Number)|Reference\\s*(?:#|No\\.?)|Invoice\\s*(?:#|No\\.?)|Order\\s*(?:#|No\\.?|ID)|EIN|Tax\\s*ID|SSN|SWIFT|IBAN|ABA|Routing(?:\\s+Number)?)\\s*:?\\s*(${BLANK_PAT}|([A-Za-z0-9-]{4,30}))`,
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
}

function classifyWalletFields(ctx: ClassifyCtx): void {
  const { fields, rawLine, trimmed, lineIdx, lines, currentParty } = ctx;
  // Wallet (inline)
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

  // Wallet (next line)
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
}

function classifyStandaloneAndNotary(ctx: ClassifyCtx): void {
  const { fields, rawLine, trimmed, lineIdx, lines, currentParty } = ctx;
  // Standalone blank with party alias: "______ ("Disclosing Party")"
  if (/^(?:_{3,}|\.{5,}|-{5,})\s*\(/.test(trimmed) && fields.length === 0) {
    const prevLine = (lines[lineIdx - 1] || "").trim().toLowerCase();
    const aliasMatch = /\(\s*["'\u201C]?([^)"'"\u201C\u201D]+)["'\u201D]?\s*\)/.exec(trimmed);
    if (/mailing\s+address|address\s+of|address\s*:/.test(prevLine)) {
      fields.push({
        type: "address",
        label: "Mailing Address",
        value: null,
        blank: true,
        partyRole: aliasMatch ? aliasMatch[1]!.trim() : currentParty,
        line: lineIdx + 1,
        position: 0,
      });
    } else if (aliasMatch) {
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

  // Notary venue: "STATE OF ___" / "COUNTY OF ___"
  if (new RegExp(`(?:STATE|COUNTY|COMMONWEALTH)\\s+OF\\s*${BLANK_PAT}`, "i").test(trimmed)) {
    fields.push(blankField("notary", "Notary Venue", rawLine, null, lineIdx));
  }

  // "My Commission Expires: ___"
  if (new RegExp(`Commission\\s+Expires\\s*:\\s*${BLANK_PAT}`, "i").test(trimmed)) {
    fields.push(blankField("notary", "Commission Expiry", rawLine, null, lineIdx));
  }

  // Witness signature
  if (new RegExp(`Witness(?:ed)?\\s+(?:Signature|By)\\s*:\\s*${BLANK_PAT}`, "i").test(trimmed)) {
    fields.push(blankField("witness", "Witness Signature", rawLine, null, lineIdx));
  }
}

// ─── Boilerplate line detection ────────────────────────────────────────────

/**
 * Returns true if a line is a boilerplate paragraph line (body text that
 * happens to contain inline fields at the end), as opposed to a dedicated
 * field-only line.
 */
export function isBoilerplateLine(line: string): boolean {
  if (line.length < 10) return false;
  if (
    /^(?:Signature|Date|Initials|(?:Typed\s+or\s+)?Print(?:ed)?\s+Name|Name|Title|By|Its|Email|Phone|Company|Wallet|Authorized)\s*:/i.test(
      line,
    )
  )
    return false;
  if (/[.!?;]\s+(?:Signature|Date|Initials|Wallet)\s*:/i.test(line)) return true;
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
  return {
    type,
    label,
    value: null,
    blank: true,
    partyRole: party,
    line: lineIdx + 1,
    position: rawLine.indexOf("_"),
  };
}

// Re-export titleCase for consumers that imported it from here
export { detectLabeledValues, detectPlaceholders, titleCase } from "./pdf-analyze-utils";
