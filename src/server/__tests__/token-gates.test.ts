import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as verifyLib from "~/lib/signing/verify";
import { evaluateSignerTokenGate, evaluateSignerTokenGateWithProofs } from "~/server/token-gates";

const BTC_WALLET = "bc1ptestwallet000000000000000000000000000000000000000000000000000";
const OTHER_BTC_WALLET = "bc1potherwallet0000000000000000000000000000000000000000000000000";
const INSCRIPTION_ID = "8845b355bee398ac83ddfe9b92f33ccf9318089221835e879f074493f9206ccbi0";

const ORIGINAL_ORD_RPC_URL = process.env.ORD_RPC_URL;
const ORIGINAL_ORDINALS_BASE_URL = process.env.ORDINALS_BASE_URL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html",
    },
  });
}

describe("BTC token gates", () => {
  beforeEach(() => {
    delete process.env.ORD_RPC_URL;
    delete process.env.ORDINALS_BASE_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (ORIGINAL_ORD_RPC_URL) process.env.ORD_RPC_URL = ORIGINAL_ORD_RPC_URL;
    else delete process.env.ORD_RPC_URL;

    if (ORIGINAL_ORDINALS_BASE_URL) process.env.ORDINALS_BASE_URL = ORIGINAL_ORDINALS_BASE_URL;
    else delete process.env.ORDINALS_BASE_URL;

    if (ORIGINAL_NODE_ENV) (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL_NODE_ENV;
    else delete (process.env as Record<string, string | undefined>).NODE_ENV;
  });

  it("uses ORD_RPC_URL for inscription ownership when configured", async () => {
    process.env.ORD_RPC_URL = "http://ord.local";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url === `http://ord.local/inscription/${INSCRIPTION_ID}`) {
        return jsonResponse({
          id: INSCRIPTION_ID,
          address: BTC_WALLET,
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const evaluation = await evaluateSignerTokenGate({
      gate: {
        mode: "ALL",
        devBypass: false,
        rules: [
          {
            chain: "BTC",
            type: "ORDINAL",
            identifierType: "INSCRIPTION_ID",
            identifier: INSCRIPTION_ID,
          },
        ],
      },
      address: BTC_WALLET,
      chain: "BTC",
    });

    expect(evaluation?.status).toBe("eligible");
    expect(evaluation?.rules[0]?.status).toBe("passed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to ordinals.com for inscription ownership when no ord server is set", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url === `https://ordinals.com/inscription/${INSCRIPTION_ID}`) {
        return htmlResponse(`
          <main>
            <dl>
              <dt>address</dt>
              <dd><a class="collapse" href="/address/${OTHER_BTC_WALLET}">${OTHER_BTC_WALLET}</a></dd>
            </dl>
          </main>
        `);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const evaluation = await evaluateSignerTokenGate({
      gate: {
        mode: "ALL",
        devBypass: false,
        rules: [
          {
            chain: "BTC",
            type: "ORDINAL",
            identifierType: "INSCRIPTION_ID",
            identifier: INSCRIPTION_ID,
          },
        ],
      },
      address: BTC_WALLET,
      chain: "BTC",
    });

    expect(evaluation?.status).toBe("ineligible");
    expect(evaluation?.rules[0]?.message).toContain(OTHER_BTC_WALLET);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to ordinals.com scraping when ORD_RPC_URL misses the inscription", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url === `http://ord.local/inscription/${INSCRIPTION_ID}`) {
        return jsonResponse({ error: "not found" }, 404);
      }

      if (url === `https://ordinals.com/inscription/${INSCRIPTION_ID}`) {
        return htmlResponse(`
          <main>
            <dl>
              <dt>address</dt>
              <dd><a class="collapse" href="/address/${BTC_WALLET}">${BTC_WALLET}</a></dd>
            </dl>
          </main>
        `);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    process.env.ORD_RPC_URL = "http://ord.local";

    const evaluation = await evaluateSignerTokenGate({
      gate: {
        mode: "ALL",
        devBypass: false,
        rules: [
          {
            chain: "BTC",
            type: "ORDINAL",
            identifierType: "INSCRIPTION_ID",
            identifier: INSCRIPTION_ID,
          },
        ],
      },
      address: BTC_WALLET,
      chain: "BTC",
    });

    expect(evaluation?.status).toBe("eligible");
    expect(evaluation?.rules[0]?.status).toBe("passed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to ordinals.com scraping for rune balances", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url === "https://ordinals.com/rune/UNCOMMONGOODS") {
        return htmlResponse(`
          <main>
            <h1>UNCOMMONGOODS</h1>
            <dl>
              <dt>divisibility</dt>
              <dd>2</dd>
            </dl>
          </main>
        `);
      }

      if (url === `https://ordinals.com/address/${encodeURIComponent(BTC_WALLET)}`) {
        return htmlResponse(`
          <main>
            <dl>
              <dt>rune balances</dt>
              <dd><a class="monospace" href="/rune/UNCOMMONGOODS">UNCOMMONGOODS</a>: 12.50</dd>
            </dl>
          </main>
        `);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const evaluation = await evaluateSignerTokenGate({
      gate: {
        mode: "ALL",
        devBypass: false,
        rules: [
          {
            chain: "BTC",
            type: "RUNE",
            identifier: "UNCOMMONGOODS",
            minAmount: "10",
          },
        ],
      },
      address: BTC_WALLET,
      chain: "BTC",
    });

    expect(evaluation?.status).toBe("eligible");
    expect(evaluation?.rules[0]?.actualValue).toBe("12.50 UNCOMMONGOODS");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("marks ordinal collection rules as unavailable", async () => {
    const evaluation = await evaluateSignerTokenGate({
      gate: {
        mode: "ALL",
        devBypass: false,
        rules: [
          {
            chain: "BTC",
            type: "ORDINAL",
            identifierType: "COLLECTION_ID",
            identifier: "test-collection",
          },
        ],
      },
      address: BTC_WALLET,
      chain: "BTC",
    });

    expect(evaluation?.status).toBe("unavailable");
    expect(evaluation?.rules[0]?.status).toBe("unavailable");
    expect(evaluation?.rules[0]?.message).toContain("specific inscription ID");
  });

  it("requires every chain wallet proof before a mixed-chain dev-bypass gate can pass", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    vi.spyOn(verifyLib, "verifySignature").mockResolvedValue({
      ok: true,
      scheme: "BIP322_P2TR",
      debug: [],
    });

    const evaluation = await evaluateSignerTokenGateWithProofs({
      gate: {
        mode: "ALL",
        devBypass: true,
        rules: [
          {
            chain: "BTC",
            type: "ORDINAL",
            identifierType: "INSCRIPTION_ID",
            identifier: INSCRIPTION_ID,
          },
          {
            chain: "SOL",
            type: "SPL",
            mintAddress: "85USz2CkK2aADobUy7GkxmALiHaqdgUHGva1UAoVXUeT",
            minAmount: "1",
          },
        ],
      },
      documentId: "doc-proof-test",
      claimToken: "claim-proof-test",
      proofs: [
        {
          chain: "BTC",
          address: BTC_WALLET,
          signature: "btc-proof-signature",
        },
      ],
    });

    expect(evaluation?.status).toBe("ineligible");
    expect(evaluation?.summary).toContain("Solana wallet");
    expect(evaluation?.wallets.find((wallet) => wallet.chain === "BTC")?.status).toBe("verified");
    expect(evaluation?.wallets.find((wallet) => wallet.chain === "SOL")?.status).toBe("missing");
  });

  it("runs the live check and only then applies dev bypass when a verified wallet fails ownership", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";

    vi.spyOn(verifyLib, "verifySignature").mockResolvedValue({
      ok: true,
      scheme: "BIP322_P2TR",
      debug: [],
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);

      if (url === `https://ordinals.com/inscription/${INSCRIPTION_ID}`) {
        return htmlResponse(`
          <main>
            <dl>
              <dt>address</dt>
              <dd><a class="collapse" href="/address/${OTHER_BTC_WALLET}">${OTHER_BTC_WALLET}</a></dd>
            </dl>
          </main>
        `);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const evaluation = await evaluateSignerTokenGateWithProofs({
      gate: {
        mode: "ALL",
        devBypass: true,
        rules: [
          {
            chain: "BTC",
            type: "ORDINAL",
            identifierType: "INSCRIPTION_ID",
            identifier: INSCRIPTION_ID,
          },
        ],
      },
      documentId: "doc-proof-test",
      claimToken: "claim-proof-test",
      proofs: [
        {
          chain: "BTC",
          address: BTC_WALLET,
          signature: "btc-proof-signature",
        },
      ],
    });

    expect(evaluation?.status).toBe("eligible");
    expect(evaluation?.bypassed).toBe(true);
    expect(evaluation?.wallets[0]?.status).toBe("verified");
    expect(evaluation?.rules[0]?.status).toBe("passed");
    expect(evaluation?.rules[0]?.message).toContain("Development bypass approved after live check");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
