/**
 * Create NDA demo contract for tech demo with X/Twitter-locked social verification.
 *
 * Usage:
 *   npx tsx scripts/create-nda-demo.ts
 *   npx tsx scripts/create-nda-demo.ts --base-url https://your-domain.com
 */

import { resolve } from "path";
import { mkdir, writeFile } from "fs/promises";
import { dirname } from "path";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { tokensToContent, type DocToken } from "~/lib/document-tokens";
import type { AppRouter } from "~/server/api/root";

const DEFAULT_BASE_URL = process.env.NEXTAUTH_URL ?? "http://127.0.0.1:3100";
const DEFAULT_OWNER_ADDRESS = process.env.PM_OWNER_ADDRESS ?? "0x0000000000000000000000000000000000000001";
const OUTPUT_PATH = resolve(process.cwd(), "tmp/nda-demo.json");

function parseArgs(argv: string[]) {
  let baseUrl = DEFAULT_BASE_URL;
  let ownerAddress = DEFAULT_OWNER_ADDRESS;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base-url" && argv[i + 1]) baseUrl = argv[++i]!;
    if (argv[i] === "--owner" && argv[i + 1]) ownerAddress = argv[++i]!;
  }
  return { baseUrl, ownerAddress };
}

// Helper to create an inline field marker
function field(
  id: string,
  type: string,
  label: string,
  signerIdx: number,
  opts: {
    placeholder?: string;
    required?: boolean;
    settings?: Record<string, unknown>;
  } = {},
): DocToken {
  return {
    kind: "field",
    field: {
      id,
      type,
      label,
      placeholder: opts.placeholder ?? label,
      signerIdx,
      required: opts.required ?? true,
      settings: opts.settings,
    },
  };
}

function sig(label: string, signerIdx: number): DocToken {
  return { kind: "signatureBlock", label, signerIdx };
}

function text(t: string): DocToken {
  return { kind: "text", text: t };
}

function heading(t: string, sectionNum: number): DocToken {
  return { kind: "heading", text: t, sectionNum };
}

function br(): DocToken {
  return { kind: "break" };
}

