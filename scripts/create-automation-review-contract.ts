import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { randomBytes } from "crypto";
import { and, eq } from "drizzle-orm";
import { Wallet } from "ethers";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import superjson from "superjson";
import { type DocToken, tokensToContent } from "~/lib/document/document-tokens";
import type { EnhancedForensicEvidence } from "~/lib/forensic/premium";
import type { BehavioralSignals, ClientFingerprint } from "~/lib/forensic/types";
import type { AppRouter } from "~/server/api/root";
import { db } from "~/server/db";
import { findSignersByDocumentId } from "~/server/db/compat";
import { sessions, signers } from "~/server/db/schema";

const DEFAULT_OWNER_ADDRESS = process.env.PM_OWNER_ADDRESS ?? "0x1000000000000000000000000000000000000A11";
const DEFAULT_BASE_URL = process.env.NEXTAUTH_URL ?? "http://127.0.0.1:3100";
const DEFAULT_OUTPUT_PATH = resolve(process.cwd(), "tmp/automation-review-contract.json");
const COUNTERPARTY_REFERENCE = "PM-AUTO-20260328-AX9";

type SeedOptions = {
  ownerAddress: string;
  baseUrl: string;
  outputPath: string;
  presignFirst: boolean;
};

function parseArgs(argv: string[]): SeedOptions {
  const options: SeedOptions = {
    ownerAddress: DEFAULT_OWNER_ADDRESS,
    baseUrl: DEFAULT_BASE_URL,
    outputPath: DEFAULT_OUTPUT_PATH,
    presignFirst: true,
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
      continue;
    }
    if (arg === "--no-presign-first") {
      options.presignFirst = false;
    }
  }

  return options;
}

