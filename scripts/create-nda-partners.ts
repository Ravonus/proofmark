/**
 * Create individual NDA contracts for paperd, superpot, and kthings.
 *
 * These NDAs protect all proprietary technology, decks, strategies, and
 * materials shared with each party. Includes an authorized-disclosure clause
 * allowing recipients to share information with third parties ONLY when
 * explicitly instructed by the Discloser.
 *
 * Usage:
 *   npx tsx scripts/create-nda-partners.ts
 *   npx tsx scripts/create-nda-partners.ts --base-url https://docu.technomancy.it
 */

import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import superjson from "superjson";
import { type DocToken, tokensToContent } from "~/lib/document/document-tokens";
import type { AppRouter } from "~/server/api/root";

const DEFAULT_BASE_URL = process.env.NEXTAUTH_URL ?? "http://127.0.0.1:3100";
const DEFAULT_OWNER_ADDRESS = process.env.PM_OWNER_ADDRESS ?? "0x0000000000000000000000000000000000000001";
const OUTPUT_DIR = resolve(process.cwd(), "tmp");

function parseArgs(argv: string[]) {
  let baseUrl = DEFAULT_BASE_URL;
  let ownerAddress = DEFAULT_OWNER_ADDRESS;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base-url" && argv[i + 1]) baseUrl = argv[++i]!;
    if (argv[i] === "--owner" && argv[i + 1]) ownerAddress = argv[++i]!;
  }
  return { baseUrl, ownerAddress };
}

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

function sub(t: string): DocToken {
  return { kind: "subheading", text: t };
}

function br(): DocToken {
  return { kind: "break" };
}

interface RecipientConfig {
  name: string;
  xHandle: string;
  outputFile: string;
}

const RECIPIENTS: RecipientConfig[] = [
  { name: "paperd", xHandle: "paperdstudio", outputFile: "nda-paperd.json" },
  {
    name: "superpot",
    xHandle: "superpotsecret",
    outputFile: "nda-superpot.json",
  },
  { name: "kthings", xHandle: "_Kthings", outputFile: "nda-kthings.json" },
];

function buildPartiesAndVerificationTokens(): DocToken[] {
  return [
    heading("MUTUAL NON-DISCLOSURE AND CONFIDENTIALITY AGREEMENT", 1),
    br(),
    text("Effective Date: April 2, 2026"),
    br(),
    br(),
    text('This Non-Disclosure and Confidentiality Agreement ("Agreement") is entered into by and between:'),
    br(),
    br(),
    text("DISCLOSING PARTY:"),
    br(),
    text("Full Legal Name: "),
    field("fullname-discloser", "full-name", "Discloser Full Legal Name", 1, {
      placeholder: "Enter your full legal name",
    }),
    br(),
    text('Known as: R4vonus ("Discloser")'),
    br(),
    br(),
    text("RECEIVING PARTY:"),
    br(),
    text("Full Legal Name: "),
    field("fullname-recipient", "full-name", "Recipient Full Legal Name", 0, {
      placeholder: "Enter your full legal name",
    }),
    br(),
    text('Known as: [see X verification below] ("Recipient")'),
    br(),
    br(),
    heading("1. IDENTITY VERIFICATION", 2),
    br(),
    text(
      "Each party shall verify their identity via X (Twitter) OAuth authentication. Verification is cryptographically locked to the specific accounts listed below. Authentication with any other account will be rejected.",
    ),
    br(),
    br(),
    text("Discloser X Verification: "),
    field("x-verify-discloser", "x-verify", "X Account (R4vonus)", 1, {
      placeholder: "Verify as @R4vonus",
      settings: { requiredUsername: "R4vonus" },
    }),
    br(),
    text("Recipient X Verification: "),
    field("x-verify-recipient", "x-verify", "Recipient X Account", 0, {
      placeholder: "Verify your X account",
    }),
    br(),
    br(),
    heading("2. PURPOSE", 2),
    br(),
    text(
      "The Discloser intends to share certain proprietary and confidential information with the Recipient for the purposes of evaluation, potential collaboration, strategic partnership, investment discussions, and/or business development. This Agreement governs the treatment of all such information.",
    ),
    br(),
    br(),
  ];
}

