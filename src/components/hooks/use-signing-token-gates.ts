"use client";

import { useCallback, useMemo, useState } from "react";
import { getWalletActions } from "~/components/layout/wallet-provider";
import { CHAIN_META, type WalletChain } from "~/lib/crypto/chains";
import { trpc } from "~/lib/platform/trpc";
import {
  buildTokenGateProofMessage,
  getSignerTokenGateChains,
  type ProofAwareTokenGateEvaluation,
  type SignerTokenGate,
  type TokenGateWalletProof,
  type TokenGateWalletVerification,
} from "~/lib/token-gates";
import { useWalletStore } from "~/stores/wallet";

type TokenGateSigner = {
  tokenGates?: SignerTokenGate | null;
  tokenGateEvaluation?: ProofAwareTokenGateEvaluation | null;
};

export function useSigningTokenGates(
  documentId: string,
  claimToken: string | null,
  currentSigner: TokenGateSigner | null,
  _currentSignerId: string | undefined,
) {
  const wallet = useWalletStore();
  const evaluateTokenGateWallets = trpc.document.evaluateTokenGateWallets.useMutation();
  const [tokenGateProofs, setTokenGateProofs] = useState<Record<WalletChain, TokenGateWalletProof>>(
    {} as Record<WalletChain, TokenGateWalletProof>,
  );
  const [proofAwareEvaluation, setProofAwareEvaluation] = useState<ProofAwareTokenGateEvaluation | null>(null);
  const [verifyingTokenGateChain, setVerifyingTokenGateChain] = useState<WalletChain | null>(null);

  const walletReady = wallet.connected && !!wallet.address && !!wallet.chain;

  const tokenGateChains = useMemo(
    () => getSignerTokenGateChains(currentSigner?.tokenGates),
    [currentSigner?.tokenGates],
  );

  const requiresTokenGateWalletProofs = useMemo(() => {
    const gate = currentSigner?.tokenGates;
    if (!gate) return false;
    return (gate as { devBypass?: boolean }).devBypass || tokenGateChains.length > 1;
  }, [currentSigner?.tokenGates, tokenGateChains]);

  const tokenGateWallets = useMemo<TokenGateWalletVerification[]>(() => {
    if (!requiresTokenGateWalletProofs) return [];
    if (proofAwareEvaluation?.wallets?.length) return proofAwareEvaluation.wallets;
    return tokenGateChains.map((chain) => ({
      chain,
      status: "missing" as const,
      message: `Connect and verify a ${CHAIN_META[chain].label} wallet.`,
    }));
  }, [proofAwareEvaluation, requiresTokenGateWalletProofs, tokenGateChains]);

  const tokenGateEvaluation = requiresTokenGateWalletProofs
    ? proofAwareEvaluation
    : (currentSigner?.tokenGateEvaluation ?? null);
  const tokenGateEligible = tokenGateEvaluation ? tokenGateEvaluation.eligible : !currentSigner?.tokenGates;
  const tokenGateBlocked =
    !!currentSigner?.tokenGates &&
    ((!requiresTokenGateWalletProofs && walletReady && !!claimToken && !tokenGateEligible) ||
      (requiresTokenGateWalletProofs && tokenGateWallets.some((entry) => entry.status !== "verified")));

  const connectTokenGateChain = useCallback(
    async (targetChain: WalletChain) => {
      const actions = getWalletActions();
      const preferredWallet = wallet.availableWallets.find(
        (candidate) => candidate.chain === targetChain && candidate.available,
      );
      await actions.connect(targetChain, preferredWallet?.id.split(":")[1]);
    },
    [wallet.availableWallets],
  );

  const verifyTokenGateWallet = useCallback(
    async (targetChain: WalletChain) => {
      if (!claimToken || !currentSigner?.tokenGates) {
        throw new Error("This signer does not have a token gate.");
      }
      if (!wallet.connected || !wallet.address || !wallet.chain) {
        throw new Error("Connect a wallet first.");
      }
      if (wallet.chain !== targetChain) {
        throw new Error(`Connect a ${CHAIN_META[targetChain].label} wallet to verify this chain.`);
      }

      const actions = getWalletActions();
      const message = buildTokenGateProofMessage({
        documentId,
        claimToken,
        chain: targetChain,
        address: wallet.address,
      });

      setVerifyingTokenGateChain(targetChain);
      try {
        const signature = await actions.signMessage(message);
        const nextProofs: Record<WalletChain, TokenGateWalletProof> = {
          ...tokenGateProofs,
          [targetChain]: {
            chain: targetChain,
            address: wallet.address,
            signature,
          },
        };

        const evaluation = await evaluateTokenGateWallets.mutateAsync({
          documentId,
          claimToken,
          proofs: Object.values(nextProofs),
        });

        setTokenGateProofs(nextProofs);
        setProofAwareEvaluation(evaluation);
        return evaluation;
      } finally {
        setVerifyingTokenGateChain(null);
      }
    },
    [
      claimToken,
      currentSigner?.tokenGates,
      wallet.connected,
      wallet.address,
      wallet.chain,
      documentId,
      tokenGateProofs,
      evaluateTokenGateWallets,
    ],
  );

  const resetTokenGates = useCallback(() => {
    setTokenGateProofs({} as Record<WalletChain, TokenGateWalletProof>);
    setProofAwareEvaluation(null);
    setVerifyingTokenGateChain(null);
  }, []);

  return {
    tokenGateChains,
    requiresTokenGateWalletProofs,
    tokenGateWallets,
    tokenGateEvaluation,
    tokenGateEligible,
    tokenGateBlocked,
    tokenGateProofs,
    verifyingTokenGateChain,
    tokenGateWalletError: evaluateTokenGateWallets.error?.message ?? null,
    connectTokenGateChain,
    verifyTokenGateWallet,
    resetTokenGates,
  };
}
