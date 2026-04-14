"use client";

import { useCallback, useEffect, useMemo } from "react";
import { validateField } from "~/components/signing/sign-document-helpers";
import type { InlineField } from "~/lib/document/document-tokens";
import {
  formatEditableFieldValue,
  getFieldLogicState,
  isFieldRequired,
  isFieldVisible,
} from "~/lib/document/field-runtime";
import type { BehavioralTracker } from "~/lib/forensic";
import { trpc } from "~/lib/platform/trpc";
import { VERIFY_FIELD_TYPES } from "~/lib/signing/signing-constants";
import { type SigningStoreState, useSigningStore } from "~/stores/signing";
import { getEquivalentFieldIds, getFieldMirrorKey } from "./signing-field-sync";

// ── Helpers ──

function clearHiddenFields(
  allVals: Record<string, string>,
  inlineFields: InlineField[],
  store: SigningStoreState,
  behavioralTracker: React.MutableRefObject<BehavioralTracker | null>,
) {
  for (const f of inlineFields) {
    const state = getFieldLogicState(f, allVals);
    if (!state.visible && state.clearWhenHidden && f.id in store.fieldValues) {
      store.setFieldValue(f.id, "");
      behavioralTracker.current?.recordFieldValue(f.id, "");
    }
  }
}

function scheduleServerSave(opts: {
  myFieldsList: InlineField[];
  mergedFieldValues: Record<string, string>;
  serverSaveTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  claimToken: string | null;
  documentId: string;
  store: SigningStoreState;
  saveFieldValuesMut: {
    mutate: (input: { documentId: string; claimToken: string; fieldValues: Record<string, string> }) => void;
  };
}) {
  const { myFieldsList, mergedFieldValues, serverSaveTimer, claimToken, documentId, store, saveFieldValuesMut } = opts;
  const hasVerifyFields = myFieldsList.some((f) => VERIFY_FIELD_TYPES.has(f.type));
  const verificationDone =
    !hasVerifyFields ||
    myFieldsList
      .filter((f) => VERIFY_FIELD_TYPES.has(f.type))
      .some((f) => mergedFieldValues[f.id]?.includes('"status":"verified"'));
  if (!verificationDone) return;
  if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
  serverSaveTimer.current = setTimeout(() => {
    if (!claimToken) return;
    const vals = store.fieldValues;
    if (Object.keys(vals).length > 0) {
      saveFieldValuesMut.mutate({ documentId, claimToken, fieldValues: vals });
    }
  }, 1500);
}

