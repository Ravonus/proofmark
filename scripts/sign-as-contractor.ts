/**
 * Sign test contracts as contractors using generated ETH wallets.
 */

import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { AppRouter } from "~/server/api/root";

const baseUrl = "http://127.0.0.1:3100";

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

const CONTRACTORS = [
  {
    docId: "KWk6kh5rBsPu3T6u",
    claim: "97hUd6P87dWQYzJKb8Bcaa-AtsOtUZt7",
    name: "Alice Johnson",
  },
  {
    docId: "yL1j2fl63gPJ3afF",
    claim: "-1EQWR3AlU4T_7TwlOIOo5wEjLtPbY4U",
    name: "Bob Smith",
  },
];

async function main() {
  for (const c of CONTRACTORS) {
    console.log(`\nSigning as ${c.name} on doc ${c.docId}...`);

    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const address = account.address;
    console.log(`  Wallet: ${address}`);

    // Get signing message from server
    let serverMsg;
    try {
      serverMsg = await trpc.document.getSigningMessage.mutate({
        documentId: c.docId,
        claimToken: c.claim,
        signerAddress: address,
        chain: "ETH",
        fieldValues: { "name-contractor": c.name },
      });
      console.log(`  Got signing message`);
    } catch (e) {
      console.error(`  getSigningMessage failed:`, (e as Error).message);
      continue;
    }

    // Sign the message with viem (same as browser wallets)
    const signature = await account.signMessage({ message: serverMsg.message });
    console.log(`  Signed message`);

    // Submit the signature
    try {
      const result = await trpc.document.sign.mutate({
        documentId: c.docId,
        claimToken: c.claim,
        signerAddress: address,
        chain: "ETH",
        signature,
        fieldValues: { "name-contractor": c.name },
        forensic: {
          fingerprint: {
            visitorId: `test-${c.name}`,
            canvasHash: "test",
            webglHash: "test",
          } as Record<string, unknown>,
          behavioral: {
            timeOnPage: 30000,
            scrolledToBottom: true,
            maxScrollDepth: 100,
            mouseMoveCount: 50,
            clickCount: 10,
            keyPressCount: 20,
          } as Record<string, unknown>,
        },
        challengeResponses: {},
      });
      console.log(`  Done! allSigned=${result.allSigned}`);
    } catch (e) {
      console.error(`  sign failed:`, (e as Error).message);
    }
  }

  console.log("\nBoth contractors signed. Discloser should receive finalization email.");
}

main().catch(console.error);
