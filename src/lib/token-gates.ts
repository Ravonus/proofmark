import { z } from "zod";
import { isEvmAddress, isSolanaAddress, normalizeAddress, type WalletChain } from "./crypto/chains";

const trimmedOptionalString = z.string().trim().max(120).optional();

const gateBaseSchema = z.object({
  id: z.string().trim().min(1).optional(),
  label: trimmedOptionalString,
});

export const erc20TokenGateRuleSchema = gateBaseSchema.extend({
  chain: z.literal("ETH"),
  type: z.literal("ERC20"),
  contractAddress: z.string().trim().min(1),
  minAmount: z.string().trim().min(1),
});

export const erc721TokenGateRuleSchema = gateBaseSchema.extend({
  chain: z.literal("ETH"),
  type: z.literal("ERC721"),
  contractAddress: z.string().trim().min(1),
  tokenId: z.string().trim().optional(),
  minAmount: z.string().trim().min(1).default("1"),
});

export const splTokenGateRuleSchema = gateBaseSchema.extend({
  chain: z.literal("SOL"),
  type: z.literal("SPL"),
  mintAddress: z.string().trim().min(1),
  minAmount: z.string().trim().min(1),
});

export const ordinalTokenGateRuleSchema = gateBaseSchema.extend({
  chain: z.literal("BTC"),
  type: z.literal("ORDINAL"),
  identifierType: z.enum(["INSCRIPTION_ID", "COLLECTION_ID"]).default("INSCRIPTION_ID"),
  identifier: z.string().trim().min(1),
});

export const runeTokenGateRuleSchema = gateBaseSchema.extend({
  chain: z.literal("BTC"),
  type: z.literal("RUNE"),
  identifier: z.string().trim().min(1),
  minAmount: z.string().trim().min(1),
});

export const tokenGateRuleSchema = z
  .discriminatedUnion("type", [
    erc20TokenGateRuleSchema,
    erc721TokenGateRuleSchema,
    splTokenGateRuleSchema,
    ordinalTokenGateRuleSchema,
    runeTokenGateRuleSchema,
  ])
  .superRefine((value, ctx) => {
    if (value.type === "ERC20" || value.type === "ERC721") {
      if (!isEvmAddress(value.contractAddress)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contractAddress"],
          message: "Enter a valid EVM contract address",
        });
      }
    }

    if (value.type === "SPL" && !isSolanaAddress(value.mintAddress)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mintAddress"],
        message: "Enter a valid Solana mint address",
      });
    }

    if (value.type === "ERC721" && value.tokenId && !/^\d+$/.test(value.tokenId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokenId"],
        message: "Token ID must be a whole number",
      });
    }

    if (value.type !== "ORDINAL" && !/^\d+(?:\.\d+)?$/.test(value.minAmount)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minAmount"],
        message: "Amount must be a positive number",
      });
    }
  });

export const signerTokenGateSchema = z
  .object({
    mode: z.enum(["ALL", "ANY"]).default("ALL"),
    devBypass: z.boolean().default(false),
    rules: z.array(tokenGateRuleSchema).max(10).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.rules.length === 0) return;

    if (value.mode === "ALL" && !value.devBypass) {
      const chains = new Set(value.rules.map((rule) => rule.chain));
      if (chains.size > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mode"],
          message: "ALL mode only supports rules from a single signing chain",
        });
      }
    }
  });

export const optionalSignerTokenGateSchema = signerTokenGateSchema.nullable().optional();
export const tokenGateWalletProofSchema = z.object({
  chain: z.enum(["ETH", "SOL", "BTC"]),
  address: z.string().trim().min(1),
  signature: z.string().trim().min(1),
});

export const tokenGateWalletProofListSchema = z.array(tokenGateWalletProofSchema).max(6).default([]);

export type TokenGateRule = z.infer<typeof tokenGateRuleSchema>;
export type SignerTokenGate = z.infer<typeof signerTokenGateSchema>;
export type TokenGateWalletProof = z.infer<typeof tokenGateWalletProofSchema>;

export type TokenGateRuleEvaluation = {
  ruleId?: string;
  status: "passed" | "failed" | "unavailable";
  passed: boolean;
  message: string;
  expectedValue?: string;
  actualValue?: string;
};

export type TokenGateWalletVerification = {
  chain: WalletChain;
  address?: string;
  status: "verified" | "failed" | "missing";
  message: string;
  scheme?: string;
  bypassed?: boolean;
};