export function collectFieldValues(
  signers: Array<{ fieldValues?: Record<string, string> | null }>,
): Record<string, string> {
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

// ── Field management hook ──

export type FieldManagementOpts = {
  inlineFields: InlineField[];
  mySignerIdx: number;
  isActionable: boolean;
  needsDrawnSig: boolean;
  currentSigner: { id: string } | null;
  docSigners: Array<{
    id: string;
    fieldValues?: Record<string, string> | null;
  }>;
  allSigners: Array<{ fieldValues?: Record<string, string> | null }>;
  behavioralTracker: React.MutableRefObject<BehavioralTracker | null>;
  claimToken: string | null;
  documentId: string;
  serverSaveTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
};

export function useFieldManagement(opts: FieldManagementOpts) {
  const {
    inlineFields,
    mySignerIdx,
    isActionable,
    needsDrawnSig,
    currentSigner,
    docSigners,
    allSigners,
    behavioralTracker,
    claimToken,
    documentId,
    serverSaveTimer,
  } = opts;
  const store = useSigningStore();
  const saveFieldValuesMut = trpc.document.saveFieldValues.useMutation();

  const myFieldIds = useMemo(
    () =>
      new Set(
        inlineFields
          .filter((f) => isActionable && (f.signerIdx === mySignerIdx || f.signerIdx === -1))
          .map((f) => f.id),
      ),
    [inlineFields, isActionable, mySignerIdx],
  );

  const { mergedFieldValues, allFieldValues } = useMemo(
    () => computeMergedFieldValues(docSigners, currentSigner, store.fieldValues, allSigners),
    [docSigners, currentSigner, store.fieldValues, allSigners],
  );

  const myFieldsList = useMemo(
    () => inlineFields.filter((f) => myFieldIds.has(f.id) && isFieldVisible(f, mergedFieldValues)),
    [inlineFields, myFieldIds, mergedFieldValues],
  );

  const validationState = useMemo(() => {
    const validationOpts = {
      signatureReady: !!store.handSignature,
      allValues: mergedFieldValues,
    };
    const requiredFields = myFieldsList.filter((f) => isFieldRequired(f, mergedFieldValues));
    const completed = requiredFields.filter((f) => !validateField(f, store.fieldValues[f.id], validationOpts)).length;
    const remaining = Math.max(0, requiredFields.length - completed);
    const allComplete = requiredFields.length === 0 || remaining === 0;
    const canFinalize = (!needsDrawnSig || !!store.handSignature) && allComplete;
    return {
      requiredFields,
      completed,
      remaining,
      allComplete,
      canFinalize,
      opts: validationOpts,
    };
  }, [myFieldsList, mergedFieldValues, store.handSignature, store.fieldValues, needsDrawnSig]);

  const fieldsByTypeLabel = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const f of myFieldsList) {
      const key = getFieldMirrorKey(f) ?? `field:${f.id}`;
      const arr = map.get(key) ?? [];
      arr.push(f.id);
      map.set(key, arr);
    }
    return map;
  }, [myFieldsList]);

  useEffect(() => {
    const updates: Record<string, string> = {};

    for (const field of myFieldsList) {
      const mirrorKey = getFieldMirrorKey(field);
      if (!mirrorKey) continue;
      if (allFieldValues[field.id]) continue;

      const siblingIds = (fieldsByTypeLabel.get(mirrorKey) ?? []).filter((id) => id !== field.id);
      const siblingValue = siblingIds.find((id) => !!allFieldValues[id]);
      if (!siblingValue) continue;

      updates[field.id] = formatEditableFieldValue(field, allFieldValues[siblingValue] ?? "");
    }

    if (Object.keys(updates).length === 0) return;

    for (const [fieldId, value] of Object.entries(updates)) {
      store.setFieldValue(fieldId, value);
    }

    store.saveDraft();
    scheduleServerSave({
      myFieldsList,
      mergedFieldValues: { ...mergedFieldValues, ...updates },
      serverSaveTimer,
      claimToken,
      documentId,
      store,
      saveFieldValuesMut,
    });
  }, [
    allFieldValues,
    claimToken,
    documentId,
    fieldsByTypeLabel,
    mergedFieldValues,
    myFieldsList,
    saveFieldValuesMut,
    serverSaveTimer,
    store,
  ]);

  const handleFieldChange = useCallback(
    (fieldId: string, value: string) => {
      if (!myFieldIds.has(fieldId)) return;
      const field = inlineFields.find((f) => f.id === fieldId);
      if (!field) return;
      if (VERIFY_FIELD_TYPES.has(field.type)) return;

      const updates: Record<string, string> = {};
      for (const candidateId of getEquivalentFieldIds(field, inlineFields)) {
        if (!myFieldIds.has(candidateId)) continue;
        const candidate = inlineFields.find((entry) => entry.id === candidateId);
        if (!candidate) continue;
        updates[candidateId] = formatEditableFieldValue(candidate, value);
      }

      if (!(fieldId in updates)) {
        updates[fieldId] = formatEditableFieldValue(field, value);
      }

      for (const [candidateId, nextValue] of Object.entries(updates)) {
        store.setFieldValue(candidateId, nextValue);
        behavioralTracker.current?.recordFieldValue(candidateId, nextValue);
      }

      clearHiddenFields({ ...mergedFieldValues, ...updates }, inlineFields, store, behavioralTracker);
      store.saveDraft();
      scheduleServerSave({
        myFieldsList,
        mergedFieldValues: { ...mergedFieldValues, ...updates },
        serverSaveTimer,
        claimToken,
        documentId,
        store,
        saveFieldValuesMut,
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

      const updates: Record<string, string> = {};
      for (const candidateId of getEquivalentFieldIds(field, inlineFields)) {
        const candidate = inlineFields.find((entry) => entry.id === candidateId);
        if (!candidate) continue;
        updates[candidateId] = formatEditableFieldValue(candidate, value);
      }

      for (const [candidateId, nextValue] of Object.entries(updates)) {
        store.setFieldValue(candidateId, nextValue);
        behavioralTracker.current?.recordFieldValue(candidateId, nextValue);
      }

      store.saveDraft();
      clearHiddenFields({ ...mergedFieldValues, ...updates }, inlineFields, store, behavioralTracker);
      scheduleServerSave({
        myFieldsList,
        mergedFieldValues: { ...mergedFieldValues, ...updates },
        serverSaveTimer,
        claimToken,
        documentId,
        store,
        saveFieldValuesMut,
      });
    },
    [
      claimToken,
      documentId,
      inlineFields,
      mergedFieldValues,
      myFieldsList,
      saveFieldValuesMut,
      serverSaveTimer,
      store,
      behavioralTracker,
    ],
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

  return {
    myFieldIds,
    myFieldsList,
    mergedFieldValues,
    allFieldValues,
    validationState,
    fieldsByTypeLabel,
    handleFieldChange,
    fillMatching,
    setHandSignatureWithAutoFill,
  };
}

// ── Field navigation hook ──

export function useFieldNavigation(
  myFieldsList: InlineField[],
  behavioralTracker: React.MutableRefObject<BehavioralTracker | null>,
  validationOpts: {
    signatureReady: boolean;
    allValues: Record<string, string>;
  },
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
    navigateToField(Math.max(0, store.currentFieldIdx - 1), "prev");
  }, [navigateToField, store.currentFieldIdx]);

  const goToNextFieldNav = useCallback(() => {
    navigateToField(Math.min(myFieldsList.length - 1, store.currentFieldIdx + 1), "next");
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

  return {
    navigateToField,
    goToNextField,
    goToPrevField,
    goToNextFieldNav,
    handleFieldFocus,
    handleFieldBlur,
  };
}
