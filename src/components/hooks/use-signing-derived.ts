"use client";

import { useMemo } from "react";
import { validateField } from "~/components/signing/sign-document-helpers";
import { CHAIN_META, normalizeAddress, type WalletChain } from "~/lib/crypto/chains";
import type { InlineField } from "~/lib/document/document-tokens";
import { isFieldRequired, isFieldVisible } from "~/lib/document/field-runtime";
import { isActionableRecipientRole, isApprovalRecipientRole } from "~/lib/signing/recipient-roles";
import {
  getSignerTokenGateChains,
  type ProofAwareTokenGateEvaluation,
  type SignerTokenGate,
  type TokenGateWalletVerification,
} from "~/lib/token-gates";

// ── Helpers ──────────────────────────────────────────────────────────────────

function collectFieldValues(signers: Array<{ fieldValues?: Record<string, string> | null }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const s of signers) {
    if (!s.fieldValues) continue;
    for (const [k, v] of Object.entries(s.fieldValues)) {
      if (v) result[k] = v;
    }
  }
  return result;
}

export function computeMergedFieldValues(
  docSigners: Array<{
    id: string;
    fieldValues?: Record<string, string> | null;
  }>,
  currentSigner: { id: string } | null,
  localValues: Record<string, string>,
  allSigners: Array<{ fieldValues?: Record<string, string> | null }>,
) {
  const otherValues = collectFieldValues(docSigners.filter((s) => s.id !== currentSigner?.id));
  const merged = { ...otherValues, ...localValues };
  const all = { ...collectFieldValues(allSigners) };
  for (const [k, v] of Object.entries(localValues)) {
    if (v) all[k] = v;
  }
  return { mergedFieldValues: merged, allFieldValues: all };
}

// ── Derived signer state ────────────────────────────────────────────────────

interface DocSigner {
  id: string;
  isYou?: boolean;
  address?: string | null;
  status: string;
  role: string;
  tokenGates?: SignerTokenGate | null;
  tokenGateEvaluation?: ProofAwareTokenGateEvaluation | null;
  groupRole?: string | null;
  finalizationSignature?: string | null;
  fieldValues?: Record<string, string> | null;
  canSign?: boolean;
  label: string;
}

export function useDerivedSignerState(
  docSigners: DocSigner[],
  walletConnected: boolean,
  walletAddress: string | null,
  doc: { createdBy?: string | null } | null,
) {
  return useMemo(() => {
    const mySigner = docSigners.find((s) => s.isYou) ?? null;
    const mySignerByAddress =
      walletConnected && walletAddress
        ? (docSigners.find((s) => s.address?.toLowerCase() === walletAddress.toLowerCase()) ?? null)
        : null;
    const currentSigner = mySigner ?? mySignerByAddress;

    const isCreator = !!(
      walletConnected &&
      walletAddress &&
      doc?.createdBy?.toLowerCase() === walletAddress.toLowerCase()
    );

    const currentRole = currentSigner?.role ?? "SIGNER";
    const isActionable = isActionableRecipientRole(currentRole);
    const needsDrawnSig = isActionable && !isApprovalRecipientRole(currentRole);
    const mySignerIdx = currentSigner ? docSigners.findIndex((s) => s.id === currentSigner.id) : -1;

    const alreadySigned = currentSigner?.status === "SIGNED";
    const actionableSigners = docSigners.filter((s) => isActionableRecipientRole(s.role));
    const signedCount = actionableSigners.filter((s) => s.status === "SIGNED").length;
    const totalRecipients = actionableSigners.length || docSigners.length;

    const isDiscloser = currentSigner?.groupRole === "discloser";
    const othersAllDone = actionableSigners
      .filter((s) => s.id !== currentSigner?.id)
      .every((s) => s.status === "SIGNED");
    const needsFinalization = !!(
      isDiscloser &&
      alreadySigned &&
      othersAllDone &&
      !currentSigner?.finalizationSignature
    );

    return {
      mySigner,
      mySignerByAddress,
      currentSigner,
      isCreator,
      currentRole,
      isActionable,
      needsDrawnSig,
      mySignerIdx,
      alreadySigned,
      needsFinalization,
      signedCount,
      totalRecipients,
    };
  }, [docSigners, walletConnected, walletAddress, doc]);
}