export type TokenGateEvaluation = {
  status: "eligible" | "ineligible" | "unavailable";
  eligible: boolean;
  checkedAddress: string;
  checkedChain: WalletChain;
  checkedAt: string;
  mode: "ALL" | "ANY";
  rules: TokenGateRuleEvaluation[];
  summary: string;
};

export type ProofAwareTokenGateEvaluation = TokenGateEvaluation & {
  wallets: TokenGateWalletVerification[];
  bypassed?: boolean;
};

export const EMPTY_SIGNER_TOKEN_GATE: SignerTokenGate = {
  mode: "ALL",
  devBypass: false,
  rules: [],
};

export const TOKEN_GATE_TYPE_OPTIONS: Array<{
  value: TokenGateRule["type"];
  label: string;
  chain: WalletChain;
}> = [
  { value: "ERC20", label: "ERC-20 balance", chain: "ETH" },
  { value: "ERC721", label: "ERC-721 / NFT", chain: "ETH" },
  { value: "SPL", label: "SPL token balance", chain: "SOL" },
  { value: "ORDINAL", label: "Ordinal ownership", chain: "BTC" },
  { value: "RUNE", label: "Rune balance", chain: "BTC" },
];

export function normalizeSignerTokenGate(value: SignerTokenGate | null | undefined): SignerTokenGate | null {
  if (!value || !Array.isArray(value.rules)) return null;
  const parsed = signerTokenGateSchema.safeParse(value);
  if (!parsed.success || parsed.data.rules.length === 0) return null;
  return parsed.data;
}

export function getSignerTokenGateChains(gate: SignerTokenGate | null | undefined): WalletChain[] {
  const normalized = normalizeSignerTokenGate(gate);
  if (!normalized) return [];
  return Array.from(new Set(normalized.rules.map((rule) => rule.chain)));
}

export function buildTokenGateProofMessage(params: {
  documentId: string;
  claimToken: string;
  chain: WalletChain;
  address: string;
}): string {
  return [
    "Proofmark — Token Gate Wallet Verification",
    "",
    `Document: ${params.documentId}`,
    `Claim Token: ${params.claimToken}`,
    `Chain: ${params.chain}`,
    `Address: ${normalizeAddress(params.chain, params.address)}`,
    "",
    "Sign this message to prove wallet ownership for token gate verification.",
    "This does not trigger a blockchain transaction.",
  ].join("\n");
}

export function getTokenGateRuleLabel(rule: TokenGateRule): string {
  if (rule.label) return rule.label;

  switch (rule.type) {
    case "ERC20":
      return `ERC-20 ${rule.contractAddress.slice(0, 6)}...${rule.contractAddress.slice(-4)}`;
    case "ERC721":
      return rule.tokenId
        ? `NFT ${rule.contractAddress.slice(0, 6)}...${rule.contractAddress.slice(-4)} #${rule.tokenId}`
        : `NFT ${rule.contractAddress.slice(0, 6)}...${rule.contractAddress.slice(-4)}`;
    case "SPL":
      return `SPL ${rule.mintAddress.slice(0, 6)}...${rule.mintAddress.slice(-4)}`;
    case "ORDINAL":
      return rule.identifierType === "COLLECTION_ID"
        ? `Ordinal collection ${rule.identifier}`
        : `Ordinal ${rule.identifier}`;
    case "RUNE":
      return `Rune ${rule.identifier}`;
  }
}

export function describeTokenGateRule(rule: TokenGateRule): string {
  switch (rule.type) {
    case "ERC20":
      return `${rule.minAmount}+ of ${getTokenGateRuleLabel(rule)}`;
    case "ERC721":
      return rule.tokenId
        ? `ownership of ${getTokenGateRuleLabel(rule)}`
        : `${rule.minAmount || "1"}+ NFT(s) from ${getTokenGateRuleLabel(rule)}`;
    case "SPL":
      return `${rule.minAmount}+ of ${getTokenGateRuleLabel(rule)}`;
    case "ORDINAL":
      return `ownership of ${getTokenGateRuleLabel(rule)}`;
    case "RUNE":
      return `${rule.minAmount}+ of ${getTokenGateRuleLabel(rule)}`;
  }
}

export function describeSignerTokenGate(gate: SignerTokenGate | null | undefined): string | null {
  const normalized = normalizeSignerTokenGate(gate);
  if (!normalized) return null;

  const joiner = normalized.mode === "ALL" ? " and " : " or ";
  return normalized.rules.map(describeTokenGateRule).join(joiner);
}
