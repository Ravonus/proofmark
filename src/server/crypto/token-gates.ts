import { ethers } from "ethers";
import { Connection, PublicKey, type ParsedAccountData } from "@solana/web3.js";
import { CHAIN_META, normalizeAddress, type WalletChain } from "~/lib/crypto/chains";
import { verifySignature as verifyWalletSignature } from "~/lib/signing/verify";
import {
  buildTokenGateProofMessage,
  describeTokenGateRule,
  getSignerTokenGateChains,
  getTokenGateRuleLabel,
  normalizeSignerTokenGate,
  type ProofAwareTokenGateEvaluation,
  type SignerTokenGate,
  type TokenGateEvaluation,
  type TokenGateWalletProof,
  type TokenGateWalletVerification,
  type TokenGateRule,
  type TokenGateRuleEvaluation,
} from "~/lib/token-gates";

const ERC20_GATE_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

const ERC721_GATE_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
] as const;

const DEFAULT_ETH_RPC_URL = "https://ethereum-rpc.publicnode.com";
const DEFAULT_SOL_RPC_URL = "https://api.mainnet.solana.com";

type Erc20ReadContract = {
  balanceOf: (owner: string) => Promise<bigint>;
  decimals: () => Promise<number>;
  symbol: () => Promise<string>;
};

type Erc721ReadContract = {
  balanceOf: (owner: string) => Promise<bigint>;
  ownerOf: (tokenId: bigint) => Promise<string>;
};

type HttpError = Error & {
  status?: number;
};

type OrdConfig = {
  baseUrl: string;
};

type OrdInscriptionResponse = {
  id: string;
  address?: string | null;
};

type OrdAddressResponse = {
  runes_balances?: Array<[string, string, string?]>;
};

type OrdRuneResponse = {
  entry?: {
    divisibility?: number;
    spaced_rune?: string;
    symbol?: string | null;
  };
};

type RuneBalance = {
  amount: string;
  amountKind: "display" | "raw";
  name: string;
  symbol?: string | null;
};

type RuneMetadata = {
  divisibility: number;
  name: string;
  symbol?: string | null;
};

let cachedEthProvider: ethers.JsonRpcProvider | null | undefined;
let cachedSolConnection: Connection | null | undefined;
let cachedEthProviderUrl: string | null | undefined;
let cachedSolConnectionUrl: string | null | undefined;

function getEthRpcUrl(): string {
  return (
    process.env.ETH_RPC_URL?.trim() ||
    process.env.EVM_RPC_URL?.trim() ||
    process.env.ETH_API_URL?.trim() ||
    process.env.PUBLIC_ETH_RPC_URL?.trim() ||
    DEFAULT_ETH_RPC_URL
  );
}

function getSolRpcUrl(): string {
  return (
    process.env.SOL_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_SOL_RPC_URL?.trim() ||
    process.env.SOL_API_URL?.trim() ||
    process.env.PUBLIC_SOL_RPC_URL?.trim() ||
    DEFAULT_SOL_RPC_URL
  );
}

function getEthProvider(): ethers.JsonRpcProvider | null {
  const rpcUrl = getEthRpcUrl();
  if (cachedEthProvider !== undefined && cachedEthProviderUrl === rpcUrl) return cachedEthProvider;
  cachedEthProvider = rpcUrl ? new ethers.JsonRpcProvider(rpcUrl) : null;
  cachedEthProviderUrl = rpcUrl;
  return cachedEthProvider;
}

function getSolConnection(): Connection | null {
  const rpcUrl = getSolRpcUrl();
  if (cachedSolConnection !== undefined && cachedSolConnectionUrl === rpcUrl) return cachedSolConnection;
  cachedSolConnection = rpcUrl ? new Connection(rpcUrl, "confirmed") : null;
  cachedSolConnectionUrl = rpcUrl;
  return cachedSolConnection;
}