function buildDefinitionTokens(): DocToken[] {
  return [
    heading("3. DEFINITION OF CONFIDENTIAL INFORMATION", 2),
    br(),
    text(
      '"Confidential Information" means any and all non-public information disclosed by the Discloser to the Recipient, whether orally, in writing, electronically, visually, or by any other means, including but not limited to:',
    ),
    br(),
    br(),
    text(
      "(a) TECHNOLOGY AND SOURCE CODE — All software, source code, object code, algorithms, data structures, system architectures, infrastructure configurations, deployment pipelines, API designs, database schemas, smart contracts, cryptographic implementations, SDKs, developer tooling, and any technical documentation or specifications related thereto.",
    ),
    br(),
    br(),
    text(
      "(b) PITCH DECKS AND PRESENTATIONS — All slide decks, investor presentations, demo recordings, product walkthroughs, competitive analyses, market research, financial models, revenue projections, fundraising materials, term sheets, valuation documents, and any supporting materials or talking points.",
    ),
    br(),
    br(),
    text(
      "(c) BUSINESS STRATEGY — All product roadmaps, go-to-market plans, launch timelines, pricing strategies, partnership pipelines, customer lists, vendor agreements, licensing terms, tokenomics designs, distribution strategies, and any other strategic planning materials.",
    ),
    br(),
    br(),
    text(
      "(d) INTELLECTUAL PROPERTY — All inventions, trade secrets, patent applications (filed or contemplated), trademark registrations, domain portfolios, design systems, brand guidelines, content strategies, and proprietary methodologies including AI-assisted development techniques.",
    ),
    br(),
    br(),
    text(
      "(e) COMMUNICATIONS — All emails, messages, calls, meeting notes, shared documents, whiteboard sessions, and verbal discussions in which Confidential Information is conveyed or referenced.",
    ),
    br(),
    br(),
    text(
      "(f) DERIVATIVE OBSERVATIONS — Any insights, conclusions, analyses, or derivative works that the Recipient produces based on access to Confidential Information, whether or not such derivatives directly reproduce the underlying information.",
    ),
    br(),
    br(),
    text(
      "Confidential Information shall be deemed confidential regardless of whether it is marked as such. Information conveyed orally or visually shall be treated as confidential if a reasonable person in the Recipient's position would understand it to be non-public.",
    ),
    br(),
    br(),
    text("Recipient Initials: "),
    field("initials-def-r", "initials", "Initials", 0, {
      placeholder: "Initials",
    }),
    br(),
    text("Discloser Initials: "),
    field("initials-def-d", "initials", "Initials", 1, {
      placeholder: "Initials",
    }),
    br(),
    br(),
  ];
}

