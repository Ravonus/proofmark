#!/usr/bin/env node --no-deprecation
/* eslint-disable no-console, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-floating-promises */
/**
 * Proofmark CLI
 *
 * Usage:
 *   npx tsx cli/index.ts setup         — Store encrypted private key
 *   npx tsx cli/index.ts create        — Create a new contract
 *   npx tsx cli/index.ts list          — List your documents
 *   npx tsx cli/index.ts rotate-key    — Change stored key or password
 */

// Suppress punycode deprecation warning
process.removeAllListeners("warning");

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "crypto";
import { Wallet } from "ethers";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createInterface } from "readline";

// ─── Config ─────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".proofmark");
const KEY_FILE = join(CONFIG_DIR, "key.enc");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const API_URL = process.env.PROOFMARK_API ?? "http://localhost:3100";

// ─── Helpers ────────────────────────────────────────────────────────────────

function rl(): ReturnType<typeof createInterface> {
  return createInterface({ input: process.stdin, output: process.stdout });
}

function ask(prompt: string, hide = false): Promise<string> {
  return new Promise((resolve) => {
    const r = rl();
    if (hide) {
      process.stdout.write(prompt);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      if (stdin.setRawMode) stdin.setRawMode(true);
      let input = "";
      const finishInput = () => {
        if (stdin.setRawMode) stdin.setRawMode(wasRaw ?? false);
        process.stdout.write("\n");
        r.close();
        resolve(input);
      };
      const onData = (ch: Buffer) => {
        const c = ch.toString();
        if (c === "\n" || c === "\r") {
          stdin.removeListener("data", onData);
          finishInput();
          return;
        }
        if (c === "\x7f" || c === "\b") {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
          return;
        }
        if (c === "\x03") {
          process.exit(0);
        }
        input += c;
        process.stdout.write("*");
      };
      stdin.on("data", onData);
    } else {
      r.question(prompt, (answer) => {
        r.close();
        resolve(answer.trim());
      });
    }
  });
}

function askMultiline(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    console.log(prompt);
    console.log("  (Enter content, then type END on a blank line to finish)");
    const r = rl();
    const lines: string[] = [];
    r.on("line", (line) => {
      if (line.trim() === "END") {
        r.close();
        resolve(lines.join("\n"));
      } else {
        lines.push(line);
      }
    });
  });
}

// ─── Encryption ─────────────────────────────────────────────────────────────

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32);
}

function encryptPK(pk: string, password: string): { encrypted: string; salt: string; iv: string } {
  const salt = randomBytes(16);
  const iv = randomBytes(16);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(pk, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return {
    encrypted: encrypted + ":" + authTag,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
  };
}

function decryptPK(data: { encrypted: string; salt: string; iv: string }, password: string): string {
  const salt = Buffer.from(data.salt, "hex");
  const iv = Buffer.from(data.iv, "hex");
  const key = deriveKey(password, salt);
  const [encHex, authTagHex] = data.encrypted.split(":");
  if (!encHex || !authTagHex) throw new Error("Corrupt key file");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(encHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function saveEncryptedKey(data: { encrypted: string; salt: string; iv: string }) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(KEY_FILE, JSON.stringify(data), { mode: 0o600 });
}

function loadEncryptedKey(): {
  encrypted: string;
  salt: string;
  iv: string;
} | null {
  if (!existsSync(KEY_FILE)) return null;
  return JSON.parse(readFileSync(KEY_FILE, "utf8"));
}

function loadConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_FILE)) return {};
  return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
}

function saveConfig(cfg: Record<string, unknown>) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

// ─── API ────────────────────────────────────────────────────────────────────

