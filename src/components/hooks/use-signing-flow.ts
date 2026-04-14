"use client";

/**
 * useSigningFlow — single hook powering the document signing page.
 *
 * Composed from sub-hooks:
 *   - useSigningTokenGates   — token gate evaluation + wallet proofs
 *   - useSigningTriggers     — IDV, social-verify, payments, attachments, mobile
 *   - useFieldManagement     — field values, validation, draft persistence
 *   - useFieldNavigation     — field focus, navigation, scroll
 *   - useSigningMutations    — sign / finalize / bulk-finalize with wallet
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { type AddressSuggestion, buildAddressSuggestionFieldUpdates } from "~/lib/address-autocomplete";
import { normalizeAddress } from "~/lib/crypto/chains";
import type { DocToken, InlineField } from "~/lib/document/document-tokens";
import { tokenizeDocument } from "~/lib/document/document-tokens";
import { formatEditableFieldValue } from "~/lib/document/field-runtime";
import { BehavioralTracker, warmForensicReplayCore } from "~/lib/forensic";
import { trpc } from "~/lib/platform/trpc";
import { isActionableRecipientRole, isApprovalRecipientRole } from "~/lib/signing/recipient-roles";
import { useSigningStore } from "~/stores/signing";
import { useWalletStore } from "~/stores/wallet";
import { useFieldManagement, useFieldNavigation } from "./use-signing-fields";
import { useSigningMutations } from "./use-signing-mutations";
import { useSigningTokenGates } from "./use-signing-token-gates";
import { useSigningTriggers } from "./use-signing-triggers";

// ── Sub-hook: forensic tracking ──

function useForensicTracker(documentId: string, claimToken: string | null) {
  const behavioralTracker = useRef<BehavioralTracker | null>(null);
  const claimTokenRef = useRef<string | null>(claimToken);
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveSessionMutation = trpc.document.saveForensicSession.useMutation();

  useEffect(() => {
    claimTokenRef.current = claimToken;
  }, [claimToken]);

  useEffect(() => {
    warmForensicReplayCore();
    const visitKey = `pm_visit_${documentId}`;
    const prevVisits = parseInt(sessionStorage.getItem(visitKey) ?? "0", 10);
    sessionStorage.setItem(visitKey, String(prevVisits + 1));
    const tracker = new BehavioralTracker(prevVisits);
    tracker.start();
    behavioralTracker.current = tracker;

    return () => {
      if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
      const currentClaimToken = claimTokenRef.current;
      if (currentClaimToken && tracker) {
        void (async () => {
          try {
            const behavioral = await tracker.collect();
            saveSessionMutation.mutate({
              documentId,
              claimToken: currentClaimToken,
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
            /* best-effort */
          }
        })();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  return { behavioralTracker, serverSaveTimer };
}

// ── Sub-hook: derived signer state ──

type SignerRow = {
  id: string;
  isYou?: boolean;
  address?: string | null;
  status: string;
  role: string;
  label: string;
  groupRole?: string | null;
  finalizationSignature?: string | null;
};

function useDerivedSignerState(docSigners: SignerRow[], doc: { createdBy: string } | null) {
  const wallet = useWalletStore();
  return useMemo(() => {
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
  }, [docSigners, wallet.connected, wallet.address, doc]);
}

// ── Main hook ──