// ── Token gate evaluation ───────────────────────────────────────────────────

export function useTokenGateEvaluation(
  currentSigner: DocSigner | null,
  walletReady: boolean,
  claimToken: string | null,
  proofAwareEvaluation: ProofAwareTokenGateEvaluation | null,
  _tokenGateProofs: Record<WalletChain, unknown>,
) {
  const tokenGateChains = useMemo(
    () => getSignerTokenGateChains(currentSigner?.tokenGates),
    [currentSigner?.tokenGates],
  );

  const requiresTokenGateWalletProofs = useMemo(() => {
    const gate = currentSigner?.tokenGates as { devBypass?: boolean } | undefined;
    if (!gate) return false;
    return !!gate.devBypass || tokenGateChains.length > 1;
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

  return {
    tokenGateChains,
    requiresTokenGateWalletProofs,
    tokenGateWallets,
    tokenGateEvaluation,
    tokenGateEligible,
    tokenGateBlocked,
  };
}

// ── Field management (pure derived) ─────────────────────────────────────────

export function useFieldManagement(opts: {
  inlineFields: InlineField[];
  isActionable: boolean;
  mySignerIdx: number;
  mergedFieldValues: Record<string, string>;
  handSignature: string | null;
  fieldValues: Record<string, string>;
  needsDrawnSig: boolean;
}) {
  const { inlineFields, isActionable, mySignerIdx, mergedFieldValues, handSignature, fieldValues, needsDrawnSig } =
    opts;
  const myFieldIds = useMemo(
    () =>
      new Set(
        inlineFields
          .filter((f) => isActionable && (f.signerIdx === mySignerIdx || f.signerIdx === -1))
          .map((f) => f.id),
      ),
    [inlineFields, isActionable, mySignerIdx],
  );

  const myFieldsList = useMemo(
    () => inlineFields.filter((f) => myFieldIds.has(f.id) && isFieldVisible(f, mergedFieldValues)),
    [inlineFields, myFieldIds, mergedFieldValues],
  );

  const validationState = useMemo(() => {
    const opts = {
      signatureReady: !!handSignature,
      allValues: mergedFieldValues,
    };
    const requiredFields = myFieldsList.filter((f) => isFieldRequired(f, mergedFieldValues));
    const completed = requiredFields.filter((f) => !validateField(f, fieldValues[f.id], opts)).length;
    const remaining = Math.max(0, requiredFields.length - completed);
    const allComplete = requiredFields.length === 0 || remaining === 0;
    const canFinalize = (!needsDrawnSig || !!handSignature) && allComplete;

    return {
      requiredFields,
      completed,
      remaining,
      allComplete,
      canFinalize,
      opts,
    };
  }, [myFieldsList, mergedFieldValues, handSignature, fieldValues, needsDrawnSig]);

  const fieldsByTypeLabel = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const f of myFieldsList) {
      const key = `${f.type}:${f.label}`;
      const arr = map.get(key) ?? [];
      arr.push(f.id);
      map.set(key, arr);
    }
    return map;
  }, [myFieldsList]);

  return {
    myFieldIds,
    myFieldsList,
    validationState,
    fieldsByTypeLabel,
  };
}

// ── Confirmation signing message (pure derived) ─────────────────────────────

export function useConfirmSigningMessage(opts: {
  walletAddress: string | null;
  walletChain: WalletChain | null;
  currentSigner: { label: string } | null;
  needsDrawnSig: boolean;
  handSignature: string | null;
  doc: { contentHash?: string | null } | null;
}) {
  const { walletAddress, walletChain, currentSigner, needsDrawnSig, handSignature, doc } = opts;
  return useMemo(() => {
    if (!walletAddress || !walletChain || !currentSigner) return "";
    if (needsDrawnSig && !handSignature) return "";
    return `proofmark:${doc?.contentHash ?? ""}:${normalizeAddress(walletChain, walletAddress)}:${currentSigner.label}`;
  }, [walletAddress, walletChain, currentSigner, needsDrawnSig, handSignature, doc]);
}
