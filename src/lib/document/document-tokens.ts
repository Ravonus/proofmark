// Shared document tokenizer — used by both the editor (creator) and signer view.
// The persisted document format is the canonical source of truth for inline fields.

const FIELD_MARKER_PREFIX = "{{W3S_FIELD:";
const SIGNATURE_MARKER_PREFIX = "{{W3S_SIGNATURE:";
const MARKER_SUFFIX = "}}";

export type InlineField = {
  id: string;
  type: string;
  label: string;
  placeholder: string;
  signerIdx: number; // which signer this field belongs to (0-based, -1 = unassigned)
  required?: boolean;
  options?: string[];
  settings?: Record<string, unknown>;
};

export type DocToken =
  | { kind: "heading"; text: string; sectionNum: number }
  | { kind: "subheading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "field"; field: InlineField }
  | { kind: "listItem"; text: string }
  | { kind: "break" }
  | { kind: "signatureBlock"; label: string; signerIdx: number }
  | { kind: "page-break"; page: number };

export const PLACEHOLDERS: Record<string, string> = {
  name: "Full legal name",
  "full-name": "Full legal name",
  "first-name": "First name",
  "last-name": "Last name",
  date: "MM/DD/YYYY",
  "effective-date": "MM/DD/YYYY",
  address: "Street, City, State ZIP",
  "street-address": "123 Main Street",
  "full-address": "123 Main St, City, State ZIP",
  email: "email@example.com",
  phone: "+1 (555) 000-0000",
  title: "Job title",
  "job-title": "Job title",
  company: "Company name",
  "company-name": "Company name",
  dropdown: "Select an option",
  "file-attachment": "Upload a file",
  "payment-request": "Collect payment",
  "id-verification": "Verify identity",
  signature: "Your signature",
  initials: "J.S.",
  "free-text": "Enter value",
  other: "Enter value",
};

export const FIELD_COLORS: Record<string, { border: string; bg: string; text: string; glow: string }> = {
  name: {
    border: "border-blue-400/50",
    bg: "bg-blue-400/10",
    text: "text-blue-400",
    glow: "shadow-[0_0_12px_rgba(96,165,250,0.15)]",
  },
  date: {
    border: "border-orange-400/50",
    bg: "bg-orange-400/10",
    text: "text-orange-400",
    glow: "shadow-[0_0_12px_rgba(251,146,60,0.15)]",
  },
  address: {
    border: "border-purple-400/50",
    bg: "bg-purple-400/10",
    text: "text-purple-400",
    glow: "shadow-[0_0_12px_rgba(192,132,252,0.15)]",
  },
  email: {
    border: "border-cyan-400/50",
    bg: "bg-cyan-400/10",
    text: "text-cyan-400",
    glow: "shadow-[0_0_12px_rgba(34,211,238,0.15)]",
  },
  title: {
    border: "border-pink-400/50",
    bg: "bg-pink-400/10",
    text: "text-pink-400",
    glow: "shadow-[0_0_12px_rgba(244,114,182,0.15)]",
  },
  company: {
    border: "border-amber-400/50",
    bg: "bg-amber-400/10",
    text: "text-amber-400",
    glow: "shadow-[0_0_12px_rgba(251,191,36,0.15)]",
  },
  signature: {
    border: "border-emerald-400/50",
    bg: "bg-emerald-400/10",
    text: "text-emerald-400",
    glow: "shadow-[0_0_12px_rgba(52,211,153,0.15)]",
  },
  other: {
    border: "border-gray-400/50",
    bg: "bg-gray-400/10",
    text: "text-gray-400",
    glow: "shadow-[0_0_12px_rgba(156,163,175,0.15)]",
  },
};

export const FIELD_TYPES = [
  { type: "name", icon: "👤", label: "Name" },
  { type: "date", icon: "📅", label: "Date" },
  { type: "address", icon: "🏠", label: "Address" },
  { type: "email", icon: "✉", label: "Email" },
  { type: "title", icon: "🏷", label: "Title/Role" },
  { type: "company", icon: "🏢", label: "Company" },
  { type: "signature", icon: "✍", label: "Signature" },
  { type: "other", icon: "📝", label: "Custom" },
] as const;

type FieldTypeRule = {
  test: (label: string, context: string, both: string) => boolean;
  type: InlineField["type"];
};

const FIELD_TYPE_RULES: FieldTypeRule[] = [
  // 1. Signature (highest priority)
  {
    test: (_l, _c, both) => /\bsignature\b|\bsign\s*here\b|\bautograph\b/i.test(both),
    type: "signature",
  },
  {
    test: (label) => /\binitials?\b/i.test(label),
    type: "signature",
  },
  // 2. Date
  { test: (label) => /\bdate\b/i.test(label), type: "date" },
  {
    test: (_l, context) =>
      /\bdate\s*of\b|\beffective\s*date\b|\bexpir\w*\s*date\b|\bstart\s*date\b|\bend\s*date\b|\bterminat\w*\s*date\b|\bexecut\w*\s*date\b|\bdated?\s*this\b|\b\d+(st|nd|rd|th)?\s*day\s*of\b|\bon\s*the\s*date\b/i.test(
        context,
      ),
    type: "date",
  },
  // 3. Email
  {
    test: (_l, _c, both) => /\be-?mail\b|\belectronic\s*mail\b|@.*\.\w/i.test(both),
    type: "email",
  },
  // 4. Phone
  {
    test: (_l, _c, both) => /\bphone\b|\btelephone\b|\btel\b|\bfax\b|\bmobile\b|\bcell\b/i.test(both),
    type: "email",
  },
  // 5. Address
  { test: (label) => /\baddress\b/i.test(label), type: "address" },
  {
    test: (_l, context) =>
      /\bmailing\s*address\b|\bstreet\b|\baddress\s*of\b|\bwith\s*a\s*mailing\s*address\b/i.test(context),
    type: "address",
  },
  {
    test: (_l, _c, both) =>
      /\bsuite\b|\bapt\b|\bcity\b|\bstate\b|\bzip\b|\bpostal\b|\bcounty\b|\bcountry\b|\bresidence\b|\bdomicile\b|\bp\.?o\.?\s*box\b/i.test(
        both,
      ),
    type: "address",
  },
  // 6. Company / organization
  {
    test: (_l, _c, both) =>
      /\bcompany\b|\bcorporation\b|\bcorp\.?\b|\bllc\b|\binc\.?\b|\bentity\b|\borgani[sz]ation\b|\bfirm\b|\bemployer\b|\bbusiness\b|\benterprise\b/i.test(
        both,
      ),
    type: "company",
  },
  // 7. Job title / role
  {
    test: (label) =>
      /\btitle\b|\brole\b|\bposition\b|\bdesignation\b|\boccupation\b|\bdepartment\b|\bauthori[sz]ed\s*representative\b/i.test(
        label,
      ),
    type: "title",
  },
  // 8. Name
  {
    test: (label) =>
      /\bname\b|\bprint\w*\s*name\b|\bfull\s*name\b|\blegal\s*name\b|\btyped.*name\b|\bprinted.*name\b/i.test(label),
    type: "name",
  },
  {
    test: (label) => /\bparty\b.*\binformation\b|\bparty\b.*\bdisclos\b|\bparty\b.*\breceiv\b/i.test(label),
    type: "name",
  },
  {
    test: (label, context) =>
      !/\bdate\b|\baddress\b/i.test(context) &&
      /\bparty\b|\bprincipal\b|\brecipient\b|\bbeneficiary\b|\bwitness\b|\bnotary\b|\blandlord\b|\btenant\b|\blessor\b|\blessee\b|\bbuyer\b|\bseller\b|\bclient\b|\bvendor\b|\bcontractor\b/i.test(
        label,
      ),
    type: "name",
  },
  // 9. Web3
  {
    test: (_l, _c, both) => /\bwallet\b|\b0x[a-f0-9]/i.test(both),
    type: "other",
  },
  // 10. Financial
  {
    test: (_l, _c, both) =>
      /\bamount\b|\bprice\b|\bfee\b|\bcost\b|\bpayment\b|\bcompensation\b|\bsalary\b|\b\$\b/i.test(both),
    type: "other",
  },
  // 11. Legal
  {
    test: (_l, _c, both) => /\bjurisdiction\b|\bgoverning\s*law\b/i.test(both),
    type: "other",
  },
  {
    test: (label) => /\bterm\b|\bduration\b|\bperiod\b/i.test(label),
    type: "date",
  },
  // 12. Last resort context hints
  {
    test: (_l, context) => /\bname\b/i.test(context) && !/\bdate\b|\baddress\b|\bmailing\b/i.test(context),
    type: "name",
  },
  { test: (_l, context) => /\bdate\b/i.test(context), type: "date" },
  {
    test: (_l, context) => /\baddress\b|\bmailing\b/i.test(context),
    type: "address",
  },
];

export function guessFieldType(label: string, lineContext?: string): InlineField["type"] {
  const labelLower = label.toLowerCase();
  const contextLower = (lineContext || "").toLowerCase();
  const both = `${labelLower} ${contextLower}`;

  for (const rule of FIELD_TYPE_RULES) {
    if (rule.test(labelLower, contextLower, both)) return rule.type;
  }
  return "other";
}

function normalizeField(field: Partial<InlineField>, fallbackId: string): InlineField {
  const type = field.type || "free-text";
  const label = field.label || "Field";
  const placeholder = field.placeholder || PLACEHOLDERS[type] || PLACEHOLDERS.other || label;
  return {
    id: field.id || fallbackId,
    type,
    label,
    placeholder,
    signerIdx: typeof field.signerIdx === "number" ? field.signerIdx : 0,
    required: field.required ?? true,
    options: field.options?.length ? field.options : undefined,
    settings: field.settings && Object.keys(field.settings).length > 0 ? field.settings : undefined,
  };
}

function decodeMarkerPayload<T>(payload: string): T | null {
  try {
    return JSON.parse(decodeURIComponent(payload)) as T;
  } catch {
    return null;
  }
}

function encodeMarkerPayload(payload: unknown): string {
  return encodeURIComponent(JSON.stringify(payload));
}

function serializeFieldMarker(field: InlineField): string {
  return `${FIELD_MARKER_PREFIX}${encodeMarkerPayload({
    id: field.id,
    type: field.type,
    label: field.label,
    placeholder: field.placeholder,
    signerIdx: field.signerIdx,
    required: field.required ?? true,
    options: field.options,
    settings: field.settings,
  })}${MARKER_SUFFIX}`;
}

function serializeSignatureMarker(label: string, signerIdx: number): string {
  return `${SIGNATURE_MARKER_PREFIX}${encodeMarkerPayload({ label, signerIdx })}${MARKER_SUFFIX}`;
}

function tryParseStandaloneSignature(line: string): DocToken[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(SIGNATURE_MARKER_PREFIX) || !trimmed.endsWith(MARKER_SUFFIX) || trimmed !== line) return null;
  const signatureMatch = /^\{\{W3S_SIGNATURE:([^}]+)\}\}$/.exec(trimmed);
  if (!signatureMatch) return null;
  const payload = decodeMarkerPayload<{ label?: string; signerIdx?: number }>(signatureMatch[1] || "");
  return [
    {
      kind: "signatureBlock",
      label: payload?.label || "Signature",
      signerIdx: payload?.signerIdx ?? 0,
    },
  ];
}