export function useSigningFlow(documentId: string, claimToken: string | null) {
  const wallet = useWalletStore();
  const store = useSigningStore();
  const { behavioralTracker, serverSaveTimer } = useForensicTracker(documentId, claimToken);

  // Draft
  const draftKey = useMemo(
    () => `proofmark-sign-draft:${documentId}:${claimToken ?? "wallet"}`,
    [documentId, claimToken],
  );
  useEffect(() => {
    store.setDraftStorageKey(draftKey);
    store.loadDraft();
  }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Query
  const docQuery = trpc.document.get.useQuery(
    {
      id: documentId,
      claimToken: claimToken ?? undefined,
      viewerAddress: wallet.address ?? undefined,
      viewerChain: wallet.chain ?? undefined,
    },
    { enabled: !!documentId },
  );
  const addressSuggestionsMutation = trpc.document.addressSuggestions.useMutation();
  const mobileSignPoll = trpc.document.pollMobileSign.useQuery(
    { token: store.qrToken ?? "" },
    {
      enabled: !!store.qrToken && store.showQr,
      refetchInterval: 2000,
    },
  );

  // Derived
  const doc = docQuery.data ?? null;
  const docSigners = useMemo(() => doc?.signers ?? [], [doc?.signers]);
  const walletReady = wallet.connected && !!wallet.address && !!wallet.chain;
  const derivedState = useDerivedSignerState(docSigners as SignerRow[], doc);

  // Token gates
  const currentSignerId = docQuery.data?.signers?.find((s) => s.isYou)?.id;
  const tokenGates = useSigningTokenGates(
    documentId,
    claimToken,
    derivedState.currentSigner as Parameters<typeof useSigningTokenGates>[2],
    currentSignerId,
  );
  useEffect(() => {
    tokenGates.resetTokenGates();
  }, [documentId, claimToken, currentSignerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSign =
    !!derivedState.currentSigner &&
    derivedState.currentSigner.status === "PENDING" &&
    (derivedState.currentSigner as { canSign?: boolean }).canSign !== false &&
    derivedState.isActionable &&
    walletReady &&
    !!claimToken &&
    tokenGates.tokenGateEligible;

  // Tokenize + fields
  const { tokens, fields: inlineFields } = useMemo(
    () =>
      doc
        ? tokenizeDocument(doc.content, docSigners.length)
        : {
            tokens: [] as DocToken[],
            fields: [] as InlineField[],
          },
    [doc, docSigners.length],
  );
  const fields = useFieldManagement({
    inlineFields,
    mySignerIdx: derivedState.mySignerIdx,
    isActionable: derivedState.isActionable,
    needsDrawnSig: derivedState.needsDrawnSig,
    currentSigner: derivedState.currentSigner,
    docSigners,
    allSigners: doc?.signers ?? [],
    behavioralTracker,
    claimToken,
    documentId,
    serverSaveTimer,
  });

  // Mobile poll effect
  useEffect(() => {
    if (mobileSignPoll.data?.status !== "signed" || !mobileSignPoll.data.signatureData) return;
    if (store.qrMode === "initials" && store.qrFieldId)
      fields.handleFieldChange(store.qrFieldId, mobileSignPoll.data.signatureData);
    else store.setHandSignature(mobileSignPoll.data.signatureData);
    behavioralTracker.current?.recordModal("mobile_sign_qr", false);
    store.setShowQr(false);
    store.clearQr();
  }, [mobileSignPoll.data?.status, mobileSignPoll.data?.signatureData]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmSigningMessage = useMemo(() => {
    if (!wallet.address || !wallet.chain || !derivedState.currentSigner) return "";
    if (derivedState.needsDrawnSig && !store.handSignature) return "";
    return `proofmark:${doc?.contentHash ?? ""}:${normalizeAddress(wallet.chain, wallet.address)}:${derivedState.currentSigner.label}`;
  }, [wallet.address, wallet.chain, derivedState.currentSigner, derivedState.needsDrawnSig, store.handSignature, doc]);

  // Navigation + UI toggles
  const nav = useFieldNavigation(fields.myFieldsList, behavioralTracker, fields.validationState.opts);
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

  // Signing mutations
  const onRefetch = useCallback(() => {
    void docQuery.refetch();
  }, [docQuery]);
  const mutations = useSigningMutations({
    documentId,
    claimToken,
    needsDrawnSig: derivedState.needsDrawnSig,
    needsFinalization: derivedState.needsFinalization,
    currentSigner: derivedState.currentSigner,
    tokenGateEligible: tokenGates.tokenGateEligible,
    tokenGateProofs: tokenGates.tokenGateProofs,
    myFieldsList: fields.myFieldsList,
    validationOpts: fields.validationState.opts,
    behavioralTracker,
    onSignSuccess: () => {
      store.completeSigning();
      store.clearDraft();
      onRefetch();
    },
    onFinalizeSuccess: () => {
      store.completeSigning();
      onRefetch();
    },
  });

  // Address suggestions
  const loadAddressSuggestions = useCallback(
    async (query: string, field: InlineField) => {
      if (!claimToken || query.trim().length < 3) return [];
      return (
        await addressSuggestionsMutation.mutateAsync({
          documentId,
          claimToken,
          fieldId: field.id,
          query: query.trim(),
          limit: 5,
        })
      ).suggestions;
    },
    [addressSuggestionsMutation, claimToken, documentId],
  );
  const applyAddressSuggestion = useCallback(
    (field: InlineField, suggestion: AddressSuggestion) => {
      for (const [fid, raw] of Object.entries(
        buildAddressSuggestionFieldUpdates({
          anchorField: field,
          fields: inlineFields,
          suggestion,
        }),
      )) {
        const t = inlineFields.find((f) => f.id === fid);
        if (t) {
          const v = formatEditableFieldValue(t, raw);
          store.setFieldValue(fid, v);
          behavioralTracker.current?.recordFieldValue(fid, v);
        }
      }
      store.saveDraft();
    },
    [inlineFields, store, behavioralTracker],
  );

  // Triggers
  const triggers = useSigningTriggers({
    documentId,
    claimToken,
    currentSignerLabel: derivedState.currentSigner?.label,
    behavioralTracker,
    inlineFields,
    handleFieldChange: fields.handleFieldChange,
    docQuery: docQuery as { refetch: () => Promise<unknown> },
  });

  const groupId = (doc as { groupId?: string | null })?.groupId ?? null;
  const handleBulkFinalize = useCallback(async () => mutations.handleBulkFinalize(groupId), [mutations, groupId]);

  return {
    docQuery,
    doc,
    docSigners,
    tokens,
    inlineFields,
    ...derivedState,
    ...tokenGates,
    canSign,
    ...fields,
    ...fields.validationState,
    fieldsByTypeLabel: fields.fieldsByTypeLabel,
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
    handleFieldChange: fields.handleFieldChange,
    fillMatching: fields.fillMatching,
    setEmail: store.setEmail,
    setHandSignature: fields.setHandSignatureWithAutoFill,
    setShowSigPad: setShowSigPadTracked,
    setShowQr: setShowQrTracked,
    setShowConfirmModal: store.setShowConfirmModal,
    setActiveField: store.setActiveField,
    ...nav,
    handleSign: mutations.handleSign,
    handleFinalize: mutations.handleFinalize,
    handleBulkFinalize,
    needsFinalization: derivedState.needsFinalization,
    groupId,
    signingError: store.signingError,
    clearSigningError: () => store.setSigningError(null),
    declineMut: mutations.declineMut,
    loadAddressSuggestions,
    applyAddressSuggestion,
    ...triggers,
    wallet,
  };
}
