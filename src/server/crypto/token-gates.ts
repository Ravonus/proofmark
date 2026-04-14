import { CHAIN_META, normalizeAddress, type WalletChain } from "~/lib/crypto/chains";
import { verifySignature as verifyWalletSignature } from "~/lib/signing/verify";
import {
  buildTokenGateProofMessage,
  describeTokenGateRule,
  getSignerTokenGateChains,
  normalizeSignerTokenGate,
  type ProofAwareTokenGateEvaluation,
  type SignerTokenGate,
  type TokenGateEvaluation,
  type TokenGateRule,
  type TokenGateRuleEvaluation,
  type TokenGateWalletProof,
  type TokenGateWalletVerification,
} from "~/lib/token-gates";
import { createResult, evaluateRule } from "~/server/crypto/token-gates-rules";

function isDevelopmentLike(): boolean {
  return process.env.NODE_ENV !== "production";
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
