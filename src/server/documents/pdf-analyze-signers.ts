/**
 * PDF signer/signature block/wallet detection helpers — extracted from pdf-analyze.ts
 * to keep files under 650 lines.
 */
import { isBitcoinAddress, isEvmAddress, isSolanaAddress, type WalletChain } from "~/lib/crypto/chains";
import type { DetectedAddress, DetectedField, DetectedSigner, SignatureBlock } from "~/lib/document/pdf-types";
import {
  extractNamedPartyInfo,
  extractPartyHeader,
  isBoilerplateLine,
  MULTI_PARTY_INITIALS_RE,
  titleCase,
} from "./pdf-analyze-fields";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SIGNATURE BLOCK DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function detectSignatureBlocks(
  lines: string[],
  allFields: DetectedField[],
  _witnessLine = -1,
): SignatureBlock[] {
  const rawBlocks = collectRawBlocks(lines, allFields);
  return deduplicateBlocks(rawBlocks);
}

function collectRawBlocks(lines: string[], allFields: DetectedField[]): SignatureBlock[] {
  const rawBlocks: SignatureBlock[] = [];
  const excludeZones = findExcludedZoneLines(lines);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim();

    const header = extractPartyHeader(trimmed);
    if (!header) continue;
    if (excludeZones.has(i)) continue;

    const namedInfo = extractNamedPartyInfo(trimmed);
    const blockFields = collectBlockFields(lines, allFields, i);
    const headerFields = allFields.filter((f) => f.line === i + 1);
    blockFields.push(...headerFields);

    if (blockFields.some((f) => f.type === "signature" || f.type === "initials")) {
      const clonedFields = blockFields.map((f) => ({
        ...f,
        partyRole: header,
      }));
      rawBlocks.push({
        partyRole: header,
        partyLabel: namedInfo ? `${namedInfo.entity} (${namedInfo.role})` : trimmed,
        signerIndex: 0,
        fields: clonedFields,
        line: i + 1,
      });
    }
  }

  return rawBlocks;
}

function collectBlockFields(lines: string[], allFields: DetectedField[], headerIdx: number): DetectedField[] {
  const blockFields: DetectedField[] = [];
  for (let j = headerIdx + 1; j < Math.min(headerIdx + 9, lines.length); j++) {
    const lineText = lines[j]?.trim() || "";
    if (extractPartyHeader(lineText)) break;
    if (MULTI_PARTY_INITIALS_RE.test(lineText)) continue;
    if (isBoilerplateLine(lineText)) continue;
    const fieldsOnLine = allFields.filter((f) => f.line === j + 1);
    blockFields.push(...fieldsOnLine);
  }
  return blockFields;
}

function deduplicateBlocks(rawBlocks: SignatureBlock[]): SignatureBlock[] {
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

export type PartyDef = {
  role: string;
  name: string | null;
  mailingAddress: string | null;
  entityType: string | null;
  nameField: DetectedField | null;
  addressField: DetectedField | null;
  fields: DetectedField[];
};

export function detectPartyDefinitions(lines: string[], allFields: DetectedField[]): PartyDef[] {
  const parties: PartyDef[] = [];

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const trimmed = lines[i]!.trim();
    detectPartyInfoLine(parties, trimmed, i, allFields);
    if (parties.length === 0) {
      detectBetweenClause(parties, trimmed, i, lines);
    }
  }

  return parties;
}

