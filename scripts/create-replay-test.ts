import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { randomBytes } from "crypto";
import { Wallet } from "ethers";
import postgres from "postgres";
import superjson from "superjson";
import { type DocToken, tokensToContent } from "~/lib/document/document-tokens";
import {
  encodeReplayEventsSync,
  encodeTimedSignatureSync,
  type ForensicReplayEncodedEvent,
} from "~/lib/forensic/replay-codec";
import { REPLAY_FORMAT_LIMITS } from "~/lib/forensic/replay-format";
import { signatureStrokesToDataUrl } from "~/lib/signature-svg";
import type { AppRouter } from "~/server/api/root";

const sql = postgres("postgresql://web3sign:web3sign_dev@127.0.0.1:5436/web3sign");
const OWNER = process.env.PM_OWNER_ADDRESS ?? "0x1000000000000000000000000000000000000A11";

function buildReplayTestTokens(): DocToken[] {
  return [
    { kind: "heading", text: "MUTUAL NON-DISCLOSURE AGREEMENT", sectionNum: 1 },
    { kind: "break" },
    {
      kind: "text",
      text: "This Mutual NDA is entered into by ProofMark Labs, Inc. and the Counterparty below.",
    },
    { kind: "break" },
    { kind: "heading", text: "1. CONFIDENTIAL INFORMATION", sectionNum: 2 },
    {
      kind: "text",
      text: "Confidential Information means any non-public information disclosed by either party, including technical data, trade secrets, business plans, source code, smart contract architectures, wallet addresses, and token economics.",
    },
    { kind: "break" },
    { kind: "heading", text: "2. OBLIGATIONS", sectionNum: 3 },
    {
      kind: "text",
      text: "The Receiving Party shall hold all Confidential Information in strict confidence, not disclose to third parties, use reasonable care, and limit access to need-to-know personnel.",
    },
    { kind: "break" },
    { kind: "heading", text: "3. TERM", sectionNum: 4 },
    {
      kind: "text",
      text: "Effective for 24 months. Confidentiality survives 3 additional years.",
    },
    { kind: "break" },
    { kind: "heading", text: "4. PARTY A (PROOFMARK) DETAILS", sectionNum: 5 },
    { kind: "break" },
    { kind: "text", text: "Company name: " },
    {
      kind: "field",
      field: {
        id: "pm-company",
        type: "name",
        label: "Company Name",
        placeholder: "Company legal name",
        signerIdx: 0,
        required: true,
      },
    },
    { kind: "break" },
    { kind: "text", text: "Representative: " },
    {
      kind: "field",
      field: {
        id: "pm-rep",
        type: "name",
        label: "Representative",
        placeholder: "Full name",
        signerIdx: 0,
        required: true,
      },
    },
    { kind: "break" },
    { kind: "text", text: "Email: " },
    {
      kind: "field",
      field: {
        id: "pm-email",
        type: "email",
        label: "Email",
        placeholder: "email@company.com",
        signerIdx: 0,
        required: true,
      },
    },
    { kind: "break" },
    {
      kind: "heading",
      text: "5. PARTY B (COUNTERPARTY) DETAILS",
      sectionNum: 6,
    },
    { kind: "break" },
    { kind: "text", text: "Full name: " },
    {
      kind: "field",
      field: {
        id: "cp-name",
        type: "name",
        label: "Your Full Name",
        placeholder: "Full legal name",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "break" },
    { kind: "text", text: "Email: " },
    {
      kind: "field",
      field: {
        id: "cp-email",
        type: "email",
        label: "Your Email",
        placeholder: "email@example.com",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "break" },
    { kind: "text", text: "Title: " },
    {
      kind: "field",
      field: {
        id: "cp-title",
        type: "title",
        label: "Your Title",
        placeholder: "Job title",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "break" },
    { kind: "text", text: "Date: " },
    {
      kind: "field",
      field: {
        id: "cp-date",
        type: "date",
        label: "Effective Date",
        placeholder: "MM/DD/YYYY",
        signerIdx: 1,
        required: true,
      },
    },
    { kind: "break" },
    { kind: "heading", text: "6. SIGNATURES", sectionNum: 7 },
    { kind: "signatureBlock", label: "ProofMark Labs", signerIdx: 0 },
    { kind: "break" },
    { kind: "signatureBlock", label: "Counterparty", signerIdx: 1 },
  ];
}

function fnvHash(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = BigInt.asUintN(64, h * 0x100000001b3n);
  }
  return h.toString(16).padStart(16, "0");
}

const BOT_NAME = "Bot LLC";
const BOT_EMAIL = "bot@proofmark.io";

function buildBotReplayEvents(TQ: number): ForensicReplayEncodedEvent[] {
  const ev: ForensicReplayEncodedEvent[] = [];
  // Scroll through document — uniform 200ms gaps
  for (let i = 0; i < 6; i++)
    ev.push({
      type: "scroll",
      delta: Math.round(200 / TQ),
      scrollY: i * 600,
      scrollMax: 3500,
    });
  // Click name field, focus, type "Bot LLC" at uniform 30ms
  ev.push({
    type: "click",
    delta: Math.round(100 / TQ),
    targetId: 1,
    x: 400,
    y: 300,
    button: 0,
  });
  ev.push({ type: "focus", delta: 1, targetId: 1 });
  for (let i = 0; i < BOT_NAME.length; i++)
    ev.push({
      type: "key",
      delta: Math.round(30 / TQ),
      targetId: 1,
      keyId: i + 1,
      modifiers: 0,
    });
  ev.push({ type: "fieldCommit", delta: 1, targetId: 1, valueId: 1 });
  ev.push({ type: "blur", delta: Math.round(50 / TQ), targetId: 1 });
  // Click email, type "bot@proofmark.io" at same cadence
  ev.push({
    type: "click",
    delta: Math.round(80 / TQ),
    targetId: 2,
    x: 400,
    y: 350,
    button: 0,
  });
  ev.push({ type: "focus", delta: 1, targetId: 2 });
  for (let i = 0; i < BOT_EMAIL.length; i++)
    ev.push({
      type: "key",
      delta: Math.round(30 / TQ),
      targetId: 2,
      keyId: 10 + i,
      modifiers: 0,
    });
  ev.push({ type: "fieldCommit", delta: 1, targetId: 2, valueId: 2 });
  ev.push({ type: "blur", delta: Math.round(50 / TQ), targetId: 2 });

  // Signature strokes
  ev.push(...buildBotSignatureEvents(TQ));
  return ev;
}

function buildBotSignatureEvents(TQ: number): ForensicReplayEncodedEvent[] {
  const ev: ForensicReplayEncodedEvent[] = [];
  ev.push({
    type: "click",
    delta: Math.round(100 / TQ),
    targetId: 3,
    x: 200,
    y: 500,
    button: 0,
  });
  ev.push({
    type: "signatureStart",
    delta: Math.round(30 / TQ),
    targetId: 3,
    strokeId: 1,
    x: 30,
    y: 50,
    pressure: 128,
  });
  for (let i = 1; i <= 25; i++)
    ev.push({
      type: "signaturePoint",
      delta: 1,
      strokeId: 1,
      x: 30 + i * 6,
      y: 50,
      pressure: 128,
    });
  ev.push({ type: "signatureEnd", delta: 1, strokeId: 1 });
  ev.push({
    type: "signatureStart",
    delta: Math.round(20 / TQ),
    targetId: 3,
    strokeId: 2,
    x: 30,
    y: 60,
    pressure: 128,
  });
  for (let i = 1; i <= 15; i++)
    ev.push({
      type: "signaturePoint",
      delta: 1,
      strokeId: 2,
      x: 30 + i * 8,
      y: 60 - i * 2,
      pressure: 128,
    });
  ev.push({ type: "signatureEnd", delta: 1, strokeId: 2 });

  const sigStrokes = [
    [
      { x: 30, y: 50, t: 0, force: 0.5 },
      ...Array.from({ length: 25 }, (_, i) => ({
        x: 30 + (i + 1) * 6,
        y: 50,
        t: (i + 1) * 8,
        force: 0.5,
      })),
    ],
    [
      { x: 30, y: 60, t: 300, force: 0.5 },
      ...Array.from({ length: 15 }, (_, i) => ({
        x: 30 + (i + 1) * 8,
        y: 60 - (i + 1) * 2,
        t: 300 + (i + 1) * 8,
        force: 0.5,
      })),
    ],
  ];
  encodeTimedSignatureSync(sigStrokes);
  ev.push({
    type: "signatureCommit",
    delta: Math.round(20 / TQ),
    targetId: 3,
    signatureId: 3,
  });
  return ev;
}

function buildBotReplayMetadata(ev: ForensicReplayEncodedEvent[], TQ: number) {
  const sigStrokes = [
    [
      { x: 30, y: 50, t: 0, force: 0.5 },
      ...Array.from({ length: 25 }, (_, i) => ({
        x: 30 + (i + 1) * 6,
        y: 50,
        t: (i + 1) * 8,
        force: 0.5,
      })),
    ],
    [
      { x: 30, y: 60, t: 300, force: 0.5 },
      ...Array.from({ length: 15 }, (_, i) => ({
        x: 30 + (i + 1) * 8,
        y: 60 - (i + 1) * 2,
        t: 300 + (i + 1) * 8,
        force: 0.5,
      })),
    ],
  ];
  const encodedSig = encodeTimedSignatureSync(sigStrokes);
  const tape = encodeReplayEventsSync(ev);
  const targets = [
    {
      id: 1,
      hash: fnvHash("bot-name"),
      descriptor: "synthetic|field:pm-company",
    },
    {
      id: 2,
      hash: fnvHash("bot-email"),
      descriptor: "synthetic|field:pm-email",
    },
    {
      id: 3,
      hash: fnvHash("bot-sig"),
      descriptor: "synthetic|signature:signature-pad",
    },
  ];
  const strings = [
    {
      id: 1,
      kind: "value" as const,
      hash: fnvHash("Bot LLC"),
      value: "Bot LLC",
    },
    {
      id: 2,
      kind: "value" as const,
      hash: fnvHash("bot@proofmark.io"),
      value: "bot@proofmark.io",
    },
    {
      id: 3,
      kind: "signature" as const,
      hash: fnvHash(encodedSig),
      value: encodedSig,
    },
    ...BOT_NAME.split("").map((c, i) => ({
      id: i + 4,
      kind: "key" as const,
      hash: fnvHash(c),
      value: c,
    })),
    ...BOT_EMAIL.split("").map((c, i) => ({
      id: i + 4 + BOT_NAME.length,
      kind: "key" as const,
      hash: fnvHash(c),
      value: c,
    })),
  ];
  return { tape, targets, strings, TQ };
}

function buildBotBehavioral() {
  const TQ = REPLAY_FORMAT_LIMITS.timeQuantumMs;
  const ev = buildBotReplayEvents(TQ);
  const { tape, targets, strings } = buildBotReplayMetadata(ev, TQ);

  return {
    timeOnPage: 3200,
    scrolledToBottom: false,
    maxScrollDepth: 100,
    mouseMoveCount: 0,
    clickCount: 3,
    keyPressCount: BOT_NAME.length + BOT_EMAIL.length,
    pageWasHidden: false,
    hiddenDuration: 0,
    interactionTimeline: [],
    typingCadence: Array(BOT_NAME.length + BOT_EMAIL.length - 1).fill(30),
    mouseVelocityAvg: 0,
    mouseAccelerationPattern: "flat",
    touchPressureAvg: null,
    scrollPattern: [],
    focusChanges: 2,
    pasteEvents: 0,
    copyEvents: 0,
    cutEvents: 0,
    rightClicks: 0,
    replay: {
      version: 1,
      encoding: "pm-replay-v1" as const,
      timeQuantumMs: TQ,
      viewport: {
        width: 1920,
        height: 1080,
        devicePixelRatio: 1,
        scrollWidth: 1920,
        scrollHeight: 3500,
      },
      targets,
      strings,
      tapeBase64: tape.tapeBase64,
      tapeHash: fnvHash(tape.tapeBase64),
      capabilities: ["scroll", "click", "key", "focus", "blur", "field", "signature"] as any,
      metrics: {
        eventCount: ev.length,
        byteLength: tape.byteLength,
        targetCount: targets.length,
        stringCount: strings.length,
        signatureStrokeCount: 2,
        signaturePointCount: 42,
        clipboardEventCount: 0,
        maxTimestampMs: 3200,
      },
    },
  };
}

async function main() {
  const sid = randomBytes(8).toString("base64url");
  const tok = randomBytes(48).toString("base64url");
  const now = new Date();
  await sql`INSERT INTO sessions (id, token, address, chain, created_at, expires_at) VALUES (${sid}, ${tok}, ${OWNER}, 'ETH', ${now}, ${new Date(now.getTime() + 86400000)})`;

  const client = createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "http://127.0.0.1:3100/api/trpc",
        transformer: superjson,
        headers: () => ({ cookie: "w3s_session=" + encodeURIComponent(tok) }),
      }),
    ],
  });

  const content = tokensToContent(buildReplayTestTokens());

  const doc = await client.document.create.mutate({
    title: "Forensic Replay Test — NDA",
    content,
    createdByEmail: "",
    proofMode: "HYBRID",
    gazeTracking: "full", // require eye tracking for entire document
    signers: [
      { label: "ProofMark Labs", signMethod: "WALLET", role: "SIGNER" },
      {
        label: "Counterparty",
        signMethod: "EMAIL_OTP",
        role: "SIGNER",
        email: "chad@technomancy.it",
      },
    ],
  });

  const links = doc.signerLinks ?? [];
  const w = Wallet.createRandom();

  // Generate bot signature SVG first — needed for signing message
  const botSigStrokes = [
    Array.from({ length: 26 }, (_, i) => ({ x: 30 + i * 6, y: 50 })),
    Array.from({ length: 16 }, (_, i) => ({ x: 30 + i * 8, y: 60 - i * 2 })),
  ];
  const botHandSig = signatureStrokesToDataUrl(botSigStrokes, 200, 80);

  const msg = await client.document.getSigningMessage.mutate({
    documentId: doc.id,
    claimToken: links[0]!.claimToken,
    signerAddress: w.address,
    chain: "ETH",
    handSignatureData: botHandSig,
  });
  const sig = await w.signMessage(msg.message);

  await client.document.sign.mutate({
    documentId: doc.id,
    claimToken: links[0]!.claimToken,
    signerAddress: w.address,
    chain: "ETH",
    signature: sig,
    handSignatureData: botHandSig,
    fieldValues: {
      "pm-company": "Bot LLC",
      "pm-rep": "AutoBot Prime",
      "pm-email": "bot@proofmark.io",
    },
    forensic: {
      fingerprint: {
        visitorId: "bot",
        canvasHash: "b",
        webglHash: "b",
        audioHash: "b",
        screen: "1920x1080x24x2",
        timezone: "UTC",
        languages: ["en"],
        cpuCores: 8,
        deviceMemory: 16,
        platform: "Linux",
        touchPoints: 0,
        webdriver: true,
        fontsHash: "b",
        pluginsHash: "b",
        doNotTrack: null,
        cookieEnabled: true,
        persistentId: "b",
        firstSeen: now.toISOString(),
        visitCount: 1,
        batteryLevel: null,
        batteryCharging: null,
        connectionType: "ethernet",
        connectionDownlink: 100,
        colorGamut: "srgb",
        hdr: false,
        reducedMotion: false,
        darkMode: true,
        devicePixelRatio: 1,
        gpuVendor: "Bot",
        gpuRenderer: "Bot",
        browserMajor: "Chrome/134",
        mathFingerprint: "b",
        webRtcLocalIps: [],
      },
      behavioral: buildBotBehavioral(),
    },
  });

  console.log("Doc: " + doc.id);
  console.log("Bot signed as ProofMark Labs.");
  console.log("");
  console.log("=== YOUR SIGNING LINK ===");
  console.log("http://localhost:3100/sign/" + doc.id + "?token=" + links[1]!.claimToken);
  console.log("");
  console.log("=== REPLAY (after signing) ===");
  console.log("http://localhost:3100/replay/" + doc.id);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
