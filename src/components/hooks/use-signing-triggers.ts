"use client";

import { useCallback, useRef } from "react";
import type { InlineField } from "~/lib/document/document-tokens";
import type { AttachmentFieldValue } from "~/lib/document/field-values";
import { encodeStructuredFieldValue } from "~/lib/document/field-values";
import type { BehavioralTracker } from "~/lib/forensic";
import { trpc } from "~/lib/platform/trpc";
import { generateQrDataUrl } from "~/lib/utils/qr-svg";
import { useSigningStore } from "~/stores/signing";

const SOCIAL_PROVIDER_MAP: Record<string, string> = {
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

function processSocialVerifyResult(
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

type TriggerDeps = {
  documentId: string;
  claimToken: string | null;
  currentSignerLabel: string | undefined;
  behavioralTracker: React.MutableRefObject<BehavioralTracker | null>;
  inlineFields: InlineField[];
  handleFieldChange: (id: string, value: string) => void;
  docQuery: { refetch: () => Promise<unknown> };
};

function startSocialPoll(opts: {
  popup: Window | null;
  pollRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>;
  field: InlineField;
  deps: TriggerDeps;
  fieldValues: Record<string, string>;
}) {
  const { popup, pollRef, field, deps, fieldValues } = opts;
  if (pollRef.current) clearInterval(pollRef.current);
  const startedAt = Date.now();
  const POLL_TIMEOUT_MS = 5 * 60 * 1000;
  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  pollRef.current = setInterval(() => {
    if (popup?.closed || Date.now() - startedAt > POLL_TIMEOUT_MS) {
      stopPolling();
      return;
    }
    void (
      deps.docQuery.refetch() as Promise<{
        data?: {
          signers?: Array<{
            isYou?: boolean;
            fieldValues?: Record<string, string>;
          }>;
        };
      }>
    ).then((res) => {
      if (!res.data) return;
      const signer = res.data.signers?.find((s: { isYou?: boolean }) => s.isYou);
      const serverVal = signer?.fieldValues?.[field.id];
      if (!serverVal) return;
      const ok = processSocialVerifyResult(serverVal, field, deps.inlineFields, fieldValues, deps.handleFieldChange);
      if (ok) {
        stopPolling();
        if (popup && !popup.closed) popup.close();
      }
    });
  }, 2000);
}

export function useSigningTriggers(deps: TriggerDeps) {
  const store = useSigningStore();
  const socialPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runIdentityVerification = trpc.document.runIdentityVerification.useMutation();
  const startPaymentCheckout = trpc.document.createPaymentCheckout.useMutation();
  const createMobileSession = trpc.document.createMobileSignSession.useMutation({
    onSuccess: async (data) => {
      deps.behavioralTracker.current?.recordModal("mobile_sign_qr", true);
      store.setShowQr(true);
      const img = await generateQrDataUrl(data.url, 280);
      store.setQrData(data.token, data.url, img);
    },
  });

  const triggerMobileInitials = useCallback(
    (field: InlineField) => {
      if (!deps.claimToken || !deps.currentSignerLabel) return;
      createMobileSession.mutate(
        {
          documentId: deps.documentId,
          claimToken: deps.claimToken,
          signerLabel: deps.currentSignerLabel,
          mode: "initials" as const,
        },
        {
          onSuccess: (data) => {
            deps.behavioralTracker.current?.recordModal("mobile_sign_qr", true);
            store.setShowQr(true);
            void (async () => {
              const img = await generateQrDataUrl(data.url, 280);
              store.setQrData(data.token, data.url, img, "initials", field.id);
            })();
          },
        },
      );
    },
    [deps.claimToken, deps.currentSignerLabel, deps.documentId, createMobileSession, store, deps.behavioralTracker],
  );

  const triggerIdentityCheck = useCallback(
    async (field: InlineField) => {
      if (!deps.claimToken) throw new Error("Missing claim token");
      const result = await runIdentityVerification.mutateAsync({
        documentId: deps.documentId,
        claimToken: deps.claimToken,
        fieldValues: store.fieldValues,
      });
      const encoded = encodeStructuredFieldValue(result.verification);
      deps.handleFieldChange(field.id, encoded);
      return encoded;
    },
    [deps.claimToken, deps.documentId, deps.handleFieldChange, runIdentityVerification, store.fieldValues],
  );

  const triggerSocialVerify = useCallback(
    (field: InlineField) => {
      if (!deps.claimToken) throw new Error("Missing claim token");
      const provider = SOCIAL_PROVIDER_MAP[field.type];
      if (!provider) throw new Error(`Unknown social verify field type: ${field.type}`);
      const params = new URLSearchParams({
        provider,
        documentId: deps.documentId,
        claimToken: deps.claimToken,
        fieldId: field.id,
        callbackOrigin: window.location.origin,
      });
      const popup = window.open(
        `/api/social-verify?${params.toString()}`,
        "social-verify",
        "width=600,height=700,popup=true",
      );
      startSocialPoll({
        popup,
        pollRef: socialPollRef,
        field,
        deps,
        fieldValues: store.fieldValues,
      });
    },
    [deps, store.fieldValues],
  );

  const triggerPayment = useCallback(
    async (field: InlineField) => {
      if (!deps.claimToken) throw new Error("Missing claim token");
      const result = await startPaymentCheckout.mutateAsync({
        documentId: deps.documentId,
        claimToken: deps.claimToken,
        fieldId: field.id,
      });
      window.location.assign(result.checkoutUrl);
    },
    [deps.claimToken, deps.documentId, startPaymentCheckout],
  );

  const uploadAttachment = useCallback(
    async (field: InlineField, file: File) => {
      if (!deps.claimToken) throw new Error("Missing claim token");
      const formData = new FormData();
      formData.set("documentId", deps.documentId);
      formData.set("claimToken", deps.claimToken);
      formData.set("fieldId", field.id);
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
      const encoded = encodeStructuredFieldValue(payload.attachment);
      deps.handleFieldChange(field.id, encoded);
      return encoded;
    },
    [deps.claimToken, deps.documentId, deps.handleFieldChange],
  );

  return {
    createMobileSession,
    triggerMobileInitials,
    triggerIdentityCheck,
    triggerSocialVerify,
    triggerPayment,
    uploadAttachment,
    socialPollRef,
  };
}
