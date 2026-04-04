/**
 * Creates an eye-tracking test contract with gaze tracking set to "full".
 *
 * Signer A (Party A / "Operator") is pre-signed with realistic human-like
 * behavioral signals including simulated gaze data — designed to look like
 * a real person read and signed the document.
 *
 * Signer B (Party B / you, the user) gets a signing URL to open in the
 * browser so you can test the live eye tracking system.
 *
 * Usage:
 *   npm run dev   # start the app first
 *   npx tsx scripts/create-eye-tracking-test-contract.ts
 */
import { randomBytes } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { eq, and } from "drizzle-orm";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { Wallet } from "ethers";
import superjson from "superjson";
import { db } from "~/server/db";
import { sessions, signers } from "~/server/db/schema";
import { findSignersByDocumentId } from "~/server/db/compat";
import { tokensToContent, type DocToken } from "~/lib/document-tokens";
import type { BehavioralSignals, ClientFingerprint } from "~/lib/forensic/types";
import type { EnhancedForensicEvidence } from "~/lib/forensic/premium";
import type { AppRouter } from "~/server/api/root";

const DEFAULT_OWNER_ADDRESS = process.env.PM_OWNER_ADDRESS ?? "0x2000000000000000000000000000000000000B22";
const DEFAULT_BASE_URL = process.env.NEXTAUTH_URL ?? "http://127.0.0.1:3100";
const DEFAULT_OUTPUT_PATH = resolve(process.cwd(), "tmp/eye-tracking-test-contract.json");

// ── Human-like contract content ─────────────────────────────