function buildObligationsAndDisclosureTokens(): DocToken[] {
  return [
    heading("4. OBLIGATIONS OF THE RECIPIENT", 2),
    br(),
    text("The Recipient agrees to the following:"),
    br(),
    br(),
    text(
      "4.1 NON-DISCLOSURE — The Recipient shall not disclose, publish, transmit, post, or otherwise make available any Confidential Information to any third party by any means — including but not limited to social media, messaging platforms, group chats, podcasts, blog posts, conference talks, investor conversations, or casual discussion — without the prior express written consent of the Discloser.",
    ),
    br(),
    br(),
    text(
      "4.2 NON-USE — The Recipient shall not use any Confidential Information for any purpose other than the evaluation and furtherance of the business relationship between the parties. The Recipient shall not use Confidential Information to develop, pitch, fund, advise on, or contribute to any competing product, service, or venture.",
    ),
    br(),
    br(),
    text(
      "4.3 STANDARD OF CARE — The Recipient shall protect Confidential Information using at least the same degree of care it uses to protect its own most sensitive proprietary information, and in no event less than a reasonable standard of care. The Recipient shall restrict access to Confidential Information solely to individuals within its organization who have a legitimate need to know and who are bound by confidentiality obligations no less restrictive than those contained herein.",
    ),
    br(),
    br(),
    text(
      "4.4 NO REVERSE ENGINEERING — The Recipient shall not reverse engineer, decompile, disassemble, or otherwise attempt to derive the source code, architecture, algorithms, or design of any software, platform, or system disclosed or demonstrated by the Discloser.",
    ),
    br(),
    br(),
    text(
      "4.5 NO REPRODUCTION — The Recipient shall not copy, clone, recreate, or produce derivative works based on any disclosed technology, user interfaces, design systems, or business models.",
    ),
    br(),
    br(),
    text(
      "4.6 NO RECORDING — The Recipient shall not photograph, screenshot, screen-record, or capture audio or video of any demonstrations, presentations, or shared materials unless the Discloser provides explicit written permission.",
    ),
    br(),
    br(),
    text("Recipient Initials: "),
    field("initials-oblig-r", "initials", "Initials", 0, {
      placeholder: "Initials",
    }),
    br(),
    br(),
    heading("5. AUTHORIZED DISCLOSURE AND DELEGATION", 2),
    br(),
    text(
      "5.1 DISCLOSER-DIRECTED SHARING — Notwithstanding Section 4.1, the Recipient may disclose specific Confidential Information to designated third parties if and only if the Discloser has provided express written instruction to do so. Such instruction must identify: (a) the specific information to be disclosed, (b) the identity of the third party or parties, and (c) the purpose for which the disclosure is authorized.",
    ),
    br(),
    br(),
    text(
      "5.2 SCOPE OF AUTHORIZATION — Any authorized disclosure shall be limited strictly to the scope defined in the Discloser's written instruction. The Recipient shall not disclose any Confidential Information beyond what has been expressly authorized, and shall not editorialize, supplement, or interpret the information unless instructed to do so.",
    ),
    br(),
    br(),
    text(
      "5.3 AGENCY CAPACITY — When acting on the Discloser's instruction to share information with third parties, the Recipient is acting as an authorized agent of the Discloser. The Recipient shall ensure that any third party receiving Confidential Information under this section is made aware that the information is confidential and proprietary. Where practicable, the Recipient shall require the third party to execute a confidentiality agreement before disclosure.",
    ),
    br(),
    br(),
    text(
      "5.4 RECORD-KEEPING — The Recipient shall maintain a record of all authorized disclosures made under this section, including the date, the recipient third party, the information disclosed, and the Discloser's authorizing instruction. This record shall be made available to the Discloser upon request.",
    ),
    br(),
    br(),
    text(
      "5.5 REVOCATION — The Discloser may revoke any authorization granted under this section at any time by written notice. Upon revocation, the Recipient shall immediately cease further disclosure of the relevant information to the specified third party.",
    ),
    br(),
    br(),
    text("I acknowledge and accept the Authorized Disclosure terms: "),
    field("ack-auth-disclosure-r", "acknowledge-checkbox", "I acknowledge the authorized disclosure terms", 0, {
      placeholder: "I acknowledge",
    }),
    br(),
    br(),
  ];
}

