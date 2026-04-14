/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
"use client";

import { useCallback } from "react";
import { getWalletActions } from "~/components/layout/wallet-provider";
import { validateField } from "~/components/signing/sign-document-helpers";
import type { WalletChain } from "~/lib/crypto/chains";
import type { InlineField } from "~/lib/document/document-tokens";
import type { BehavioralSignals } from "~/lib/forensic";
import type { BehavioralTracker } from "~/lib/forensic";
import { collectFingerprintBestEffort } from "~/lib/forensic";
import type { TokenGateWalletProof } from "~/lib/token-gates";
import { type SigningStoreState, useSigningStore } from "~/stores/signing";
import { useWalletStore, type WalletStoreState } from "~/stores/wallet";
import { EMPTY_BEHAVIORAL, runSigningAction } from "./use-signing-actions";

// ── Forensic collection helper ──────────────────────────────────────────────

async function collectForensicEvidence(behavioralTracker: React.MutableRefObject<BehavioralTracker | null>): Promise<{
  fingerprint: Record<string, unknown>;
  behavioral: BehavioralSignals;
  session: Record<string, unknown> | undefined;
}> {
  const fingerprint = await collectFingerprintBestEffort();
  behavioralTracker.current?.logAction("sign_submitted");
  let behavioral: BehavioralSignals;
  try {
    behavioral = (await behavioralTracker.current?.collect()) ?? {
      ...EMPTY_BEHAVIORAL,
    };
  } catch {
    behavioral = { ...EMPTY_BEHAVIORAL };
  }
  return {
    fingerprint: fingerprint as unknown as Record<string, unknown>,
    behavioral,
    session: behavioralTracker.current
      ? {
          sessionId: behavioralTracker.current.sessionId,
          visitIndex: behavioralTracker.current.visitIndex,
          startedAt: behavioralTracker.current.startedAt,
          endedAt: new Date().toISOString(),
          durationMs: behavioral.timeOnPage,
        }
      : undefined,
  };
}

// ── Signing / finalize actions ──────────────────────────────────────────────

export interface UseSignSubmitArgs {
  claimToken: string | null;
  documentId: string;
  derivedState: {
    currentSigner: { label: string } | null;
    needsDrawnSig: boolean;
    needsFinalization: boolean;
  };
  tokenGateEligible: boolean;
  tokenGateProofs: Record<WalletChain, TokenGateWalletProof>;
  myFieldsList: InlineField[];
  validationOpts: {
    signatureReady: boolean;
    allValues: Record<string, string>;
  };
  signMutation: { mutateAsync: (args: unknown) => Promise<unknown> };
  getSigningMessageMut: {
    mutateAsync: (args: unknown) => Promise<{ message: string }>;
  };
  getFinalizationMessageMut: {
    mutateAsync: (args: unknown) => Promise<{ message: string }>;
  };
  finalizeMut: { mutateAsync: (args: unknown) => Promise<unknown> };
  getBulkFinalizationMessageMut: {
    mutateAsync: (args: unknown) => Promise<{ message: string }>;
  };
  bulkFinalizeMut: { mutateAsync: (args: unknown) => Promise<unknown> };
  behavioralTracker: React.MutableRefObject<BehavioralTracker | null>;
  doc: { groupId?: string | null } | null;
}