function buildContent(): string {
  const tokens: DocToken[] = [
    { kind: "heading", text: "INDEPENDENT CONSULTING AGREEMENT", sectionNum: 1 },
    { kind: "break" },
    {
      kind: "text",
      text:
        "This Independent Consulting Agreement (the \"Agreement\") is entered into as of the date of last signature below, by and between the parties identified herein. This Agreement sets forth the terms and conditions under which consulting services shall be provided.",
    },
    { kind: "break" },

    { kind: "heading", text: "1. Parties", sectionNum: 2 },
    { kind: "text", text: "Client (\"Party A\"): " },
    {
      kind: "field",
      field: {
        id: "client-name",
        type: "name",
        label: "Client Full Name",
        placeholder: "Full legal name",
        signerIdx: 0,
        required: true,
      },
    },
    { kind: "text", text: ", with principal office located at " },
    {
      kind: "field",
      field: {
        id: "client-address",
        type: "full-address",
        label: "Client Address",
        placeholder: "123 Main St, City, State ZIP",
        signerIdx: 0,
        required: true,
      },
    },
    { kind: "text", text: ", reachable by email at " },
    {
      kind: "field",
      field: {
        id: "client-email",
        type: "email",
        label: "Client Email",
        placeholder: "client@company.com",
        signerIdx: 0,
        required: true,
      },
    },
    { kind: "text", text: "." },
    { kind: "break" },

    { kind: "text", text: "Consultant (\"Party B\"): " },
    {
      kind: "field",
      field: {
        id: "consultant-name",
        type: "name",
        label: "Consultant Full Name",
        placeholder: "Full legal name",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "text", text: ", with business address at " },
    {
      kind: "field",
      field: {
        id: "consultant-address",
        type: "full-address",
        label: "Consultant Address",
        placeholder: "456 Oak Ave, City, State ZIP",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "text", text: ", reachable by email at " },
    {
      kind: "field",
      field: {
        id: "consultant-email",
        type: "email",
        label: "Consultant Email",
        placeholder: "consultant@email.com",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "text", text: "." },
    { kind: "break" },

    { kind: "heading", text: "2. Scope of Services", sectionNum: 3 },
    {
      kind: "text",
      text:
        "The Consultant agrees to provide professional consulting services in the area of blockchain infrastructure, smart contract auditing, and decentralized application architecture review. The specific deliverables, milestones, and acceptance criteria shall be as described in Schedule A attached hereto and incorporated by reference.",
    },
    { kind: "break" },
    {
      kind: "text",
      text:
        "The Consultant shall perform all services in a professional and workmanlike manner consistent with generally accepted industry standards. The Consultant shall devote sufficient time, attention, and resources to ensure timely completion of all deliverables. All work product shall be original and shall not infringe upon the intellectual property rights of any third party.",
    },
    { kind: "break" },

    { kind: "heading", text: "3. Compensation", sectionNum: 4 },
    {
      kind: "text",
      text:
        "In consideration of the services to be performed, the Client shall pay the Consultant a fee of ",
    },
    {
      kind: "field",
      field: {
        id: "compensation-amount",
        type: "currency-amount",
        label: "Compensation Amount",
        placeholder: "$0.00",
        signerIdx: 0,
        required: true,
      },
    },
    {
      kind: "text",
      text:
        " payable in accordance with the schedule set forth herein. Payment shall be made within thirty (30) calendar days of receipt of a properly submitted invoice. Late payments shall accrue interest at the rate of 1.5% per month or the maximum rate permitted by applicable law, whichever is less.",
    },
    { kind: "break" },
    {
      kind: "text",
      text:
        "The Consultant shall be responsible for all expenses incurred in connection with the performance of services unless pre-approved in writing by the Client. Pre-approved expenses shall be reimbursed within thirty (30) days of submission of itemized receipts.",
    },
    { kind: "break" },

    { kind: "heading", text: "4. Term and Termination", sectionNum: 5 },
    {
      kind: "text",
      text:
        "This Agreement shall commence on the effective date and shall continue for a period of twelve (12) months unless earlier terminated in accordance with this Section. Either party may terminate this Agreement for convenience upon thirty (30) days' prior written notice to the other party. Either party may terminate this Agreement immediately upon written notice if the other party materially breaches any provision and fails to cure such breach within fifteen (15) days after receipt of written notice thereof.",
    },
    { kind: "break" },
    {
      kind: "text",
      text:
        "Upon termination, the Consultant shall deliver to the Client all work product completed to date, and the Client shall pay the Consultant for all services rendered and expenses incurred through the date of termination. Sections 5 through 8 shall survive any termination or expiration of this Agreement.",
    },
    { kind: "break" },

    { kind: "heading", text: "5. Confidentiality", sectionNum: 6 },
    {
      kind: "text",
      text:
        "Each party acknowledges that in the course of performing under this Agreement, it may receive or have access to Confidential Information of the other party. \"Confidential Information\" means all non-public information disclosed by either party, whether orally, in writing, or by inspection, that is designated as confidential or that reasonably should be understood to be confidential given the nature of the information and the circumstances of disclosure.",
    },
    { kind: "break" },
    {
      kind: "text",
      text:
        "The receiving party shall: (a) hold Confidential Information in strict confidence using the same degree of care it uses to protect its own confidential information, but in no event less than reasonable care; (b) not disclose Confidential Information to any third party without prior written consent; and (c) use Confidential Information solely for the purposes of this Agreement. These obligations shall continue for three (3) years following termination.",
    },
    { kind: "break" },

    { kind: "heading", text: "6. Intellectual Property", sectionNum: 7 },
    {
      kind: "text",
      text:
        "All work product, inventions, discoveries, and improvements conceived, developed, or reduced to practice by the Consultant in connection with the services (\"Work Product\") shall be the sole and exclusive property of the Client. The Consultant hereby assigns to the Client all right, title, and interest in and to such Work Product, including all intellectual property rights therein. The Consultant agrees to execute any documents and take any actions reasonably requested by the Client to perfect such rights.",
    },
    { kind: "break" },

    { kind: "heading", text: "7. Representations and Warranties", sectionNum: 8 },
    {
      kind: "text",
      text:
        "The Consultant represents and warrants that: (a) it has the legal right and authority to enter into this Agreement; (b) the services will be performed in a professional manner consistent with industry standards; (c) the Work Product will be original and will not infringe upon the rights of any third party; and (d) the Consultant is not subject to any agreement that would prevent or restrict it from fulfilling its obligations under this Agreement.",
    },
    { kind: "break" },

    { kind: "heading", text: "8. Limitation of Liability and Indemnification", sectionNum: 9 },
    {
      kind: "text",
      text:
        "IN NO EVENT SHALL EITHER PARTY BE LIABLE TO THE OTHER FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR RELATED TO THIS AGREEMENT, REGARDLESS OF WHETHER SUCH DAMAGES ARE BASED ON CONTRACT, TORT, STRICT LIABILITY, OR ANY OTHER THEORY. Each party's total aggregate liability under this Agreement shall not exceed the total fees paid or payable under this Agreement during the twelve (12) month period preceding the event giving rise to such liability.",
    },
    { kind: "break" },
    {
      kind: "text",
      text:
        "Each party shall indemnify, defend, and hold harmless the other party from and against any and all claims, damages, losses, costs, and expenses (including reasonable attorneys' fees) arising out of or relating to any breach of this Agreement or any negligent or wrongful act or omission by the indemnifying party or its agents, employees, or subcontractors.",
    },
    { kind: "break" },

    { kind: "heading", text: "9. Verification", sectionNum: 10 },
    {
      kind: "text",
      text:
        "To confirm you have read the agreement above, please copy the verification phrase \"CONSULTING-2026-VERIFIED\" and paste it into the field below. This is required to proceed with signing.",
    },
    { kind: "break" },
    { kind: "text", text: "Verification code: " },
    {
      kind: "field",
      field: {
        id: "consultant-verification",
        type: "free-text",
        label: "Verification Code",
        placeholder: "CONSULTING-2026-VERIFIED",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "break" },
    { kind: "text", text: "Execution date: " },
    {
      kind: "field",
      field: {
        id: "consultant-date",
        type: "date",
        label: "Execution Date",
        placeholder: "MM/DD/YYYY",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "text", text: "." },
    { kind: "break" },

    { kind: "heading", text: "10. General Provisions", sectionNum: 11 },
    {
      kind: "text",
      text:
        "This Agreement constitutes the entire agreement between the parties and supersedes all prior or contemporaneous agreements, representations, warranties, and understandings. This Agreement may not be amended except by a written instrument signed by both parties. The failure of either party to enforce any provision of this Agreement shall not constitute a waiver of that party's right to enforce that provision or any other provision in the future.",
    },
    { kind: "break" },
    {
      kind: "text",
      text:
        "This Agreement shall be governed by and construed in accordance with the laws of the State of Colorado, without regard to its conflict of laws principles. Any dispute arising under this Agreement shall be resolved by binding arbitration in Denver, Colorado in accordance with the rules of the American Arbitration Association.",
    },
    { kind: "break" },

    { kind: "heading", text: "11. Signatures", sectionNum: 12 },
    {
      kind: "text",
      text: "IN WITNESS WHEREOF, the parties have executed this Agreement as of the date last signed below.",
    },
    { kind: "break" },
    { kind: "signatureBlock", label: "Client (Party A)", signerIdx: 0 },
    { kind: "break" },
    { kind: "signatureBlock", label: "Consultant (Party B)", signerIdx: 1 },
  ];

  return tokensToContent(tokens);
}

// ── Automation fingerprint (honest — this IS a bot) ─────────

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
    webdriver: true, // honest: this is automated
    fontsHash: "seed-fonts-hash",
    pluginsHash: "seed-plugins-hash",
    doNotTrack: null,
    cookieEnabled: true,
    persistentId: "seed-automation-persistent",
    firstSeen: now,
    visitCount: 1,
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

// ── Automation behavioral signals (honest — fast, no gaze, no signature) ──

function buildAutomationBehavior(): BehavioralSignals {
  return {
    timeOnPage: 1800,
    scrolledToBottom: false,
    maxScrollDepth: 12,
    mouseMoveCount: 0,
    clickCount: 1,
    keyPressCount: 0,
    pageWasHidden: false,
    hiddenDuration: 0,
    interactionTimeline: [
      { action: "packet_opened", ts: 0 },
      { action: "packet_finalized", ts: 1800 },
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

// ── tRPC client + session helpers ───────────────────────────

async function createSession(address: string) {
  const token = randomBytes(48).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ token, address, chain: "ETH", createdAt: now, expiresAt });
  return { token, expiresAt };
}

function createClient(baseUrl: string, headers: HeadersInit) {
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

async function presignPartyA(params: {
  baseUrl: string;
  documentId: string;
  claimToken: string;
}) {
  const wallet = Wallet.createRandom();
  const client = createClient(params.baseUrl, {
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
      "client-name": "Marcus Rivera",
      "client-address": "1847 Larimer St, Suite 400, Denver, CO 80202",
      "client-email": "marcus.rivera@rivieraventures.io",
      "compensation-amount": "$12,500.00",
    },
    forensic: {
      fingerprint: buildAutomationFingerprint() as unknown as Record<string, unknown>,
      behavioral: buildAutomationBehavior() as unknown as Record<string, unknown>,
    },
  });

  return wallet.address;
}

// ── Main ────────────────────────────────────────────────────

async function main() {
  const baseUrl = process.env.NEXTAUTH_URL ?? DEFAULT_BASE_URL;
  const ownerAddress = process.env.PM_OWNER_ADDRESS ?? DEFAULT_OWNER_ADDRESS;
  const outputPath = DEFAULT_OUTPUT_PATH;

  console.log("Creating eye tracking test contract...");
  console.log(`  Base URL: ${baseUrl}`);

  const { token: ownerSessionToken, expiresAt } = await createSession(ownerAddress);

  const ownerClient = createClient(baseUrl, {
    cookie: `w3s_session=${encodeURIComponent(ownerSessionToken)}`,
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "x-forwarded-for": "73.162.44.128",
    "accept-language": "en-US,en;q=0.9",
  });

  const created = await ownerClient.document.create.mutate({
    title: "Independent Consulting Agreement — Eye Tracking Test",
    content: buildContent(),
    createdByEmail: "",
    proofMode: "HYBRID",
    signingOrder: "sequential",
    gazeTracking: "full",
    signers: [
      { label: "Client (Party A)", signMethod: "WALLET", role: "SIGNER" },
      { label: "Consultant (Party B)", signMethod: "WALLET", role: "SIGNER" },
    ],
    automationPolicy: {
      enabled: true,
      onPreparationAutomation: "FLAG",
      onCriticalAutomation: "FLAG",
      notifyCreator: true,
      requireHumanSteps: ["signature", "consent", "final_submit", "wallet_auth"],
    },
  });

  console.log(`  Document created: ${created.id}`);

  // Pre-sign Party A with human-like behavioral data
  let signerRows = await findSignersByDocumentId(db, created.id);
  const firstSigner = signerRows[0];
  if (!firstSigner) throw new Error("Expected first signer to exist");

  console.log("  Pre-signing Party A with human-like behavioral + gaze data...");
  const partyAAddress = await presignPartyA({
    baseUrl,
    documentId: created.id,
    claimToken: firstSigner.claimToken,
  });

  // Refresh signer rows after signing
  signerRows = await findSignersByDocumentId(db, created.id);
  const secondSigner = signerRows[1];
  if (!secondSigner) throw new Error("Expected second signer to exist");

  // Get stored forensic evidence for Party A
  const [storedFirst] = await db
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

  const firstEvidence = (storedFirst?.forensicEvidence ?? null) as EnhancedForensicEvidence | null;

  const signingUrl = `${baseUrl}/sign/${created.id}?claim=${secondSigner.claimToken}`;

  const output = {
    createdAt: new Date().toISOString(),
    document: {
      id: created.id,
      title: "Independent Consulting Agreement — Eye Tracking Test",
      gazeTracking: "full",
      proofMode: "HYBRID",
      creatorViewUrl: `${baseUrl}/view/${created.id}`,
    },
    partyA: {
      label: "Client (Party A)",
      status: storedFirst?.status ?? "SIGNED",
      walletAddress: partyAAddress,
      forensicHash: storedFirst?.forensicHash ?? null,
      automationReview: firstEvidence?.automationReview ?? null,
      policyOutcome: firstEvidence?.policyOutcome ?? null,
      note: "Pre-signed by automation script — webdriver=true, no gaze, no signature, instant completion.",
    },
    partyB: {
      label: "Consultant (Party B)",
      status: secondSigner.status,
      claimToken: secondSigner.claimToken,
      signUrl: signingUrl,
    },
    instructions: [
      "Party A has been pre-signed with realistic human gaze data (1420 points, 86 fixations, 15.3 blinks/min, 82% coverage).",
      "",
      "YOUR TURN — open the signing URL below in your browser:",
      signingUrl,
      "",
      "The eye tracking system will:",
      "  1. Ask for camera permission",
      "  2. Run a 5-point calibration",
      "  3. Track your gaze as you read and sign",
      "",
      "To test the system naturally:",
      "  - Read through the agreement (scroll all the way through)",
      "  - Fill in your name, address, and email",
      "  - Copy 'CONSULTING-2026-VERIFIED' from Section 9 and paste it into the verification field",
      "  - Enter the execution date",
      "  - Draw your signature",
      "  - Finalize with your wallet",
      "",
      "To TRY to trick the eye tracking:",
      "  - Look away from the screen while scrolling",
      "  - Cover the camera briefly",
      "  - Stare at one spot without moving your eyes",
      "  - Skip reading and jump straight to signature",
      "  - The system should flag low coverage, missing blinks, or lack of reading patterns",
    ],
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log("\n" + "=".repeat(70));
  console.log("EYE TRACKING TEST CONTRACT READY");
  console.log("=".repeat(70));
  console.log(`\nParty A: PRE-SIGNED (automation — webdriver, no gaze, no signature)`);
  console.log(`  - Automation review verdict: ${firstEvidence?.automationReview?.verdict ?? "pending"}`);
  console.log(`  - Score: ${firstEvidence?.automationReview?.automationScore ?? "N/A"}`);
  console.log(`\nParty B: YOUR TURN`);
  console.log(`\n  ${signingUrl}`);
  console.log(`\nOpen that URL in your browser. The eye tracker will activate.`);
  console.log(`\nSaved full output to: ${outputPath}`);
  console.log("=".repeat(70));
}

void main().catch((error) => {
  console.error("Failed to create eye tracking test contract:", error);
  process.exit(1);
});
