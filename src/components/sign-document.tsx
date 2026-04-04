"use client";

import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getRecipientActionLabel } from "~/lib/recipient-roles";
import { useWallet } from "./wallet-provider";
import { CHAIN_META, addressPreview } from "~/lib/chains";
import { SignaturePad } from "./signature-pad";
import { isFieldVisible, isFieldLocked, isFieldRequired } from "~/lib/field-runtime";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  PenTool,
  FileSignature,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  X,
  Loader2,
  Eye,
  Smartphone,
  QrCode,
  FileDown,
  ShieldCheck,
} from "lucide-react";
import { getFieldVisualStyle, getFieldMinWidth, getFieldDisplayText, validateField } from "./sign-document-helpers";
import { isImageDataUrl } from "~/lib/field-values";
import { InlineFieldInput } from "./sign-document-inline-field";
import { DocumentPaper } from "./document-paper";
import { CenterCard, DocumentHeader, SignerList, CreatorClaimSlot, ChainButtons } from "./sign-document-parts";
import dynamic from "next/dynamic";
const AiSignerChat = dynamic(() => import("./ai/ai-signer-chat").then((m) => m.AiSignerChat), {
  ssr: false,
  loading: () => null,
});
import { resolveFieldBadge, resolveFieldLogo, resolveFieldPrefix, resolveFieldSuffix } from "~/lib/field-runtime";
import { useSigningFlow } from "./hooks/use-signing-flow";
import { GazeGate } from "./gaze-gate";
import { GazeGateMobile } from "./gaze-gate-mobile";
import { isGazeLivenessAccepted } from "~/lib/forensic/gaze-liveness";
import type { GazeLivenessSummary } from "~/lib/forensic/types";
import { describeSignerTokenGate } from "~/lib/token-gates";

// ─── Main Component ──────────────────────────────────────────────────────────