function buildContent(): string {
  const tokens: DocToken[] = [
    heading("NON-DISCLOSURE AGREEMENT", 1),
    br(),
    text("Effective Date: March 31, 2026"),
    br(),
    br(),

    text("This Non-Disclosure Agreement (\"Agreement\") is entered into between:"),
    br(),
    br(),

    text("DISCLOSING PARTY: R4vonus (\"Discloser\")"),
    br(),
    text("RECEIVING PARTY: The undersigned individuals, acting collectively as a single receiving party (\"Recipients\")"),
    br(),
    br(),

    text("WHEREAS, the Discloser has independently developed a portfolio of six (6) technology products and platforms using AI-assisted \"vibe coding\" methodologies, and wishes to demonstrate these products and the underlying multi-product go-to-market strategy to the Recipients for the purpose of evaluation, potential collaboration, investment, or partnership;"),
    br(),
    br(),
    text("WHEREAS, this demonstration will reveal proprietary source code, system architectures, business strategies, revenue models, and trade secrets that the Discloser has not made publicly available;"),
    br(),
    br(),
    text("WHEREAS, the Recipients understand that the Discloser's competitive advantage depends in part on the secrecy of the information being disclosed, and that unauthorized use or disclosure would cause irreparable harm;"),
    br(),
    br(),
    text("NOW, THEREFORE, in consideration of the mutual covenants and agreements contained herein, and for other good and valuable consideration, the receipt and sufficiency of which are hereby acknowledged, the parties agree as follows:"),
    br(),
    br(),

    // ── SECTION 1: IDENTITY VERIFICATION ──
    heading("1. IDENTITY VERIFICATION", 2),
    br(),
    text("Each party must verify their X (Twitter) identity via OAuth to confirm they are the intended signatory of this Agreement. Each verification field below is cryptographically locked to a specific X account. If a party authenticates with any account other than the one specified, verification will be rejected and the party will be unable to execute this Agreement."),
    br(),
    br(),

    text("Discloser X Verification: "),
    field("x-verify-discloser", "x-verify", "X Account (R4vonus)", 3, {
      placeholder: "Verify as @R4vonus",
      settings: { requiredUsername: "R4vonus" },
    }),
    br(),
    text("Recipient 1 X Verification: "),
    field("x-verify-r1", "x-verify", "X Account (superpotsecret)", 0, {
      placeholder: "Verify as @superpotsecret",
      settings: { requiredUsername: "superpotsecret" },
    }),
    br(),
    text("Recipient 2 X Verification: "),
    field("x-verify-r2", "x-verify", "X Account (_Kthings)", 1, {
      placeholder: "Verify as @_Kthings",
      settings: { requiredUsername: "_Kthings" },
    }),
    br(),
    text("Recipient 3 X Verification: "),
    field("x-verify-r3", "x-verify", "X Account (paperdstudio)", 2, {
      placeholder: "Verify as @paperdstudio",
      settings: { requiredUsername: "paperdstudio" },
    }),
    br(),
    br(),

    // ── SECTION 2: PRODUCTS AND PLATFORMS COVERED ──
    heading("2. PRODUCTS AND PLATFORMS UNDER NON-DISCLOSURE", 2),
    br(),
    text("The following products, platforms, and systems are collectively and individually subject to this Agreement. \"Confidential Information\" includes all source code, architectures, designs, user interfaces, APIs, business logic, algorithms, data models, deployment infrastructure, pricing strategies, roadmaps, and any other non-public information related to these products:"),
    br(),
    br(),

    heading("2.1 PROOFMARK (docu.technomancy.it)", 3),
    br(),
    text("A web3-native document signing and verification platform. Proofmark combines traditional e-signature workflows with blockchain-anchored proof, multi-chain wallet authentication (BTC, ETH, SOL, BASE), and court-admissible forensic evidence collection. Key proprietary systems include:"),
    br(),
    text("- Forensic Evidence Engine: Device fingerprinting (canvas, WebGL, audio, font enumeration), behavioral signal capture (keystroke timing, scroll patterns, mouse dynamics), geolocation with VPN/proxy/Tor detection, and cross-domain persistent identity tracking. All evidence is hashed into a tamper-proof chain linked to each signature."),
    br(),
    text("- Forensic Replay System: A binary-encoded replay tape format (pm-replay-v1) that records every user interaction during signing with sub-millisecond precision, enabling full session reconstruction for dispute resolution."),
    br(),
    text("- Multi-Provider AI Layer: A premium AI system supporting 12+ LLM providers with BYOK (bring-your-own-key) support, enterprise key sharing, and an OpenClaw connector for local model integration. Includes AI-assisted document editing, signer Q&A, and automated PDF analysis/correction."),
    br(),
    text("- Real-Time Collaboration: Yjs CRDT-based co-editing with shared/private AI conversations, annotation threads, and WebSocket sidecar architecture for multi-party contract drafting."),
    br(),
    text("- Social Verification System: OAuth-verified identity proofs locked to specific social accounts (X, GitHub, Discord, Google) embedded directly into contracts as required signing fields."),
    br(),
    text("- Three-tier proof architecture (PRIVATE, HYBRID, CRYPTO_NATIVE) with on-chain hash anchoring, IPFS content addressing, and zero-knowledge encrypted document vaults."),
    br(),
    text("NOTE: This very Agreement is being executed on Proofmark. The signing experience, forensic data captured during this session, and all platform behaviors observed are themselves Confidential Information."),
    br(),
    br(),

    heading("2.2 AGORIX", 3),
    br(),
    text("A technology platform currently in active development. All concepts, system architecture, technical specifications, wireframes, prototypes, database schemas, API designs, market positioning documents, competitive analysis, user research findings, and implementation details related to Agorix are Confidential Information. This includes any discussions about Agorix's target market, monetization strategy, and differentiation from existing solutions."),
    br(),
    br(),

    heading("2.3 BENCHMARK PROTOCOL", 3),
    br(),
    text("A protocol-level product with proprietary methodology for performance measurement, comparison, and/or verification. Confidential Information includes the protocol specification, any tokenomics or incentive design, smart contract architectures, consensus mechanisms, validator/node requirements, SDK and developer tooling, benchmarking algorithms, data collection methodology, go-to-market strategy, partnership pipeline, and all technical documentation."),
    br(),
    br(),

    heading("2.4 TILES", 3),
    br(),
    text("A product and/or platform concept. All design documents, technical specifications, user experience flows, interface mockups, component architectures, interaction patterns, data models, content management approaches, rendering pipelines, plugin/extension systems, and business model details are Confidential Information. This includes the product's relationship to or integration with other products in the Discloser's portfolio."),
    br(),
    br(),

    heading("2.5 PINOKY.IO", 3),
    br(),
    text("A web-based platform or application accessible at pinoky.io. All source code, frontend and backend architectures, database schemas, API endpoint designs, authentication flows, user data models, content delivery strategies, real-time communication systems, third-party integrations, deployment infrastructure (CDN, hosting, CI/CD), performance optimization techniques, and monetization mechanisms are Confidential Information."),
    br(),
    br(),

    heading("2.6 TYPESTROM.XYZ", 3),
    br(),
    text("A web-based platform or application accessible at typestrom.xyz. All creative direction, editorial strategy, content generation systems, technical infrastructure, rendering engines, typography systems, user contribution models, curation algorithms, distribution channels, community governance, and monetization plans are Confidential Information."),
    br(),
    br(),

    // Initials required for Section 2
    text("By initialing below, each party acknowledges they have read and understood the full scope of products and platforms covered by this Agreement:"),
    br(),
    text("Recipient 1 Initials: "),
    field("initials-scope-r1", "initials", "Initials", 0, { placeholder: "Initials" }),
    br(),
    text("Recipient 2 Initials: "),
    field("initials-scope-r2", "initials", "Initials", 1, { placeholder: "Initials" }),
    br(),
    text("Recipient 3 Initials: "),
    field("initials-scope-r3", "initials", "Initials", 2, { placeholder: "Initials" }),
    br(),
    text("Discloser Initials: "),
    field("initials-scope-disc", "initials", "Initials", 3, { placeholder: "Initials" }),
    br(),
    br(),

    // ── SECTION 3: MULTI-PRODUCT STRATEGY ──
    heading("3. MULTI-PRODUCT VIBE-CODED MARKET STRATEGY", 2),
    br(),
    text("In addition to the individual products listed in Section 2, the following overarching strategy and methodology constitute Confidential Information:"),
    br(),
    br(),
    text("3.1 The Discloser's strategy of simultaneously developing and launching multiple software products using AI-assisted development (\"vibe coding\"), rather than building a single product or acquiring existing commercial solutions. This approach leverages large language models and AI coding assistants to rapidly prototype, iterate, and ship production-grade software across multiple domains in parallel."),
    br(),
    br(),
    text("3.2 The Discloser's approach to designing these products as open-source software (OSS) for community adoption, with premium tiers, enterprise features, or complementary services as revenue capture mechanisms. This includes the specific OSS licensing strategy, the boundary between free and premium features, and the community engagement playbook."),
    br(),
    br(),
    text("3.3 The timing, sequencing, and coordination of product launches. The specific order in which products will be announced, the marketing narrative connecting them, cross-product referral and integration strategies, and any planned token launches, airdrops, or Web3-native distribution mechanisms."),
    br(),
    br(),
    text("3.4 The Discloser's competitive analysis of existing products in each vertical that these platforms aim to disrupt or replace, including identified weaknesses in incumbents and specific differentiation strategies."),
    br(),
    br(),
    text("3.5 Internal development infrastructure shared across products, including shared component libraries, deployment automation, CI/CD pipelines, monitoring dashboards, and any proprietary development tooling or AI prompt engineering techniques."),
    br(),
    br(),

    // Initials for strategy section
    text("By initialing below, each Recipient acknowledges that the multi-product strategy described above is itself a trade secret independent of any individual product:"),
    br(),
    text("Recipient 1 Initials: "),
    field("initials-strategy-r1", "initials", "Initials", 0, { placeholder: "Initials" }),
    br(),
    text("Recipient 2 Initials: "),
    field("initials-strategy-r2", "initials", "Initials", 1, { placeholder: "Initials" }),
    br(),
    text("Recipient 3 Initials: "),
    field("initials-strategy-r3", "initials", "Initials", 2, { placeholder: "Initials" }),
    br(),
    br(),

    // ── SECTION 4: OBLIGATIONS ──
    heading("4. OBLIGATIONS OF THE RECIPIENTS", 2),
    br(),
    text("The Recipients jointly and severally agree to the following obligations regarding all Confidential Information:"),
    br(),
    br(),
    text("4.1 NON-DISCLOSURE - Recipients shall not disclose, publish, post, tweet, stream, screenshot, screen-record, or otherwise reveal any Confidential Information to any third party, including on social media, blogs, podcasts, group chats, or forums, without the prior written consent of the Discloser."),
    br(),
    br(),
    text("4.2 NON-USE - Recipients shall not use any Confidential Information for any purpose other than evaluating the demonstration and potential collaboration with the Discloser. Recipients shall not use Confidential Information to build, pitch, advise on, invest in, or contribute to any product, service, or strategy that competes with or replicates any aspect of the Discloser's products or strategy."),
    br(),
    br(),
    text("4.3 PROTECTION - Recipients shall protect the Confidential Information with at least the same degree of care used to protect their own most sensitive confidential information, and in no event less than reasonable care. Recipients shall limit access to Confidential Information to only those individuals who have a need to know and who are bound by confidentiality obligations at least as protective as those in this Agreement."),
    br(),
    br(),
    text("4.4 NO REVERSE ENGINEERING - Recipients shall not reverse engineer, decompile, disassemble, or otherwise attempt to derive source code, algorithms, data structures, or architectural patterns from any demonstrated software, platform, prototype, or demo environment. This prohibition extends to inspecting network traffic, browser developer tools output, API responses, or any other technical artifacts observable during the demonstration."),
    br(),
    br(),
    text("4.5 NO REPRODUCTION - Recipients shall not copy, clone, fork, recreate, or create derivative works based on any demonstrated technology, user interfaces, user experience flows, design systems, or business models. This includes creating \"inspired by\" or functionally equivalent alternatives based on knowledge gained from the demonstration."),
    br(),
    br(),
    text("4.6 NO RECORDING - Recipients shall not photograph, screenshot, screen-record, or make any audio or video recording of the demonstration, the products, the platform interfaces, or any discussions occurring during the demo session, unless explicitly authorized in writing by the Discloser."),
    br(),
    br(),

    // Initials for obligations
    text("By initialing below, each Recipient agrees to all obligations in Section 4:"),
    br(),
    text("Recipient 1 Initials: "),
    field("initials-oblig-r1", "initials", "Initials", 0, { placeholder: "Initials" }),
    br(),
    text("Recipient 2 Initials: "),
    field("initials-oblig-r2", "initials", "Initials", 1, { placeholder: "Initials" }),
    br(),
    text("Recipient 3 Initials: "),
    field("initials-oblig-r3", "initials", "Initials", 2, { placeholder: "Initials" }),
    br(),
    br(),

    // ── SECTION 5: DEMO ACKNOWLEDGMENT ──
    heading("5. DEMONSTRATION ACKNOWLEDGMENT", 2),
    br(),
    text("The Recipients acknowledge and agree to the following regarding the nature of this demonstration:"),
    br(),
    br(),
    text("5.1 The products demonstrated may be in various stages of development including early prototype, alpha, beta, or pre-release. The current state of any product does not represent its final form, capabilities, or market positioning."),
    br(),
    br(),
    text("5.2 The demonstration may include live walkthroughs of working software, code repositories, internal dashboards, analytics data, user metrics, financial projections, partnership discussions, and strategic planning documents."),
    br(),
    br(),
    text("5.3 The Discloser's approach of using AI-assisted development to simultaneously build multiple products — and the specific methodologies, prompt engineering techniques, and development workflows used — are themselves trade secrets covered by this Agreement."),
    br(),
    br(),
    text("5.4 This Agreement itself is being executed on Proofmark, one of the Discloser's platforms. Every aspect of the signing experience — the social verification flow, the wallet connection, the inline field system, the forensic evidence being silently captured in the background, and the blockchain-anchored proof packet generated upon completion — is a live demonstration of Confidential Information. Recipients acknowledge that their interaction with this signing flow constitutes part of the demo."),
    br(),
    br(),
    text("5.5 The Discloser may share information about planned but unannounced features, unreleased products, draft partnerships, or speculative roadmap items. Recipients understand these are forward-looking and confidential regardless of whether they are ultimately pursued."),
    br(),
    br(),

    // Acknowledgment checkbox
    text("I acknowledge and accept all terms in Section 5:"),
    br(),
    text("Recipient 1: "),
    field("ack-demo-r1", "acknowledge-checkbox", "I acknowledge the demo scope and terms", 0, {
      placeholder: "I acknowledge",
    }),
    br(),
    text("Recipient 2: "),
    field("ack-demo-r2", "acknowledge-checkbox", "I acknowledge the demo scope and terms", 1, {
      placeholder: "I acknowledge",
    }),
    br(),
    text("Recipient 3: "),
    field("ack-demo-r3", "acknowledge-checkbox", "I acknowledge the demo scope and terms", 2, {
      placeholder: "I acknowledge",
    }),
    br(),
    br(),

    // ── SECTION 6: TERM AND DURATION ──
    heading("6. TERM AND DURATION", 2),
    br(),
    text("This Agreement shall remain in effect for a period of three (3) years from the date of execution. The obligations of confidentiality shall survive the termination or expiration of this Agreement and shall continue for as long as the Confidential Information retains its confidential nature and has not been made publicly available by the Discloser."),
    br(),
    br(),

    // ── SECTION 7: EXCLUSIONS ──
    heading("7. EXCLUSIONS FROM CONFIDENTIAL INFORMATION", 2),
    br(),
    text("Confidential Information does not include information that:"),
    br(),
    text("a) Is or becomes publicly available through no fault or action of the Recipients;"),
    br(),
    text("b) Was demonstrably known to the Recipients prior to disclosure, as evidenced by written records predating this Agreement;"),
    br(),
    text("c) Is independently developed by the Recipients without use of, reference to, or knowledge gained from the Confidential Information, as evidenced by contemporaneous documentation;"),
    br(),
    text("d) Is disclosed with the prior written approval of the Discloser;"),
    br(),
    text("e) Is required to be disclosed by law, regulation, or court order, provided that the Recipients give the Discloser prompt written notice and cooperate in seeking protective measures."),
    br(),
    br(),
    text("For the avoidance of doubt: the mere fact that a product is released as open-source software does NOT automatically declassify the strategy, premium features, business model, or unreleased roadmap items associated with that product. Only the specific source code published under an OSS license becomes non-confidential; everything else remains covered."),
    br(),
    br(),

    // ── SECTION 8: REMEDIES ──
    heading("8. REMEDIES AND ENFORCEMENT", 2),
    br(),
    text("8.1 The Recipients acknowledge that any breach of this Agreement may cause immediate and irreparable harm to the Discloser for which monetary damages alone would be an inadequate remedy. The Discloser shall be entitled to seek equitable relief, including temporary restraining orders, preliminary and permanent injunctions, and specific performance, in addition to all other remedies available at law or in equity, without the necessity of proving actual damages or posting any bond."),
    br(),
    br(),
    text("8.2 In the event of a breach, the breaching Recipient(s) shall be liable for all reasonable attorneys' fees, court costs, and expenses incurred by the Discloser in enforcing this Agreement."),
    br(),
    br(),
    text("8.3 The Discloser's forensic evidence system (described in Section 2.1) captures court-admissible evidence of each party's interaction with this Agreement, including device fingerprints, behavioral signals, IP geolocation, and timestamped cryptographic proofs. This evidence may be used in any legal proceeding related to the enforcement of this Agreement."),
    br(),
    br(),

    // ── SECTION 9: RETURN OF MATERIALS ──
    heading("9. RETURN OF MATERIALS", 2),
    br(),
    text("Upon written request by the Discloser, or upon termination or expiration of this Agreement, the Recipients shall within five (5) business days: (a) return all documents, files, notes, recordings, and materials containing or reflecting Confidential Information; (b) permanently delete all electronic copies from all devices, cloud storage, and backup systems; and (c) provide written certification that such return and destruction has been completed."),
    br(),
    br(),

    // ── SECTION 10: NO LICENSE ──
    heading("10. NO LICENSE OR RIGHTS GRANTED", 2),
    br(),
    text("10.1 Nothing in this Agreement grants the Recipients any license, intellectual property rights, ownership interest, or option to acquire any rights in the Discloser's technology, platforms, source code, designs, trademarks, or business strategies."),
    br(),
    br(),
    text("10.2 The demonstration of products that include open-source components does not waive confidentiality over the overall product strategy, proprietary extensions, premium feature implementations, the relationship between products, or any unpublished code."),
    br(),
    br(),
    text("10.3 No joint venture, partnership, employment, or agency relationship is created by this Agreement or by the demonstration."),
    br(),
    br(),

    // Initials for no-license clause
    text("By initialing below, each party acknowledges Sections 8, 9, and 10:"),
    br(),
    text("Recipient 1 Initials: "),
    field("initials-license-r1", "initials", "Initials", 0, { placeholder: "Initials" }),
    br(),
    text("Recipient 2 Initials: "),
    field("initials-license-r2", "initials", "Initials", 1, { placeholder: "Initials" }),
    br(),
    text("Recipient 3 Initials: "),
    field("initials-license-r3", "initials", "Initials", 2, { placeholder: "Initials" }),
    br(),
    text("Discloser Initials: "),
    field("initials-license-disc", "initials", "Initials", 3, { placeholder: "Initials" }),
    br(),
    br(),

    // ── SECTION 11: GOVERNING LAW ──
    heading("11. GOVERNING LAW AND JURISDICTION", 2),
    br(),
    text("This Agreement shall be governed by and construed in accordance with the laws of the State of applicable jurisdiction, without regard to its conflicts of law principles. Any dispute arising out of or relating to this Agreement shall be subject to the exclusive jurisdiction of the courts in the Discloser's jurisdiction of residence."),
    br(),
    br(),

    // ── SECTION 12: MISCELLANEOUS ──
    heading("12. MISCELLANEOUS", 2),
    br(),
    text("12.1 ENTIRE AGREEMENT - This Agreement constitutes the entire agreement between the parties regarding the subject matter hereof and supersedes all prior discussions, negotiations, and agreements, whether oral or written."),
    br(),
    br(),
    text("12.2 AMENDMENTS - This Agreement may only be amended by a written instrument signed by all parties."),
    br(),
    br(),
    text("12.3 SEVERABILITY - If any provision of this Agreement is found to be invalid or unenforceable, the remaining provisions shall continue in full force and effect, and the invalid provision shall be modified to the minimum extent necessary to make it enforceable."),
    br(),
    br(),
    text("12.4 WAIVER - The failure of any party to enforce any provision of this Agreement shall not be construed as a waiver of such provision or the right to enforce it at a later time."),
    br(),
    br(),
    text("12.5 ASSIGNMENT - The Recipients may not assign or transfer this Agreement or any rights or obligations hereunder without the prior written consent of the Discloser."),
    br(),
    br(),
    text("12.6 BLOCKCHAIN VERIFICATION - Upon full execution, a cryptographic hash of this Agreement and all signatures will be anchored to one or more public blockchains, creating an immutable, independently verifiable proof of existence and execution. This on-chain record serves as supplementary evidence of the Agreement's authenticity and the timestamp of execution."),
    br(),
    br(),

    // ── SIGNATURES ──
    heading("SIGNATURES", 2),
    br(),
    text("IN WITNESS WHEREOF, the parties have executed this Non-Disclosure Agreement as of the date first written above. Each party's execution is evidenced by their verified X (Twitter) identity, drawn signature, and cryptographic wallet signature."),
    br(),
    br(),

    text("DISCLOSING PARTY"),
    br(),
    text("X Username: "),
    field("name-discloser", "twitter-handle", "X Username", 3, { placeholder: "@R4vonus" }),
    br(),
    text("Date: "),
    field("date-discloser", "date", "Date", 3, { placeholder: "Signing Date" }),
    br(),
    sig("Discloser Signature", 3),
    br(),
    br(),

    text("RECEIVING PARTY - RECIPIENT 1"),
    br(),
    text("X Username: "),
    field("name-r1", "twitter-handle", "X Username", 0, { placeholder: "@superpotsecret" }),
    br(),
    text("Date: "),
    field("date-r1", "date", "Date", 0, { placeholder: "Signing Date" }),
    br(),
    sig("Recipient 1 Signature", 0),
    br(),
    br(),

    text("RECEIVING PARTY - RECIPIENT 2"),
    br(),
    text("X Username: "),
    field("name-r2", "twitter-handle", "X Username", 1, { placeholder: "@_Kthings" }),
    br(),
    text("Date: "),
    field("date-r2", "date", "Date", 1, { placeholder: "Signing Date" }),
    br(),
    sig("Recipient 2 Signature", 1),
    br(),
    br(),

    text("RECEIVING PARTY - RECIPIENT 3"),
    br(),
    text("X Username: "),
    field("name-r3", "twitter-handle", "X Username", 2, { placeholder: "@paperdstudio" }),
    br(),
    text("Date: "),
    field("date-r3", "date", "Date", 2, { placeholder: "Signing Date" }),
    br(),
    sig("Recipient 3 Signature", 2),
    br(),
  ];

  return tokensToContent(tokens);
}

