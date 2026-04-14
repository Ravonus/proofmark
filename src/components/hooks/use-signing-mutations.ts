"use client";

import { useCallback } from "react";
import { getWalletActions } from "~/components/layout/wallet-provider";
import { validateField } from "~/components/signing/sign-document-helpers";
import type { InlineField } from "~/lib/document/document-tokens";
import type { BehavioralSignals, BehavioralTracker } from "~/lib/forensic";
import { collectFingerprintBestEffort } from "~/lib/forensic";
import { trpc } from "~/lib/platform/trpc";
import type { TokenGateWalletProof } from "~/lib/token-gates";
import { useSigningStore } from "~/stores/signing";
import { useWalletStore } from "~/stores/wallet";

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

export type SigningMutationDeps = {
  documentId: string;
  claimToken: string | null;
  needsDrawnSig: boolean;
  needsFinalization: boolean;
  currentSigner: { label: string; status: string; signMethod?: string | null } | null;
  tokenGateEligible: boolean;
  tokenGateProofs: Record<string, TokenGateWalletProof>;
  myFieldsList: InlineField[];
  validationOpts: {
    signatureReady: boolean;
    allValues: Record<string, string>;
  };
  behavioralTracker: React.MutableRefObject<BehavioralTracker | null>;
  onSignSuccess: () => void;
  onFinalizeSuccess: () => void;
};

const EMAIL_SIGN_CONSENT = "I consent to use an electronic signature for this document.";

function focusFirstInvalidField(
  myFieldsList: InlineField[],
  fieldValues: Record<string, string>,
  validationOpts: {
    signatureReady: boolean;
    allValues: Record<string, string>;
  },
) {
  for (const field of myFieldsList) {
    if (validateField(field, fieldValues[field.id] ?? "", validationOpts)) {
      document.getElementById(field.id)?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
      return true;
    }
  }

  return false;
}

async function collectSigningForensics(tracker: React.MutableRefObject<BehavioralTracker | null>): Promise<{
  fingerprint: Record<string, unknown>;
  behavioral: Record<string, unknown>;
  session:
    | {
        sessionId: string;
        visitIndex: number;
        startedAt: string;
        endedAt: string;
        durationMs: number;
      }
    | undefined;
}> {
  const fingerprint = await collectFingerprintBestEffort();
  tracker.current?.logAction("sign_submitted");

  let behavioral: BehavioralSignals;
  try {
    behavioral = (await tracker.current?.collect()) ?? { ...EMPTY_BEHAVIORAL };
  } catch {
    behavioral = { ...EMPTY_BEHAVIORAL };
  }

  return {
    fingerprint: fingerprint as unknown as Record<string, unknown>,
    behavioral: behavioral as unknown as Record<string, unknown>,
    session: tracker.current
      ? {
          sessionId: tracker.current.sessionId,
          visitIndex: tracker.current.visitIndex,
          startedAt: tracker.current.startedAt,
          endedAt: new Date().toISOString(),
          durationMs: behavioral.timeOnPage,
        }
      : undefined,
  };
}