export function SignDocument({ documentId, claimToken }: { documentId: string; claimToken: string | null }) {
  const { connected, address, chain } = useWallet();
  const [showSigningOnlyGazeGate, setShowSigningOnlyGazeGate] = useState(false);

  // Detect mobile once for gaze gate routing
  const [mobileDevice] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      const modPath = "~/premium/eye-tracking/mobile/device";
      const { detectDevice } = require(/* webpackIgnore: true */ modPath);
      return detectDevice();
    } catch {
      return null;
    }
  });
  const [sigPadMode, setSigPadMode] = useState<"signature" | "initials">("signature");
  const initialsFieldRef = useRef<string | null>(null);
  // All state + logic extracted to useSigningFlow (0 useEffect, 0 useState)
  const flow = useSigningFlow(documentId, claimToken);
  const {
    docQuery,
    doc,
    docSigners,
    tokens,
    currentSigner,
    isCreator,
    currentRole,
    needsDrawnSig,
    canSign,
    alreadySigned,
    signedCount,
    totalRecipients,
    tokenGateEvaluation,
    tokenGateBlocked,
    requiresTokenGateWalletProofs,
    tokenGateWallets,
    verifyingTokenGateChain,
    tokenGateWalletError,
    myFieldIds,
    myFieldsList,
    mergedFieldValues,
    allFieldValues,
    requiredFields,
    completed: fieldsFilled,
    remaining: requiredFieldsRemaining,
    allComplete: allFieldsComplete,
    canFinalize,
    opts: validationOptions,
    fieldsByTypeLabel,
    confirmSigningMessage,
    signing,
    done,
    declined,
    email,
    handSignature,
    fieldValues,
    activeField,
    currentFieldIdx,
    showSigPad,
    showQr,
    showConfirmModal,
    qrUrl,
    qrImage,
    qrMode,
    handleFieldChange,
    fillMatching,
    setEmail,
    setHandSignature,
    setShowSigPad,
    setShowQr,
    setShowConfirmModal,
    handleFieldFocus,
    handleFieldBlur,
    forensicTracker,
    gazeTracking,
    gazeReady,
    gazeError,
    gazeAway,
    gazePoint,
    gazeBlinkCount,
    gazeLiveness,
    recordGazeLiveness,
    startGazeTracking,
    hasStoredCalibration,
    saveGazeCalibration,
    pauseGazeTraining,
    resumeGazeTraining,
    setGazeLightSmoothing,
    markDocumentViewingStarted,
    navigateToField,
    goToNextField,
    goToPrevField,
    goToNextFieldNav,
    connectTokenGateChain,
    verifyTokenGateWallet,
    handleSign,
    handleFinalize,
    handleBulkFinalize,
    needsFinalization,
    groupId,
    signingError,
    clearSigningError,
    declineMut,
    loadAddressSuggestions,
    applyAddressSuggestion,
    createMobileSession,
    triggerMobileInitials,
    triggerIdentityCheck,
    triggerPayment,
    triggerSocialVerify,
    uploadAttachment,
  } = flow;
  const totalMyFields = requiredFields.length;
  const needsDrawnSignature = needsDrawnSig;
  const tokenGateSummary = currentSigner?.tokenGates ? describeSignerTokenGate(currentSigner.tokenGates) : null;
  const tokenGateCardState = requiresTokenGateWalletProofs
    ? tokenGateEvaluation?.status === "eligible"
      ? "eligible"
      : tokenGateWallets.some((walletCheck) => walletCheck.status === "failed")
        ? "failed"
        : "pending"
    : tokenGateEvaluation?.status === "eligible"
      ? "eligible"
      : tokenGateBlocked
        ? "failed"
        : "pending";

  // ── REMOVED: All 15 useState declarations (now in useSigningStore)
  // ── REMOVED: All 9 useEffects (now derived state / event handlers)

  // The rest below is unchanged JSX — it references the same variable names.

  // Old state declarations removed — all in useSigningFlow hook above.

  // tRPC + state logic removed — all in useSigningFlow hook

  // [removed: signMutation — now in useSigningFlow]

  // [removed: tRPC mutations — now in useSigningFlow]

  // All derived state from useSigningFlow hook.

  // Re-derive values the JSX needs that aren't in the hook return
  const mySignerIdx = currentSigner ? docSigners.findIndex((s) => s.id === currentSigner.id) : -1;
  const otherSignerValues: Record<string, string> = {};
  for (const s of docSigners) {
    if (s.fieldValues && s.id !== currentSigner?.id) {
      for (const [k, v] of Object.entries(s.fieldValues)) {
        if (v) otherSignerValues[k] = v;
      }
    }
  }
  const mobileSignPoll = { data: null as any };
  const signMutation = { isPending: false, error: null as any };
  const setQrToken = (_: any) => {};

  if (!claimToken && !connected) {
    return (
      <CenterCard>
        <h2 className="text-xl font-semibold">Connect Your Wallet</h2>
        <p className="text-sm text-muted">Connect the wallet associated with this document.</p>
        <ChainButtons />
      </CenterCard>
    );
  }
  if (docQuery.isLoading) {
    return (
      <CenterCard>
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-accent" />
        <p className="mt-3 text-muted">Loading document...</p>
      </CenterCard>
    );
  }
  if (docQuery.error || !doc) {
    return (
      <CenterCard>
        <p className="flex items-center justify-center gap-2 font-medium text-red-400">
          <AlertCircle className="h-4 w-4" />
          {docQuery.error?.message ?? "Document not found"}
        </p>
        {!connected && <ChainButtons />}
      </CenterCard>
    );
  }

  // ── Finalization: discloser has signed but needs final wallet sig ──
  if (needsFinalization && !done) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <DocumentHeader doc={doc} signedCount={signedCount} totalRecipients={totalRecipients} />

        {signingError && (
          <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <span>{signingError}</span>
            <button onClick={clearSigningError} className="ml-3 text-red-400/60 hover:text-red-400">
              Dismiss
            </button>
          </div>
        )}

        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="space-y-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 backdrop-blur-sm"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15">
              <CheckCircle className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-primary">All parties have signed</h2>
              <p className="text-sm text-secondary">Your final wallet signature is needed to close this contract.</p>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-secondary">
            All other signers have completed their signatures. Your finalization signature cryptographically covers the
            entire completed document — proving you reviewed and approved the final version with everyone&apos;s
            information included.
          </p>

          <div className="flex gap-3 pt-2">
            <button
              onClick={groupId ? handleBulkFinalize : handleFinalize}
              disabled={!connected || signing}
              className="shadow-accent/25 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:brightness-110 disabled:opacity-50"
            >
              {signing ? "Signing..." : groupId ? "Finalize All Contracts" : "Finalize Contract"}
            </button>
          </div>

          {!connected && <p className="text-xs text-amber-400">Connect your wallet to finalize.</p>}
        </motion.div>
      </div>
    );
  }

  // ── Done / already-signed / completed state ──
  if (done || alreadySigned || doc.status === "COMPLETED") {
    const pdfUrl = claimToken
      ? `/api/pdf/${documentId}?claim=${claimToken}`
      : address
        ? `/api/pdf/${documentId}?address=${address}`
        : null;

    return (
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <DocumentHeader doc={doc} signedCount={signedCount} totalRecipients={totalRecipients} />

        {/* Status banner */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="space-y-4 rounded-2xl border border-green-500/20 bg-green-500/5 p-6 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", delay: 0.2 }}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/15"
              >
                <CheckCircle className="h-6 w-6 text-green-400" />
              </motion.div>
              <div>
                <p className="font-semibold text-green-400">
                  {doc.status === "COMPLETED"
                    ? "All Parties Have Signed"
                    : done
                      ? "Signature Recorded!"
                      : "You've Already Signed"}
                </p>
                <p className="text-xs text-muted">Signatures are cryptographically bound to this document.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pdfUrl && (
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-accent/15 hover:bg-accent/25 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-accent transition-colors"
                >
                  <FileDown className="h-3.5 w-3.5" /> Download PDF
                </a>
              )}
              <a
                href={`/view/${documentId}${claimToken ? `?claim=${claimToken}` : ""}`}
                className="bg-accent/10 hover:bg-accent/20 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-accent transition-colors"
              >
                <FileSignature className="h-3.5 w-3.5" /> View Online
              </a>
              <a
                href={`/verify/${doc.contentHash}`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-surface-hover px-4 py-2 text-xs font-medium text-secondary transition-colors hover:bg-surface-elevated"
              >
                <ShieldCheck className="h-3.5 w-3.5" /> Verify
              </a>
              {doc.status === "COMPLETED" && (
                <a
                  href={`/api/proof-packet/${documentId}?address=${address ?? ""}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-surface-hover px-4 py-2 text-xs font-medium text-secondary transition-colors hover:bg-surface-elevated"
                >
                  <FileDown className="h-3.5 w-3.5" /> Evidence Bundle
                </a>
              )}
            </div>
          </div>
          {doc.postSignReveal && (
            <a
              href={`/reveal/${documentId}`}
              className="inline-block rounded-xl bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            >
              View Project Details &rarr;
            </a>
          )}
        </motion.div>

        {/* Full document with filled-in fields */}
        <div className="relative">
          <div
            className="overflow-hidden rounded-2xl border border-border"
            style={{
              background: "var(--doc-paper)",
              boxShadow: "var(--doc-paper-shadow)",
            }}
          >
            <div
              className="h-px"
              style={{ background: "linear-gradient(90deg, transparent, var(--accent), transparent)" }}
            />
            <div
              className="space-y-1 px-8 py-10 sm:px-14 sm:py-14"
              style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
            >
              {tokens.map((token, i) => {
                switch (token.kind) {
                  case "heading":
                    return (
                      <div key={i} className="pb-2 pt-8">
                        <h3 className="text-base font-bold text-primary">{token.text}</h3>
                      </div>
                    );
                  case "subheading":
                    return (
                      <h4
                        key={i}
                        className="pb-2 pt-8 text-sm font-bold uppercase tracking-widest text-secondary"
                        style={{ letterSpacing: "0.15em" }}
                      >
                        {token.text}
                      </h4>
                    );
                  case "text":
                    return (
                      <span key={i} className="text-sm leading-relaxed text-secondary">
                        {token.text}{" "}
                      </span>
                    );
                  case "break":
                    return <div key={i} className="h-3" />;
                  case "listItem":
                    return <div key={i} className="pl-6 pt-1" />;
                  case "field": {
                    if (!isFieldVisible(token.field, allFieldValues)) {
                      return null;
                    }
                    const val = allFieldValues[token.field.id];
                    if (token.field.type === "signature" && isImageDataUrl(val)) {
                      return (
                        <span key={token.field.id} className="mx-1 inline-flex flex-col align-middle">
                          <span className="mb-1 text-[9px] font-medium uppercase tracking-wider text-emerald-400/70">
                            {token.field.label}
                          </span>
                          <span className="inline-block rounded-md border border-black/10 bg-[var(--sig-bg)] px-3 py-2 shadow-sm">
                            <img
                              src={val}
                              alt={`${token.field.label} signature`}
                              className="sig-theme-img h-10 w-auto object-contain"
                            />
                          </span>
                        </span>
                      );
                    }
                    const s = getFieldVisualStyle(token.field);
                    const badge = resolveFieldBadge(token.field, val);
                    const logo = resolveFieldLogo(token.field, val);
                    const prefix = resolveFieldPrefix(token.field);
                    const suffix = resolveFieldSuffix(token.field);
                    return (
                      <span key={token.field.id} className="mx-0.5 my-1 inline-block align-baseline">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 ${val ? s.border + " " + s.bg : "bg-surface-hover/20 border-border"}`}
                          style={{ minWidth: getFieldMinWidth(token.field) }}
                        >
                          <span
                            className={`shrink-0 text-[9px] font-medium uppercase tracking-wider ${val ? s.text : "text-muted"}`}
                          >
                            {token.field.label}
                          </span>
                          {logo && (
                            <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted">
                              {logo}
                            </span>
                          )}
                          {badge && (
                            <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted">
                              {badge}
                            </span>
                          )}
                          {prefix && <span className="text-xs text-muted">{prefix}</span>}
                          <span
                            className={`text-sm ${val ? "font-medium text-primary" : "text-muted/50 italic"}`}
                            style={{ fontFamily: "'Georgia', serif" }}
                          >
                            {getFieldDisplayText(token.field, val)}
                          </span>
                          {suffix && <span className="text-xs text-muted">{suffix}</span>}
                          {val && <CheckCircle className="h-3 w-3 shrink-0 text-green-400" />}
                        </span>
                      </span>
                    );
                  }
                  case "signatureBlock": {
                    const signerForBlock = doc.signers[token.signerIdx];
                    const hasSigned = signerForBlock?.status === "SIGNED";
                    const signatureImage = signerForBlock?.handSignatureData;
                    return (
                      <div key={i} className="pb-2 pt-8">
                        <p className="mb-3 text-xs uppercase tracking-wider text-muted">{token.label} Signature</p>
                        {hasSigned && signatureImage && isImageDataUrl(signatureImage) ? (
                          <div className="inline-block rounded-md border border-black/10 bg-[var(--sig-bg)] px-3 py-2 shadow-sm">
                            <img
                              src={signatureImage}
                              alt={`${signerForBlock.label} signature`}
                              className="sig-theme-img h-12 w-auto object-contain"
                            />
                          </div>
                        ) : hasSigned ? (
                          <div className="inline-flex items-center gap-2 text-sm text-green-400/80">
                            <Check className="h-4 w-4" /> Signed by {signerForBlock.label}
                            {signerForBlock.signedAt && (
                              <span className="text-[10px] text-muted">
                                ({new Date(signerForBlock.signedAt).toLocaleDateString()})
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="inline-block h-8 w-48 border-b-2 border-border" />
                        )}
                      </div>
                    );
                  }
                  default:
                    return null;
                }
              })}

              {/* Document hash footer */}
              {doc.status === "COMPLETED" && (
                <div className="mt-8 border-t border-border pt-10">
                  <p className="text-muted/60 font-mono text-[10px]">Document SHA-256: {doc.contentHash}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <SignerList signers={doc.signers} currentAddress={address} />
      </div>
    );
  }

  // ── Main document view ──
  const hasAcceptedGazeLiveness = isGazeLivenessAccepted(gazeLiveness);
  const needsGazeForFullDoc = gazeTracking === "full" && (!gazeReady || !hasAcceptedGazeLiveness);
  const needsGazeForSigningStep = gazeTracking === "signing_only" && (!gazeReady || !hasAcceptedGazeLiveness);

  const handleGazeLivenessComplete = (summary: GazeLivenessSummary) => {
    recordGazeLiveness(summary);
    markDocumentViewingStarted();
    if (isGazeLivenessAccepted(summary)) {
      setShowSigningOnlyGazeGate(false);
    }
  };

  const requireCriticalGazeGate = () => {
    if (!needsGazeForSigningStep) return false;
    setShowSigningOnlyGazeGate(true);
    return true;
  };

  const openSignaturePad = (mode: "signature" | "initials" = "signature", fieldId?: string) => {
    if (requireCriticalGazeGate()) return;
    setSigPadMode(mode);
    if (mode === "initials" && fieldId) initialsFieldRef.current = fieldId;
    setShowSigPad(true);
  };

  const openConfirmModal = () => {
    if (requireCriticalGazeGate()) return;
    setShowConfirmModal(true);
  };

  const confirmAndSign = () => {
    if (requireCriticalGazeGate()) return;
    setShowConfirmModal(false);
    handleSign();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 pb-28">
      {/* Signing error banner */}
      {signingError && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <span>{signingError}</span>
          <button onClick={clearSigningError} className="ml-3 text-red-400/60 hover:text-red-400">
            Dismiss
          </button>
        </div>
      )}
      {/* Eye tracking gate — blocks entire document if mode is "full" */}
      {needsGazeForFullDoc &&
        (mobileDevice?.isMobile || mobileDevice?.isTablet ? (
          <GazeGateMobile
            mode="full"
            gazeReady={gazeReady}
            gazeError={gazeError}
            gazePoint={gazePoint}
            gazeBlinkCount={gazeBlinkCount}
            device={mobileDevice}
            onLivenessComplete={handleGazeLivenessComplete}
            onStart={startGazeTracking}
            skipCalibration={hasStoredCalibration}
            onCalibrationComplete={saveGazeCalibration}
            onPauseTraining={pauseGazeTraining}
            onResumeTraining={resumeGazeTraining}
            onSetLightSmoothing={setGazeLightSmoothing}
            onDocumentViewingStarted={markDocumentViewingStarted}
          >
            <div />
          </GazeGateMobile>
        ) : (
          <GazeGate
            mode="full"
            gazeReady={gazeReady}
            gazeError={gazeError}
            gazePoint={gazePoint}
            gazeBlinkCount={gazeBlinkCount}
            onLivenessComplete={handleGazeLivenessComplete}
            onStart={startGazeTracking}
            skipCalibration={hasStoredCalibration}
            onCalibrationComplete={saveGazeCalibration}
            onPauseTraining={pauseGazeTraining}
            onResumeTraining={resumeGazeTraining}
            onSetLightSmoothing={setGazeLightSmoothing}
            onDocumentViewingStarted={markDocumentViewingStarted}
          >
            <div />
          </GazeGate>
        ))}

      {showSigningOnlyGazeGate && needsGazeForSigningStep && (
        <GazeGate
          mode="signing_only"
          gazeReady={gazeReady}
          gazeError={gazeError}
          gazePoint={gazePoint}
          gazeBlinkCount={gazeBlinkCount}
          onLivenessComplete={handleGazeLivenessComplete}
          onStart={startGazeTracking}
          skipCalibration={hasStoredCalibration}
          onCalibrationComplete={saveGazeCalibration}
          onPauseTraining={pauseGazeTraining}
          onResumeTraining={resumeGazeTraining}
          onSetLightSmoothing={setGazeLightSmoothing}
          onDocumentViewingStarted={markDocumentViewingStarted}
        >
          <div />
        </GazeGate>
      )}

      {/* Gaze away overlay — blocks document when signer looks away */}
      {gazeTracking !== "off" && gazeReady && gazeAway && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="mx-4 max-w-sm space-y-4 rounded-2xl border border-amber-500/20 bg-[#0d1117] p-8 text-center shadow-2xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10">
              <Eye className="h-7 w-7 text-amber-400" />
            </div>
            <h3 className="text-lg font-bold text-amber-400">Eyes Not Detected</h3>
            <p className="text-sm text-white/50">
              Please look at the screen to continue. The document is paused because eye tracking cannot detect your
              gaze.
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-white/30">
              <div className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
              Waiting for gaze...
            </div>
          </div>
        </div>
      )}

      <DocumentHeader doc={doc} signedCount={signedCount} totalRecipients={totalRecipients} />

      {/* Floating toolbar */}
      {canSign && (
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="glass-card border-accent/20 sticky top-16 z-30 flex items-center justify-between gap-3 rounded-2xl border p-3 shadow-lg"
        >
          <div className="flex items-center gap-3">
            <div className="bg-accent/15 flex h-8 w-8 items-center justify-center rounded-full">
              <span style={{ color: CHAIN_META[chain!]?.color }}>{CHAIN_META[chain!]?.icon}</span>
            </div>
            <div className="text-xs">
              <span className="font-medium text-secondary">{currentSigner!.label}</span>
              <span className="ml-2 font-mono text-muted">{addressPreview(address!)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {myFieldIds.size > 0 && (
              <>
                <span className="text-[10px] text-muted">
                  {fieldsFilled}/{Math.max(totalMyFields, 1)} required
                </span>
                {requiredFieldsRemaining > 0 && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> {requiredFieldsRemaining} remaining
                  </span>
                )}
                {allFieldsComplete && (
                  <span className="flex items-center gap-1 text-[10px] text-green-400">
                    <CheckCircle className="h-3 w-3" /> Complete
                  </span>
                )}
              </>
            )}
            <button
              onClick={goToNextField}
              className="bg-accent/15 hover:bg-accent/25 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-accent transition-colors"
            >
              <Eye className="h-3 w-3" /> Next Field
            </button>
          </div>
        </motion.div>
      )}

      {/* ── Paper document ── */}
      <DocumentPaper
        tokens={tokens}
        reveal
        renderField={({ field, forensicId }) => {
          if (!isFieldVisible(field, mergedFieldValues)) {
            return null;
          }
          return (
            <InlineFieldInput
              key={field.id}
              documentId={documentId}
              claimToken={claimToken}
              field={field}
              forensicId={forensicId}
              active={activeField === field.id}
              canEdit={!!canSign && myFieldIds.has(field.id) && !isFieldLocked(field, mergedFieldValues)}
              isOtherSigners={field.signerIdx !== -1 && field.signerIdx !== mySignerIdx}
              otherValue={otherSignerValues[field.id]}
              hasSiblings={(fieldsByTypeLabel.get(`${field.type}:${field.label}`) ?? []).length > 1}
              siblingValue={
                (fieldsByTypeLabel.get(`${field.type}:${field.label}`) ?? [])
                  .filter((id) => id !== field.id && fieldValues[id])
                  .map((id) => fieldValues[id])[0]
              }
              value={fieldValues[field.id]}
              signatureReady={!!handSignature}
              allValues={mergedFieldValues}
              walletAddress={address}
              isFilled={!validateField(field, fieldValues[field.id], validationOptions)}
              isRequired={isFieldRequired(field, mergedFieldValues)}
              onChange={handleFieldChange}
              onFillMatching={fillMatching}
              onApplyAddressSuggestion={applyAddressSuggestion}
              onLoadAddressSuggestions={loadAddressSuggestions}
              onUploadAttachment={uploadAttachment}
              onRunIdentityCheck={triggerIdentityCheck}
              onStartPayment={triggerPayment}
              onStartSocialVerify={triggerSocialVerify}
              onRequestSignature={() =>
                openSignaturePad(field.type === "initials" ? "initials" : "signature", field.id)
              }
              onRequestPhoneDraw={() => {
                if (field.type === "initials") {
                  triggerMobileInitials(field);
                } else if (currentSigner && claimToken) {
                  createMobileSession.mutate({ documentId, claimToken, signerLabel: currentSigner.label });
                }
              }}
              onFocus={() => handleFieldFocus(field.id)}
              onBlur={() => handleFieldBlur(field.id)}
            />
          );
        }}
        renderSignatureBlock={({ signerIdx }) => {
          const isMySignatureBlock = signerIdx === mySignerIdx || signerIdx === -1;
          const blockSigner = doc.signers[signerIdx];
          const blockSigned = blockSigner?.status === "SIGNED";
          const blockSigImg = blockSigner?.handSignatureData;

          if (canSign && isMySignatureBlock && needsDrawnSignature) {
            return (
              <div className="inline-flex items-center gap-1">
                <button
                  onClick={() => openSignaturePad()}
                  className="inline-flex items-center gap-2 rounded-xl border border-dashed border-emerald-400/30 bg-emerald-400/5 px-4 py-2 text-sm text-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.08)] transition-all hover:bg-emerald-400/10"
                >
                  {handSignature ? (
                    <img src={handSignature} alt="Your signature" className="sig-theme-img h-8" />
                  ) : (
                    <>
                      <PenTool className="h-4 w-4" /> Sign here
                    </>
                  )}
                  <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-muted">
                    {handSignature ? "signed" : "draw"}
                  </span>
                </button>
                <button
                  onClick={() =>
                    currentSigner &&
                    claimToken &&
                    createMobileSession.mutate({ documentId, claimToken, signerLabel: currentSigner.label })
                  }
                  className="shrink-0 rounded-full bg-surface-elevated p-1.5 text-muted transition-colors hover:text-primary"
                  title="Draw on phone"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }

          if (blockSigned && blockSigImg && isImageDataUrl(blockSigImg)) {
            return (
              <div className="inline-block rounded-md border border-black/10 bg-[var(--sig-bg)] px-3 py-2 shadow-sm">
                <img
                  src={blockSigImg}
                  alt={`${blockSigner.label} signature`}
                  className="sig-theme-img h-12 w-auto object-contain"
                />
                <p className="mt-1 text-[9px] text-emerald-600/60">
                  Signed by {blockSigner.label}
                  {blockSigner.signedAt && ` (${new Date(blockSigner.signedAt).toLocaleDateString()})`}
                </p>
              </div>
            );
          }
          if (blockSigned) {
            return (
              <div className="inline-flex items-center gap-2 text-sm text-green-400/80">
                <Check className="h-4 w-4" /> Signed by {blockSigner?.label}
                {blockSigner?.signedAt && (
                  <span className="text-[10px] text-muted">
                    ({new Date(blockSigner.signedAt).toLocaleDateString()})
                  </span>
                )}
              </div>
            );
          }

          if (!needsDrawnSignature) {
            return (
              <div className="inline-flex items-center gap-2 rounded-xl border border-dashed border-sky-400/30 bg-sky-400/5 px-5 py-3 text-sky-300/80">
                <CheckCircle className="h-4 w-4" /> Approval-only recipient
              </div>
            );
          }

          return <div className="inline-block h-8 w-48 border-b-2 border-border" />;
        }}
      />

      {/* Signers */}
      <SignerList signers={doc.signers} currentAddress={address} />

      {currentSigner?.tokenGates && (
        <div
          className={`glass-card rounded-2xl border p-5 ${
            tokenGateCardState === "eligible"
              ? "border-green-500/20 bg-green-500/5"
              : tokenGateCardState === "failed"
                ? "border-red-500/20 bg-red-500/5"
                : "border-amber-500/20 bg-amber-500/5"
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">Token Gate</p>
          <p className="mt-2 text-sm text-secondary">{tokenGateSummary}</p>
          {requiresTokenGateWalletProofs ? (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-muted">
                Verify each required chain wallet below. Proofmark will run the live checks for that wallet, and dev
                bypass only changes the final result after those checks complete.
              </p>
              {tokenGateWallets.map((walletCheck) => {
                const chainMeta = CHAIN_META[walletCheck.chain];
                const isCurrentChain = connected && chain === walletCheck.chain;
                const isVerifying = verifyingTokenGateChain === walletCheck.chain;
                const verified = walletCheck.status === "verified";

                return (
                  <div
                    key={walletCheck.chain}
                    className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary">
                        {chainMeta.label} wallet
                        {walletCheck.address ? ` · ${addressPreview(walletCheck.address)}` : ""}
                      </p>
                      <p
                        className={`mt-1 text-xs ${
                          verified
                            ? "text-green-400"
                            : walletCheck.status === "failed"
                              ? "text-red-400"
                              : "text-amber-300"
                        }`}
                      >
                        {walletCheck.message}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isVerifying || verified}
                      onClick={() => {
                        if (verified) return;
                        if (isCurrentChain) {
                          void verifyTokenGateWallet(walletCheck.chain);
                          return;
                        }
                        void connectTokenGateChain(walletCheck.chain);
                      }}
                      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                        verified
                          ? "bg-green-500/15 text-green-300"
                          : isCurrentChain
                            ? "bg-accent text-white hover:bg-accent-hover"
                            : "bg-white/10 text-white hover:bg-white/15"
                      }`}
                    >
                      {isVerifying ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Verifying...
                        </>
                      ) : verified ? (
                        <>
                          <CheckCircle className="h-4 w-4" /> Verified
                        </>
                      ) : isCurrentChain ? (
                        `Verify ${chainMeta.label}`
                      ) : (
                        `Connect ${chainMeta.label}`
                      )}
                    </button>
                  </div>
                );
              })}
              <p
                className={`text-xs ${
                  tokenGateEvaluation?.status === "eligible"
                    ? "text-green-400"
                    : tokenGateWallets.some((walletCheck) => walletCheck.status === "failed")
                      ? "text-red-400"
                      : "text-amber-300"
                }`}
              >
                {tokenGateEvaluation?.summary ?? "Verify all required wallets to continue."}
              </p>
              {tokenGateWalletError && <p className="text-xs text-red-400">{tokenGateWalletError}</p>}
            </div>
          ) : (
            <p
              className={`mt-2 text-xs ${
                tokenGateEvaluation?.status === "eligible"
                  ? "text-green-400"
                  : tokenGateBlocked
                    ? "text-red-400"
                    : "text-amber-300"
              }`}
            >
              {tokenGateEvaluation?.summary ??
                "Connect the wallet you want to sign with so Proofmark can verify the required holdings."}
            </p>
          )}
        </div>
      )}

      {/* Email + final sign */}
      {canSign && (
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="glass-card space-y-4 rounded-2xl p-6"
        >
          <div>
            <label className="mb-1 block text-xs text-muted">Your email (for signed copy)</label>
            <input
              type="email"
              defaultValue={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg bg-surface-card px-4 py-2.5 text-sm outline-none ring-1 ring-border transition-all focus:ring-accent"
            />
          </div>
          <button
            onClick={() => {
              if (!canFinalize) {
                if (needsDrawnSignature && !handSignature) {
                  openSignaturePad();
                  return;
                }
                goToNextField();
                return;
              }
              openConfirmModal();
            }}
            disabled={signing || !address || !chain || !claimToken || !currentSigner}
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-4 text-sm font-semibold shadow-lg transition-all ${
              canFinalize
                ? "shadow-accent/20 bg-accent text-white hover:bg-accent-hover"
                : "bg-accent/40 shadow-accent/10 text-secondary"
            } disabled:opacity-40`}
          >
            {signing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Signing...
              </>
            ) : needsDrawnSignature && !handSignature ? (
              <>
                <PenTool className="h-4 w-4" /> Draw your signature in the document first
              </>
            ) : !allFieldsComplete && totalMyFields > 0 ? (
              <>
                <AlertTriangle className="h-4 w-4" /> {requiredFieldsRemaining} required field
                {requiredFieldsRemaining !== 1 ? "s" : ""} remaining
              </>
            ) : (
              <>
                <FileSignature className="h-4 w-4" /> Finalize &amp; {getRecipientActionLabel(currentRole)} Document
              </>
            )}
          </button>
          <button
            onClick={() => {
              const reason = prompt("Reason for declining (optional):");
              if (reason !== null && claimToken) {
                declineMut.mutate({ documentId, claimToken, reason: reason || undefined });
              }
            }}
            disabled={declineMut.isPending || declined}
            className="w-full rounded-xl py-2.5 text-xs text-red-400/70 transition-all hover:bg-red-500/10 hover:text-red-400"
          >
            {declined ? "Declined" : "Decline to Sign"}
          </button>
          {signMutation.error && (
            <p className="flex items-center justify-center gap-1.5 text-center text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" /> {signMutation.error.message}
            </p>
          )}
          {declineMut.error && (
            <p className="flex items-center justify-center gap-1.5 text-center text-sm text-red-400">
              <AlertCircle className="h-3.5 w-3.5" /> {declineMut.error.message}
            </p>
          )}
        </motion.div>
      )}

      {/* Not connected */}
      {!connected && claimToken && !requiresTokenGateWalletProofs && (
        <div className="glass-card space-y-4 rounded-2xl p-6 text-center">
          <p className="text-sm text-secondary">
            {tokenGateSummary
              ? `Connect an eligible wallet to sign. Required: ${tokenGateSummary}`
              : "Connect your wallet to sign this document"}
          </p>
          <ChainButtons />
        </div>
      )}

      {connected && tokenGateBlocked && currentSigner?.tokenGates && !requiresTokenGateWalletProofs && (
        <div className="glass-card space-y-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-6 text-center">
          <p className="text-sm font-medium text-red-400">This wallet does not satisfy the token gate.</p>
          <p className="text-xs text-muted">{tokenGateEvaluation?.summary ?? tokenGateSummary}</p>
          <ChainButtons />
        </div>
      )}

      {/* Creator claim */}
      {connected && isCreator && !currentSigner && <CreatorClaimSlot documentId={documentId} signers={doc.signers} />}

      {/* ── Floating bottom navigation bar ── */}
      {canSign && totalMyFields > 0 && (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, type: "spring", damping: 25 }}
          className="pointer-events-none fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 pb-4"
        >
          <div
            className="glass-card pointer-events-auto flex w-full max-w-lg items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3 shadow-2xl"
            style={{ backdropFilter: "blur(20px)", background: "var(--glass-bg)" }}
          >
            <button
              onClick={goToPrevField}
              disabled={currentFieldIdx <= 0}
              aria-label="Previous field"
              data-forensic-id="sign-nav-prev"
              className="rounded-lg bg-surface-hover p-2 text-secondary transition-colors hover:bg-surface-elevated hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-3 text-xs">
              <span className="font-medium text-secondary">
                Field {Math.min(currentFieldIdx + 1, totalMyFields)} of {totalMyFields}
              </span>
              <div className="flex gap-1">
                {myFieldsList.map((f, idx) => (
                  <button
                    key={f.id}
                    onClick={() => navigateToField(idx)}
                    aria-label={`Jump to field ${idx + 1}`}
                    data-forensic-id={`sign-nav-dot-${idx + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      idx === currentFieldIdx
                        ? "w-4 bg-accent"
                        : !validateField(f, fieldValues[f.id], validationOptions)
                          ? "w-1.5 bg-green-400/60"
                          : "w-1.5 bg-border"
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {allFieldsComplete && (!needsDrawnSignature || handSignature) ? (
                <button
                  onClick={openConfirmModal}
                  data-forensic-id="sign-confirm"
                  className="shadow-accent/20 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-lg transition-colors hover:bg-accent-hover"
                >
                  <FileSignature className="h-3 w-3" /> {getRecipientActionLabel(currentRole)} Document
                </button>
              ) : (
                <button
                  onClick={goToNextFieldNav}
                  disabled={currentFieldIdx >= totalMyFields - 1}
                  aria-label="Next field"
                  data-forensic-id="sign-nav-next"
                  className="rounded-lg bg-surface-hover p-2 text-secondary transition-colors hover:bg-surface-elevated hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Signature pad modal */}
      <AnimatePresence>
        {showSigPad && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowSigPad(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="glass-card w-full max-w-lg space-y-4 rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <PenTool className="h-5 w-5 text-accent" />{" "}
                  {sigPadMode === "initials" ? "Draw Your Initials" : "Draw Your Signature"}
                </h3>
                <button
                  onClick={() => setShowSigPad(false)}
                  data-forensic-id="signature-pad-close"
                  className="rounded-lg p-1 transition-colors hover:bg-surface-elevated"
                >
                  <X className="h-4 w-4 text-muted" />
                </button>
              </div>
              <SignaturePad
                onCapture={(dataUrl) => {
                  if (sigPadMode === "initials" && initialsFieldRef.current) {
                    handleFieldChange(initialsFieldRef.current, dataUrl);
                  } else {
                    setHandSignature(dataUrl);
                  }
                  setShowSigPad(false);
                }}
                onClear={() => {
                  if (sigPadMode === "initials" && initialsFieldRef.current) {
                    handleFieldChange(initialsFieldRef.current, "");
                  } else {
                    setHandSignature(null);
                  }
                }}
                captured={
                  sigPadMode === "initials"
                    ? !!(initialsFieldRef.current && fieldValues[initialsFieldRef.current])
                    : !!handSignature
                }
                forensicTracker={forensicTracker}
                forensicSurfaceId={sigPadMode === "initials" ? "initials-pad" : "signature-pad"}
                mode={sigPadMode}
                signerIdentity={email || address || undefined}
                documentId={doc?.id}
              />
              {handSignature && (
                <div className="rounded-lg bg-[var(--sig-bg)] p-3">
                  <p className="mb-2 text-xs text-muted">Preview</p>
                  <img src={handSignature} alt="Signature" className="mx-auto max-h-16" />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSigPad(false)}
                  className="flex-1 rounded-lg bg-surface-hover py-2 text-sm text-secondary transition-colors hover:text-primary"
                >
                  {handSignature ? "Done" : "Cancel"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* QR code modal */}
      <AnimatePresence>
        {showQr && qrUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setShowQr(false);
                setQrToken(null);
              }
            }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="glass-card w-full max-w-sm space-y-5 rounded-2xl p-6 text-center shadow-2xl"
            >
              <div>
                <h3 className="mb-1 flex items-center justify-center gap-2 text-lg font-semibold">
                  <QrCode className="h-5 w-5 text-accent" />{" "}
                  {qrMode === "initials" ? "Draw Initials on Phone" : "Sign on Your Phone"}
                </h3>
                <p className="text-xs text-muted">
                  Scan this QR code to open the {qrMode === "initials" ? "initials" : "signature"} pad on your phone
                </p>
              </div>

              <div className="mx-auto overflow-hidden rounded-xl">
                {qrImage ? (
                  <img src={qrImage} alt="Scan to sign" className="h-56 w-56" />
                ) : (
                  <div className="flex h-56 w-56 items-center justify-center rounded-xl bg-surface-elevated">
                    <Loader2 className="h-5 w-5 animate-spin text-white" />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-center gap-2">
                {mobileSignPoll.data?.status === "signed" ? (
                  <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-400">
                    <CheckCircle className="h-4 w-4" /> Signature received!
                  </span>
                ) : (
                  <>
                    <div className="h-2 w-2 animate-pulse rounded-full bg-blue-400" />
                    <span className="text-xs text-muted">Waiting for signature...</span>
                  </>
                )}
              </div>

              <button
                onClick={() => {
                  setShowQr(false);
                  setQrToken(null);
                }}
                className="w-full rounded-lg bg-surface-hover py-2 text-sm text-secondary transition-colors hover:text-primary"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Pre-sign confirmation modal ── */}
      <AnimatePresence>
        {showConfirmModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(12px)" }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowConfirmModal(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="glass-card w-full max-w-md space-y-5 rounded-2xl p-6 shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-lg font-semibold">
                  <FileSignature className="h-5 w-5 text-accent" /> Confirm Signature
                </h3>
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="rounded-lg p-1 transition-colors hover:bg-surface-elevated"
                >
                  <X className="h-4 w-4 text-muted" />
                </button>
              </div>

              {/* Document title */}
              <div className="rounded-xl border border-border bg-surface-card p-4">
                <p className="mb-1 text-xs text-muted">Document</p>
                <p className="text-sm font-medium text-primary">{doc.title}</p>
              </div>

              {/* Summary */}
              <div className="space-y-2 rounded-xl border border-border bg-surface-card p-4">
                <p className="mb-1 text-xs text-muted">Summary</p>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-secondary">Recipient</span>
                  <span className="font-medium text-primary">{currentSigner?.label}</span>
                </div>
                {totalMyFields > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-secondary">Required fields</span>
                    <span className="flex items-center gap-1 font-medium text-primary">
                      <CheckCircle className="h-3 w-3 text-green-400" /> {fieldsFilled}/{totalMyFields}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-secondary">Chain</span>
                  <span className="font-medium text-primary">{chain ? CHAIN_META[chain]?.label : "Unknown"}</span>
                </div>
              </div>

              {/* Signing message preview */}
              <div className="rounded-xl border border-border bg-surface-card p-4">
                <p className="mb-2 flex items-center gap-1 text-xs text-muted">
                  <Eye className="h-3 w-3" /> Signing message
                </p>
                <p className="break-all font-mono text-[11px] leading-relaxed text-muted">{confirmSigningMessage}</p>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="flex-1 rounded-xl bg-surface-hover py-3 text-sm font-medium text-secondary transition-colors hover:bg-surface-elevated hover:text-primary"
                >
                  Go Back
                </button>
                <button
                  onClick={confirmAndSign}
                  disabled={signing}
                  className="shadow-accent/20 flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {signing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Signing...
                    </>
                  ) : (
                    <>
                      <PenTool className="h-4 w-4" /> Confirm &amp; {getRecipientActionLabel(currentRole)}
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Document Assistant for Signers */}
      {claimToken && docQuery.data && (
        <AiSignerChat
          documentId={documentId}
          claimToken={claimToken}
          documentTitle={docQuery.data.title}
          signerLabel={
            docQuery.data.signers?.find((s) => "claimToken" in s && s.claimToken === claimToken)?.label ?? "Signer"
          }
        />
      )}
    </div>
  );
}
