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

export function guessFieldType(label: string, lineContext?: string): InlineField["type"] {
  // Use just the label for primary match, context for fallback
  const labelLower = label.toLowerCase();
  const contextLower = (lineContext || "").toLowerCase();
  // Combined for broader matching — but label takes priority
  const both = labelLower + " " + contextLower;

  // ── 1. Signature (highest priority) ──
  if (/\bsignature\b|\bsign\s*here\b|\bautograph\b/i.test(both)) return "signature";
  if (/\binitials?\b/i.test(labelLower)) return "signature";

  // ── 2. Date (before name — "date of ___" must beat "party name" in context) ──
  if (/\bdate\b/i.test(labelLower)) return "date";
  // Check context: "on the date of" "effective date" "dated this" "day of"
  if (
    /\bdate\s*of\b|\beffective\s*date\b|\bexpir\w*\s*date\b|\bstart\s*date\b|\bend\s*date\b|\bterminat\w*\s*date\b|\bexecut\w*\s*date\b|\bdated?\s*this\b|\b\d+(st|nd|rd|th)?\s*day\s*of\b|\bon\s*the\s*date\b/i.test(
      contextLower,
    )
  )
    return "date";

  // ── 3. Email ──
  if (/\be-?mail\b|\belectronic\s*mail\b|@.*\.\w/i.test(both)) return "email";

  // ── 4. Phone ──
  if (/\bphone\b|\btelephone\b|\btel\b|\bfax\b|\bmobile\b|\bcell\b/i.test(both)) return "email";

  // ── 5. Address (before name — "mailing address of" must beat "party") ──
  if (/\baddress\b/i.test(labelLower)) return "address";
  if (/\bmailing\s*address\b|\bstreet\b|\baddress\s*of\b|\bwith\s*a\s*mailing\s*address\b/i.test(contextLower))
    return "address";
  if (
    /\bsuite\b|\bapt\b|\bcity\b|\bstate\b|\bzip\b|\bpostal\b|\bcounty\b|\bcountry\b|\bresidence\b|\bdomicile\b|\bp\.?o\.?\s*box\b/i.test(
      both,
    )
  )
    return "address";

  // ── 6. Company / organization ──
  if (
    /\bcompany\b|\bcorporation\b|\bcorp\.?\b|\bllc\b|\binc\.?\b|\bentity\b|\borgani[sz]ation\b|\bfirm\b|\bemployer\b|\bbusiness\b|\benterprise\b/i.test(
      both,
    )
  )
    return "company";

  // ── 7. Job title / role ──
  if (
    /\btitle\b|\brole\b|\bposition\b|\bdesignation\b|\boccupation\b|\bdepartment\b|\bauthori[sz]ed\s*representative\b/i.test(
      labelLower,
    )
  )
    return "title";

  // ── 8. Name (check label strongly, context loosely) ──
  if (
    /\bname\b|\bprint\w*\s*name\b|\bfull\s*name\b|\blegal\s*name\b|\btyped.*name\b|\bprinted.*name\b/i.test(labelLower)
  )
    return "name";
  // "Party Disclosing Information:", "Party Receiving Information:" — asking for party name
  if (/\bparty\b.*\binformation\b|\bparty\b.*\bdisclos\b|\bparty\b.*\breceiv\b/i.test(labelLower)) return "name";
  if (!/\bdate\b|\baddress\b/i.test(contextLower)) {
    if (
      /\bparty\b|\bprincipal\b|\brecipient\b|\bbeneficiary\b|\bwitness\b|\bnotary\b|\blandlord\b|\btenant\b|\blessor\b|\blessee\b|\bbuyer\b|\bseller\b|\bclient\b|\bvendor\b|\bcontractor\b/i.test(
        labelLower,
      )
    )
      return "name";
  }

  // ── 9. Web3 ──
  if (/\bwallet\b|\b0x[a-f0-9]/i.test(both)) return "other";

  // ── 10. Financial ──
  if (/\bamount\b|\bprice\b|\bfee\b|\bcost\b|\bpayment\b|\bcompensation\b|\bsalary\b|\b\$\b/i.test(both))
    return "other";

  // ── 11. Legal ──
  if (/\bjurisdiction\b|\bgoverning\s*law\b/i.test(both)) return "other";
  if (/\bterm\b|\bduration\b|\bperiod\b/i.test(labelLower)) return "date";

  // ── 12. Last resort: check context for hints ──
  if (/\bname\b/i.test(contextLower) && !/\bdate\b|\baddress\b|\bmailing\b/i.test(contextLower)) return "name";
  if (/\bdate\b/i.test(contextLower)) return "date";
  if (/\baddress\b|\bmailing\b/i.test(contextLower)) return "address";

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

function parseCanonicalLine(line: string, makeField: (field: Partial<InlineField>) => InlineField): DocToken[] | null {
  const markerRegex = /\{\{W3S_(FIELD|SIGNATURE):([^}]+)\}\}/g;
  if (!markerRegex.test(line)) return null;
  markerRegex.lastIndex = 0;

  if (line.trim().startsWith(SIGNATURE_MARKER_PREFIX) && line.trim().endsWith(MARKER_SUFFIX) && line.trim() === line) {
    const signatureMatch = /^\{\{W3S_SIGNATURE:([^}]+)\}\}$/.exec(line.trim());
    if (signatureMatch) {
      const payload = decodeMarkerPayload<{ label?: string; signerIdx?: number }>(signatureMatch[1] || "");
      return [
        {
          kind: "signatureBlock",
          label: payload?.label || "Signature",
          signerIdx: payload?.signerIdx ?? 0,
        },
      ];
    }
  }

  const tokens: DocToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = markerRegex.exec(line)) !== null) {
    const before = line.slice(lastIndex, match.index);
    if (before) {
      tokens.push({ kind: "text", text: before });
    }

    const kind = match[1];
    const payload = match[2];

    if (kind === "FIELD") {
      const fieldPayload = decodeMarkerPayload<Partial<InlineField>>(payload || "");
      tokens.push({ kind: "field", field: makeField(fieldPayload ?? {}) });
    } else if (kind === "SIGNATURE") {
      const signaturePayload = decodeMarkerPayload<{ label?: string; signerIdx?: number }>(payload || "");
      tokens.push({
        kind: "signatureBlock",
        label: signaturePayload?.label || "Signature",
        signerIdx: signaturePayload?.signerIdx ?? 0,
      });
    }

    lastIndex = markerRegex.lastIndex;
  }

  if (lastIndex < line.length) {
    tokens.push({ kind: "text", text: line.slice(lastIndex) });
  }

  return tokens;
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

    // Detect party context switches — many formats:
    // "Party A:", "Party B:", "Disclosing Party:", "Receiving Party:",
    // "Party Disclosing Information:", "Party Receiving Information:",
    // "DISCLOSING PARTY", "RECEIVING PARTY"
    if (/party\s+([a-z])\b/i.test(line)) {
      const m = /party\s+([a-z])\b/i.exec(line);
      if (m) currentSignerGuess = m[1]!.toUpperCase().charCodeAt(0) - 65;
    }
    if (
      /\b(disclos|first|landlord|lessor|seller|employer|licensor)\w*/i.test(line) &&
      /party|information/i.test(line)
    ) {
      currentSignerGuess = 0;
    }
    if (/\b(receiv|second|tenant|lessee|buyer|employee|licensee)\w*/i.test(line) && /party|information/i.test(line)) {
      currentSignerGuess = 1;
    }

    // ── Section/clause detection (varied formats from PDFs) ──

    // "1. PURPOSE" or "1. Purpose" or "Section 1: Purpose" or "ARTICLE I" or "Clause 3.2"
    if (/^\d+\.\s+\S/.test(line) && line.length < 100) {
      sectionCounter++;
      tokens.push({ kind: "heading", text: line, sectionNum: sectionCounter });
      continue;
    }
    if (
      /^(?:section|article|clause|part|schedule|exhibit|appendix|recital)\s+[\dIVXivx]+/i.test(line) &&
      line.length < 100
    ) {
      sectionCounter++;
      tokens.push({ kind: "heading", text: line, sectionNum: sectionCounter });
      continue;
    }
    // "1.2 Sub-clause" or "3.1.1 Detailed item"
    if (/^\d+\.\d+\.?\d*\s+\S/.test(line) && line.length < 100) {
      tokens.push({ kind: "subheading", text: line });
      continue;
    }

    // All-caps heading (but not full sentences — max ~60 chars and mostly letters)
    if (line === line.toUpperCase() && line.length > 3 && line.length < 60 && /^[A-Z][A-Z &/,().-]+$/.test(line)) {
      tokens.push({ kind: "subheading", text: line });
      continue;
    }

    // List items: (a), (i), (1), -, *, •, roman numerals
    if (/^\([a-z]\)\s|^\([ivx]+\)\s|^\(\d+\)\s|^[-*•]\s|^[a-z]\)\s|^[ivx]+\)\s/.test(line)) {
      tokens.push({ kind: "listItem", text: line });
      continue;
    }

    // Signature line: "Party A Signature: ____"
    if (/signature\s*:/i.test(line) && /_{3,}/.test(line)) {
      const label =
        line.replace(/signature\s*:\s*_+/i, "").trim() || line.split(/signature/i)[0]!.trim() || "Signature";
      tokens.push({ kind: "signatureBlock", label, signerIdx: currentSignerGuess });
      continue;
    }

    tokens.push(...processInlineFields(line, (label, fieldType) => makeField(label, fieldType), prevLineText));
    prevLineText = line;
  }

  return { tokens, fields };
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

    // Build context: the explicit label + the text before the blank + the prev line
    // This catches patterns like "date of \n______" and "mailing address of \n______"
    const textBeforeBlank = line.slice(0, match.index);
    const fullContext = (prevLine || "") + " " + textBeforeBlank + " " + rawLabel;

    const type = guessFieldType(rawLabel, fullContext);

    // Generate a smart label
    let label = rawLabel;
    if (!label) {
      // Try to extract a meaningful label from what precedes the blank
      const contextWords = textBeforeBlank.trim().split(/\s+/).slice(-3).join(" ");
      if (contextWords && type !== "other") {
        label = type.charAt(0).toUpperCase() + type.slice(1);
      } else if (contextWords.length > 2) {
        // Use last few words before blank as label
        label = contextWords.length > 30 ? contextWords.slice(-30) : contextWords;
      } else {
        label = type !== "other" ? type.charAt(0).toUpperCase() + type.slice(1) : "Field";
      }
    }

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