function getOrdConfig(): OrdConfig | null {
  const baseUrl =
    process.env.ORD_RPC_URL?.trim() || process.env.ORD_SERVER_URL?.trim() || process.env.BTC_ORD_RPC_URL?.trim();
  return baseUrl ? { baseUrl } : null;
}

function getOrdinalsBaseUrl(): string {
  return process.env.ORDINALS_BASE_URL?.trim() || "https://ordinals.com";
}

function isDevelopmentLike(): boolean {
  return process.env.NODE_ENV !== "production";
}

function createResult(
  status: TokenGateRuleEvaluation["status"],
  rule: TokenGateRule,
  message: string,
  values?: { expectedValue?: string; actualValue?: string },
): TokenGateRuleEvaluation {
  return {
    ruleId: rule.id,
    status,
    passed: status === "passed",
    message,
    expectedValue: values?.expectedValue,
    actualValue: values?.actualValue,
  };
}

function decimalStringToUnits(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  const [whole, fraction = ""] = normalized.split(".");
  const safeFraction = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(`${whole}${safeFraction}` || "0");
}

function formatUnits(value: bigint, decimals: number): string {
  if (decimals <= 0) return value.toString();
  const raw = value.toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function normalizeLooseIdentifier(value: string): string {
  return value.replace(/\s+/g, "").replace(/\./g, "").replace(/•/g, "").toUpperCase();
}

function isParsedTokenAccountData(value: unknown): value is ParsedAccountData {
  return !!value && typeof value === "object" && "parsed" in value;
}

function createHttpError(status: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
}

function isHttpErrorStatus(error: unknown, status: number): boolean {
  return !!error && typeof error === "object" && "status" in error && error.status === status;
}

function buildUrl(baseUrl: string, path: string): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), normalizedBase);
}