export function useSigningMutations(deps: SigningMutationDeps) {
  const wallet = useWalletStore();
  const store = useSigningStore();

  const signMutation = trpc.document.sign.useMutation({
    onSuccess: deps.onSignSuccess,
  });
  const requestSigningOtpMut = trpc.document.requestSigningOtp.useMutation();
  const signWithEmailMut = trpc.document.signWithEmail.useMutation({
    onSuccess: deps.onSignSuccess,
  });
  const declineMut = trpc.document.declineSign.useMutation({
    onSuccess: () => store.declineSigning(),
  });
  const getSigningMessageMut = trpc.document.getSigningMessage.useMutation();
  const getFinalizationMessageMut = trpc.document.getFinalizationMessage.useMutation();
  const finalizeMut = trpc.document.finalize.useMutation({
    onSuccess: deps.onFinalizeSuccess,
  });
  const getBulkFinalizationMessageMut = trpc.document.getBulkFinalizationMessage.useMutation();
  const bulkFinalizeMut = trpc.document.bulkFinalize.useMutation({
    onSuccess: deps.onFinalizeSuccess,
  });

  const handleSign = useCallback(async () => {
    if (deps.currentSigner?.signMethod === "EMAIL_OTP") return;
    if (!wallet.address || !wallet.chain || !deps.claimToken || !deps.currentSigner) return;
    if (!deps.tokenGateEligible || (deps.needsDrawnSig && !store.handSignature)) return;
    if (focusFirstInvalidField(deps.myFieldsList, store.fieldValues, deps.validationOpts)) return;

    const proofsList = Object.values(deps.tokenGateProofs);
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
        const forensic = await collectSigningForensics(deps.behavioralTracker);

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
            fingerprint: forensic.fingerprint,
            behavioral: forensic.behavioral,
            session: forensic.session,
          },
        });
      },
      "Signing",
    );
  }, [wallet, deps, store, signMutation, getSigningMessageMut]);

  const requestEmailOtp = useCallback(async () => {
    if (deps.currentSigner?.signMethod !== "EMAIL_OTP" || !deps.claimToken) return;

    const email = store.email.trim();
    if (!email) {
      store.setSigningError("Enter your email to receive a verification code.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    store.setSigningError(null);
    await requestSigningOtpMut.mutateAsync({
      documentId: deps.documentId,
      claimToken: deps.claimToken,
      email,
    });
  }, [deps.claimToken, deps.currentSigner?.signMethod, deps.documentId, requestSigningOtpMut, store]);

  const handleEmailSign = useCallback(
    async (otpCode: string) => {
      if (deps.currentSigner?.signMethod !== "EMAIL_OTP" || !deps.claimToken || !deps.currentSigner) return;
      if (!deps.tokenGateEligible || (deps.needsDrawnSig && !store.handSignature)) return;
      if (focusFirstInvalidField(deps.myFieldsList, store.fieldValues, deps.validationOpts)) return;

      const email = store.email.trim();
      const otp = otpCode.trim();
      if (!email) {
        store.setSigningError("Enter your email before submitting this signature.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (otp.length !== 6) {
        store.setSigningError("Enter the 6-digit verification code from your email.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      const fieldVals = Object.keys(store.fieldValues).length > 0 ? store.fieldValues : undefined;

      await runSigningAction(
        store,
        async () => {
          const forensic = await collectSigningForensics(deps.behavioralTracker);
          await signWithEmailMut.mutateAsync({
            documentId: deps.documentId,
            claimToken: deps.claimToken!,
            email,
            otpCode: otp,
            fieldValues: fieldVals,
            handSignatureData: store.handSignature || undefined,
            consentText: EMAIL_SIGN_CONSENT,
            forensic: {
              fingerprint: forensic.fingerprint,
              behavioral: forensic.behavioral,
              session: forensic.session,
            },
          });
        },
        "Email signing",
      );
    },
    [deps, store, signWithEmailMut],
  );

  const handleFinalize = useCallback(async () => {
    if (!wallet.address || !wallet.chain || !deps.claimToken || !deps.needsFinalization) return;
    await runSigningAction(
      store,
      async () => {
        const { message } = await getFinalizationMessageMut.mutateAsync({
          documentId: deps.documentId,
          claimToken: deps.claimToken!,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
        });
        await finalizeMut.mutateAsync({
          documentId: deps.documentId,
          claimToken: deps.claimToken!,
          signerAddress: wallet.address!,
          chain: wallet.chain!,
          signature: await getWalletActions().signMessage(message),
        });
      },
      "Finalization",
    );
  }, [wallet, deps.claimToken, deps.needsFinalization, deps.documentId, store, getFinalizationMessageMut, finalizeMut]);

  const handleBulkFinalize = useCallback(
    async (groupId: string | null) => {
      if (!wallet.address || !wallet.chain || !deps.claimToken || !deps.needsFinalization) return;
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
          await bulkFinalizeMut.mutateAsync({
            groupId,
            claimToken: deps.claimToken!,
            signerAddress: wallet.address!,
            chain: wallet.chain!,
            signature: await getWalletActions().signMessage(message),
          });
        },
        "Bulk finalization",
      );
    },
    [
      wallet,
      deps.claimToken,
      deps.needsFinalization,
      store,
      handleFinalize,
      getBulkFinalizationMessageMut,
      bulkFinalizeMut,
    ],
  );

  return {
    signMutation,
    requestSigningOtpMut,
    signWithEmailMut,
    declineMut,
    handleSign,
    requestEmailOtp,
    handleEmailSign,
    handleFinalize,
    handleBulkFinalize,
  };
}
