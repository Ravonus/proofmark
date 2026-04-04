import { createHash, randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { db } from "~/server/db";
import { sessions } from "~/server/db/schema";
import { tokensToContent, type DocToken } from "~/lib/document/document-tokens";
import { normalizeSignerTokenGate, type SignerTokenGate } from "~/lib/token-gates";
import type { AppRouter } from "~/server/api/root";
import { insertDocumentCompat, insertSignersCompat } from "~/server/db/compat";
import { getDefaultReminderChannels } from "~/server/workspace";

const DEFAULT_OWNER_ADDRESS = process.env.PM_OWNER_ADDRESS ?? "0x3000000000000000000000000000000000000C33";
const DEFAULT_BASE_URL = process.env.NEXTAUTH_URL ?? "http://127.0.0.1:3100";
const DEFAULT_OUTPUT_PATH = resolve(process.cwd(), "tmp/token-gate-dev-contract.json");

const MAD_LADS_MINT = "85USz2CkK2aADobUy7GkxmALiHaqdgUHGva1UAoVXUeT";
const MOG_ERC20_CONTRACT = "0xaaee1a9723aadb7afa2810263653a34ba2c21c7a";
const ETH_NFT_CONTRACT = "0xb852c6b5892256c264cc2c888ea462189154d8d7";
const ETH_NFT_TOKEN_ID = "518";
const BTC_INSCRIPTION_ID = "7def89aeb39dac76cbcd4c090ad481c4664e336e9caca970bc41d7c5c12c31dbi0";
const SOL_TOKEN_MINT = "G7vQWurMkMMm2dU3iZpXYFTHT9Biio4F4gZCrwFpKNwG";

type SeedOptions = {
  ownerAddress: string;
  baseUrl: string;
  outputPath: string;
};

type CreatedDocumentResult = {
  id: string;
  contentHash: string;
  signerLinks: Array<{
    label: string;
    claimToken: string;
    signUrl: string;
    embedUrl: string;
    signMethod: "WALLET" | "EMAIL_OTP";
  }>;
};

function parseArgs(argv: string[]): SeedOptions {
  const options: SeedOptions = {
    ownerAddress: DEFAULT_OWNER_ADDRESS,
    baseUrl: DEFAULT_BASE_URL,
    outputPath: DEFAULT_OUTPUT_PATH,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--owner" && next) {
      options.ownerAddress = next;
      i += 1;
      continue;
    }
    if (arg === "--base-url" && next) {
      options.baseUrl = next;
      i += 1;
      continue;
    }
    if (arg === "--output" && next) {
      options.outputPath = resolve(process.cwd(), next);
      i += 1;
    }
  }

  return options;
}

function buildContent(): string {
  const tokens: DocToken[] = [
    { kind: "heading", text: "CROSS-CHAIN TOKEN GATE DEV DEMO", sectionNum: 1 },
    { kind: "break" },
    {
      kind: "text",
      text: "This contract is seeded for local development and exercises Proofmark's signer-level token gate flow across Bitcoin ordinals, Solana assets, and Ethereum assets.",
    },
    { kind: "break" },
    {
      kind: "text",
      text: "The signer gate on this packet is configured with a development bypass so any connected wallet can pass locally even if it does not actually hold the listed assets.",
    },
    { kind: "break" },
    { kind: "heading", text: "1. Required Assets", sectionNum: 2 },
    { kind: "text", text: `1. Ordinal inscription ${BTC_INSCRIPTION_ID}.` },
    { kind: "break" },
    { kind: "text", text: `2. Solana SPL token ${SOL_TOKEN_MINT} with a minimum balance of 1,000,000.` },
    { kind: "break" },
    { kind: "text", text: `3. Ethereum NFT ${ETH_NFT_CONTRACT} token #${ETH_NFT_TOKEN_ID}.` },
    { kind: "break" },
    { kind: "text", text: `4. MOG ERC-20 on Ethereum at ${MOG_ERC20_CONTRACT}.` },
    { kind: "break" },
    { kind: "text", text: `5. Mad Lads #5454 on Solana (mint ${MAD_LADS_MINT}).` },
    { kind: "break" },
    {
      kind: "text",
      text: "The provided Magic Eden item link resolves to the same Mad Lads #5454 mint above, so it is represented by the same gate rule rather than duplicated.",
    },
    { kind: "break" },
    { kind: "heading", text: "2. Signer Details", sectionNum: 3 },
    { kind: "text", text: "Signer name: " },
    {
      kind: "field",
      field: {
        id: "demo-signer-name",
        type: "name",
        label: "Signer Name",
        placeholder: "Full legal name",
        signerIdx: 0,
        required: true,
      },
    },
    { kind: "break" },
    { kind: "text", text: "Execution date: " },
    {
      kind: "field",
      field: {
        id: "demo-sign-date",
        type: "date",
        label: "Execution Date",
        placeholder: "MM/DD/YYYY",
        signerIdx: 0,
        required: true,
      },
    },
    { kind: "break" },
    { kind: "heading", text: "3. Acceptance", sectionNum: 4 },
    {
      kind: "text",
      text: "By signing, the signer acknowledges that this packet exists only to validate the token gate UX and verification plumbing during development.",
    },
    { kind: "break" },
    { kind: "signatureBlock", label: "Cross-Chain Gated Signer", signerIdx: 0 },
  ];

  return tokensToContent(tokens);
}

async function createSession(address: string) {
  const token = randomBytes(48).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    token,
    address,
    chain: "ETH",
    createdAt: now,
    expiresAt,
  });

  return { token, expiresAt };
}

function createDocumentClient(baseUrl: string, headers: HeadersInit) {
  return createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        headers: () => headers,
      }),
    ],
  });
}