function buildLegalAndSignatureTokens(): DocToken[] {
  return [
    heading("6. EXCLUSIONS FROM CONFIDENTIAL INFORMATION", 2),
    br(),
    text("Confidential Information does not include information that:"),
    br(),
    br(),
    text("(a) Is or becomes publicly available through no fault, act, or omission of the Recipient;"),
    br(),
    text(
      "(b) Was demonstrably in the Recipient's possession prior to disclosure by the Discloser, as established by written records predating this Agreement;",
    ),
    br(),
    text(
      "(c) Is independently developed by the Recipient without reference to, use of, or reliance on the Confidential Information, as demonstrated by contemporaneous documentation;",
    ),
    br(),
    text("(d) Is disclosed with the prior express written consent of the Discloser; or"),
    br(),
    text(
      "(e) Is required to be disclosed by applicable law, regulation, or valid court order, provided the Recipient: (i) gives the Discloser prompt written notice, (ii) cooperates with any effort to obtain protective treatment, and (iii) discloses only the minimum information legally required.",
    ),
    br(),
    br(),
    text(
      "For the avoidance of doubt: public release of any open-source component does NOT declassify associated business strategies, premium features, unpublished roadmap items, pitch materials, financial data, or any other Confidential Information not contained within the specific code released under an OSS license.",
    ),
    br(),
    br(),
    heading("7. TERM AND SURVIVAL", 2),
    br(),
    text(
      "7.1 This Agreement shall remain in effect for a period of five (5) years from the Effective Date, unless earlier terminated by mutual written agreement of the parties.",
    ),
    br(),
    br(),
    text(
      "7.2 The Recipient's obligations of confidentiality and non-use shall survive expiration or termination of this Agreement and shall continue for as long as the Confidential Information retains its confidential character and has not been made publicly available by the Discloser.",
    ),
    br(),
    br(),
    heading("8. RETURN AND DESTRUCTION OF MATERIALS", 2),
    br(),
    text(
      "Upon written request by the Discloser, or upon expiration or termination of this Agreement, the Recipient shall within five (5) business days: (a) return all documents, files, materials, devices, and media containing Confidential Information; (b) permanently delete all electronic copies from all devices, cloud storage, email archives, and backup systems; and (c) provide a signed written certification confirming that all such materials have been returned or destroyed and that no copies have been retained.",
    ),
    br(),
    br(),
    heading("9. REMEDIES AND ENFORCEMENT", 2),
    br(),
    text(
      "9.1 The Recipient acknowledges that any breach or threatened breach of this Agreement may cause the Discloser immediate and irreparable harm for which monetary damages would be insufficient. The Discloser shall be entitled to seek injunctive and equitable relief — including temporary restraining orders, preliminary and permanent injunctions, and specific performance — in addition to all remedies available at law, without the requirement of posting bond or proving actual damages.",
    ),
    br(),
    br(),
    text(
      "9.2 In the event of a breach, the Recipient shall be liable for all reasonable attorneys' fees, litigation costs, and expenses incurred by the Discloser in enforcing this Agreement.",
    ),
    br(),
    br(),
    text(
      "9.3 The Discloser's document signing platform captures forensic evidence including device fingerprints, behavioral biometrics, IP geolocation data, and timestamped cryptographic proofs. This evidence is admissible and may be used in any legal proceeding arising from or relating to this Agreement.",
    ),
    br(),
    br(),
    heading("10. NO LICENSE OR RIGHTS GRANTED", 2),
    br(),
    text(
      "Nothing in this Agreement grants the Recipient any license, right, title, or interest in or to any of the Discloser's intellectual property, technology, products, trademarks, or business assets. No joint venture, partnership, employment, or agency relationship is created by this Agreement except as expressly set forth in Section 5.",
    ),
    br(),
    br(),
    heading("11. GOVERNING LAW AND JURISDICTION", 2),
    br(),
    text(
      "This Agreement shall be governed by and construed in accordance with the laws of the jurisdiction in which the Discloser resides, without regard to conflict-of-law principles. Any dispute arising out of or relating to this Agreement shall be subject to the exclusive jurisdiction of the state and federal courts located in the Discloser's jurisdiction of residence.",
    ),
    br(),
    br(),
  ];
}

