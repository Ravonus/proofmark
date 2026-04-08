/* eslint-disable @typescript-eslint/consistent-type-imports */
"use client";

import { useCallback } from "react";
import { type AddressSuggestion, buildAddressSuggestionFieldUpdates } from "~/lib/address-autocomplete";
import type { InlineField } from "~/lib/document/document-tokens";
import { formatEditableFieldValue } from "~/lib/document/field-runtime";
import type { AttachmentFieldValue } from "~/lib/document/field-values";
import { encodeStructuredFieldValue } from "~/lib/document/field-values";
import type { BehavioralTracker } from "~/lib/forensic";
import { generateQrDataUrl } from "~/lib/utils/qr-svg";
import { useSigningStore } from "~/stores/signing";
import { processSocialVerifyResult, SOCIAL_PROVIDER_MAP } from "./use-signing-actions";

// ── Social verify polling helper ────────────────────────────────────────────

interface SocialVerifyPollOpts {
  popup: Window | null;
  socialPollRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
  docQuery: {
    refetch: () => Promise<{
      data?: {
        signers?: Array<{
          isYou?: boolean;
          fieldValues?: Record<string, string> | null;
        }>;
      };
    }>;
  };
  field: InlineField;
  inlineFields: InlineField[];
  fieldValues: Record<string, string>;
  handleFieldChange: (id: string, value: string) => void;
}

function startSocialVerifyPolling({
  popup,
  socialPollRef,
  docQuery,
  field,
  inlineFields,
  fieldValues,
  handleFieldChange,
}: SocialVerifyPollOpts) {
  if (socialPollRef.current) clearInterval(socialPollRef.current);
  const startedAt = Date.now();
  const POLL_TIMEOUT_MS = 5 * 60 * 1000;

  const stopPolling = () => {
    if (socialPollRef.current) {
      clearInterval(socialPollRef.current);
      socialPollRef.current = null;
    }
  };

  socialPollRef.current = setInterval(() => {
    if (popup?.closed || Date.now() - startedAt > POLL_TIMEOUT_MS) {
      stopPolling();
      return;
    }

    void docQuery.refetch().then((res) => {
      if (!res.data) return;
      const signer = res.data.signers?.find((s) => s.isYou);
      const serverVal = signer?.fieldValues?.[field.id];
      if (!serverVal) return;

      const ok = processSocialVerifyResult(serverVal, field, inlineFields, fieldValues, handleFieldChange);
      if (ok) {
        stopPolling();
        if (popup && !popup.closed) popup.close();
      }
    });
  }, 2000);
}

async function runAndApplyIdentityCheck(opts: {
  documentId: string;
  claimToken: string;
  fieldValues: Record<string, string>;
  mutateAsync: (args: {
    documentId: string;
    claimToken: string;
    fieldValues: Record<string, string>;
  }) => Promise<{ verification: Record<string, unknown> }>;
  fieldId: string;
  handleFieldChange: (id: string, value: string) => void;
}): Promise<string> {
  const result = await opts.mutateAsync({
    documentId: opts.documentId,
    claimToken: opts.claimToken,
    fieldValues: opts.fieldValues,
  });
  const encoded = encodeStructuredFieldValue(result.verification as Parameters<typeof encodeStructuredFieldValue>[0]);
  opts.handleFieldChange(opts.fieldId, encoded);
  return encoded;
}

function handleMobileInitialsSuccess(
  data: { token: string; url: string },
  fieldId: string,
  store: import("~/stores/signing").SigningStoreState,
  behavioralTracker: React.MutableRefObject<BehavioralTracker | null>,
) {
  behavioralTracker.current?.recordModal("mobile_sign_qr", true);
  store.setShowQr(true);
  void (async () => {
    const img = await generateQrDataUrl(data.url, 280);
    store.setQrData(data.token, data.url, img, "initials", fieldId);
  })();
}

function openSocialVerifyPopup(
  fieldType: string,
  documentId: string,
  claimToken: string,
  fieldId: string,
): Window | null {
  const provider = SOCIAL_PROVIDER_MAP[fieldType];
  if (!provider) throw new Error(`Unknown social verify field type: ${fieldType}`);
  const params = new URLSearchParams({
    provider,
    documentId,
    claimToken,
    fieldId,
    callbackOrigin: window.location.origin,
  });
  return window.open(`/api/social-verify?${params.toString()}`, "social-verify", "width=600,height=700,popup=true");
}

function applyAddressSuggestionToFields(
  inlineFields: InlineField[],
  suggestion: AddressSuggestion,
  field: InlineField,
  store: import("~/stores/signing").SigningStoreState,
  behavioralTracker: React.MutableRefObject<BehavioralTracker | null>,
) {
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
}

async function submitAttachmentUpload(
  documentId: string,
  claimToken: string,
  fieldId: string,
  file: File,
): Promise<string> {
  const formData = new FormData();
  formData.set("documentId", documentId);
  formData.set("claimToken", claimToken);
  formData.set("fieldId", fieldId);
  formData.set("file", file);
  const response = await fetch("/api/signer-attachments", {
    method: "POST",
    body: formData,
  });
  const payload = (await response.json()) as {
    attachment?: AttachmentFieldValue;
    error?: string;
  };
  if (!response.ok || !payload.attachment) throw new Error(payload.error || "Attachment upload failed");
  return encodeStructuredFieldValue(payload.attachment);
}

