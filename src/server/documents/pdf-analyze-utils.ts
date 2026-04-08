/**
 * Shared utilities for pdf-analyze modules.
 */
import type { DetectedField, FieldType } from "~/lib/document/pdf-types";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TITLE CASE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const SMALL_WORDS = new Set(["a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "by", "at"]);

export function titleCase(str: string): string {
  return str
    .split(/\s+/)
    .map((w, i) => {
      if (w === w.toUpperCase() && w.length <= 5 && /^[A-Z]+$/.test(w)) return w;
      if (/^\([A-Z]+\)$/.test(w)) return w;
      const lower = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      if (lower.includes("-"))
        return lower
          .split("-")
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join("-");
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FILLED-IN LABELED FIELDS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function detectLabeledValues(trimmed: string, _lineIdx: number, currentParty: string | null): DetectedField[] {
  const fields: DetectedField[] = [];

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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PLACEHOLDER / E-SIGN TAG DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DOCUSIGN_TYPE_MAP: Record<string, FieldType> = {
  s: "signature",
  n: "name",
  d: "date",
  t: "title",
  i: "initials",
  c: "company",
};

const HELLOSIGN_TYPE_MAP: Record<string, FieldType> = {
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

export function detectPlaceholders(trimmed: string, _lineIdx: number, currentParty: string | null): DetectedField[] {
  const fields: DetectedField[] = [];

  for (const m of trimmed.matchAll(/\[([A-Za-z][A-Za-z\s_]{1,40}?)\]/g)) {
    const label = m[1]!.trim();
    if (label.length < 2) continue;
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

  for (const m of trimmed.matchAll(/\\([snditc])(\d+)\\/g)) {
    fields.push({
      type: DOCUSIGN_TYPE_MAP[m[1]!] || "other",
      label: `Signer ${m[2]} ${DOCUSIGN_TYPE_MAP[m[1]!] || "field"}`,
      value: null,
      blank: true,
      partyRole: null,
      line: 0,
      position: 0,
    });
  }

  for (const m of trimmed.matchAll(/\[(\w+)\|(\w+)\|signer(\d+)(?:\|([^\]]+))?\]/g)) {
    const fieldType = m[1]!.toLowerCase();
    fields.push({
      type: HELLOSIGN_TYPE_MAP[fieldType] || "other",
      label: m[4] || `Signer ${m[3]} ${fieldType}`,
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
  const patterns: Array<[RegExp, FieldType]> = [
    [/sign|sig/, "signature"],
    [/initial/, "initials"],
    [/wallet|eth.*addr|btc.*addr/, "wallet"],
    [/company|entity|corp|org/, "company"],
    [/name|print/, "name"],
    [/date/, "date"],
    [/title|role|position/, "title"],
    [/address|addr/, "address"],
    [/email|e-?mail/, "email"],
    [/phone|tel|fax|mobile/, "phone"],
    [/amount|price|fee|sum/, "amount"],
    [/witness/, "witness"],
    [/notary|commission/, "notary"],
    [/check|agree|accept|consent/, "checkbox"],
    [/account|ref|invoice|order|ssn|ein|tax.?id|swift|iban/, "reference"],
  ];
  // Special case: "sign" without "initial"
  if (/sign|sig/.test(l) && !l.includes("initial")) return "signature";
  for (const [pattern, type] of patterns) {
    if (pattern === patterns[0]![0]) continue; // skip signature (handled above)
    if (pattern.test(l)) return type;
  }
  return "other";
}