export function useSignSubmit({
  claimToken,
  documentId,
  derivedState,
  tokenGateEligible,
  tokenGateProofs,
  myFieldsList,
  validationOpts,
  signMutation,
  getSigningMessageMut,
  getFinalizationMessageMut,
  finalizeMut,
  getBulkFinalizationMessageMut,
  bulkFinalizeMut,
  behavioralTracker,
  doc,
}: UseSignSubmitArgs) {
  const wallet = useWalletStore();
  const store = useSigningStore();

  const handleSign = useCallback(async () => {
    if (!wallet.address || !wallet.chain || !claimToken || !derivedState.currentSigner) return;
    if (!tokenGateEligible) return;
    if (derivedState.needsDrawnSig && !store.handSignature) return;

    for (const f of myFieldsList) {
      if (validateField(f, store.fieldValues[f.id] ?? "", validationOpts)) {
        document.getElementById(f.id)?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
        return;
      }
    }

    const proofsList = Object.values(tokenGateProofs);
    const fieldVals = Object.keys(store.fieldValues).length > 0 ? store.fieldValues : undefined;

    await runSigningAction(
      store,
      async () => {
        const { message } = (await getSigningMessageMut.mutateAsync({
          documentId,
          claimToken,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
          handSignatureData: store.handSignature || undefined,
          tokenGateProofs: proofsList.length > 0 ? proofsList : undefined,
          fieldValues: fieldVals,
        })) as { message: string };

        const actions = getWalletActions();
        const signature = await actions.signMessage(message);
        const forensic = await collectForensicEvidence(behavioralTracker);

        await signMutation.mutateAsync({
          documentId,
          claimToken,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
          signature,
          tokenGateProofs: proofsList.length > 0 ? proofsList : undefined,
          email: store.email || undefined,
          handSignatureData: store.handSignature || undefined,
          fieldValues: fieldVals,
          forensic: {
            fingerprint: forensic.fingerprint,
            behavioral: forensic.behavioral as unknown as Record<string, unknown>,
            session: forensic.session,
          },
        });
      },
      "Signing",
    );
  }, [
    wallet,
    claimToken,
    derivedState,
    store,
    myFieldsList,
    validationOpts,
    signMutation,
    documentId,
    tokenGateEligible,
    tokenGateProofs,
    getSigningMessageMut,
    behavioralTracker,
  ]);

  const { handleFinalize, handleBulkFinalize } = useFinalization({
    wallet,
    claimToken,
    documentId,
    store,
    derivedState,
    doc,
    getFinalizationMessageMut,
    finalizeMut,
    getBulkFinalizationMessageMut,
    bulkFinalizeMut,
  });

  return { handleSign, handleFinalize, handleBulkFinalize };
}

function useFinalization(deps: {
  wallet: WalletStoreState;
  claimToken: string | null;
  documentId: string;
  store: SigningStoreState;
  derivedState: { needsFinalization: boolean };
  doc: { groupId?: string | null } | null;
  getFinalizationMessageMut: {
    mutateAsync: (args: unknown) => Promise<{ message: string }>;
  };
  finalizeMut: { mutateAsync: (args: unknown) => Promise<unknown> };
  getBulkFinalizationMessageMut: {
    mutateAsync: (args: unknown) => Promise<{ message: string }>;
  };
  bulkFinalizeMut: { mutateAsync: (args: unknown) => Promise<unknown> };
}) {
  const {
    wallet,
    claimToken,
    documentId,
    store,
    derivedState,
    doc,
    getFinalizationMessageMut,
    finalizeMut,
    getBulkFinalizationMessageMut,
    bulkFinalizeMut,
  } = deps;

  const handleFinalize = useCallback(async () => {
    if (!wallet.address || !wallet.chain || !claimToken || !derivedState.needsFinalization) return;
    await runSigningAction(
      store,
      async () => {
        const { message } = (await getFinalizationMessageMut.mutateAsync({
          documentId,
          claimToken,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
        })) as { message: string };
        const signature = await getWalletActions().signMessage(message);
        await finalizeMut.mutateAsync({
          documentId,
          claimToken,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
          signature,
        });
      },
      "Finalization",
    );
  }, [wallet, claimToken, derivedState.needsFinalization, documentId, store, getFinalizationMessageMut, finalizeMut]);

  const handleBulkFinalize = useCallback(async () => {
    if (!wallet.address || !wallet.chain || !claimToken || !derivedState.needsFinalization) return;
    const groupId = doc?.groupId;
    if (!groupId) return handleFinalize();
    await runSigningAction(
      store,
      async () => {
        const { message } = (await getBulkFinalizationMessageMut.mutateAsync({
          groupId,
          claimToken: claimToken!,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
        })) as { message: string };
        const signature = await getWalletActions().signMessage(message);
        await bulkFinalizeMut.mutateAsync({
          groupId,
          claimToken: claimToken!,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
          signature,
        });
      },
      "Bulk finalization",
    );
  }, [
    wallet,
    claimToken,
    derivedState.needsFinalization,
    doc,
    store,
    handleFinalize,
    getBulkFinalizationMessageMut,
    bulkFinalizeMut,
  ]);

  return { handleFinalize, handleBulkFinalize };
}
