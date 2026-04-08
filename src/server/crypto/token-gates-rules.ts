/**
 * Token gate rule evaluation functions extracted from token-gates.ts
 * to reduce file length below the 650-line Biome threshold.
 */

import { Connection, type ParsedAccountData, PublicKey } from "@solana/web3.js";
import { ethers } from "ethers";
import { normalizeAddress, type WalletChain } from "~/lib/crypto/chains";
import {
  describeTokenGateRule,
  getTokenGateRuleLabel,
  type TokenGateRule,
  type TokenGateRuleEvaluation,
} from "~/lib/token-gates";
import { lookupAddressRunes, lookupInscription, lookupRuneMetadata } from "~/server/crypto/token-gates-btc";

const ERC20_GATE_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

const ERC721_GATE_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
] as const;

type Erc20ReadContract = {
  balanceOf: (owner: string) => Promise<bigint>;
  decimals: () => Promise<number>;
  symbol: () => Promise<string>;
};

type Erc721ReadContract = {
  balanceOf: (owner: string) => Promise<bigint>;
  ownerOf: (tokenId: bigint) => Promise<string>;
};

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

export { createResult };

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

function getFractionDigits(value: string): number {
  return value.split(".")[1]?.length ?? 0;
}

// ── Provider helpers ───────────────────────────────────────────────────────

const DEFAULT_ETH_RPC_URL = "https://ethereum-rpc.publicnode.com";
const DEFAULT_SOL_RPC_URL = "https://api.mainnet.solana.com";

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

// ── Rule evaluators ────────────────────────────────────────────────────────

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
      return createResult("passed", rule, `Wallet holds ${actualValue}.`, {
        expectedValue,
        actualValue,
      });
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
      return createResult("passed", rule, `Wallet holds ${actualValue}.`, {
        expectedValue,
        actualValue,
      });
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
      return createResult("passed", rule, `Wallet holds ${actualValue}.`, {
        expectedValue,
        actualValue,
      });
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

export async function evaluateRule(
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