function decodeMarkerToken(
  kind: string,
  rawPayload: string,
  makeField: (field: Partial<InlineField>) => InlineField,
): DocToken {
  if (kind === "FIELD") {
    const fieldPayload = decodeMarkerPayload<Partial<InlineField>>(rawPayload || "");
    return { kind: "field", field: makeField(fieldPayload ?? {}) };
  }
  const signaturePayload = decodeMarkerPayload<{
    label?: string;
    signerIdx?: number;
  }>(rawPayload || "");
  return {
    kind: "signatureBlock",
    label: signaturePayload?.label || "Signature",
    signerIdx: signaturePayload?.signerIdx ?? 0,
  };
}

function parseCanonicalLine(line: string, makeField: (field: Partial<InlineField>) => InlineField): DocToken[] | null {
  const markerRegex = /\{\{W3S_(FIELD|SIGNATURE):([^}]+)\}\}/g;
  if (!markerRegex.test(line)) return null;
  markerRegex.lastIndex = 0;

  const standalone = tryParseStandaloneSignature(line);
  if (standalone) return standalone;

  const tokens: DocToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(line)) !== null) {
    const before = line.slice(lastIndex, match.index);
    if (before) {
      tokens.push({ kind: "text", text: before });
    }
    tokens.push(decodeMarkerToken(match[1]!, match[2]!, makeField));
    lastIndex = markerRegex.lastIndex;
  }

  if (lastIndex < line.length) {
    tokens.push({ kind: "text", text: line.slice(lastIndex) });
  }

  return tokens;
}