function createToken(): string {
  return randomBytes(24).toString("base64url");
}

function buildTokenGate(): SignerTokenGate {
  return {
    mode: "ALL",
    devBypass: true,
    rules: [
      {
        id: "ordinal-demo-rule",
        label: "Ordinal inscription",
        chain: "BTC",
        type: "ORDINAL",
        identifierType: "INSCRIPTION_ID",
        identifier: BTC_INSCRIPTION_ID,
      },
      {
        id: "sol-fungible-demo-rule",
        label: "SOL token >= 1,000,000",
        chain: "SOL",
        type: "SPL",
        mintAddress: SOL_TOKEN_MINT,
        minAmount: "1000000",
      },
      {
        id: "eth-nft-demo-rule",
        label: "ETH NFT #518",
        chain: "ETH",
        type: "ERC721",
        contractAddress: ETH_NFT_CONTRACT,
        tokenId: ETH_NFT_TOKEN_ID,
        minAmount: "1",
      },
      {
        id: "mog-demo-rule",
        label: "MOG ERC-20",
        chain: "ETH",
        type: "ERC20",
        contractAddress: MOG_ERC20_CONTRACT,
        minAmount: "1",
      },
      {
        id: "mad-lads-demo-rule",
        label: "Mad Lads #5454",
        chain: "SOL",
        type: "SPL",
        mintAddress: MAD_LADS_MINT,
        minAmount: "1",
      },
    ],
  };
}

async function isBaseUrlReachable(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(`${baseUrl}/`, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function createDocumentViaTrpc(baseUrl: string, ownerSessionToken: string): Promise<CreatedDocumentResult> {
  const ownerClient = createDocumentClient(baseUrl, {
    cookie: `w3s_session=${encodeURIComponent(ownerSessionToken)}`,
    "user-agent": "Proofmark Token Gate Seed/1.0",
    "x-forwarded-for": "127.0.0.1",
    "accept-language": "en-US,en;q=0.9",
  });

  return await ownerClient.document.create.mutate({
    title: "Cross-Chain Token Gate Demo (Dev Bypass)",
    content: buildContent(),
    createdByEmail: "",
    proofMode: "HYBRID",
    signingOrder: "parallel",
    gazeTracking: "off",
    signers: [
      {
        label: "Cross-Chain Gated Signer",
        signMethod: "WALLET",
        role: "SIGNER",
        tokenGates: buildTokenGate(),
      },
    ],
  });
}

async function createDocumentViaDb(baseUrl: string, ownerAddress: string): Promise<CreatedDocumentResult> {
  const content = buildContent();
  const contentHash = createHash("sha256").update(`${content}\n${Date.now().toString()}`, "utf8").digest("hex");
  const [doc] = await insertDocumentCompat(db, {
    title: "Cross-Chain Token Gate Demo (Dev Bypass)",
    content,
    contentHash,
    createdBy: ownerAddress.trim().toLowerCase(),
    createdByEmail: null,
    accessToken: createToken(),
    ipfsCid: null,
    postSignReveal: null,
    proofMode: "HYBRID",
    signingOrder: "parallel",
    gazeTracking: "off",
    expiresAt: null,
    encryptedAtRest: false,
    encryptionKeyWrapped: null,
    templateId: null,
    brandingProfileId: null,
    pdfStyleTemplateId: null,
    reminderConfig: null,
  });
  if (!doc) throw new Error("Failed to create document row.");

  const [signer] = await insertSignersCompat(db, [
    {
      documentId: doc.id,
      label: "Cross-Chain Gated Signer",
      email: null,
      phone: null,
      fields: null,
      tokenGates: normalizeSignerTokenGate(buildTokenGate()),
      claimToken: createToken(),
      signMethod: "WALLET",
      signerOrder: 0,
      identityLevel: "L0_WALLET",
      deliveryMethods: getDefaultReminderChannels(null, null),
      role: "SIGNER",
    },
  ]);
  if (!signer) throw new Error("Failed to create signer row.");

  return {
    id: doc.id,
    contentHash,
    signerLinks: [
      {
        label: signer.label,
        claimToken: signer.claimToken,
        signUrl: `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}`,
        embedUrl: `${baseUrl}/sign/${doc.id}?claim=${signer.claimToken}&embed=1`,
        signMethod: signer.signMethod,
      },
    ],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { token: ownerSessionToken, expiresAt } = await createSession(options.ownerAddress);
  const usedTransport = (await isBaseUrlReachable(options.baseUrl)) ? "trpc" : "db";
  const result =
    usedTransport === "trpc"
      ? await createDocumentViaTrpc(options.baseUrl, ownerSessionToken)
      : await createDocumentViaDb(options.baseUrl, options.ownerAddress);

  const output = {
    createdAt: new Date().toISOString(),
    documentId: result.id,
    title: "Cross-Chain Token Gate Demo (Dev Bypass)",
    contentHash: result.contentHash,
    creatorAddress: options.ownerAddress,
    ownerSessionToken,
    ownerSessionExpiresAt: expiresAt.toISOString(),
    creatorViewUrl: `${options.baseUrl}/view/${result.id}`,
    signers: result.signerLinks.map((link) => ({
      label: link.label,
      claimToken: link.claimToken,
      signUrl: link.signUrl,
    })),
    tokenGate: buildTokenGate(),
    notes: [
      "Development bypass is enabled on this signer's gate, so every rule auto-passes outside production.",
      "Mad Lads #5454 and the supplied Magic Eden URL point at the same Solana mint, so they share one rule.",
      usedTransport === "trpc"
        ? "Created through the live app API."
        : "Created directly in the local database because the app server was unavailable.",
    ],
  };

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(output, null, 2));
  console.log(`\nSaved seed output to ${options.outputPath}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