async function fetchResponse(url: URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonFromUrl<T>(url: URL, init?: RequestInit): Promise<T> {
  const response = await fetchResponse(url, init);
  if (!response.ok) {
    throw createHttpError(response.status, `Request to ${url.origin}${url.pathname} failed (${response.status}).`);
  }

  return (await response.json()) as T;
}

async function fetchTextFromUrl(url: URL, init?: RequestInit): Promise<string> {
  const response = await fetchResponse(url, init);
  if (!response.ok) {
    throw createHttpError(response.status, `Request to ${url.origin}${url.pathname} failed (${response.status}).`);
  }

  return await response.text();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseOrdinalsInscriptionAddressFromHtml(html: string): string | null {
  const match = /<dt>address<\/dt>\s*<dd><a[^>]*>([^<]+)<\/a><\/dd>/i.exec(html);
  return match ? decodeHtmlEntities(match[1] ?? "").trim() : null;
}

function parseOrdinalsAddressRuneBalances(html: string): RuneBalance[] {
  return Array.from(
    html.matchAll(
      /<dd><a[^>]*href=(?:"|')?\/rune\/[^"' >]+(?:"|')?[^>]*>([^<]+)<\/a>:\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*[^<]*<\/dd>/gi,
    ),
    (match) => ({
      amount: (match[2] ?? "0").replace(/,/g, ""),
      amountKind: "display" as const,
      name: decodeHtmlEntities(match[1] ?? "").trim(),
    }),
  );
}

function parseOrdinalsRuneMetadataFromHtml(html: string): RuneMetadata | null {
  const nameMatch = /<h1>([^<]+)<\/h1>/i.exec(html);
  const divisibilityMatch = /<dt>divisibility<\/dt>\s*<dd>(\d+)<\/dd>/i.exec(html);
  const symbolMatch = /<dt>symbol<\/dt>\s*<dd>([^<]*)<\/dd>/i.exec(html);

  if (!nameMatch || !divisibilityMatch) return null;

  return {
    divisibility: Number.parseInt(divisibilityMatch[1] ?? "0", 10),
    name: decodeHtmlEntities(nameMatch[1] ?? "").trim(),
    symbol: symbolMatch ? decodeHtmlEntities(symbolMatch[1] ?? "").trim() || null : null,
  };
}

function getRuneLookupCandidates(identifier: string): string[] {
  const trimmed = identifier.trim();
  const collapsed = trimmed.replace(/[.\s•]/g, "");
  return Array.from(new Set([trimmed, collapsed].filter(Boolean)));
}

function getFractionDigits(value: string): number {
  return value.split(".")[1]?.length ?? 0;
}

async function fetchOrdServerJson<T>(path: string): Promise<T> {
  const cfg = getOrdConfig();
  if (!cfg) {
    throw new Error("BTC token-gate verification needs ORD_RPC_URL or a public ordinals.com fallback.");
  }

  return await fetchJsonFromUrl<T>(buildUrl(cfg.baseUrl, path), {
    headers: {
      accept: "application/json",
    },
  });
}

async function lookupInscription(id: string): Promise<OrdInscriptionResponse | null> {
  let notFound = false;
  const failures: string[] = [];

  if (getOrdConfig()) {
    try {
      return await fetchOrdServerJson<OrdInscriptionResponse>(`/inscription/${encodeURIComponent(id)}`);
    } catch (error) {
      if (isHttpErrorStatus(error, 404)) {
        notFound = true;
      } else {
        failures.push(error instanceof Error ? error.message : "Unknown ord server error");
      }
    }
  }

  try {
    const html = await fetchTextFromUrl(buildUrl(getOrdinalsBaseUrl(), `/inscription/${encodeURIComponent(id)}`));
    const address = parseOrdinalsInscriptionAddressFromHtml(html);
    if (address) {
      return {
        id,
        address,
      };
    }
    failures.push("Could not parse the owner address from ordinals.com.");
  } catch (error) {
    if (isHttpErrorStatus(error, 404)) {
      notFound = true;
    } else {
      failures.push(error instanceof Error ? error.message : "Unknown ordinals.com scrape error");
    }
  }

  if (notFound) return null;
  throw new Error(failures[0] ?? "Ordinal ownership lookup failed.");
}

async function lookupAddressRunes(address: string): Promise<RuneBalance[]> {
  const failures: string[] = [];

  if (getOrdConfig()) {
    try {
      const response = await fetchOrdServerJson<OrdAddressResponse>(`/address/${encodeURIComponent(address)}`);
      return (response.runes_balances ?? []).map(([name, amount, symbol]) => ({
        amount,
        amountKind: "raw" as const,
        name,
        symbol,
      }));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Unknown ord server address lookup error");
    }
  }

  try {
    const html = await fetchTextFromUrl(buildUrl(getOrdinalsBaseUrl(), `/address/${encodeURIComponent(address)}`));
    return parseOrdinalsAddressRuneBalances(html);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "Unknown ordinals.com address scrape error");
  }

  throw new Error(failures[0] ?? "Rune balance lookup failed.");
}

async function lookupRuneMetadata(identifier: string): Promise<RuneMetadata | null> {
  const failures: string[] = [];
  const candidates = getRuneLookupCandidates(identifier);
  let notFound = false;

  if (getOrdConfig()) {
    for (const candidate of candidates) {
      try {
        const response = await fetchOrdServerJson<OrdRuneResponse>(`/rune/${encodeURIComponent(candidate)}`);
        return {
          divisibility: Number(response.entry?.divisibility ?? 0),
          name: response.entry?.spaced_rune ?? candidate,
          symbol: response.entry?.symbol ?? null,
        };
      } catch (error) {
        if (isHttpErrorStatus(error, 404)) {
          notFound = true;
          continue;
        }
        failures.push(error instanceof Error ? error.message : "Unknown ord server rune lookup error");
        break;
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const html = await fetchTextFromUrl(buildUrl(getOrdinalsBaseUrl(), `/rune/${encodeURIComponent(candidate)}`));
      const metadata = parseOrdinalsRuneMetadataFromHtml(html);
      if (metadata) return metadata;
      failures.push(`Could not parse rune metadata for ${candidate}.`);
    } catch (error) {
      if (isHttpErrorStatus(error, 404)) {
        notFound = true;
        continue;
      }
      failures.push(error instanceof Error ? error.message : "Unknown ordinals.com rune lookup error");
      break;
    }
  }

  if (notFound) return null;
  throw new Error(failures[0] ?? `Rune metadata lookup failed for ${identifier}.`);
}

async function getSolMintDecimals(connection: Connection, mint: PublicKey): Promise<number> {
  const accountInfo = await connection.getParsedAccountInfo(mint);
  const value = accountInfo.value;
  if (!value || !("data" in value) || !isParsedTokenAccountData(value.data)) {
    return 0;
  }

  const parsed = value.data.parsed as {
    info?: {
      decimals?: number;
    };
  };
  return Number(parsed.info?.decimals ?? 0);
}

async function evaluateErc20Rule(rule: Extract<TokenGateRule, { type: "ERC20" }>, address: string) {
  const provider = getEthProvider();
  if (!provider) {
    return createResult(
      "unavailable",
      rule,
      "ETH token-gate verification is not configured. Set ETH_RPC_URL or EVM_RPC_URL.",
    );
  }

  try {
    const contract = new ethers.Contract(
      rule.contractAddress,
      ERC20_GATE_ABI,
      provider,
    ) as unknown as Erc20ReadContract;
    const [balance, decimals, symbol] = await Promise.all([
      contract.balanceOf(address),
      contract.decimals().catch(() => 18),
      contract.symbol().catch(() => getTokenGateRuleLabel(rule)),
    ]);
    const required = decimalStringToUnits(rule.minAmount, Number(decimals));
    const actualFormatted = formatUnits(balance, Number(decimals));
    const expectedValue = `${rule.minAmount} ${symbol}`;
    const actualValue = `${actualFormatted} ${symbol}`;

    if (balance >= required) {
      return createResult("passed", rule, `Wallet holds ${actualValue}.`, { expectedValue, actualValue });
    }

    return createResult("failed", rule, `Wallet needs at least ${expectedValue}, but only holds ${actualValue}.`, {
      expectedValue,
      actualValue,
    });
  } catch (error) {
    return createResult(
      "unavailable",
      rule,
      `Could not verify ERC-20 balance for ${rule.contractAddress}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function evaluateErc721Rule(rule: Extract<TokenGateRule, { type: "ERC721" }>, address: string) {
  const provider = getEthProvider();
  if (!provider) {
    return createResult(
      "unavailable",
      rule,
      "ETH token-gate verification is not configured. Set ETH_RPC_URL or EVM_RPC_URL.",
    );
  }

  try {
    const contract = new ethers.Contract(
      rule.contractAddress,
      ERC721_GATE_ABI,
      provider,
    ) as unknown as Erc721ReadContract;

    if (rule.tokenId) {
      const owner = await contract.ownerOf(BigInt(rule.tokenId));
      const normalizedOwner = normalizeAddress("ETH", owner);
      const normalizedAddress = normalizeAddress("ETH", address);

      if (normalizedOwner === normalizedAddress) {
        return createResult("passed", rule, `Wallet owns ${getTokenGateRuleLabel(rule)}.`);
      }

      return createResult(
        "failed",
        rule,
        `Wallet does not own ${getTokenGateRuleLabel(rule)}. Current owner is ${owner}.`,
      );
    }

    const balance = await contract.balanceOf(address);
    const required = BigInt(Math.max(1, Number.parseInt(rule.minAmount || "1", 10)));
    if (balance >= required) {
      return createResult("passed", rule, `Wallet holds ${balance.toString()} NFT(s) from this collection.`, {
        expectedValue: `${required.toString()} NFT(s)`,
        actualValue: `${balance.toString()} NFT(s)`,
      });
    }

    return createResult(
      "failed",
      rule,
      `Wallet needs ${required.toString()} NFT(s) from this collection, but only holds ${balance.toString()}.`,
      {
        expectedValue: `${required.toString()} NFT(s)`,
        actualValue: `${balance.toString()} NFT(s)`,
      },
    );
  } catch (error) {
    return createResult(
      "unavailable",
      rule,
      `Could not verify ERC-721 ownership for ${rule.contractAddress}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function evaluateSplRule(rule: Extract<TokenGateRule, { type: "SPL" }>, address: string) {
  const connection = getSolConnection();
  if (!connection) {
    return createResult(
      "unavailable",
      rule,
      "Solana token-gate verification is not configured. Set SOL_RPC_URL or NEXT_PUBLIC_SOL_RPC_URL.",
    );
  }

  try {
    const owner = new PublicKey(address);
    const mint = new PublicKey(rule.mintAddress);
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, { mint });

    let balance = 0n;
    let decimals = 0;

    for (const account of tokenAccounts.value) {
      const data = account.account.data;
      if (!isParsedTokenAccountData(data)) continue;
      const parsed = data.parsed as {
        info?: {
          tokenAmount?: {
            amount?: string;
            decimals?: number;
          };
        };
      };
      const amount = parsed.info?.tokenAmount?.amount ?? "0";
      balance += BigInt(amount);
      decimals = Number(parsed.info?.tokenAmount?.decimals ?? decimals);
    }

    if (tokenAccounts.value.length === 0) {
      decimals = await getSolMintDecimals(connection, mint);
    }

    const required = decimalStringToUnits(rule.minAmount, decimals);
    const actualFormatted = formatUnits(balance, decimals);
    const expectedValue = `${rule.minAmount} ${getTokenGateRuleLabel(rule)}`;
    const actualValue = `${actualFormatted} ${getTokenGateRuleLabel(rule)}`;

    if (balance >= required) {
      return createResult("passed", rule, `Wallet holds ${actualValue}.`, { expectedValue, actualValue });
    }

    return createResult("failed", rule, `Wallet needs at least ${expectedValue}, but only holds ${actualValue}.`, {
      expectedValue,
      actualValue,
    });
  } catch (error) {
    return createResult(
      "unavailable",
      rule,
      `Could not verify SPL balance for ${rule.mintAddress}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function evaluateOrdinalRule(rule: Extract<TokenGateRule, { type: "ORDINAL" }>, address: string) {
  try {
    if (rule.identifierType === "COLLECTION_ID") {
      return createResult(
        "unavailable",
        rule,
        "Ordinal collection gates are not supported by ord/ordinals.com lookups yet. Use a specific inscription ID for now.",
      );
    }

    const inscription = await lookupInscription(rule.identifier);
    if (!inscription) {
      return createResult("failed", rule, `Ordinal ${rule.identifier} could not be found.`);
    }

    const normalizedOwner = inscription.address ? normalizeAddress("BTC", inscription.address) : null;
    const normalizedAddress = normalizeAddress("BTC", address);

    if (normalizedOwner === normalizedAddress) {
      return createResult("passed", rule, `Wallet owns ordinal ${rule.identifier}.`);
    }

    return createResult(
      "failed",
      rule,
      `Wallet does not own ordinal ${rule.identifier}. Current owner is ${inscription.address ?? "unknown"}.`,
    );
  } catch (error) {
    return createResult(
      "unavailable",
      rule,
      `Could not verify ordinal ownership: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function evaluateRuneRule(rule: Extract<TokenGateRule, { type: "RUNE" }>, address: string) {
  try {
    const metadata = await lookupRuneMetadata(rule.identifier);
    const balances = await lookupAddressRunes(address);
    const identifier = normalizeLooseIdentifier(rule.identifier);
    const match = balances.find((item) => {
      const normalizedName = normalizeLooseIdentifier(item.name);
      return (
        normalizedName === identifier || (metadata ? normalizedName === normalizeLooseIdentifier(metadata.name) : false)
      );
    });

    if (!metadata && !match) {
      return createResult("failed", rule, `Rune ${rule.identifier} could not be found.`);
    }

    const divisibility =
      metadata?.divisibility ?? Math.max(getFractionDigits(rule.minAmount), getFractionDigits(match?.amount ?? "0"));
    const actualUnits = match
      ? match.amountKind === "raw"
        ? BigInt(match.amount)
        : decimalStringToUnits(match.amount, divisibility)
      : 0n;
    const requiredUnits = decimalStringToUnits(rule.minAmount, divisibility);
    const runeName = metadata?.name ?? match?.name ?? rule.identifier;
    const actualAmount = match
      ? match.amountKind === "raw"
        ? formatUnits(BigInt(match.amount), divisibility)
        : match.amount
      : "0";
    const symbol = metadata?.symbol ?? match?.symbol ?? "";
    const symbolSuffix = symbol ? ` ${symbol}` : "";
    const expectedValue = `${rule.minAmount} ${runeName}${symbolSuffix}`;
    const actualValue = `${actualAmount} ${runeName}${symbolSuffix}`;

    if (match && actualUnits >= requiredUnits) {
      return createResult("passed", rule, `Wallet holds ${actualValue}.`, { expectedValue, actualValue });
    }

    return createResult("failed", rule, `Wallet needs at least ${expectedValue}, but only holds ${actualValue}.`, {
      expectedValue,
      actualValue,
    });
  } catch (error) {
    return createResult(
      "unavailable",
      rule,
      `Could not verify rune balance: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

async function evaluateRule(
  rule: TokenGateRule,
  address: string,
  chain: WalletChain,
): Promise<TokenGateRuleEvaluation> {
  if (rule.chain !== chain) {
    return createResult(
      "failed",
      rule,
      `This signer requires a ${rule.chain} wallet for ${describeTokenGateRule(rule)}.`,
    );
  }

  switch (rule.type) {
    case "ERC20":
      return evaluateErc20Rule(rule, address);
    case "ERC721":
      return evaluateErc721Rule(rule, address);
    case "SPL":
      return evaluateSplRule(rule, address);
    case "ORDINAL":
      return evaluateOrdinalRule(rule, address);
    case "RUNE":
      return evaluateRuneRule(rule, address);
  }
}

function finalizeEvaluation(
  gate: SignerTokenGate,
  address: string,
  chain: WalletChain,
  results: TokenGateRuleEvaluation[],
): TokenGateEvaluation {
  const passed = results.filter((result) => result.status === "passed");
  const failed = results.filter((result) => result.status === "failed");
  const unavailable = results.filter((result) => result.status === "unavailable");

  const eligible = gate.mode === "ALL" ? passed.length === results.length : passed.length > 0;

  let status: TokenGateEvaluation["status"];
  if (eligible) {
    status = "eligible";
  } else if (
    unavailable.length > 0 &&
    ((gate.mode === "ALL" && failed.length === 0) ||
      (gate.mode === "ANY" && failed.length + unavailable.length === results.length))
  ) {
    status = "unavailable";
  } else {
    status = "ineligible";
  }

  const summary =
    status === "eligible"
      ? `Eligible: wallet satisfies this signer's ${gate.mode === "ALL" ? "all" : "at least one"} token gate rule.`
      : status === "unavailable"
        ? (unavailable[0]?.message ?? "Token-gate verification is currently unavailable.")
        : (failed[0]?.message ?? "Wallet does not meet this signer's token gate requirements.");

  return {
    status,
    eligible,
    checkedAddress: normalizeAddress(chain, address),
    checkedChain: chain,
    checkedAt: new Date().toISOString(),
    mode: gate.mode,
    rules: results,
    summary,
  };
}

async function verifyTokenGateWalletProof(params: {
  documentId: string;
  claimToken: string;
  proof: TokenGateWalletProof;
}): Promise<TokenGateWalletVerification> {
  const chain = params.proof.chain;
  const address = normalizeAddress(chain, params.proof.address);
  const message = buildTokenGateProofMessage({
    documentId: params.documentId,
    claimToken: params.claimToken,
    chain,
    address,
  });
  const result = await verifyWalletSignature({
    chain,
    address,
    message,
    signature: params.proof.signature,
  });

  if (!result.ok) {
    return {
      chain,
      address,
      status: "failed",
      message: `Could not verify the ${CHAIN_META[chain].label} wallet proof.`,
      scheme: result.scheme,
    };
  }

  return {
    chain,
    address,
    status: "verified",
    message: `Verified ${CHAIN_META[chain].label} wallet ${address}.`,
    scheme: result.scheme,
  };
}

function createBypassedRuleResult(rule: TokenGateRule, actual: TokenGateRuleEvaluation): TokenGateRuleEvaluation {
  return {
    ...actual,
    ruleId: actual.ruleId ?? rule.id,
    status: "passed",
    passed: true,
    message: `Development bypass approved after live check: ${actual.message}`,
  };
}

export async function evaluateSignerTokenGateWithProofs(params: {
  gate: SignerTokenGate | null | undefined;
  documentId: string;
  claimToken: string;
  proofs: TokenGateWalletProof[];
}): Promise<ProofAwareTokenGateEvaluation | null> {
  const gate = normalizeSignerTokenGate(params.gate);
  if (!gate) return null;

  const proofMap = new Map<WalletChain, TokenGateWalletProof>();
  for (const proof of params.proofs) {
    proofMap.set(proof.chain, {
      ...proof,
      address: normalizeAddress(proof.chain, proof.address),
    });
  }

  const requiredChains = getSignerTokenGateChains(gate);
  const walletChecks: TokenGateWalletVerification[] = [];
  const verifiedWallets = new Map<WalletChain, string>();

  for (const chain of requiredChains) {
    const proof = proofMap.get(chain);
    if (!proof) {
      walletChecks.push({
        chain,
        status: "missing",
        message: `Connect and verify a ${CHAIN_META[chain].label} wallet.`,
      });
      continue;
    }

    const verification = await verifyTokenGateWalletProof({
      documentId: params.documentId,
      claimToken: params.claimToken,
      proof,
    });
    walletChecks.push(verification);

    if (verification.status === "verified" && verification.address) {
      verifiedWallets.set(chain, verification.address);
    }
  }

  const bypassed = gate.devBypass && isDevelopmentLike();
  const ruleResults = await Promise.all(
    gate.rules.map(async (rule) => {
      const verifiedAddress = verifiedWallets.get(rule.chain);
      if (!verifiedAddress) {
        return createResult(
          "failed",
          rule,
          `Verify a ${CHAIN_META[rule.chain].label} wallet for ${describeTokenGateRule(rule)}.`,
        );
      }

      const actual = await evaluateRule(rule, verifiedAddress, rule.chain);
      if (!bypassed || actual.status === "passed") {
        return actual;
      }

      return createBypassedRuleResult(rule, actual);
    }),
  );

  const fallbackChain = requiredChains[0] ?? "ETH";
  const fallbackAddress = verifiedWallets.get(fallbackChain) ?? "";
  const base = finalizeEvaluation(gate, fallbackAddress, fallbackChain, ruleResults);

  const failedWallet = walletChecks.find((wallet) => wallet.status !== "verified");
  const summary = failedWallet
    ? failedWallet.message
    : base.status === "eligible" && bypassed
      ? "All required wallets were verified, the live token checks ran, and development bypass approved the final gate result."
      : base.summary;

  return {
    ...base,
    summary,
    wallets: walletChecks,
    bypassed: bypassed && ruleResults.some((result) => result.message.startsWith("Development bypass approved")),
  };
}

export async function evaluateSignerTokenGate(params: {
  gate: SignerTokenGate | null | undefined;
  address: string;
  chain: WalletChain;
}): Promise<TokenGateEvaluation | null> {
  const gate = normalizeSignerTokenGate(params.gate);
  if (!gate) return null;

  const normalizedAddress = normalizeAddress(params.chain, params.address);
  const results = await Promise.all(gate.rules.map((rule) => evaluateRule(rule, normalizedAddress, params.chain)));
  return finalizeEvaluation(gate, normalizedAddress, params.chain, results);
}