function detectPartySwitch(line: string, currentGuess: number): number {
  const partyLetterMatch = /party\s+([a-z])\b/i.exec(line);
  if (partyLetterMatch) {
    return partyLetterMatch[1]!.toUpperCase().charCodeAt(0) - 65;
  }
  if (/\b(disclos|first|landlord|lessor|seller|employer|licensor)\w*/i.test(line) && /party|information/i.test(line)) {
    return 0;
  }
  if (/\b(receiv|second|tenant|lessee|buyer|employee|licensee)\w*/i.test(line) && /party|information/i.test(line)) {
    return 1;
  }
  return currentGuess;
}

function isHeading(line: string): boolean {
  if (/^\d+\.\s+\S/.test(line) && line.length < 100) return true;
  return (
    /^(?:section|article|clause|part|schedule|exhibit|appendix|recital)\s+[\dIVXivx]+/i.test(line) && line.length < 100
  );
}

function isSubheading(line: string): boolean {
  if (/^\d+\.\d+\.?\d*\s+\S/.test(line) && line.length < 100) return true;
  return line === line.toUpperCase() && line.length > 3 && line.length < 60 && /^[A-Z][A-Z &/,().-]+$/.test(line);
}

function classifyStructuralLine(line: string, sectionCounter: number, signerGuess: number): DocToken | null {
  if (isHeading(line)) {
    return {
      kind: "heading",
      text: line,
      sectionNum: sectionCounter + 1,
    };
  }
  if (isSubheading(line)) {
    return { kind: "subheading", text: line };
  }
  if (/^\([a-z]\)\s|^\([ivx]+\)\s|^\(\d+\)\s|^[-*•]\s|^[a-z]\)\s|^[ivx]+\)\s/.test(line)) {
    return { kind: "listItem", text: line };
  }
  if (/signature\s*:/i.test(line) && /_{3,}/.test(line)) {
    const label = line.replace(/signature\s*:\s*_+/i, "").trim() || line.split(/signature/i)[0]!.trim() || "Signature";
    return { kind: "signatureBlock", label, signerIdx: signerGuess };
  }
  return null;
}