function buildContent(): string {
  const tokens: DocToken[] = [
    {
      kind: "heading",
      text: "AUTOMATION REVIEW TEST AGREEMENT",
      sectionNum: 1,
    },
    { kind: "break" },
    {
      kind: "text",
      text: "This agreement is intentionally structured to exercise forensic replay, premium evidence storage, and automation review across both mundane preparation and human-critical signing steps.",
    },
    { kind: "break" },
    { kind: "heading", text: "1. Operational Intake", sectionNum: 2 },
    { kind: "text", text: "Party A operations contact: " },
    {
      kind: "field",
      field: {
        id: "ops-contact",
        type: "name",
        label: "Operations Contact",
        placeholder: "Operations Contact",
        signerIdx: 0,
        required: true,
      },
    },
    { kind: "text", text: ", workflow ID: " },
    {
      kind: "field",
      field: {
        id: "ops-workflow-id",
        type: "free-text",
        label: "Workflow ID",
        placeholder: "WF-0000",
        signerIdx: 0,
        required: true,
      },
    },
    { kind: "text", text: ", prep note: " },
    {
      kind: "field",
      field: {
        id: "ops-prep-note",
        type: "free-text",
        label: "Preparation Note",
        placeholder: "Preparation note",
        signerIdx: 0,
        required: true,
      },
    },
    { kind: "text", text: "." },
    { kind: "break" },
    { kind: "heading", text: "2. Counterparty Confirmation", sectionNum: 3 },
    { kind: "text", text: "Party B legal name: " },
    {
      kind: "field",
      field: {
        id: "counterparty-name",
        type: "name",
        label: "Counterparty Name",
        placeholder: "Full legal name",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "text", text: ", title: " },
    {
      kind: "field",
      field: {
        id: "counterparty-title",
        type: "title",
        label: "Counterparty Title",
        placeholder: "Title",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "text", text: ", email: " },
    {
      kind: "field",
      field: {
        id: "counterparty-email",
        type: "email",
        label: "Counterparty Email",
        placeholder: "email@example.com",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "text", text: "." },
    { kind: "break" },
    {
      kind: "text",
      text: `Copy the reference code "${COUNTERPARTY_REFERENCE}" from this sentence and paste it into the verification field: `,
    },
    {
      kind: "field",
      field: {
        id: "counterparty-reference",
        type: "free-text",
        label: "Reference Code",
        placeholder: COUNTERPARTY_REFERENCE,
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "text", text: "." },
    { kind: "break" },
    { kind: "text", text: "Execution date: " },
    {
      kind: "field",
      field: {
        id: "counterparty-date",
        type: "date",
        label: "Execution Date",
        placeholder: "MM/DD/YYYY",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "text", text: "." },
    { kind: "break" },
    { kind: "heading", text: "3. Review Procedure", sectionNum: 4 },
    {
      kind: "text",
      text: "The counterparty should scroll the entire packet, highlight the sentence containing the reference code, and complete the verification field by pasting rather than retyping the code. This allows the forensic tape to capture navigation, selection, clipboard, and final signature behavior in one session.",
    },
    { kind: "break" },
    {
      kind: "text",
      text: "Automated preparation is permitted for non-critical intake work, but the final confirmation, drawn signature, and wallet-based finalize action are intended to be completed manually by the actual signer.",
    },
    { kind: "break" },
    {
      kind: "text",
      text: "If preparation activity appears automated, the packet should be flagged without necessarily invalidating the agreement. If the critical signing action appears automated, the review should still preserve the distinction between preparation and final consent.",
    },
    { kind: "break" },
    {
      kind: "text",
      text: "This document is also long enough to encourage visible scrolling behavior before the final action. Reviewers can use the resulting evidence to compare a scripted low-interaction path against a manual browser session.",
    },
    { kind: "break" },
    { kind: "heading", text: "4. Signatures", sectionNum: 5 },
    { kind: "signatureBlock", label: "Operations Admin", signerIdx: 0 },
    { kind: "break" },
    { kind: "signatureBlock", label: "Counterparty Signer", signerIdx: 1 },
  ];

  return tokensToContent(tokens);
}

function buildAutomationFingerprint(): ClientFingerprint {
  const now = new Date().toISOString();
  return {
    visitorId: "seed-automation-visitor",
    canvasHash: "seed-canvas-hash",
    webglHash: "seed-webgl-hash",
    audioHash: "seed-audio-hash",
    screen: "1440x900x24x2",
    timezone: "America/Denver",
    languages: ["en-US", "en"],
    cpuCores: 8,
    deviceMemory: 16,
    platform: "MacIntel",
    touchPoints: 0,
    webdriver: true,
    fontsHash: "seed-fonts-hash",
    pluginsHash: "seed-plugins-hash",
    doNotTrack: null,
    cookieEnabled: true,
    persistentId: "seed-automation-persistent",
    firstSeen: now,
    visitCount: 7,
    batteryLevel: null,
    batteryCharging: null,
    connectionType: "ethernet",
    connectionDownlink: 100,
    colorGamut: "p3",
    hdr: false,
    reducedMotion: false,
    darkMode: true,
    devicePixelRatio: 2,
    gpuVendor: "Automation GPU",
    gpuRenderer: "Proofmark Scripted Renderer",
    browserMajor: "Chrome/134",
    mathFingerprint: "seed-math-hash",
    webRtcLocalIps: [],
  };
}

function buildAutomationBehavior(): BehavioralSignals {
  return {
    timeOnPage: 1650,
    scrolledToBottom: false,
    maxScrollDepth: 11,
    mouseMoveCount: 0,
    clickCount: 1,
    keyPressCount: 0,
    pageWasHidden: false,
    hiddenDuration: 0,
    interactionTimeline: [
      { action: "packet_opened", ts: 0 },
      { action: "packet_finalized", ts: 1650 },
    ],
    typingCadence: [],
    mouseVelocityAvg: 0,
    mouseAccelerationPattern: "flat",
    touchPressureAvg: null,
    scrollPattern: [],
    focusChanges: 0,
    pasteEvents: 0,
    copyEvents: 0,
    cutEvents: 0,
    rightClicks: 0,
    gazeTrackingActive: false,
    gazePointCount: 0,
    gazeFixationCount: 0,
    gazeFixationAvgMs: 0,
    gazeBlinkCount: 0,
    gazeBlinkRate: 0,
    gazeTrackingCoverage: 0,
    replay: null,
  };
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

async function presignFirstSigner(params: { baseUrl: string; documentId: string; claimToken: string }) {
  const wallet = Wallet.createRandom();
  const client = createDocumentClient(params.baseUrl, {
    "user-agent": "Proofmark Automation Seed/1.0",
    "x-forwarded-for": "127.0.0.2",
    "accept-language": "en-US,en;q=0.9",
  });

  const signingMessage = await client.document.getSigningMessage.mutate({
    documentId: params.documentId,
    claimToken: params.claimToken,
    signerAddress: wallet.address,
    chain: "ETH",
  });

  const signature = await wallet.signMessage(signingMessage.message);

  await client.document.sign.mutate({
    documentId: params.documentId,
    claimToken: params.claimToken,
    signerAddress: wallet.address,
    chain: "ETH",
    signature,
    fieldValues: {
      "ops-contact": "Automation Runner",
      "ops-workflow-id": "WF-2026-0328-AUTO",
      "ops-prep-note": "Prepared through scripted intake flow for forensic comparison.",
    },
    forensic: {
      fingerprint: buildAutomationFingerprint() as unknown as Record<string, unknown>,
      behavioral: buildAutomationBehavior() as unknown as Record<string, unknown>,
    },
  });

  return wallet.address;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { token: ownerSessionToken, expiresAt } = await createSession(options.ownerAddress);

  const ownerClient = createDocumentClient(options.baseUrl, {
    cookie: `w3s_session=${encodeURIComponent(ownerSessionToken)}`,
    "user-agent": "Proofmark Automation Seed/1.0",
    "x-forwarded-for": "127.0.0.1",
    "accept-language": "en-US,en;q=0.9",
  });

  const created = await ownerClient.document.create.mutate({
    title: "Automation Review Live Test Packet",
    content: buildContent(),
    createdByEmail: "",
    proofMode: "HYBRID",
    signingOrder: "sequential",
    signers: [
      {
        label: "Operations Admin",
        signMethod: "WALLET",
        role: "SIGNER",
      },
      {
        label: "Counterparty Signer",
        signMethod: "WALLET",
        role: "SIGNER",
      },
    ],
    automationPolicy: {
      enabled: true,
      onPreparationAutomation: "FLAG",
      onCriticalAutomation: "FLAG",
      notifyCreator: true,
      requireHumanSteps: ["signature", "final_submit", "wallet_auth"],
    },
  });

  let signerRows = await findSignersByDocumentId(db, created.id);
  let firstSignerWalletAddress: string | null = null;

  if (options.presignFirst) {
    const firstSigner = signerRows[0];
    if (!firstSigner) {
      throw new Error("Expected a first signer slot to exist");
    }
    firstSignerWalletAddress = await presignFirstSigner({
      baseUrl: options.baseUrl,
      documentId: created.id,
      claimToken: firstSigner.claimToken,
    });
    signerRows = await findSignersByDocumentId(db, created.id);
  }

  const firstSigner = signerRows[0];
  const secondSigner = signerRows[1];
  if (!firstSigner || !secondSigner) {
    throw new Error("Expected two signer rows after document creation");
  }

  const [storedFirstSigner] = await db
    .select({
      id: signers.id,
      status: signers.status,
      address: signers.address,
      forensicHash: signers.forensicHash,
      forensicEvidence: signers.forensicEvidence,
    })
    .from(signers)
    .where(and(eq(signers.documentId, created.id), eq(signers.id, firstSigner.id)))
    .limit(1);

  const firstEvidence = (storedFirstSigner?.forensicEvidence ?? null) as EnhancedForensicEvidence | null;
  const firstPendingOrder = signerRows.find((signer) => signer.status === "PENDING")?.signerOrder ?? null;

  const output = {
    createdAt: new Date().toISOString(),
    document: {
      id: created.id,
      title: "Automation Review Live Test Packet",
      proofMode: created.proofMode,
      signingOrder: "sequential",
      creatorAddress: options.ownerAddress,
      ownerSessionToken,
      ownerSessionExpiresAt: expiresAt.toISOString(),
      manageHint: "Use the owner session token as the w3s_session cookie for creator-only AI review routes.",
      creatorViewUrl: `${options.baseUrl}/view/${created.id}`,
    },
    signers: signerRows.map((signer, index) => ({
      id: signer.id,
      label: signer.label,
      claimToken: signer.claimToken,
      signUrl: `${options.baseUrl}/sign/${created.id}?claim=${signer.claimToken}`,
      embedUrl: `${options.baseUrl}/sign/${created.id}?claim=${signer.claimToken}&embed=1`,
      status: signer.status,
      signerOrder: signer.signerOrder,
      role: signer.role,
      currentTurn: signer.status === "PENDING" && signer.signerOrder === firstPendingOrder,
    })),
    presignedFirstSigner: options.presignFirst
      ? {
          walletAddress: firstSignerWalletAddress,
          signerId: firstSigner.id,
          status: storedFirstSigner?.status ?? firstSigner.status,
          forensicHash: storedFirstSigner?.forensicHash ?? null,
          storedReview: firstEvidence?.automationReview ?? null,
          storedPolicyOutcome: firstEvidence?.policyOutcome ?? null,
          storage: firstEvidence?.storage ?? null,
        }
      : null,
    manualRunChecklist: [
      "Open the Counterparty Signer link in a real browser session.",
      "Scroll the packet fully before signing.",
      "Highlight the sentence that contains the reference code.",
      `Paste ${COUNTERPARTY_REFERENCE} into the Reference Code field rather than typing it.`,
      "Fill the remaining fields, draw the hand signature, and finalize with your wallet.",
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
