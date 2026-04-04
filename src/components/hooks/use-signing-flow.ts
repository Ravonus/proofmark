"use client";

/**
 * useSigningFlow — single hook powering the document signing page.
 *
 * Architecture:
 *   State lives in useSigningStore (Zustand) + local refs.
 *   Derived values are pure useMemo — no sync effects.
 *   Side-effects are limited to: forensic tracker init, draft load,
 *   mobile-sign poll processing, and token-gate reset on signer change.
 *
 * Subsystems:
 *   1. Forensic tracking  — BehavioralTracker + optional gaze via WebGazer
 *   2. Token gates         — simple (server-eval) or proof-aware (multi-chain)
 *   3. Field management    — validation, visibility, auto-fill, debounced save
 *   4. Signing actions     — sign / finalize / bulk-finalize with wallet
 *   5. Identity & social   — IDV, social-verify popup, payment checkout
 */

import { useRef, useState, useMemo, useCallback, useEffect } from "react";
import { trpc } from "~/lib/trpc";
import { useWalletStore } from "~/stores/wallet";
import { getWalletActions } from "~/components/wallet-provider";
import { generateQrDataUrl } from "~/lib/qr-svg";
import { useSigningStore } from "~/stores/signing";
import { encodeStructuredFieldValue } from "~/lib/document/field-values";
import type { AttachmentFieldValue } from "~/lib/document/field-values";
import {
  formatEditableFieldValue,
  getFieldLogicState,
  isFieldVisible,
  isFieldRequired,
} from "~/lib/document/field-runtime";
import { VERIFY_FIELD_TYPES } from "~/lib/signing/signing-constants";
import { tokenizeDocument } from "~/lib/document/document-tokens";
import type { InlineField, DocToken } from "~/lib/document/document-tokens";
import { validateField } from "~/components/signing/sign-document-helpers";
import { isActionableRecipientRole, isApprovalRecipientRole } from "~/lib/signing/recipient-roles";
import { buildAddressSuggestionFieldUpdates, type AddressSuggestion } from "~/lib/address-autocomplete";
import { collectFingerprintBestEffort, BehavioralTracker, warmForensicReplayCore } from "~/lib/forensic";
import type { BehavioralSignals } from "~/lib/forensic";
import { CHAIN_META, normalizeAddress, type WalletChain } from "~/lib/chains";
import {
  buildTokenGateProofMessage,
  getSignerTokenGateChains,
  type ProofAwareTokenGateEvaluation,
  type TokenGateWalletProof,
  type TokenGateWalletVerification,
} from "~/lib/token-gates";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fallback behavioral signals when the tracker fails or is absent. */
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

/** Whether the user intentionally cancelled (don't show as error). */
function isUserRejection(msg: string): boolean {
  return msg.includes("rejected") || msg.includes("denied");
}

/**
 * Run a wallet-signing action (sign / finalize / bulk-finalize) with
 * shared error handling: sets signing phase, catches errors, scrolls
 * to error banner, and always resets phase on completion.
 */