export function tokenizeDocument(
  content: string,
  signerCount: number = 2,
): { tokens: DocToken[]; fields: InlineField[] } {
  const lines = content.split("\n");
  const tokens: DocToken[] = [];
  const fields: InlineField[] = [];
  let fieldCounter = 0;
  let sectionCounter = 0;
  let currentSignerGuess = 0;
  let prevLineText = ""; // carry context from previous line for field detection

  const makeField = (input: string | Partial<InlineField>, type?: InlineField["type"]): InlineField => {
    const fallbackId = `field-${fieldCounter++}`;
    const f =
      typeof input === "string"
        ? normalizeField(
            {
              id: fallbackId,
              type: type || "free-text",
              label: input,
              placeholder: PLACEHOLDERS[type || "free-text"] || input,
              signerIdx: Math.min(currentSignerGuess, signerCount - 1),
            },
            fallbackId,
          )
        : normalizeField(
            {
              ...input,
              signerIdx:
                typeof input.signerIdx === "number"
                  ? Math.min(input.signerIdx, signerCount - 1)
                  : Math.min(currentSignerGuess, signerCount - 1),
            },
            fallbackId,
          );
    fields.push(f);
    return f;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      tokens.push({ kind: "break" });
      continue;
    }
    if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(line)) continue;

    const canonicalTokens = parseCanonicalLine(line, (field) => makeField(field));
    if (canonicalTokens) {
      tokens.push(...canonicalTokens);
      prevLineText = line;
      continue;
    }

    currentSignerGuess = detectPartySwitch(line, currentSignerGuess);

    const structuralToken = classifyStructuralLine(line, sectionCounter, currentSignerGuess);
    if (structuralToken) {
      if (structuralToken.kind === "heading" && "sectionNum" in structuralToken) {
        sectionCounter = structuralToken.sectionNum;
      }
      tokens.push(structuralToken);
      prevLineText = line;
      continue;
    }

    tokens.push(...processInlineFields(line, (label, fieldType) => makeField(label, fieldType), prevLineText));
    prevLineText = line;
  }

  return { tokens, fields };
}