async function main() {
  const { baseUrl, ownerAddress } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.AUTOMATION_SECRET;

  console.log(`Creating NDA demo contract...`);
  console.log(`  Base URL: ${baseUrl}`);
  console.log(`  Owner: ${ownerAddress}`);
  console.log(`  API Key: ${apiKey ? "set" : "NOT SET (will fail auth)"}`);

  const trpc = createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        headers: {
          "x-api-key": apiKey ?? "",
          "x-wallet-address": ownerAddress,
          "x-wallet-chain": "ETH",
        },
      }),
    ],
  });

  const content = buildContent();

  const result = await trpc.document.create.mutate({
    title: "Non-Disclosure Agreement - Technology Demo",
    content,
    createdByEmail: "",
    proofMode: "HYBRID",
    signingOrder: "parallel",
    gazeTracking: "off",
    expiresInDays: 90,
    signers: [
      // Signer 0 - Recipient 1: @superpotsecret
      {
        label: "Recipient 1 (superpotsecret)",
        email: "",
        signMethod: "WALLET",
        role: "SIGNER",
        fields: [
          { type: "x-verify", label: "X Account (superpotsecret)", required: true, settings: { requiredUsername: "superpotsecret" } },
          { type: "initials", label: "Initials", required: true },
          { type: "full-name", label: "Full Name", required: true },
          { type: "date", label: "Date", required: true },
          { type: "acknowledge-checkbox", label: "I acknowledge the demo scope", required: true },
          { type: "signature", label: "Signature", required: true },
        ],
      },
      // Signer 1 - Recipient 2: @_Kthings
      {
        label: "Recipient 2 (_Kthings)",
        email: "",
        signMethod: "WALLET",
        role: "SIGNER",
        fields: [
          { type: "x-verify", label: "X Account (_Kthings)", required: true, settings: { requiredUsername: "_Kthings" } },
          { type: "initials", label: "Initials", required: true },
          { type: "full-name", label: "Full Name", required: true },
          { type: "date", label: "Date", required: true },
          { type: "acknowledge-checkbox", label: "I acknowledge the demo scope", required: true },
          { type: "signature", label: "Signature", required: true },
        ],
      },
      // Signer 2 - Recipient 3: @paperdstudio
      {
        label: "Recipient 3 (paperdstudio)",
        email: "",
        signMethod: "WALLET",
        role: "SIGNER",
        fields: [
          { type: "x-verify", label: "X Account (paperdstudio)", required: true, settings: { requiredUsername: "paperdstudio" } },
          { type: "initials", label: "Initials", required: true },
          { type: "full-name", label: "Full Name", required: true },
          { type: "date", label: "Date", required: true },
          { type: "acknowledge-checkbox", label: "I acknowledge the demo scope", required: true },
          { type: "signature", label: "Signature", required: true },
        ],
      },
      // Signer 3 - Discloser: @R4vonus
      {
        label: "Discloser (R4vonus)",
        email: "",
        signMethod: "WALLET",
        role: "SIGNER",
        fields: [
          { type: "x-verify", label: "X Account (R4vonus)", required: true, settings: { requiredUsername: "R4vonus" } },
          { type: "initials", label: "Initials", required: true },
          { type: "full-name", label: "Full Name", required: true },
          { type: "date", label: "Date", required: true },
          { type: "signature", label: "Signature", required: true },
        ],
      },
    ],
  });

  const output = {
    documentId: result.id,
    contentHash: result.contentHash,
    proofMode: result.proofMode,
    signerLinks: result.signerLinks.map((link) => ({
      label: link.label,
      signUrl: link.signUrl,
      claimToken: link.claimToken,
    })),
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2));

  console.log("\nNDA contract created successfully!");
  console.log(`  Document ID: ${result.id}`);
  console.log(`  Content Hash: ${result.contentHash}`);
  console.log(`\nSigning Links:`);
  for (const link of result.signerLinks) {
    console.log(`  ${link.label}: ${link.signUrl}`);
  }
  console.log(`\nFull output saved to: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Failed to create NDA:", err);
  process.exit(1);
});