// ── Misc actions ────────────────────────────────────────────────────────────

export interface UseMiscActionsArgs {
  claimToken: string | null;
  documentId: string;
  inlineFields: InlineField[];
  behavioralTracker: React.MutableRefObject<BehavioralTracker | null>;
  socialPollRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
  handleFieldChange: (fieldId: string, value: string) => void;
  addressSuggestionsMutation: {
    mutateAsync: (args: {
      documentId: string;
      claimToken: string;
      fieldId: string;
      query: string;
      limit: number;
    }) => Promise<{ suggestions: AddressSuggestion[] }>;
  };
  runIdentityVerification: {
    mutateAsync: (args: {
      documentId: string;
      claimToken: string;
      fieldValues: Record<string, string>;
    }) => Promise<{ verification: Record<string, unknown> }>;
  };
  startPaymentCheckout: {
    mutateAsync: (args: {
      documentId: string;
      claimToken: string;
      fieldId: string;
    }) => Promise<{ checkoutUrl: string }>;
  };
  createMobileSession: {
    mutate: (
      args: {
        documentId: string;
        claimToken: string;
        signerLabel: string;
        mode?: "initials";
      },
      opts?: {
        onSuccess?: (data: { token: string; url: string }) => void;
      },
    ) => void;
  };
  docQuery: {
    refetch: () => Promise<{
      data?: {
        signers?: Array<{
          isYou?: boolean;
          fieldValues?: Record<string, string> | null;
        }>;
      };
    }>;
  };
  currentSigner: { label: string } | null;
}

function useAddressActions(args: UseMiscActionsArgs) {
  const { claimToken, documentId, inlineFields, behavioralTracker, addressSuggestionsMutation } = args;
  const store = useSigningStore();

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
    (field: InlineField, suggestion: AddressSuggestion) =>
      applyAddressSuggestionToFields(inlineFields, suggestion, field, store, behavioralTracker),
    [inlineFields, store, behavioralTracker],
  );

  return { loadAddressSuggestions, applyAddressSuggestion };
}

function useVerifyActions(args: UseMiscActionsArgs) {
  const {
    claimToken,
    documentId,
    inlineFields,
    behavioralTracker: _behavioralTracker, // eslint-disable-line @typescript-eslint/no-unused-vars
    socialPollRef,
    handleFieldChange,
    runIdentityVerification,
    docQuery,
  } = args;
  const store = useSigningStore();

  const triggerIdentityCheck = useCallback(
    async (field: InlineField) => {
      if (!claimToken) throw new Error("Missing claim token");
      return runAndApplyIdentityCheck({
        documentId,
        claimToken,
        fieldValues: store.fieldValues,
        mutateAsync: runIdentityVerification.mutateAsync,
        fieldId: field.id,
        handleFieldChange,
      });
    },
    [claimToken, documentId, runIdentityVerification, store.fieldValues, handleFieldChange],
  );

  const triggerSocialVerify = useCallback(
    (field: InlineField) => {
      if (!claimToken) throw new Error("Missing claim token");
      const popup = openSocialVerifyPopup(field.type, documentId, claimToken, field.id);
      startSocialVerifyPolling({
        popup,
        socialPollRef,
        docQuery,
        field,
        inlineFields,
        fieldValues: store.fieldValues,
        handleFieldChange,
      });
    },
    [claimToken, documentId, socialPollRef, docQuery, inlineFields, store.fieldValues, handleFieldChange],
  );

  return { triggerIdentityCheck, triggerSocialVerify };
}

export function useMiscActions(args: UseMiscActionsArgs) {
  const {
    claimToken,
    documentId,
    behavioralTracker,
    handleFieldChange,
    startPaymentCheckout,
    createMobileSession,
    currentSigner,
  } = args;
  const store = useSigningStore();
  const addressActions = useAddressActions(args);
  const verifyActions = useVerifyActions(args);

  const triggerMobileInitials = useCallback(
    (field: InlineField) => {
      if (!claimToken || !currentSigner) return;
      createMobileSession.mutate(
        {
          documentId,
          claimToken,
          signerLabel: currentSigner.label,
          mode: "initials" as const,
        },
        {
          onSuccess: (data) => handleMobileInitialsSuccess(data, field.id, store, behavioralTracker),
        },
      );
    },
    [claimToken, currentSigner, createMobileSession, documentId, store, behavioralTracker],
  );

  const triggerPayment = useCallback(
    async (field: InlineField) => {
      if (!claimToken) throw new Error("Missing claim token");
      const result = await startPaymentCheckout.mutateAsync({
        documentId,
        claimToken,
        fieldId: field.id,
      });
      window.location.assign(result.checkoutUrl);
    },
    [claimToken, documentId, startPaymentCheckout],
  );

  const uploadAttachment = useCallback(
    async (field: InlineField, file: File) => {
      if (!claimToken) throw new Error("Missing claim token");
      const encoded = await submitAttachmentUpload(documentId, claimToken, field.id, file);
      handleFieldChange(field.id, encoded);
      return encoded;
    },
    [claimToken, documentId, handleFieldChange],
  );

  return {
    ...addressActions,
    ...verifyActions,
    triggerMobileInitials,
    triggerIdentityCheck: verifyActions.triggerIdentityCheck,
    triggerSocialVerify: verifyActions.triggerSocialVerify,
    triggerPayment,
    uploadAttachment,
  };
}