function detectPartyInfoLine(parties: PartyDef[], trimmed: string, i: number, allFields: DetectedField[]): void {
  const partyInfoMatch = /^Party\s+(Disclosing|Receiving|Providing|Requesting)\s+Information\s*:/i.exec(trimmed);
  if (!partyInfoMatch) return;

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

function detectBetweenClause(parties: PartyDef[], trimmed: string, i: number, lines: string[]): void {
  const betweenMatch = /\b(?:by\s+and\s+)?between\s*:?\s+(.+)/i.exec(trimmed);
  if (!betweenMatch) return;

  const chunk = lines.slice(i, Math.min(i + 5, lines.length)).join(" ");
  const m = /between\s+(.+?)\s*\(.*?\)\s*(?:,?\s*and\s+)(.+?)\s*\(/i.exec(chunk);
  if (!m) return;

  const names = [m[1], m[2]].map((n) => n!.replace(/(?:_{3,}|\.{5,}|-{5,})/g, "").trim());
  const aliases = [...chunk.matchAll(/\(\s*["'\u201C]?([^)"'"\u201C\u201D]+?)["'\u201D]?\s*\)/g)].map((a) =>
    a[1]!.trim(),
  );
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SIGNER LIST BUILDER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function buildSignerList(
  partyDefs: PartyDef[],
  signatureBlocks: SignatureBlock[],
  detectedAddresses: DetectedAddress[],
  allFields: DetectedField[],
): DetectedSigner[] {
  const signers: DetectedSigner[] = [];
  const usedRoles = new Set<string>();

  addSignersFromPartyDefs(signers, usedRoles, partyDefs, signatureBlocks, detectedAddresses);
  addSignersFromBlocks(signers, usedRoles, signatureBlocks, detectedAddresses);
  addSignersFromFields(signers, usedRoles, allFields);
  addUnmatchedAddresses(signers, detectedAddresses);

  return signers;
}

function addSignersFromPartyDefs(
  signers: DetectedSigner[],
  usedRoles: Set<string>,
  partyDefs: PartyDef[],
  signatureBlocks: SignatureBlock[],
  detectedAddresses: DetectedAddress[],
): void {
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
}

function addSignersFromBlocks(
  signers: DetectedSigner[],
  usedRoles: Set<string>,
  signatureBlocks: SignatureBlock[],
  detectedAddresses: DetectedAddress[],
): void {
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
}

function addSignersFromFields(signers: DetectedSigner[], _usedRoles: Set<string>, allFields: DetectedField[]): void {
  if (signers.length > 0) return;

  const nameFields = allFields.filter((f) => f.type === "name" && f.blank);
  const sigFields = allFields.filter((f) => f.type === "signature" && f.blank);
  const roles = new Set<string>();
  for (const f of [...nameFields, ...sigFields]) {
    if (f.partyRole) roles.add(f.partyRole);
  }
  for (const role of roles) {
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

function addUnmatchedAddresses(signers: DetectedSigner[], detectedAddresses: DetectedAddress[]): void {
  for (const addr of detectedAddresses) {
    if (signers.some((s) => s.address === addr.address)) continue;
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
    const score = scoreWalletMatch(addr, roleLower, nameLower);
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

function scoreWalletMatch(addr: DetectedAddress, roleLower: string, nameLower: string): number {
  const ctx = addr.context.toLowerCase();
  let score = 0;

  if (ctx.includes(`(${roleLower}) approval`) || ctx.includes(`(${roleLower}) acknowledgment`)) score += 5;
  if (nameLower.length > 5 && ctx.includes(nameLower)) score += 4;

  const roleWords = roleLower.split(/\s+/).filter((w) => w.length > 3);
  for (const w of roleWords) {
    if (ctx.includes(w)) score += 2;
  }

  const genericWords = /^(llc|inc|corp|ltd|pllc|group|partners|holdings|capital|services)$/;
  const nameWords = nameLower.split(/\s+/).filter((w) => w.length > 3);
  for (const w of nameWords) {
    if (genericWords.test(w)) continue;
    if (ctx.includes(w)) score += 1;
  }

  return score;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXCLUDED ZONES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function findExcludedZoneLines(lines: string[]): Set<number> {
  const excluded = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim().toLowerCase();
    excludeWitnessBlock(excluded, trimmed, i, lines.length);
    excludeNotaryBlock(excluded, trimmed, i, lines.length);
    excludeAttorneyBlock(excluded, trimmed, i, lines.length);
    excludeSingleLines(excluded, trimmed, i);
  }

  return excluded;
}

function excludeWitnessBlock(excluded: Set<number>, trimmed: string, i: number, lineCount: number): void {
  if (/^(?:witness(?:ed)?(?:\s+by)?|in\s+the\s+presence\s+of)\s*:?/.test(trimmed)) {
    for (let j = i; j < Math.min(i + 10, lineCount); j++) excluded.add(j);
  }
}

function excludeNotaryBlock(excluded: Set<number>, trimmed: string, i: number, lineCount: number): void {
  if (/^(?:state\s+of|notary\s+public|before\s+me.*notary|subscribed\s+and\s+sworn)/.test(trimmed)) {
    for (let j = i; j < Math.min(i + 20, lineCount); j++) excluded.add(j);
  }
}

function excludeAttorneyBlock(excluded: Set<number>, trimmed: string, i: number, lineCount: number): void {
  if (/^(?:approved\s+as\s+to\s+form|legal\s+counsel\s+review)/.test(trimmed)) {
    for (let j = i; j < Math.min(i + 6, lineCount); j++) excluded.add(j);
  }
}

function excludeSingleLines(excluded: Set<number>, trimmed: string, i: number): void {
  if (/^(?:copyright|©|\(c\))\s*\d{4}/.test(trimmed) || /\ball\s+rights\s+reserved\b/.test(trimmed)) {
    excluded.add(i);
  }
  if (/^(?:draft|confidential|sample|do\s+not\s+copy|privileged)\s*$/i.test(trimmed)) {
    excluded.add(i);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WALLET ADDRESS DETECTION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function findWalletAddresses(text: string): DetectedAddress[] {
  const results: DetectedAddress[] = [];
  const seen = new Set<string>();

  const add = (addr: string, chain: WalletChain, idx: number) => {
    const key = chain === "ETH" ? addr.toLowerCase() : addr;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ address: addr, chain, context: getContext(text, idx) });
  };

  findLabeledWallets(text, add);
  findEvmAddresses(text, add);
  findBtcAddresses(text, add);
  findSolAddresses(text, seen, add);
  findEnsNames(text, seen, results);

  return results;
}

function findLabeledWallets(text: string, add: (addr: string, chain: WalletChain, idx: number) => void): void {
  for (const m of text.matchAll(
    /\b(?:wallet|eth(?:ereum)?|btc|bitcoin|sol(?:ana)?|receiving|payment|treasury|deposit|payout|public|send\s*to|receive\s*at)\s*(?:address|addr\.?|wallet|key)?\s*:\s*([a-zA-Z0-9]{20,})/gim,
  )) {
    const addr = m[1]!;
    if (isEvmAddress(addr)) add(addr, "ETH", m.index);
    else if (isBitcoinAddress(addr)) add(addr, "BTC", m.index);
    else if (isSolanaAddress(addr) && addr.length >= 32) add(addr, "SOL", m.index);
  }
}

function findEvmAddresses(text: string, add: (addr: string, chain: WalletChain, idx: number) => void): void {
  for (const m of text.matchAll(/\b(0x[a-fA-F0-9]{40})\b/g)) {
    if (isEvmAddress(m[1]!)) add(m[1]!, "ETH", m.index);
  }
}

function findBtcAddresses(text: string, add: (addr: string, chain: WalletChain, idx: number) => void): void {
  for (const m of text.matchAll(/\b((?:bc1|tb1|bcrt1)[a-z0-9]{20,})\b/gi)) {
    if (isBitcoinAddress(m[1]!)) add(m[1]!, "BTC", m.index);
  }
  for (const m of text.matchAll(/\b([13][a-km-zA-HJ-NP-Z1-9]{25,39})\b/g)) {
    if (isBitcoinAddress(m[1]!)) add(m[1]!, "BTC", m.index);
  }
}

function findSolAddresses(
  text: string,
  seen: Set<string>,
  add: (addr: string, chain: WalletChain, idx: number) => void,
): void {
  if (!/\b(?:sol(?:ana)?|spl|phantom|anchor|metaplex)\b/i.test(text)) return;
  for (const m of text.matchAll(/\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g)) {
    const addr = m[1]!;
    if (seen.has(addr)) continue;
    if (!isSolanaAddress(addr) || isEvmAddress(addr) || isBitcoinAddress(addr)) continue;
    const nearby = text.slice(Math.max(0, m.index - 100), m.index + addr.length + 100).toLowerCase();
    if (/sol|wallet|address|phantom|anchor|spl/.test(nearby)) add(addr, "SOL", m.index);
  }
}

function findEnsNames(text: string, seen: Set<string>, results: DetectedAddress[]): void {
  for (const m of text.matchAll(/\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+eth)\b/gi)) {
    const ens = m[1]!.toLowerCase();
    if (seen.has(ens)) continue;
    seen.add(ens);
    results.push({
      address: ens,
      chain: "ETH",
      context: getContext(text, m.index),
    });
  }
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

export function estimateSignerCount(text: string, lines: string[]): number {
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

  // "IN WITNESS WHEREOF"
  if (count < 2 && /\bin\s+witness\s+whereof\b/i.test(text)) count = Math.max(count, 2);

  return count;
}