async function runSigningAction(
  store: { startSigning: () => void; setSigningError: (e: string | null) => void; resetSigning: () => void },
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

export function useSigningFlow(documentId: string, claimToken: string | null) {
  const wallet = useWalletStore();
  const store = useSigningStore();

  // ── Forensic tracker (initialized once via useEffect) ───────────────────────
  const behavioralTracker = useRef<BehavioralTracker | null>(null);
  const visitIndexRef = useRef(0);
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socialPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveSessionMutation = trpc.document.saveForensicSession.useMutation();
  const saveFieldValuesMut = trpc.document.saveFieldValues.useMutation();

  useEffect(() => {
    warmForensicReplayCore();

    // Load visit count from sessionStorage so we track multiple visits
    const visitKey = `pm_visit_${documentId}`;
    const prevVisits = parseInt(sessionStorage.getItem(visitKey) ?? "0", 10);
    visitIndexRef.current = prevVisits;
    sessionStorage.setItem(visitKey, String(prevVisits + 1));

    const tracker = new BehavioralTracker(prevVisits);
    tracker.start();
    behavioralTracker.current = tracker;

    return () => {
      if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
      if (socialPollRef.current) clearInterval(socialPollRef.current);

      // Best-effort: save forensic session before the user leaves the page
      if (claimToken && tracker) {
        void (async () => {
          try {
            const behavioral = await tracker.collect();
            saveSessionMutation.mutate({
              documentId,
              claimToken,
              session: {
                sessionId: tracker.sessionId,
                visitIndex: tracker.visitIndex,
                startedAt: tracker.startedAt,
                endedAt: new Date().toISOString(),
                durationMs: behavioral.timeOnPage,
                behavioral: behavioral as unknown as Record<string, unknown>,
                replay: behavioral.replay as unknown as Record<string, unknown> | null,
              },
            });
          } catch {
            // Best-effort — don't block navigation
          }
        })();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: tracker init + cleanup must not re-run
  }, []);

  // ── Draft storage key ──────────────────────────────────────────────────────
  const draftKey = useMemo(
    () => `proofmark-sign-draft:${documentId}:${claimToken ?? "wallet"}`,
    [documentId, claimToken],
  );

  useEffect(() => {
    store.setDraftStorageKey(draftKey);
    store.loadDraft();
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── tRPC queries/mutations ─────────────────────────────────────────────────
  const docQuery = trpc.document.get.useQuery(
    {
      id: documentId,
      claimToken: claimToken ?? undefined,
      viewerAddress: wallet.address ?? undefined,
      viewerChain: wallet.chain ?? undefined,
    },
    { enabled: !!claimToken || (wallet.connected && !!wallet.address) },
  );

  const signMutation = trpc.document.sign.useMutation({
    onSuccess: () => {
      store.completeSigning();
      store.clearDraft();
      void docQuery.refetch();
    },
  });

  const declineMut = trpc.document.declineSign.useMutation({
    onSuccess: () => store.declineSigning(),
  });

  const runIdentityVerification = trpc.document.runIdentityVerification.useMutation();
  const startPaymentCheckout = trpc.document.createPaymentCheckout.useMutation();
  const getSigningMessageMut = trpc.document.getSigningMessage.useMutation();
  const getFinalizationMessageMut = trpc.document.getFinalizationMessage.useMutation();
  const finalizeMut = trpc.document.finalize.useMutation({
    onSuccess: () => {
      store.completeSigning();
      void docQuery.refetch();
    },
  });
  const getBulkFinalizationMessageMut = trpc.document.getBulkFinalizationMessage.useMutation();
  const bulkFinalizeMut = trpc.document.bulkFinalize.useMutation({
    onSuccess: () => {
      store.completeSigning();
      void docQuery.refetch();
    },
  });
  const addressSuggestionsMutation = trpc.document.addressSuggestions.useMutation();
  const evaluateTokenGateWallets = trpc.document.evaluateTokenGateWallets.useMutation();
  const [tokenGateProofs, setTokenGateProofs] = useState<Record<WalletChain, TokenGateWalletProof>>(
    {} as Record<WalletChain, TokenGateWalletProof>,
  );
  const [proofAwareEvaluation, setProofAwareEvaluation] = useState<ProofAwareTokenGateEvaluation | null>(null);
  const [verifyingTokenGateChain, setVerifyingTokenGateChain] = useState<WalletChain | null>(null);

  const createMobileSession = trpc.document.createMobileSignSession.useMutation({
    onSuccess: async (data) => {
      behavioralTracker.current?.recordModal("mobile_sign_qr", true);
      store.setShowQr(true);
      const img = await generateQrDataUrl(data.url, 280);
      store.setQrData(data.token, data.url, img);
    },
  });

  // Mobile poll — derived state replaces useEffect #2
  const mobileSignPoll = trpc.document.pollMobileSign.useQuery(
    { token: store.qrToken ?? "" },
    { enabled: !!store.qrToken && store.showQr, refetchInterval: 2000 },
  );

  // Process mobile poll result
  useEffect(() => {
    if (mobileSignPoll.data?.status === "signed" && mobileSignPoll.data.signatureData) {
      if (store.qrMode === "initials" && store.qrFieldId) {
        handleFieldChange(store.qrFieldId, mobileSignPoll.data.signatureData);
      } else {
        store.setHandSignature(mobileSignPoll.data.signatureData);
      }
      behavioralTracker.current?.recordModal("mobile_sign_qr", false);
      store.setShowQr(false);
      store.clearQr();
    }
  }, [mobileSignPoll.data?.status, mobileSignPoll.data?.signatureData]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentSignerId = docQuery.data?.signers?.find((signer) => signer.isYou)?.id;

  useEffect(() => {
    setTokenGateProofs({} as Record<WalletChain, TokenGateWalletProof>);
    setProofAwareEvaluation(null);
    setVerifyingTokenGateChain(null);
  }, [documentId, claimToken, currentSignerId]);

  // ── Derived document state (all useMemo, no useEffect) ─────────────────────
  const doc = docQuery.data ?? null;
  const docSigners = useMemo(() => doc?.signers ?? [], [doc?.signers]);

  /** Whether the wallet session is fully connected with address + chain. */
  const walletReady = wallet.connected && !!wallet.address && !!wallet.chain;

  const derivedState = useMemo(() => {
    // Resolve which signer row belongs to the current viewer
    const mySigner = docSigners.find((s) => s.isYou) ?? null;
    const mySignerByAddress =
      wallet.connected && wallet.address
        ? (docSigners.find((s) => s.address?.toLowerCase() === wallet.address!.toLowerCase()) ?? null)
        : null;
    const currentSigner = mySigner ?? mySignerByAddress;

    const isCreator = !!(
      wallet.connected &&
      wallet.address &&
      doc?.createdBy?.toLowerCase() === wallet.address.toLowerCase()
    );

    const currentRole = currentSigner?.role ?? "SIGNER";
    const isActionable = isActionableRecipientRole(currentRole);
    const needsDrawnSig = isActionable && !isApprovalRecipientRole(currentRole);
    const mySignerIdx = currentSigner ? docSigners.findIndex((s) => s.id === currentSigner.id) : -1;

    const alreadySigned = currentSigner?.status === "SIGNED";
    const actionableSigners = docSigners.filter((s) => isActionableRecipientRole(s.role));
    const signedCount = actionableSigners.filter((s) => s.status === "SIGNED").length;
    const totalRecipients = actionableSigners.length || docSigners.length;

    // Discloser finalization: they've signed, all others signed, no finalization sig yet
    const isDiscloser = (currentSigner as { groupRole?: string | null } | undefined)?.groupRole === "discloser";
    const othersAllDone = actionableSigners
      .filter((s) => s.id !== currentSigner?.id)
      .every((s) => s.status === "SIGNED");
    const needsFinalization = !!(
      isDiscloser &&
      alreadySigned &&
      othersAllDone &&
      !(currentSigner as { finalizationSignature?: string | null } | undefined)?.finalizationSignature
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
  }, [docSigners, wallet.connected, wallet.address, doc]);

  // ── Token gate evaluation ─────────────────────────────────────────────────
  // Two modes: "simple" uses server-side evaluation on the signer row;
  // "proof-aware" collects wallet proofs for multi-chain gates or dev bypass.

  const tokenGateChains = useMemo(
    () => getSignerTokenGateChains(derivedState.currentSigner?.tokenGates),
    [derivedState.currentSigner?.tokenGates],
  );

  const requiresTokenGateWalletProofs = useMemo(() => {
    const gate = derivedState.currentSigner?.tokenGates;
    if (!gate) return false;
    return gate.devBypass || tokenGateChains.length > 1;
  }, [derivedState.currentSigner?.tokenGates, tokenGateChains]);

  const tokenGateWallets = useMemo<TokenGateWalletVerification[]>(() => {
    if (!requiresTokenGateWalletProofs) return [];
    if (proofAwareEvaluation?.wallets?.length) return proofAwareEvaluation.wallets;
    return tokenGateChains.map((chain) => ({
      chain,
      status: "missing" as const,
      message: `Connect and verify a ${CHAIN_META[chain].label} wallet.`,
    }));
  }, [proofAwareEvaluation, requiresTokenGateWalletProofs, tokenGateChains]);

  // Merge simple + proof-aware evaluations into a single "effective" result
  const tokenGateEvaluation = requiresTokenGateWalletProofs
    ? proofAwareEvaluation
    : (derivedState.currentSigner?.tokenGateEvaluation ?? null);
  const tokenGateEligible = tokenGateEvaluation
    ? tokenGateEvaluation.eligible
    : !derivedState.currentSigner?.tokenGates;
  const tokenGateBlocked =
    !!derivedState.currentSigner?.tokenGates &&
    ((!requiresTokenGateWalletProofs && walletReady && !!claimToken && !tokenGateEligible) ||
      (requiresTokenGateWalletProofs && tokenGateWallets.some((entry) => entry.status !== "verified")));

  const canSign =
    !!derivedState.currentSigner &&
    derivedState.currentSigner.status === "PENDING" &&
    derivedState.currentSigner.canSign !== false &&
    derivedState.isActionable &&
    walletReady &&
    !!claimToken &&
    tokenGateEligible;

  // Tokenize document (pure derived)
  const { tokens, fields: inlineFields } = useMemo(
    () =>
      doc
        ? tokenizeDocument(doc.content, docSigners.length)
        : { tokens: [] as DocToken[], fields: [] as InlineField[] },
    [doc, docSigners.length],
  );

  // My field IDs (pure derived)
  const myFieldIds = useMemo(
    () =>
      new Set(
        inlineFields
          .filter((f) => derivedState.isActionable && (f.signerIdx === derivedState.mySignerIdx || f.signerIdx === -1))
          .map((f) => f.id),
      ),
    [inlineFields, derivedState.isActionable, derivedState.mySignerIdx],
  );

  // Merged field values (pure derived)
  const { mergedFieldValues, allFieldValues } = useMemo(() => {
    const otherValues: Record<string, string> = {};
    for (const s of docSigners) {
      if (s.fieldValues && s.id !== derivedState.currentSigner?.id) {
        for (const [k, v] of Object.entries(s.fieldValues)) {
          if (v) otherValues[k] = v;
        }
      }
    }
    const merged = { ...otherValues, ...store.fieldValues };

    const all: Record<string, string> = {};
    for (const s of doc?.signers ?? []) {
      if (s.fieldValues) {
        for (const [k, v] of Object.entries(s.fieldValues)) {
          if (v) all[k] = v;
        }
      }
    }
    for (const [k, v] of Object.entries(store.fieldValues)) {
      if (v) all[k] = v;
    }

    return { mergedFieldValues: merged, allFieldValues: all };
  }, [docSigners, derivedState.currentSigner, store.fieldValues, doc]);

  // Visible fields for this signer (pure derived)
  const myFieldsList = useMemo(
    () => inlineFields.filter((f) => myFieldIds.has(f.id) && isFieldVisible(f, mergedFieldValues)),
    [inlineFields, myFieldIds, mergedFieldValues],
  );

  // Validation state (pure derived)
  const validationState = useMemo(() => {
    const opts = { signatureReady: !!store.handSignature, allValues: mergedFieldValues };
    const requiredFields = myFieldsList.filter((f) => isFieldRequired(f, mergedFieldValues));
    const completed = requiredFields.filter((f) => !validateField(f, store.fieldValues[f.id], opts)).length;
    const remaining = Math.max(0, requiredFields.length - completed);
    const allComplete = requiredFields.length === 0 || remaining === 0;
    const canFinalize = (!derivedState.needsDrawnSig || !!store.handSignature) && allComplete;

    return { requiredFields, completed, remaining, allComplete, canFinalize, opts };
  }, [myFieldsList, mergedFieldValues, store.handSignature, store.fieldValues, derivedState.needsDrawnSig]);

  // Field groups for "fill all matching" (pure derived)
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

  // Signing message for confirmation modal (pure derived)
  const confirmSigningMessage = useMemo(() => {
    if (!wallet.address || !wallet.chain || !derivedState.currentSigner) return "";
    if (derivedState.needsDrawnSig && !store.handSignature) return "";
    return `proofmark:${doc?.contentHash ?? ""}:${normalizeAddress(wallet.chain, wallet.address)}:${derivedState.currentSigner.label}`;
  }, [wallet.address, wallet.chain, derivedState.currentSigner, derivedState.needsDrawnSig, store.handSignature, doc]);

  // ── Actions ────────────────────────────────────────────────────────────────

  // Imported from shared constants — verify fields are read-only

  const handleFieldChange = useCallback(
    (fieldId: string, value: string) => {
      if (!myFieldIds.has(fieldId)) return;
      const field = inlineFields.find((f) => f.id === fieldId);
      if (!field) return;
      // Verify fields are read-only — only set via verification flow
      if (VERIFY_FIELD_TYPES.has(field.type)) return;
      const next = formatEditableFieldValue(field, value);
      store.setFieldValue(fieldId, next);
      behavioralTracker.current?.recordFieldValue(fieldId, next);

      // Clear hidden fields (replaces useEffect #6)
      const allVals = { ...mergedFieldValues, [fieldId]: next };
      for (const f of inlineFields) {
        const state = getFieldLogicState(f, allVals);
        if (!state.visible && state.clearWhenHidden && f.id in store.fieldValues) {
          store.setFieldValue(f.id, "");
          behavioralTracker.current?.recordFieldValue(f.id, "");
        }
      }

      // Auto-save draft locally (always) + debounced server save (gated)
      store.saveDraft();

      // Server save is blocked if this signer has verify fields that haven't
      // been completed yet — we need to know who they are first.
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
          const vals = store.fieldValues;
          if (Object.keys(vals).length > 0) {
            saveFieldValuesMut.mutate({ documentId, claimToken, fieldValues: vals });
          }
        }, 1500);
      }
    },
    [myFieldIds, myFieldsList, inlineFields, mergedFieldValues, store, claimToken, documentId, saveFieldValuesMut],
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
    [inlineFields, fieldsByTypeLabel, store],
  );

  const setHandSignatureWithAutoFill = useCallback(
    (data: string | null) => {
      store.setHandSignature(data);
      // Auto-fill signature fields (replaces useEffect #5)
      for (const f of myFieldsList) {
        if (f.type === "signature") {
          store.setFieldValue(f.id, data ?? "");
          behavioralTracker.current?.recordFieldValue(f.id, data ?? "");
        }
      }
      store.saveDraft();
    },
    [myFieldsList, store],
  );

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
    [myFieldsList, store],
  );

  const goToNextField = useCallback(() => {
    const emptyIdx = myFieldsList.findIndex((f) => !!validateField(f, store.fieldValues[f.id], validationState.opts));
    if (emptyIdx !== -1) navigateToField(emptyIdx, "jump");
  }, [myFieldsList, store.fieldValues, validationState.opts, navigateToField]);

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
    [myFieldsList, store],
  );

  const handleFieldBlur = useCallback(
    (fieldId: string) => {
      behavioralTracker.current?.recordFieldBlur(fieldId);
      store.setActiveField(null);
    },
    [store],
  );

  const setShowSigPadTracked = useCallback(
    (next: boolean) => {
      behavioralTracker.current?.recordModal("signature_pad", next);
      store.setShowSigPad(next);
    },
    [store],
  );

  const setShowQrTracked = useCallback(
    (next: boolean) => {
      behavioralTracker.current?.recordModal("mobile_sign_qr", next);
      store.setShowQr(next);
    },
    [store],
  );

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
      if (!claimToken || !derivedState.currentSigner?.tokenGates) {
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
      derivedState.currentSigner?.tokenGates,
      wallet.connected,
      wallet.address,
      wallet.chain,
      documentId,
      tokenGateProofs,
      evaluateTokenGateWallets,
    ],
  );

  const handleSign = useCallback(async () => {
    if (!wallet.address || !wallet.chain || !claimToken || !derivedState.currentSigner) return;
    if (!tokenGateEligible) return;
    if (derivedState.needsDrawnSig && !store.handSignature) return;

    // Focus the first invalid field so the user knows what to fix
    for (const f of myFieldsList) {
      if (validateField(f, store.fieldValues[f.id] ?? "", validationState.opts)) {
        document.getElementById(f.id)?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
        return;
      }
    }

    const proofsList = Object.values(tokenGateProofs);
    const fieldVals = Object.keys(store.fieldValues).length > 0 ? store.fieldValues : undefined;

    await runSigningAction(
      store,
      async () => {
        // Server message includes documentStateHash covering template + all field values
        const { message } = await getSigningMessageMut.mutateAsync({
          documentId,
          claimToken,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
          handSignatureData: store.handSignature || undefined,
          tokenGateProofs: proofsList.length > 0 ? proofsList : undefined,
          fieldValues: fieldVals,
        });

        const actions = getWalletActions();
        const signature = await actions.signMessage(message);

        // Collect forensic evidence (fingerprint + behavioral signals)
        const fingerprint = await collectFingerprintBestEffort();
        behavioralTracker.current?.logAction("sign_submitted");
        let behavioral: BehavioralSignals;
        try {
          behavioral = (await behavioralTracker.current?.collect()) ?? { ...EMPTY_BEHAVIORAL };
        } catch {
          behavioral = { ...EMPTY_BEHAVIORAL };
        }

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
            fingerprint: fingerprint as unknown as Record<string, unknown>,
            behavioral: behavioral as unknown as Record<string, unknown>,
            session: behavioralTracker.current
              ? {
                  sessionId: behavioralTracker.current.sessionId,
                  visitIndex: behavioralTracker.current.visitIndex,
                  startedAt: behavioralTracker.current.startedAt,
                  endedAt: new Date().toISOString(),
                  durationMs: behavioral.timeOnPage,
                }
              : undefined,
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
    validationState,
    signMutation,
    documentId,
    tokenGateEligible,
    tokenGateProofs,
    getSigningMessageMut,
  ]);

  const handleFinalize = useCallback(async () => {
    if (!wallet.address || !wallet.chain || !claimToken || !derivedState.needsFinalization) return;

    await runSigningAction(
      store,
      async () => {
        const { message } = await getFinalizationMessageMut.mutateAsync({
          documentId,
          claimToken,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
        });
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
    const groupId = (doc as { groupId?: string | null })?.groupId;
    if (!groupId) return handleFinalize();

    await runSigningAction(
      store,
      async () => {
        const { message } = await getBulkFinalizationMessageMut.mutateAsync({
          groupId: groupId,
          claimToken: claimToken,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
        });
        const signature = await getWalletActions().signMessage(message);
        await bulkFinalizeMut.mutateAsync({
          groupId: groupId,
          claimToken: claimToken,
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

  const loadAddressSuggestions = useCallback(
    async (query: string, field: InlineField) => {
      if (!claimToken || query.trim().length < 3) return [];
      const result = await addressSuggestionsMutation.mutateAsync({
        documentId,
        claimToken,
        fieldId: field.id,
        query: query.trim(),
        limit: 5,
      });
      return result.suggestions;
    },
    [addressSuggestionsMutation, claimToken, documentId],
  );

  const applyAddressSuggestion = useCallback(
    (field: InlineField, suggestion: AddressSuggestion) => {
      const updates = buildAddressSuggestionFieldUpdates({
        anchorField: field,
        fields: inlineFields,
        suggestion,
      });
      for (const [fieldId, rawValue] of Object.entries(updates)) {
        const target = inlineFields.find((f) => f.id === fieldId);
        if (target) {
          const next = formatEditableFieldValue(target, rawValue);
          store.setFieldValue(fieldId, next);
          behavioralTracker.current?.recordFieldValue(fieldId, next);
        }
      }
      store.saveDraft();
    },
    [inlineFields, store],
  );

  return {
    // Queries
    docQuery,
    doc,
    docSigners,
    tokens,
    inlineFields,

    // Derived state
    ...derivedState,
    tokenGateEvaluation,
    tokenGateEligible,
    tokenGateBlocked,
    canSign,
    requiresTokenGateWalletProofs,
    tokenGateChains,
    tokenGateWallets,
    verifyingTokenGateChain,
    tokenGateWalletError: evaluateTokenGateWallets.error?.message ?? null,
    myFieldIds,
    myFieldsList,
    mergedFieldValues,
    allFieldValues,
    ...validationState,
    fieldsByTypeLabel,
    confirmSigningMessage,

    signing: store.phase === "signing",
    done: store.phase === "done",
    declined: store.phase === "declined",
    email: store.email,
    handSignature: store.handSignature,
    fieldValues: store.fieldValues,
    activeField: store.activeField,
    currentFieldIdx: store.currentFieldIdx,
    showSigPad: store.showSigPad,
    showQr: store.showQr,
    showConfirmModal: store.showConfirmModal,
    qrUrl: store.qrUrl,
    qrImage: store.qrImage,
    qrMode: store.qrMode,
    forensicTracker: behavioralTracker.current,

    // Actions
    handleFieldChange,
    fillMatching,
    setEmail: store.setEmail,
    setHandSignature: setHandSignatureWithAutoFill,
    setShowSigPad: setShowSigPadTracked,
    setShowQr: setShowQrTracked,
    setShowConfirmModal: store.setShowConfirmModal,
    setActiveField: store.setActiveField,
    handleFieldFocus,
    handleFieldBlur,
    navigateToField,
    goToNextField,
    goToPrevField,
    goToNextFieldNav,
    connectTokenGateChain,
    verifyTokenGateWallet,
    handleSign,
    handleFinalize,
    handleBulkFinalize,
    needsFinalization: derivedState.needsFinalization,
    groupId: (doc as { groupId?: string | null })?.groupId ?? null,
    signingError: store.signingError,
    clearSigningError: () => store.setSigningError(null),
    declineMut,
    loadAddressSuggestions,
    applyAddressSuggestion,
    createMobileSession,
    triggerMobileInitials: (field: InlineField) => {
      if (!claimToken || !derivedState.currentSigner) return;
      createMobileSession.mutate(
        { documentId, claimToken, signerLabel: derivedState.currentSigner.label, mode: "initials" as const },
        {
          onSuccess: (data) => {
            behavioralTracker.current?.recordModal("mobile_sign_qr", true);
            store.setShowQr(true);
            void (async () => {
              const img = await generateQrDataUrl(data.url, 280);
              store.setQrData(data.token, data.url, img, "initials", field.id);
            })();
          },
        },
      );
    },
    triggerIdentityCheck: async (field: InlineField) => {
      if (!claimToken) throw new Error("Missing claim token");
      const result = await runIdentityVerification.mutateAsync({
        documentId,
        claimToken,
        fieldValues: store.fieldValues,
      });
      const encoded = encodeStructuredFieldValue(result.verification);
      handleFieldChange(field.id, encoded);
      return encoded;
    },
    triggerSocialVerify: (field: InlineField) => {
      if (!claimToken) throw new Error("Missing claim token");
      const providerMap: Record<string, string> = {
        "x-verify": "x",
        "github-verify": "github",
        "discord-verify": "discord",
        "google-verify": "google",
      };
      const provider = providerMap[field.type];
      if (!provider) throw new Error(`Unknown social verify field type: ${field.type}`);

      const params = new URLSearchParams({
        provider,
        documentId,
        claimToken,
        fieldId: field.id,
        callbackOrigin: window.location.origin,
      });
      const popupUrl = `/api/social-verify?${params.toString()}`;
      const popup = window.open(popupUrl, "social-verify", "width=600,height=700,popup=true");

      // Clear any previous social poll before starting a new one
      if (socialPollRef.current) clearInterval(socialPollRef.current);

      const startedAt = Date.now();
      const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min max

      const stopPolling = () => {
        if (socialPollRef.current) {
          clearInterval(socialPollRef.current);
          socialPollRef.current = null;
        }
      };

      // Poll server until verification completes, popup closes, or timeout
      socialPollRef.current = setInterval(() => {
        if (popup?.closed || Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stopPolling();
          return;
        }

        void docQuery.refetch().then((res) => {
          if (!res.data) return;
          const signer = res.data.signers?.find((s: { isYou?: boolean }) => s.isYou);
          const serverVal = signer?.fieldValues?.[field.id];
          if (!serverVal) return;

          try {
            const parsed = JSON.parse(serverVal) as {
              kind?: string;
              status?: string;
              provider?: string;
              username?: string;
            };
            if (parsed.kind !== "social-verification" || parsed.status !== "verified") return;

            handleFieldChange(field.id, serverVal);

            // Auto-fill matching handle/email fields for this signer
            if (parsed.username) {
              const providerFieldMap: Record<string, string[]> = {
                x: ["twitter-handle"],
                github: ["github-handle"],
                discord: ["discord-handle"],
                google: ["email", "secondary-email"],
              };
              const autoFillTypes = providerFieldMap[parsed.provider ?? ""] ?? [];
              for (const f of inlineFields) {
                if (autoFillTypes.includes(f.type) && f.signerIdx === field.signerIdx && !store.fieldValues[f.id]) {
                  handleFieldChange(f.id, parsed.provider === "google" ? parsed.username : `@${parsed.username}`);
                }
              }
            }

            stopPolling();
            if (popup && !popup.closed) popup.close();
          } catch {
            /* not valid JSON yet */
          }
        });
      }, 2000);
    },
    triggerPayment: async (field: InlineField) => {
      if (!claimToken) throw new Error("Missing claim token");
      const result = await startPaymentCheckout.mutateAsync({
        documentId,
        claimToken,
        fieldId: field.id,
      });
      window.location.assign(result.checkoutUrl);
    },
    uploadAttachment: async (field: InlineField, file: File) => {
      if (!claimToken) throw new Error("Missing claim token");
      const formData = new FormData();
      formData.set("documentId", documentId);
      formData.set("claimToken", claimToken);
      formData.set("fieldId", field.id);
      formData.set("file", file);
      const response = await fetch("/api/signer-attachments", { method: "POST", body: formData });
      const payload = (await response.json()) as {
        attachment?: AttachmentFieldValue;
        error?: string;
      };
      if (!response.ok || !payload.attachment) throw new Error(payload.error || "Attachment upload failed");
      const encoded = encodeStructuredFieldValue(payload.attachment);
      handleFieldChange(field.id, encoded);
      return encoded;
    },

    // Wallet
    wallet,
  };
}