function buildGeneralProvisionsAndSignatureTokens(): DocToken[] {
  return [
    heading("12. GENERAL PROVISIONS", 2),
    br(),
    text(
      "12.1 ENTIRE AGREEMENT — This Agreement constitutes the entire understanding between the parties with respect to the subject matter hereof and supersedes all prior or contemporaneous agreements, discussions, and representations, whether written or oral.",
    ),
    br(),
    br(),
    text(
      "12.2 AMENDMENTS — No amendment, modification, or waiver of any provision of this Agreement shall be effective unless set forth in a written instrument signed by both parties.",
    ),
    br(),
    br(),
    text(
      "12.3 SEVERABILITY — If any provision of this Agreement is held to be invalid or unenforceable, the remaining provisions shall remain in full force and effect. The invalid provision shall be reformed to the minimum extent necessary to make it valid and enforceable while preserving the parties' original intent.",
    ),
    br(),
    br(),
    text(
      "12.4 NO WAIVER — Failure by either party to enforce any provision of this Agreement shall not constitute a waiver of that provision or the right to enforce it in the future.",
    ),
    br(),
    br(),
    text(
      "12.5 ASSIGNMENT — The Recipient may not assign or transfer any rights or obligations under this Agreement without the Discloser's prior written consent. Any attempted assignment without consent is void.",
    ),
    br(),
    br(),
    text(
      "12.6 BLOCKCHAIN ANCHORING — Upon full execution, a cryptographic hash of this Agreement and all signatures will be anchored to one or more public blockchains, creating an immutable and independently verifiable record of existence and execution.",
    ),
    br(),
    br(),
    text("Recipient Initials: "),
    field("initials-general-r", "initials", "Initials", 0, {
      placeholder: "Initials",
    }),
    br(),
    text("Discloser Initials: "),
    field("initials-general-d", "initials", "Initials", 1, {
      placeholder: "Initials",
    }),
    br(),
    br(),
    heading("EXECUTION", 2),
    br(),
    text(
      "IN WITNESS WHEREOF, the parties have executed this Non-Disclosure and Confidentiality Agreement as of the Effective Date. Each party's execution is evidenced by their verified identity, full legal name, and cryptographic signature.",
    ),
    br(),
    br(),
    text("DISCLOSING PARTY"),
    br(),
    text("Full Legal Name: "),
    field("sig-fullname-discloser", "full-name", "Discloser Full Legal Name", 1, { placeholder: "Full legal name" }),
    br(),
    text("X Username: "),
    field("sig-x-discloser", "twitter-handle", "X Username", 1, {
      placeholder: "@R4vonus",
    }),
    br(),
    text("Date: "),
    field("date-discloser", "date", "Date", 1, { placeholder: "Signing Date" }),
    br(),
    sig("Discloser Signature", 1),
    br(),
    br(),
    text("RECEIVING PARTY"),
    br(),
    text("Full Legal Name: "),
    field("sig-fullname-recipient", "full-name", "Recipient Full Legal Name", 0, { placeholder: "Full legal name" }),
    br(),
    text("X Username: "),
    field("sig-x-recipient", "twitter-handle", "X Username", 0, {
      placeholder: `@${recipient.xHandle}`,
    }),
    br(),
    text("Date: "),
    field("date-recipient", "date", "Date", 0, { placeholder: "Signing Date" }),
    br(),
    sig("Recipient Signature", 0),
    br(),
  ];
}

function buildContent(): string {
  const tokens: DocToken[] = [
    ...buildPartiesAndVerificationTokens(),
    ...buildDefinitionTokens(),
    ...buildObligationsAndDisclosureTokens(),
    ...buildLegalAndSignatureTokens(),
    ...buildGeneralProvisionsAndSignatureTokens(),
  ];
  return tokensToContent(tokens);
}

