/**
 * Quick test: create a group contract with 1 discloser + 2 contractors.
 * Simple fields: full name + signature only.
 */

import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { tokensToContent, type DocToken } from "~/lib/document/document-tokens";
import type { AppRouter } from "~/server/api/root";

const text = (t: string): DocToken => ({ kind: "text", text: t });
const heading = (t: string, n: number): DocToken => ({ kind: "heading", text: t, sectionNum: n });
const br = (): DocToken => ({ kind: "break" });
const field = (id: string, type: string, label: string, idx: number, opts: Record<string, unknown> = {}): DocToken => ({
  kind: "field",
  field: { id, type, label, placeholder: (opts.placeholder as string) ?? label, signerIdx: idx, required: true },
});
const sig = (label: string, idx: number): DocToken => ({ kind: "signatureBlock", label, signerIdx: idx });

// signerIdx 0 = contractor (recipient), signerIdx 1 = discloser
// (createGroup puts recipient at idx 0, discloser at idx 1)
const tokens: DocToken[] = [
  heading("TEST CONTRACT", 1),
  br(),
  text("Effective Date: April 2, 2026"),
  br(),
  br(),
  text("This is a test contract between the Discloser and Contractor."),
  br(),
  br(),

  heading("PARTIES", 2),
  br(),
  text("Contractor Full Name: "),
  field("name-contractor", "full-name", "Contractor Name", 0, { placeholder: "Your full name" }),
  br(),
  br(),

  text("Discloser Full Name: "),
  field("name-discloser", "full-name", "Discloser Name", 1, { placeholder: "Your full name" }),
  br(),
  br(),

  heading("SIGNATURES", 2),
  br(),
  text("Contractor:"),
  br(),
  sig("Contractor Signature", 0),
  br(),
  br(),

  text("Discloser:"),
  br(),
  sig("Discloser Signature", 1),
  br(),
];

const content = tokensToContent(tokens);

const baseUrl = process.argv.includes("--base-url")
  ? process.argv[process.argv.indexOf("--base-url") + 1]!
  : "http://127.0.0.1:3100";

async function main() {
  const trpc = createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        headers: {
          "x-api-key": process.env.AUTOMATION_SECRET ?? "",
          "x-wallet-address": "0x0000000000000000000000000000000000000001",
          "x-wallet-chain": "ETH",
        },
      }),
    ],
  });

  const result = await trpc.document.createGroup.mutate({
    title: "Test Contract",
    content,
    proofMode: "HYBRID",
    gazeTracking: "off",
    expiresInDays: 30,
    discloser: {
      label: "Discloser (R4vonus)",
      email: "chad@technomancy.it",
      signMethod: "WALLET",
      fields: [
        { type: "full-name", label: "Discloser Name", required: true },
        { type: "signature", label: "Signature", required: true },
      ],
    },
    recipients: [
      {
        label: "Contractor 1",
        email: "",
        signMethod: "WALLET",
        role: "SIGNER",
        fields: [
          { type: "full-name", label: "Contractor 1 Name", required: true },
          { type: "signature", label: "Signature", required: true },
        ],
      },
      {
        label: "Contractor 2",
        email: "",
        signMethod: "WALLET",
        role: "SIGNER",
        fields: [
          { type: "full-name", label: "Contractor 2 Name", required: true },
          { type: "signature", label: "Signature", required: true },
        ],
      },
    ],
  });

  console.log(`Group ID: ${result.groupId}\n`);
  for (const doc of result.documents) {
    console.log(`── ${doc.recipientLabel} ──`);
    console.log(`  Doc ID: ${doc.documentId}`);
    for (const link of doc.signerLinks) {
      console.log(`  ${link.label}: ${link.signUrl}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
