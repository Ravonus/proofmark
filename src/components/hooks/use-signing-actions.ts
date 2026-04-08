/* eslint-disable @typescript-eslint/consistent-type-imports */
"use client";

import { useCallback } from "react";
import { getWalletActions } from "~/components/layout/wallet-provider";
import { validateField } from "~/components/signing/sign-document-helpers";
import { CHAIN_META, type WalletChain } from "~/lib/crypto/chains";
import type { InlineField } from "~/lib/document/document-tokens";
import { formatEditableFieldValue, getFieldLogicState } from "~/lib/document/field-runtime";
import type { BehavioralSignals } from "~/lib/forensic";
import type { BehavioralTracker } from "~/lib/forensic";
import { VERIFY_FIELD_TYPES } from "~/lib/signing/signing-constants";
import { buildTokenGateProofMessage, type TokenGateWalletProof } from "~/lib/token-gates";

import { useSigningStore } from "~/stores/signing";
import { useWalletStore } from "~/stores/wallet";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Whether the user intentionally cancelled (don't show as error). */
function isUserRejection(msg: string): boolean {
  return msg.includes("rejected") || msg.includes("denied");
}

export async function runSigningAction(
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

export const SOCIAL_PROVIDER_MAP: Record<string, string> = {
  "x-verify": "x",
  "github-verify": "github",
  "discord-verify": "discord",
  "google-verify": "google",
};

const PROVIDER_FIELD_MAP: Record<string, string[]> = {
  x: ["twitter-handle"],
  github: ["github-handle"],
  discord: ["discord-handle"],
  google: ["email", "secondary-email"],
};

export function processSocialVerifyResult(
  serverVal: string,
  field: InlineField,
  inlineFields: InlineField[],
  fieldValues: Record<string, string>,
  handleFieldChange: (id: string, value: string) => void,
): boolean {
  try {
    const parsed = JSON.parse(serverVal) as {
      kind?: string;
      status?: string;
      provider?: string;
      username?: string;
    };
    if (parsed.kind !== "social-verification" || parsed.status !== "verified") return false;

    handleFieldChange(field.id, serverVal);

    if (parsed.username) {
      const autoFillTypes = PROVIDER_FIELD_MAP[parsed.provider ?? ""] ?? [];
      for (const f of inlineFields) {
        if (autoFillTypes.includes(f.type) && f.signerIdx === field.signerIdx && !fieldValues[f.id]) {
          const value = parsed.provider === "google" ? parsed.username : `@${parsed.username}`;
          handleFieldChange(f.id, value);
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Fallback behavioral signals when the tracker fails or is absent. */
export const EMPTY_BEHAVIORAL: BehavioralSignals = Object.freeze({
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

// ── Field change helpers (pure logic, not hooks) ────────────────────────────

function clearHiddenFields(
  inlineFields: InlineField[],
  allVals: Record<string, string>,
  storeFieldValues: Record<string, string>,
  setFieldValue: (id: string, v: string) => void,
  tracker: React.MutableRefObject<BehavioralTracker | null>,
) {
  for (const f of inlineFields) {
    const state = getFieldLogicState(f, allVals);
    if (!state.visible && state.clearWhenHidden && f.id in storeFieldValues) {
      setFieldValue(f.id, "");
      tracker.current?.recordFieldValue(f.id, "");
    }
  }
}

function scheduleServerSave(opts: {
  myFieldsList: InlineField[];
  mergedFieldValues: Record<string, string>;
  serverSaveTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  claimToken: string | null;
  documentId: string;
  getFieldValues: () => Record<string, string>;
  saveMutate: (args: unknown) => void;
}) {
  const { myFieldsList, mergedFieldValues, serverSaveTimer, claimToken, documentId, getFieldValues, saveMutate } = opts;
  const hasVerifyFields = myFieldsList.some((f) => VERIFY_FIELD_TYPES.has(f.type));
  const verificationDone =
    !hasVerifyFields ||
    myFieldsList
      .filter((f) => VERIFY_FIELD_TYPES.has(f.type))
      .some((f) => {
        const val = mergedFieldValues[f.id];
        return val?.includes('"status":"verified"');
      });

  if (verificationDone) {
    if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    serverSaveTimer.current = setTimeout(() => {
      if (!claimToken) return;
      const vals = getFieldValues();
      if (Object.keys(vals).length > 0) {
        saveMutate({ documentId, claimToken, fieldValues: vals });
      }
    }, 1500);
  }
}

// ── Field actions ───────────────────────────────────────────────────────────

interface UseFieldActionsArgs {
  myFieldIds: Set<string>;
  myFieldsList: InlineField[];
  inlineFields: InlineField[];
  mergedFieldValues: Record<string, string>;
  fieldsByTypeLabel: Map<string, string[]>;
  validationOpts: {
    signatureReady: boolean;
    allValues: Record<string, string>;
  };
  behavioralTracker: React.MutableRefObject<BehavioralTracker | null>;
  serverSaveTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  claimToken: string | null;
  documentId: string;
  saveFieldValuesMut: { mutate: (args: unknown) => void };
}

export function useFieldActions({
  myFieldIds,
  myFieldsList,
  inlineFields,
  mergedFieldValues,
  fieldsByTypeLabel,
  validationOpts,
  behavioralTracker,
  serverSaveTimer,
  claimToken,
  documentId,
  saveFieldValuesMut,
}: UseFieldActionsArgs) {
  const store = useSigningStore();

  const handleFieldChange = useCallback(
    (fieldId: string, value: string) => {
      if (!myFieldIds.has(fieldId)) return;
      const field = inlineFields.find((f) => f.id === fieldId);
      if (!field) return;
      if (VERIFY_FIELD_TYPES.has(field.type)) return;
      const next = formatEditableFieldValue(field, value);
      store.setFieldValue(fieldId, next);
      behavioralTracker.current?.recordFieldValue(fieldId, next);

      const allVals = { ...mergedFieldValues, [fieldId]: next };
      clearHiddenFields(inlineFields, allVals, store.fieldValues, store.setFieldValue, behavioralTracker);
      store.saveDraft();
      scheduleServerSave({
        myFieldsList,
        mergedFieldValues,
        serverSaveTimer,
        claimToken,
        documentId,
        getFieldValues: () => store.fieldValues,
        saveMutate: saveFieldValuesMut.mutate,
      });
    },
    [
      myFieldIds,
      myFieldsList,
      inlineFields,
      mergedFieldValues,
      store,
      claimToken,
      documentId,
      saveFieldValuesMut,
      behavioralTracker,
      serverSaveTimer,
    ],
  );

  const fillMatching = useCallback(
    (fieldId: string, value: string) => {
      const field = inlineFields.find((f) => f.id === fieldId);
      if (!field) return;
      const key = `${field.type}:${field.label}`;
      const siblings = fieldsByTypeLabel.get(key) ?? [];
      for (const id of siblings) {
        const next = formatEditableFieldValue(field, value);
        store.setFieldValue(id, next);
        behavioralTracker.current?.recordFieldValue(id, next);
      }
      store.saveDraft();
    },
    [inlineFields, fieldsByTypeLabel, store, behavioralTracker],
  );

  const setHandSignatureWithAutoFill = useCallback(
    (data: string | null) => {
      store.setHandSignature(data);
      for (const f of myFieldsList) {
        if (f.type === "signature") {
          store.setFieldValue(f.id, data ?? "");
          behavioralTracker.current?.recordFieldValue(f.id, data ?? "");
        }
      }
      store.saveDraft();
    },
    [myFieldsList, store, behavioralTracker],
  );

  const nav = useFieldNavigation(myFieldsList, validationOpts, behavioralTracker);

  return {
    handleFieldChange,
    fillMatching,
    setHandSignature: setHandSignatureWithAutoFill,
    ...nav,
  };
}

function useFieldNavigation(
  myFieldsList: InlineField[],
  validationOpts: {
    signatureReady: boolean;
    allValues: Record<string, string>;
  },
  behavioralTracker: React.MutableRefObject<BehavioralTracker | null>,
) {
  const store = useSigningStore();

  const navigateToField = useCallback(
    (idx: number, direction: "jump" | "prev" | "next" = "jump") => {
      if (idx < 0 || idx >= myFieldsList.length) return;
      const field = myFieldsList[idx]!;
      store.setCurrentFieldIdx(idx);
      store.setActiveField(field.id);
      behavioralTracker.current?.recordNavigation(direction, field.id, idx + 1);
      behavioralTracker.current?.recordFieldFocus(field.id);
      document.getElementById(field.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => document.getElementById(field.id)?.querySelector("input")?.focus(), 300);
    },
    [myFieldsList, store, behavioralTracker],
  );

  const goToNextField = useCallback(() => {
    const emptyIdx = myFieldsList.findIndex((f) => !!validateField(f, store.fieldValues[f.id], validationOpts));
    if (emptyIdx !== -1) navigateToField(emptyIdx, "jump");
  }, [myFieldsList, store.fieldValues, validationOpts, navigateToField]);

  const goToPrevField = useCallback(() => {
    const nextIdx = Math.max(0, store.currentFieldIdx - 1);
    navigateToField(nextIdx, "prev");
  }, [navigateToField, store.currentFieldIdx]);

  const goToNextFieldNav = useCallback(() => {
    const nextIdx = Math.min(myFieldsList.length - 1, store.currentFieldIdx + 1);
    navigateToField(nextIdx, "next");
  }, [myFieldsList.length, navigateToField, store.currentFieldIdx]);

  const handleFieldFocus = useCallback(
    (fieldId: string) => {
      store.setActiveField(fieldId);
      const idx = myFieldsList.findIndex((f) => f.id === fieldId);
      if (idx !== -1) store.setCurrentFieldIdx(idx);
      behavioralTracker.current?.recordFieldFocus(fieldId);
    },
    [myFieldsList, store, behavioralTracker],
  );

  const handleFieldBlur = useCallback(
    (fieldId: string) => {
      behavioralTracker.current?.recordFieldBlur(fieldId);
      store.setActiveField(null);
    },
    [store, behavioralTracker],
  );

  const setShowSigPadTracked = useCallback(
    (next: boolean) => {
      behavioralTracker.current?.recordModal("signature_pad", next);
      store.setShowSigPad(next);
    },
    [store, behavioralTracker],
  );

  const setShowQrTracked = useCallback(
    (next: boolean) => {
      behavioralTracker.current?.recordModal("mobile_sign_qr", next);
      store.setShowQr(next);
    },
    [store, behavioralTracker],
  );

  return {
    navigateToField,
    goToNextField,
    goToPrevField,
    goToNextFieldNav,
    handleFieldFocus,
    handleFieldBlur,
    setShowSigPad: setShowSigPadTracked,
    setShowQr: setShowQrTracked,
  };
}

// ── Token gate actions ──────────────────────────────────────────────────────

interface UseTokenGateActionsArgs {
  claimToken: string | null;
  currentSigner: { tokenGates?: unknown } | null;
  documentId: string;
  tokenGateProofs: Record<WalletChain, TokenGateWalletProof>;
  setTokenGateProofs: (proofs: Record<WalletChain, TokenGateWalletProof>) => void;
  setProofAwareEvaluation: (evaluation: import("~/lib/token-gates").ProofAwareTokenGateEvaluation | null) => void;
  setVerifyingTokenGateChain: (chain: WalletChain | null) => void;
  evaluateTokenGateWallets: {
    mutateAsync: (args: {
      documentId: string;
      claimToken: string;
      proofs: TokenGateWalletProof[];
    }) => Promise<import("~/lib/token-gates").ProofAwareTokenGateEvaluation>;
  };
}

export function useTokenGateActions({
  claimToken,
  currentSigner,
  documentId,
  tokenGateProofs,
  setTokenGateProofs,
  setProofAwareEvaluation,
  setVerifyingTokenGateChain,
  evaluateTokenGateWallets,
}: UseTokenGateActionsArgs) {
  const wallet = useWalletStore();

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
      setTokenGateProofs,
      setProofAwareEvaluation,
      setVerifyingTokenGateChain,
    ],
  );

  return { connectTokenGateChain, verifyTokenGateWallet };
}

export type { UseMiscActionsArgs } from "./use-signing-actions-misc";
export { useMiscActions } from "./use-signing-actions-misc";
export type { UseSignSubmitArgs } from "./use-signing-actions-submit";
// Re-export from dedicated modules
export { useSignSubmit } from "./use-signing-actions-submit";