async function main() {
  const { baseUrl, ownerAddress } = parseArgs(process.argv.slice(2));
  const apiKey = process.env.AUTOMATION_SECRET;

  console.log(`Creating partner NDA contracts (document group)...`);
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

  await mkdir(OUTPUT_DIR, { recursive: true });

  // Content is identical for all contracts — recipient-specific settings
  // (like requiredUsername for X verification) come from the signer's fields
  // metadata, not the document content. This lets the discloser sign once
  // and have the signature propagate to all siblings.
  const content = buildContent();

  const result = await trpc.document.createGroup.mutate({
    title: "Non-Disclosure Agreement",
    content,
    createdByEmail: "",
    proofMode: "HYBRID",
    signingOrder: "parallel",
    gazeTracking: "off",
    expiresInDays: 90,
    postSignReveal: {
      enabled: true,
      summary:
        "Thank you for signing. The following confidential documents are now available for your review. These materials are covered by the NDA you just executed — do not share them without express authorization from the Discloser.",
      sections: [
        {
          title: "Access Granted",
          content:
            "You now have download access to the Agorix documentation package, including the protocol specification, investor deck, assumptions memo, partner intro, and pitch deck. All documents are confidential and subject to the terms of this Agreement.",
        },
      ],
      downloads: [
        {
          label: "Pitch Deck",
          filename: "pitch-deck.pdf",
          description: "High-level pitch deck",
        },
        {
          label: "Agorix Investor Deck",
          filename: "agorix-investor-deck.pdf",
          description: "Investor presentation for Agorix protocol",
        },
        {
          label: "Agorix Protocol Documentation",
          filename: "agorix-protocol-documentation.pdf",
          description: "Full technical protocol specification",
        },
        {
          label: "Agorix Assumptions Memo",
          filename: "agorix-assumptions-memo.pdf",
          description: "Key assumptions and market analysis",
        },
        {
          label: "Agorix Partner Intro",
          filename: "agorix-partner-intro.pdf",
          description: "Partnership overview and integration guide",
        },
      ],
    },
    // The discloser signs once — propagates to all contracts in the group
    discloser: {
      label: "Discloser (R4vonus)",
      email: "",
      signMethod: "WALLET",
      fields: [
        { type: "full-name", label: "Full Legal Name", required: true },
        {
          type: "x-verify",
          label: "X Account (R4vonus)",
          required: true,
          settings: { requiredUsername: "R4vonus" },
        },
        { type: "initials", label: "Initials", required: true },
        { type: "twitter-handle", label: "X Username", required: true },
        { type: "date", label: "Date", required: true },
        { type: "signature", label: "Signature", required: true },
      ],
    },
    // One contract per recipient — each with its own content
    recipients: RECIPIENTS.map((r) => ({
      label: `Recipient (${r.xHandle})`,
      email: "",
      signMethod: "WALLET" as const,
      role: "SIGNER" as const,
      fields: [
        { type: "full-name", label: "Full Legal Name", required: true },
        {
          type: "x-verify",
          label: `X Account (${r.xHandle})`,
          required: true,
          settings: { requiredUsername: r.xHandle },
        },
        { type: "initials", label: "Initials", required: true },
        {
          type: "acknowledge-checkbox",
          label: "I acknowledge the authorized disclosure terms",
          required: true,
        },
        { type: "twitter-handle", label: "X Username", required: true },
        { type: "date", label: "Date", required: true },
        { type: "signature", label: "Signature", required: true },
      ],
    })),
  });

  console.log(`\nGroup ID: ${result.groupId}`);
  console.log(`Created ${result.documents.length} contracts:\n`);

  const allOutput: Record<string, unknown> = {
    groupId: result.groupId,
    documents: [],
  };

  for (let i = 0; i < result.documents.length; i++) {
    const doc = result.documents[i]!;
    const recipient = RECIPIENTS[i]!;

    const docOutput = {
      documentId: doc.documentId,
      contentHash: doc.contentHash,
      recipient: recipient.name,
      signerLinks: doc.signerLinks,
    };
    (allOutput.documents as unknown[]).push(docOutput);

    const outputPath = resolve(OUTPUT_DIR, recipient.outputFile);
    await writeFile(outputPath, JSON.stringify(docOutput, null, 2));

    console.log(`── ${recipient.name} (@${recipient.xHandle}) ──`);
    console.log(`  Document ID: ${doc.documentId}`);
    for (const link of doc.signerLinks) {
      console.log(`  ${link.label}: ${link.signUrl}`);
    }
    console.log(`  Output: ${outputPath}`);
  }

  // Write combined output
  await writeFile(resolve(OUTPUT_DIR, "nda-group.json"), JSON.stringify(allOutput, null, 2));
  console.log(`\nSign any ONE discloser link — it auto-signs all ${result.documents.length} contracts.`);
}

main().catch((err) => {
  console.error("Failed to create NDAs:", err);
  process.exit(1);
});
