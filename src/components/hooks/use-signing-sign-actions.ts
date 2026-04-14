"use client";

import { useCallback } from "react";
import { getWalletActions } from "~/components/layout/wallet-provider";
import { type AddressSuggestion, buildAddressSuggestionFieldUpdates } from "~/lib/address-autocomplete";
import type { InlineField } from "~/lib/document/document-tokens";
import { formatEditableFieldValue } from "~/lib/document/field-runtime";
import type { BehavioralSignals, BehavioralTracker } from "~/lib/forensic";
import { collectFingerprintBestEffort } from "~/lib/forensic";
import { trpc } from "~/lib/platform/trpc";
import type { TokenGateWalletProof } from "~/lib/token-gates";
import { useSigningStore } from "~/stores/signing";
import { useWalletStore } from "~/stores/wallet";

// ── Helpers ──

const EMPTY_BEHAVIORAL: BehavioralSignals = Object.freeze({
  timeOnPage: 0,
  scrolledToBottom: false,
  maxScrollDepth: 0,
  mouseMoveCount: 0,
  clickCount: 0,
  keyPressCount: 0,
  pageWasHidden: false,
  hiddenDuration: 0,
  interactionTimeline: [],
  typingCadence: [],
  mouseVelocityAvg: 0,
  mouseAccelerationPattern: "",
  touchPressureAvg: null,
  scrollPattern: [],
  focusChanges: 0,
  pasteEvents: 0,
  copyEvents: 0,
  cutEvents: 0,
  rightClicks: 0,
  gazeTrackingActive: false,
  gazePointCount: 0,
  gazeFixationCount: 0,
  gazeFixationAvgMs: 0,
  gazeBlinkCount: 0,
  gazeBlinkRate: 0,
  gazeTrackingCoverage: 0,
  gazeLiveness: null,
  replay: null,
});

function isUserRejection(msg: string): boolean {
  return msg.includes("rejected") || msg.includes("denied");
}