function inferFieldLabel(rawLabel: string, textBeforeBlank: string, type: InlineField["type"]): string {
  if (rawLabel) return rawLabel;

  const contextWords = textBeforeBlank.trim().split(/\s+/).slice(-3).join(" ");
  if (contextWords && type !== "other") {
    return type.charAt(0).toUpperCase() + type.slice(1);
  }
  if (contextWords.length > 2) {
    return contextWords.length > 30 ? contextWords.slice(-30) : contextWords;
  }
  return type !== "other" ? type.charAt(0).toUpperCase() + type.slice(1) : "Field";
}

function processInlineFields(
  line: string,
  makeField: (label: string, type: InlineField["type"]) => InlineField,
  prevLine?: string,
): DocToken[] {
  const tokens: DocToken[] = [];
  const regex = /(?:([A-Za-z\s]+?)\s*:\s*)?_{3,}/g;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(line)) !== null) {
    const beforeBlank = line.slice(lastIdx, match.index);
    if (beforeBlank) {
      tokens.push({ kind: "text", text: beforeBlank });
    }

    const rawLabel = (match[1] || "").trim();
    const textBeforeBlank = line.slice(0, match.index);
    const fullContext = `${prevLine || ""} ${textBeforeBlank} ${rawLabel}`;
    const type = guessFieldType(rawLabel, fullContext);
    const label = inferFieldLabel(rawLabel, textBeforeBlank, type);

    tokens.push({ kind: "field", field: makeField(label, type) });
    lastIdx = regex.lastIndex;
  }

  if (lastIdx === 0) {
    tokens.push({ kind: "text", text: line });
  } else if (lastIdx < line.length) {
    tokens.push({ kind: "text", text: line.slice(lastIdx) });
  }

  return tokens;
}

// Rebuild content from tokens (for saving edited documents)
export function tokensToContent(tokens: DocToken[]): string {
  const lines: string[] = [];
  let currentLine = "";

  const flushCurrentLine = () => {
    if (currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = "";
    }
  };

  for (const t of tokens) {
    switch (t.kind) {
      case "heading":
        flushCurrentLine();
        lines.push(t.text);
        break;
      case "subheading":
        flushCurrentLine();
        lines.push(t.text);
        break;
      case "text":
        currentLine += t.text;
        break;
      case "field":
        currentLine += serializeFieldMarker(t.field);
        break;
      case "listItem":
        flushCurrentLine();
        if (t.text) {
          lines.push(t.text);
        }
        break;
      case "break":
        flushCurrentLine();
        lines.push("");
        break;
      case "signatureBlock":
        flushCurrentLine();
        lines.push(serializeSignatureMarker(t.label, t.signerIdx));
        break;
    }
  }
  flushCurrentLine();
  return lines.join("\n");
}