async function apiCall(procedure: string, input: unknown): Promise<unknown> {
  const resp = await fetch(`${API_URL}/api/trpc/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: input }),
  });
  const body = await resp.json();
  if (body.error) {
    const msg = body.error.json?.message ?? body.error.message ?? JSON.stringify(body.error);
    throw new Error(msg);
  }
  return body.result?.data?.json;
}

// ─── Key Detection ──────────────────────────────────────────────────────────

type DetectedKey = { chain: string; address: string; storedPk: string };

function tryDetectETH(trimmed: string): DetectedKey | null {
  const ethCandidate = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(ethCandidate)) return null;
  try {
    const wallet = new Wallet(ethCandidate);
    return {
      chain: "ETH",
      address: wallet.address.toLowerCase(),
      storedPk: wallet.privateKey,
    };
  } catch {
    return null;
  }
}

function tryDetectSOL(trimmed: string): DetectedKey | null {
  // base58 secret key (typically 87-88 chars)
  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length === 64) {
      const keypair = Keypair.fromSecretKey(decoded);
      return {
        chain: "SOL",
        address: keypair.publicKey.toBase58(),
        storedPk: bs58.encode(keypair.secretKey),
      };
    }
  } catch {
    /* not base58 SOL */
  }

  // JSON byte array
  if (trimmed.startsWith("[")) {
    try {
      const bytes = JSON.parse(trimmed);
      if (Array.isArray(bytes) && bytes.length === 64) {
        const keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
        return {
          chain: "SOL",
          address: keypair.publicKey.toBase58(),
          storedPk: bs58.encode(keypair.secretKey),
        };
      }
    } catch {
      /* not JSON SOL */
    }
  }

  // 128 hex chars (64 bytes as hex)
  if (/^[0-9a-fA-F]{128}$/.test(trimmed)) {
    try {
      const keypair = Keypair.fromSecretKey(Buffer.from(trimmed, "hex"));
      return {
        chain: "SOL",
        address: keypair.publicKey.toBase58(),
        storedPk: bs58.encode(keypair.secretKey),
      };
    } catch {
      /* not hex SOL */
    }
  }

  return null;
}

function tryDetectBTC(trimmed: string): DetectedKey | null {
  if (!/^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(trimmed)) return null;
  try {
    const decoded = bs58.decode(trimmed);
    if (decoded.length < 33 || decoded.length > 38) return null;
    const keyHash = createHash("sha256").update(decoded.slice(1, 33)).digest();
    const ripemd = createHash("ripemd160").update(keyHash).digest("hex");
    return {
      chain: "BTC",
      address: `1${ripemd.slice(0, 32)}`,
      storedPk: trimmed,
    };
  } catch {
    return null;
  }
}

function detectKeyChain(pk: string): DetectedKey | null {
  const trimmed = pk.trim();
  return tryDetectETH(trimmed) ?? tryDetectSOL(trimmed) ?? tryDetectBTC(trimmed);
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function setup() {
  console.log("\n  ┌─────────────────────────────┐");
  console.log("  │   Proofmark CLI Setup        │");
  console.log("  └─────────────────────────────┘\n");

  if (loadEncryptedKey()) {
    const overwrite = await ask("  A key already exists. Overwrite? (y/N): ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("  Aborted.");
      return;
    }
  }

  const pk = await ask("  Enter your private key (ETH/SOL/BTC — auto-detected): ", true);
  if (!pk || pk.length < 16) {
    console.log("  Invalid private key.");
    return;
  }

  // Auto-detect chain from key format and validate
  const detected = detectKeyChain(pk);
  if (!detected) {
    console.log("  Could not detect chain from private key. Supported formats:");
    console.log("    ETH: 0x-prefixed hex (64 hex chars) or raw 64 hex chars");
    console.log("    SOL: base58 secret key (87-88 chars), JSON byte array, or 128 hex chars");
    console.log("    BTC: WIF (starts with 5, K, or L, 51-52 chars)");
    return;
  }

  const { chain, address, storedPk } = detected;
  console.log(`\n  Detected chain: ${chain}`);

  const password = await ask("  Create an encryption password: ", true);
  if (!password || password.length < 4) {
    console.log("  Password too short (min 4 chars).");
    return;
  }

  const confirm = await ask("  Confirm password: ", true);
  if (confirm !== password) {
    console.log("  Passwords don't match.");
    return;
  }

  const encData = encryptPK(storedPk, password);
  saveEncryptedKey(encData);

  const cfg = loadConfig();
  cfg.address = address;
  cfg.chain = chain;
  cfg.apiUrl = API_URL;
  saveConfig(cfg);

  console.log(`\n  ✓ Key encrypted and saved to ${KEY_FILE}`);
  console.log(`  ✓ Chain: ${chain}`);
  console.log(`  ✓ Address: ${address}`);
  console.log(`  ✓ API URL: ${API_URL}\n`);
}

type UnlockedKey = { pk: string; address: string; chain: string };

async function unlockKey(): Promise<UnlockedKey> {
  const encData = loadEncryptedKey();
  if (!encData) {
    console.log("  No key found. Run: npx tsx cli/index.ts setup");
    process.exit(1);
  }

  const cfg = loadConfig();
  const password = await ask("  Password: ", true);
  try {
    const pk = decryptPK(encData, password);
    return {
      pk,
      address: (cfg.address as string) ?? "",
      chain: (cfg.chain as string) ?? "ETH",
    };
  } catch {
    console.log("  Wrong password.");
    process.exit(1);
  }
}

const TEMPLATE_GENERATORS: Record<string, (parties: string[], date: string, term: string) => string> = {
  "1": generateMutualNDA,
  "": generateMutualNDA,
  "2": generateOneWayNDA,
  "3": generateCryptoNDA,
  "4": generateServiceAgreement,
  "5": generateConsultingAgreement,
};

async function generateContent(
  templateChoice: string,
  signersList: Array<{ label: string; email: string }>,
): Promise<string> {
  const term = "3 years";
  const partyNames = signersList.map((s) => s.label);
  const effectiveDate = new Date().toISOString().split("T")[0]!;
  const generator = TEMPLATE_GENERATORS[templateChoice];
  if (generator) return generator(partyNames, effectiveDate, term);
  return askMultiline("\n  Paste document content:");
}

async function promptPostSignReveal(): Promise<Record<string, unknown> | undefined> {
  const addReveal = await ask("\n  Add post-sign reveal content? (y/N): ");
  if (addReveal.toLowerCase() !== "y") return undefined;

  const summary = await ask("  Reveal summary: ");
  const downloads = await promptDownloads();
  const testbedAccess = await promptTestbedAccess();

  return {
    enabled: true,
    summary,
    downloads: downloads.length > 0 ? downloads : undefined,
    testbedAccess,
  };
}

async function promptDownloads(): Promise<Array<Record<string, string>>> {
  const addDownloads = await ask("  Add PDF downloads? (y/N): ");
  if (addDownloads.toLowerCase() !== "y") return [];

  const downloads: Array<Record<string, string>> = [];
  let addMoreDl = true;
  while (addMoreDl) {
    const dlLabel = await ask("    Download label: ");
    if (!dlLabel) break;
    const dlFile = await ask("    Filename (in /public/downloads/): ");
    const dlDesc = await ask("    Description: ");
    downloads.push({ label: dlLabel, filename: dlFile, description: dlDesc });
    const moreDl = await ask("    Add another download? (y/N): ");
    addMoreDl = moreDl.toLowerCase() === "y";
  }
  return downloads;
}

async function promptTestbedAccess(): Promise<Record<string, unknown> | undefined> {
  const addTestbed = await ask("  Add testbed/docs access gating? (y/N): ");
  if (addTestbed.toLowerCase() !== "y") return undefined;
  const desc = await ask("    Access description: ");
  const domain = await ask("    Proxy domain (e.g., agorix-docs.technomancy.it): ");
  return { enabled: true, description: desc, proxyEndpoint: domain };
}

async function create() {
  console.log("\n  ┌─────────────────────────────┐");
  console.log("  │   Create New Document       │");
  console.log("  └─────────────────────────────┘\n");

  const key = await unlockKey();
  console.log(`  ${key.chain} Wallet: ${key.address}\n`);

  const cfg = loadConfig();
  const creatorEmail = (cfg.email as string) ?? "";

  // Basic info
  const title = await ask("  Document title: ");
  if (!title) return;

  let email = await ask(`  Your email [${creatorEmail || "none"}]: `);
  if (!email && creatorEmail) email = creatorEmail;
  if (email && email !== creatorEmail) {
    cfg.email = email;
    saveConfig(cfg);
  }

  // Template or custom?
  console.log("\n  Document Templates:");
  console.log("    1) Mutual NDA");
  console.log("    2) One-Way NDA");
  console.log("    3) Crypto Project NDA");
  console.log("    4) Service Agreement");
  console.log("    5) Consulting Agreement");
  console.log("    6) Custom (paste your own)");
  const templateChoice = await ask("\n  Choice [1-6]: ");

  // Signers
  console.log("\n  Add signers (at least 1):");
  const signersList: Array<{ label: string; email: string }> = [];
  let addMore = true;
  let signerNum = 1;
  while (addMore) {
    const label = await ask(`  Signer ${signerNum} name: `);
    if (!label) break;
    const signerEmail = await ask(`  Signer ${signerNum} email (optional): `);
    signersList.push({ label, email: signerEmail });
    signerNum++;
    const more = await ask("  Add another signer? (y/N): ");
    addMore = more.toLowerCase() === "y";
  }

  if (signersList.length === 0) {
    console.log("  Need at least one signer.");
    return;
  }

  // Generate content
  const content = await generateContent(templateChoice, signersList);

  // Post-sign reveal?
  const postSignReveal = await promptPostSignReveal();

  // Create via API
  console.log("\n  Creating document...");

  const result = (await apiCall("document.create", {
    title,
    content,
    createdBy: key.address,
    createdByEmail: email || undefined,
    signers: signersList.map((s) => ({
      label: s.label,
      email: s.email || undefined,
    })),
    postSignReveal,
  })) as {
    id: string;
    signerLinks: Array<{ label: string; claimToken: string; signUrl: string }>;
  };

  const publicBase = process.env.PROOFMARK_PUBLIC_URL ?? "https://docu.technomancy.it";

  console.log("\n  ┌─────────────────────────────────────┐");
  console.log("  │   ✓ Document Created                │");
  console.log("  └─────────────────────────────────────┘\n");
  console.log(`  ID: ${result.id}`);
  console.log(`  Reveal: ${publicBase}/reveal/${result.id}\n`);

  console.log("  Signing Links:");
  for (const link of result.signerLinks) {
    const url = `${publicBase}/sign/${result.id}?claim=${link.claimToken}`;
    console.log(`    ${link.label}: ${url}`);
  }
  console.log("");
}

async function list() {
  const key = await unlockKey();
  console.log(`\n  ${key.chain} Wallet: ${key.address}\n`);

  const result = await fetch(
    `${API_URL}/api/trpc/document.listByAddress?input=${encodeURIComponent(
      JSON.stringify({ json: { address: key.address } }),
    )}`,
  );
  const body = await result.json();
  const docs = body.result?.data?.json ?? [];

  if (docs.length === 0) {
    console.log("  No documents found.\n");
    return;
  }

  console.log(`  Found ${docs.length} document(s):\n`);
  for (const doc of docs) {
    const signedCount = doc.signers.filter((s: { status: string }) => s.status === "SIGNED").length;
    const statusIcon = doc.status === "COMPLETED" ? "✓" : "◷";
    console.log(`  ${statusIcon} ${doc.title}`);
    console.log(`    ID: ${doc.id} | Status: ${doc.status} | Signed: ${signedCount}/${doc.signers.length}`);
    console.log(`    Created: ${new Date(doc.createdAt).toLocaleDateString()}`);
    console.log("");
  }
}

async function rotateKey() {
  console.log("\n  Rotate encryption key\n");
  const key = await unlockKey();
  console.log(`  Current wallet: ${key.chain} ${key.address}\n`);

  const newPk = await ask("  Enter new private key (or Enter to keep same key, new password): ", true);

  let chain: string;
  let address: string;
  let storedPk: string;

  if (newPk) {
    const detected = detectKeyChain(newPk);
    if (!detected) {
      console.log("  Could not detect chain from key.");
      return;
    }
    chain = detected.chain;
    address = detected.address;
    storedPk = detected.storedPk;
    console.log(`  Detected: ${chain}`);
  } else {
    chain = key.chain;
    address = key.address;
    storedPk = key.pk;
  }

  const password = await ask("  New encryption password: ", true);
  const confirm = await ask("  Confirm password: ", true);
  if (password !== confirm) {
    console.log("  Passwords don't match.");
    return;
  }

  const encData = encryptPK(storedPk, password);
  saveEncryptedKey(encData);

  const cfg = loadConfig();
  cfg.address = address;
  cfg.chain = chain;
  saveConfig(cfg);

  console.log(`\n  ✓ Key rotated. ${chain} Wallet: ${address}\n`);
}

// ─── NDA Templates ──────────────────────────────────────────────────────────

function generateMutualNDA(parties: string[], date: string, term: string): string {
  const partyList = parties.map((n, i) => `Party ${String.fromCharCode(65 + i)}: ${n}`).join("\n");
  return `MUTUAL NON-DISCLOSURE AGREEMENT

Effective Date: ${date}

PARTIES

${partyList}

1. PURPOSE

The Parties wish to explore collaboration relating to the development of a technology platform including protocol design, node architecture, smart contracts, tokenomics, governance, AI integration, and related software and business strategies.

2. CONFIDENTIAL INFORMATION

All non-public information including source code, smart contracts, algorithms, protocol architecture, private keys, wallet addresses, tokenomics, financial models, treasury operations, business plans, security mechanisms, MPC key management, and audit reports.

3. OBLIGATIONS

Each Party agrees to hold Confidential Information in strict confidence, not disclose without consent, use solely for the stated Purpose, and protect with reasonable care.

4. CRYPTO-SPECIFIC

Neither Party shall disclose private keys or wallet credentials. Wallet-to-identity associations are Confidential. Unpublished smart contracts are Confidential until deployed. Non-public token info shall not be used for trading advantage.

5. IDENTITY PROTECTION

Pseudonymous-to-real-world identity associations receive highest protection. Unauthorized disclosure is grounds for termination and legal action.

6. TERM

${term}. Trading restrictions survive indefinitely.

7. DIGITAL SIGNATURES

Cryptographic wallet signatures constitute legally binding acknowledgment.

By signing, each Party agrees to be bound by these terms.`;
}

function generateOneWayNDA(parties: string[], date: string, term: string): string {
  const discloser = parties[0] ?? "Disclosing Party";
  const receivers = parties.slice(1).join(", ") || "Receiving Party";
  return `ONE-WAY NON-DISCLOSURE AGREEMENT

Effective Date: ${date}

Disclosing Party: ${discloser}
Receiving Party: ${receivers}

1. PURPOSE

The Disclosing Party wishes to share Confidential Information for evaluating a potential collaboration.

2. CONFIDENTIAL INFORMATION

All non-public information disclosed by the Disclosing Party including technical data, trade secrets, source code, financial information, and business plans.

3. OBLIGATIONS

The Receiving Party agrees to hold all Confidential Information in strict confidence, not disclose to third parties, use solely for evaluation, and not reverse-engineer any materials.

4. CRYPTO-SPECIFIC

Private keys, seed phrases, and wallet-to-identity associations are Confidential. Unpublished smart contract code is Confidential until deployed.

5. TERM

${term} from the Effective Date.

6. RETURN OF MATERIALS

Upon request, the Receiving Party shall return or destroy all Confidential Information.

By signing, each Party agrees to be bound by these terms.`;
}

function generateCryptoNDA(parties: string[], date: string, term: string): string {
  const partyList = parties.map((n, i) => `Party ${String.fromCharCode(65 + i)}: ${n}`).join("\n");
  return `CRYPTO PROJECT NON-DISCLOSURE AGREEMENT

Effective Date: ${date}

PARTIES

${partyList}

1. PURPOSE

The Parties are collaborating on or evaluating involvement in a cryptocurrency/blockchain project.

2. CONFIDENTIAL INFORMATION

Includes: smart contract source code, audit reports, deployment plans, tokenomics, distribution schedules, vesting terms, protocol architecture, node infrastructure, MPC key management, treasury operations, listing plans, exchange negotiations, governance mechanisms, security vulnerabilities, and incident reports.

3. WALLET & KEY SECURITY

NO Party shall disclose or attempt to access another Party's private keys, seed phrases, or key shares. Accidental exposure must be reported immediately. Multi-sig and MPC configurations are Confidential.

4. TRADING RESTRICTIONS

No Party shall use non-public information regarding tokens for personal trading advantage. This is a material breach.

5. IDENTITY PROTECTION

Pseudonymous-to-real-world identity associations receive highest protection. Disclosure is grounds for termination and legal action.

6. TERM

${term}. Trading restrictions survive indefinitely.

7. DISPUTE RESOLUTION

Binding arbitration in English. Arbitrator's decision is final.

8. DIGITAL SIGNATURES

Cryptographic wallet signatures constitute legally binding acknowledgment.

By signing, each Party agrees to be bound by these terms.`;
}

function generateServiceAgreement(parties: string[], date: string, term: string): string {
  const provider = parties[0] ?? "Service Provider";
  const client = parties[1] ?? "Client";
  return `SERVICE AGREEMENT

Effective Date: ${date}

PARTIES

Service Provider: ${provider}
Client: ${client}

1. SERVICES

The Service Provider agrees to provide services as mutually agreed upon by the Parties. Scope, deliverables, and timelines will be defined in separate Statements of Work (SOWs).

2. COMPENSATION

Compensation terms will be defined in each SOW. Payment may be made in fiat currency or cryptocurrency as agreed. Crypto payments are final upon blockchain confirmation.

3. INTELLECTUAL PROPERTY

Work product created under this Agreement shall be owned by the Client upon full payment, unless otherwise specified in the SOW.

4. CONFIDENTIALITY

Each Party agrees to maintain confidentiality of all non-public information shared during the engagement. Private keys, wallet credentials, and identity associations are strictly confidential.

5. TERM & TERMINATION

This Agreement is effective for ${term}. Either Party may terminate with 30 days written notice. Outstanding payments survive termination.

6. LIMITATION OF LIABILITY

Neither Party shall be liable for indirect, incidental, or consequential damages.

7. DIGITAL SIGNATURES

Cryptographic wallet signatures constitute legally binding acknowledgment.

By signing, each Party agrees to be bound by these terms.`;
}

function generateConsultingAgreement(parties: string[], date: string, term: string): string {
  const consultant = parties[0] ?? "Consultant";
  const company = parties[1] ?? "Company";
  return `CONSULTING AGREEMENT

Effective Date: ${date}

PARTIES

Consultant: ${consultant}
Company: ${company}

1. ENGAGEMENT

The Company engages the Consultant as an independent contractor to provide advisory and consulting services related to the Company's operations, technology, and business strategy.

2. SCOPE

Services may include but are not limited to: technical architecture review, code audits, tokenomics design, security assessments, go-to-market strategy, and partnership introductions.

3. COMPENSATION

The Consultant shall be compensated at rates agreed upon in writing. Payment may be made via bank transfer, cryptocurrency, or token allocation as mutually agreed.

4. INDEPENDENT CONTRACTOR

The Consultant is an independent contractor, not an employee. The Consultant maintains control over methods and timing of work.

5. CONFIDENTIALITY

All non-public information including source code, business plans, financial data, user metrics, token distribution plans, and private key material is strictly confidential.

6. NON-COMPETE

During the term and for 6 months after, the Consultant shall not directly compete with the Company's core product.

7. TERM

${term} from the Effective Date. Renewable by mutual written agreement.

8. DIGITAL SIGNATURES

Cryptographic wallet signatures constitute legally binding acknowledgment.

By signing, each Party agrees to be bound by these terms.`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const command = process.argv[2];

switch (command) {
  case "setup":
    setup().then(() => process.exit(0));
    break;
  case "create":
    create().then(() => process.exit(0));
    break;
  case "list":
    list().then(() => process.exit(0));
    break;
  case "rotate-key":
  case "rotate":
    rotateKey().then(() => process.exit(0));
    break;
  default:
    console.log(`
  Proofmark CLI

  Commands:
    setup         Store your private key (encrypted with AES-256-GCM)
    create        Create a new contract/document
    list          List your documents
    rotate-key    Change stored private key or password

  Environment:
    PROOFMARK_API          API URL (default: http://localhost:3100)
    PROOFMARK_PUBLIC_URL   Public URL (default: https://docu.technomancy.it)

  Key storage: ~/.proofmark/key.enc (AES-256-GCM, scrypt-derived key)
`);
    break;
}