async function runSigningAction(
  store: {
    startSigning: () => void;
    setSigningError: (e: string | null) => void;
    resetSigning: () => void;
  },
  action: () => Promise<void>,
  label: string,
): Promise<void> {
  store.startSigning();
  store.setSigningError(null);
  try {
    await action();
  } catch (e) {
    console.error(`${label} failed:`, e);
    const msg = e instanceof Error ? e.message : `${label} failed`;
    if (!isUserRejection(msg)) {
      store.setSigningError(msg);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  } finally {
    store.resetSigning();
  }
}

// ── Types ──

interface SignActionsDeps {
  documentId: string;
  claimToken: string | null;
  derivedState: {
    currentSigner: { label: string } | null;
    needsDrawnSig: boolean;
    needsFinalization: boolean;
  };
  fields: {
    myFieldsList: InlineField[];
    validationState: { opts: Record<string, unknown> };
  };
  tokenGates: {
    tokenGateEligible: boolean;
    tokenGateProofs: Record<string, TokenGateWalletProof>;
  };
  behavioralTracker: React.MutableRefObject<BehavioralTracker | null>;
  inlineFields: InlineField[];
  doc: { groupId?: string | null } | null;
}

export function useSigningSignActions(deps: SignActionsDeps) {
  const wallet = useWalletStore();
  const store = useSigningStore();

  const signMutation = trpc.document.sign.useMutation({
    onSuccess: () => {
      store.completeSigning();
      store.clearDraft();
    },
  });
  const declineMut = trpc.document.declineSign.useMutation({
    onSuccess: () => store.declineSigning(),
  });
  const getSigningMessageMut = trpc.document.getSigningMessage.useMutation();
  const getFinalizationMessageMut = trpc.document.getFinalizationMessage.useMutation();
  const finalizeMut = trpc.document.finalize.useMutation({
    onSuccess: () => store.completeSigning(),
  });
  const getBulkFinalizationMessageMut = trpc.document.getBulkFinalizationMessage.useMutation();
  const bulkFinalizeMut = trpc.document.bulkFinalize.useMutation({
    onSuccess: () => store.completeSigning(),
  });
  const addressSuggestionsMutation = trpc.document.addressSuggestions.useMutation();

  const handleSign = useCallback(async () => {
    if (!wallet.address || !wallet.chain || !deps.claimToken || !deps.derivedState.currentSigner) return;
    if (!deps.tokenGates.tokenGateEligible || (deps.derivedState.needsDrawnSig && !store.handSignature)) return;
    for (const f of deps.fields.myFieldsList) {
      if (
        (await import("~/components/signing/sign-document-helpers")).validateField(
          f,
          store.fieldValues[f.id] ?? "",
          deps.fields.validationState.opts,
        )
      ) {
        document.getElementById(f.id)?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
        return;
      }
    }
    const proofsList = Object.values(deps.tokenGates.tokenGateProofs);
    const fieldVals = Object.keys(store.fieldValues).length > 0 ? store.fieldValues : undefined;
    await runSigningAction(
      store,
      async () => {
        const { message } = await getSigningMessageMut.mutateAsync({
          documentId: deps.documentId,
          claimToken: deps.claimToken!,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
          handSignatureData: store.handSignature || undefined,
          tokenGateProofs: proofsList.length > 0 ? proofsList : undefined,
          fieldValues: fieldVals,
        });
        const signature = await getWalletActions().signMessage(message);
        const fingerprint = await collectFingerprintBestEffort();
        deps.behavioralTracker.current?.logAction("sign_submitted");
        let behavioral: BehavioralSignals;
        try {
          behavioral = (await deps.behavioralTracker.current?.collect()) ?? {
            ...EMPTY_BEHAVIORAL,
          };
        } catch {
          behavioral = { ...EMPTY_BEHAVIORAL };
        }
        await signMutation.mutateAsync({
          documentId: deps.documentId,
          claimToken: deps.claimToken!,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
          signature,
          tokenGateProofs: proofsList.length > 0 ? proofsList : undefined,
          email: store.email || undefined,
          handSignatureData: store.handSignature || undefined,
          fieldValues: fieldVals,
          forensic: {
            fingerprint: fingerprint as unknown as Record<string, unknown>,
            behavioral: behavioral as unknown as Record<string, unknown>,
            session: deps.behavioralTracker.current
              ? {
                  sessionId: deps.behavioralTracker.current.sessionId,
                  visitIndex: deps.behavioralTracker.current.visitIndex,
                  startedAt: deps.behavioralTracker.current.startedAt,
                  endedAt: new Date().toISOString(),
                  durationMs: behavioral.timeOnPage,
                }
              : undefined,
          },
        });
      },
      "Signing",
    );
  }, [wallet, deps, store, signMutation, getSigningMessageMut]);

  const handleFinalize = useCallback(async () => {
    if (!wallet.address || !wallet.chain || !deps.claimToken || !deps.derivedState.needsFinalization) return;
    await runSigningAction(
      store,
      async () => {
        const { message } = await getFinalizationMessageMut.mutateAsync({
          documentId: deps.documentId,
          claimToken: deps.claimToken!,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
        });
        const signature = await getWalletActions().signMessage(message);
        await finalizeMut.mutateAsync({
          documentId: deps.documentId,
          claimToken: deps.claimToken!,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
          signature,
        });
      },
      "Finalization",
    );
  }, [
    wallet,
    deps.claimToken,
    deps.derivedState.needsFinalization,
    deps.documentId,
    store,
    getFinalizationMessageMut,
    finalizeMut,
  ]);

  const handleBulkFinalize = useCallback(async () => {
    if (!wallet.address || !wallet.chain || !deps.claimToken || !deps.derivedState.needsFinalization) return;
    const groupId = deps.doc?.groupId;
    if (!groupId) return handleFinalize();
    await runSigningAction(
      store,
      async () => {
        const { message } = await getBulkFinalizationMessageMut.mutateAsync({
          groupId,
          claimToken: deps.claimToken!,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
        });
        const signature = await getWalletActions().signMessage(message);
        await bulkFinalizeMut.mutateAsync({
          groupId,
          claimToken: deps.claimToken!,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
          signature,
        });
      },
      "Bulk finalization",
    );
  }, [
    wallet,
    deps.claimToken,
    deps.derivedState.needsFinalization,
    deps.doc,
    store,
    handleFinalize,
    getBulkFinalizationMessageMut,
    bulkFinalizeMut,
  ]);

  const loadAddressSuggestions = useCallback(
    async (query: string, field: InlineField) => {
      if (!deps.claimToken || query.trim().length < 3) return [];
      return (
        await addressSuggestionsMutation.mutateAsync({
          documentId: deps.documentId,
          claimToken: deps.claimToken,
          fieldId: field.id,
          query: query.trim(),
          limit: 5,
        })
      ).suggestions;
    },
    [addressSuggestionsMutation, deps.claimToken, deps.documentId],
  );

  const applyAddressSuggestion = useCallback(
    (field: InlineField, suggestion: AddressSuggestion) => {
      for (const [fieldId, rawValue] of Object.entries(
        buildAddressSuggestionFieldUpdates({
          anchorField: field,
          fields: deps.inlineFields,
          suggestion,
        }),
      )) {
        const target = deps.inlineFields.find((f) => f.id === fieldId);
        if (target) {
          const next = formatEditableFieldValue(target, rawValue);
          store.setFieldValue(fieldId, next);
          deps.behavioralTracker.current?.recordFieldValue(fieldId, next);
        }
      }
      store.saveDraft();
    },
    [deps.inlineFields, store, deps.behavioralTracker],
  );

  return {
    signMutation,
    declineMut,
    handleSign,
    handleFinalize,
    handleBulkFinalize,
    loadAddressSuggestions,
    applyAddressSuggestion,
  };
}
