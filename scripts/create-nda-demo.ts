/**
 * Create NDA demo contract for tech demo with X/Twitter-locked social verification.
 *
 * Usage:
 *   npx tsx scripts/create-nda-demo.ts
 *   npx tsx scripts/create-nda-demo.ts --base-url https://your-domain.com
 */

import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import superjson from "superjson";
import type { AppRouter } from "~/server/api/root";
import { buildNdaDemoContent } from "./nda-demo-content";

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

  const content = buildNdaDemoContent();

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
          {
            type: "x-verify",
            label: "X Account (superpotsecret)",
            required: true,
            settings: { requiredUsername: "superpotsecret" },
          },
          { type: "initials", label: "Initials", required: true },
          { type: "full-name", label: "Full Name", required: true },
          { type: "date", label: "Date", required: true },
          {
            type: "acknowledge-checkbox",
            label: "I acknowledge the demo scope",
            required: true,
          },
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
          {
            type: "x-verify",
            label: "X Account (_Kthings)",
            required: true,
            settings: { requiredUsername: "_Kthings" },
          },
          { type: "initials", label: "Initials", required: true },
          { type: "full-name", label: "Full Name", required: true },
          { type: "date", label: "Date", required: true },
          {
            type: "acknowledge-checkbox",
            label: "I acknowledge the demo scope",
            required: true,
          },
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
          {
            type: "x-verify",
            label: "X Account (paperdstudio)",
            required: true,
            settings: { requiredUsername: "paperdstudio" },
          },
          { type: "initials", label: "Initials", required: true },
          { type: "full-name", label: "Full Name", required: true },
          { type: "date", label: "Date", required: true },
          {
            type: "acknowledge-checkbox",
            label: "I acknowledge the demo scope",
            required: true,
          },
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
          {
            type: "x-verify",
            label: "X Account (R4vonus)",
            required: true,
            settings: { requiredUsername: "R4vonus" },
          },
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
