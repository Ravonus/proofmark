"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileSignature,
  Loader2,
  PenTool,
  Smartphone,
} from "lucide-react";
import { addressPreview, CHAIN_META } from "~/lib/crypto/chains";
import { isImageDataUrl } from "~/lib/document/field-values";
import { getRecipientActionLabel } from "~/lib/signing/recipient-roles";
import type { InlineField } from "./sign-document-helpers";
import { validateField } from "./sign-document-helpers";

// ─── Helpers ────────────────────────────────────────────────────────────────

export function resolveTokenGateCardState(
  requiresProofs: boolean,
  evaluation: { status?: string } | null,
  wallets: { status: string }[],
  blocked: boolean,
): string {
  if (requiresProofs) {
    if (evaluation?.status === "eligible") return "eligible";
    if (wallets.some((w) => w.status === "failed")) return "failed";
    return "pending";
  }
  if (evaluation?.status === "eligible") return "eligible";
  if (blocked) return "failed";
  return "pending";
}

// ─── Error Banner ───────────────────────────────────────────────────────────

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
      <span>{message}</span>
      <button onClick={onDismiss} className="ml-3 text-red-400/60 hover:text-red-400">
        Dismiss
      </button>
    </div>
  );
}

// ─── Floating Toolbar ───────────────────────────────────────────────────────

export function FloatingToolbar({
  chain,
  address,
  currentSigner,
  myFieldIds,
  fieldsFilled,
  totalMyFields,
  requiredFieldsRemaining,
  allFieldsComplete,
  goToNextField,
}: {
  chain: string;
  address: string;
  currentSigner: { label: string };
  myFieldIds: Set<string>;
  fieldsFilled: number;
  totalMyFields: number;
  requiredFieldsRemaining: number;
  allFieldsComplete: boolean;
  goToNextField: () => void;
}) {
  return (
    <motion.div
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="glass-card border-accent/20 sticky top-16 z-30 flex items-center justify-between gap-3 rounded-2xl border p-3 shadow-lg"
    >
      <div className="flex items-center gap-3">
        <div className="bg-accent/15 flex h-8 w-8 items-center justify-center rounded-full">
          <span
            style={{
              color: CHAIN_META[chain as keyof typeof CHAIN_META]?.color,
            }}
          >
            {CHAIN_META[chain as keyof typeof CHAIN_META]?.icon}
          </span>
        </div>
        <div className="text-xs">
          <span className="font-medium text-secondary">{currentSigner.label}</span>
          <span className="ml-2 font-mono text-muted">{addressPreview(address)}</span>
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
  );
}

// ─── Signature Block Renderer ───────────────────────────────────────────────

export function SignatureBlockRenderer({
  signerIdx,
  mySignerIdx,
  doc,
  canSign,
  needsDrawnSignature,
  handSignature,
  openSignaturePad,
  currentSigner,
  claimToken,
  documentId,
  createMobileSession,
}: {
  signerIdx: number;
  mySignerIdx: number;
  doc: {
    signers: Array<
      Record<string, unknown> & {
        status: string;
        label: string;
        signedAt: Date | null;
        handSignatureData?: string;
      }
    >;
  };
  canSign: boolean;
  needsDrawnSignature: boolean;
  handSignature: string | null;
  openSignaturePad: (mode?: "signature" | "initials") => void;
  currentSigner: { label: string } | null;
  claimToken: string | null;
  documentId: string;
  createMobileSession: {
    mutate: (args: { documentId: string; claimToken: string; signerLabel: string }) => void;
  };
}) {
  const isMyBlock = signerIdx === mySignerIdx || signerIdx === -1;
  const blockSigner = doc.signers[signerIdx];
  const blockSigned = blockSigner?.status === "SIGNED";
  const blockSigImg = blockSigner?.handSignatureData;

  if (canSign && isMyBlock && needsDrawnSignature) {
    return (
      <div className="inline-flex items-center gap-1">
        <button
          onClick={() => openSignaturePad()}
          className="inline-flex items-center gap-2 rounded-xl border border-dashed border-emerald-400/30 bg-emerald-400/5 px-4 py-2 text-sm text-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.08)] transition-all hover:bg-emerald-400/10"
        >
          {handSignature ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL signature
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
            createMobileSession.mutate({
              documentId,
              claimToken,
              signerLabel: currentSigner.label,
            })
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
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL signature */}
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
          <span className="text-[10px] text-muted">({new Date(blockSigner.signedAt).toLocaleDateString()})</span>
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
}

// ─── Signing Actions ────────────────────────────────────────────────────────

export function SigningActions({
  needsDrawnSignature,
  handSignature,
  allFieldsComplete,
  totalMyFields,
  requiredFieldsRemaining,
  canFinalize,
  signing,
  address,
  chain,
  claimToken,
  canSubmit,
  isEmailOtpSigner,
  currentSigner,
  currentRole,
  email,
  setEmail,
  declined,
  declineMut,
  requestEmailOtp,
  requestEmailOtpPending,
  submitEmailSign,
  documentId,
  openSignaturePad,
  openConfirmModal,
  goToNextField,
}: {
  needsDrawnSignature: boolean;
  handSignature: string | null;
  allFieldsComplete: boolean;
  totalMyFields: number;
  requiredFieldsRemaining: number;
  canFinalize: boolean;
  signing: boolean;
  address: string | null;
  chain: string | null;
  claimToken: string | null;
  canSubmit: boolean;
  isEmailOtpSigner: boolean;
  currentSigner: { label: string } | null;
  currentRole: string;
  email: string;
  setEmail: (e: string) => void;
  declined: boolean;
  declineMut: {
    mutate: (args: { documentId: string; claimToken: string; reason?: string }) => void;
    isPending: boolean;
    error: { message: string } | null;
  };
  requestEmailOtp: () => Promise<void>;
  requestEmailOtpPending: boolean;
  submitEmailSign: (otpCode: string) => Promise<void>;
  documentId: string;
  openSignaturePad: () => void;
  openConfirmModal: () => void;
  goToNextField: () => void;
}) {
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.3 }}
      className="glass-card space-y-4 rounded-2xl p-6"
    >
      <div>
        <label className="mb-1 block text-xs text-muted">
          {isEmailOtpSigner ? "Your email (for verification and signed copy)" : "Your email (for signed copy)"}
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-lg bg-surface-card px-4 py-2.5 text-sm outline-none ring-1 ring-border transition-all focus:ring-accent"
        />
        {isEmailOtpSigner && (
          <p className="mt-2 text-xs text-muted">
            No login required. We&apos;ll email you a 6-digit code to finish signing.
          </p>
        )}
      </div>
      {isEmailOtpSigner && (
        <>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              className="w-full rounded-lg bg-surface-card px-4 py-2.5 text-sm outline-none ring-1 ring-border transition-all focus:ring-accent"
            />
            <button
              type="button"
              onClick={() => {
                void requestEmailOtp()
                  .then(() => setOtpSent(true))
                  .catch(() => setOtpSent(false));
              }}
              disabled={requestEmailOtpPending}
              className="shrink-0 rounded-lg border border-border bg-surface-hover px-4 py-2.5 text-xs font-medium text-secondary transition-colors hover:text-primary disabled:opacity-40"
            >
              {requestEmailOtpPending ? "Sending..." : otpSent ? "Resend Code" : "Send Code"}
            </button>
          </div>
          {otpSent && (
            <p className="text-xs text-emerald-400/80">Verification code sent. Enter it above, then finish signing.</p>
          )}
        </>
      )}
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
          if (isEmailOtpSigner) {
            void submitEmailSign(otpCode);
            return;
          }
          openConfirmModal();
        }}
        disabled={
          signing || !claimToken || !currentSigner || !canSubmit || (isEmailOtpSigner && otpCode.trim().length !== 6)
        }
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
        ) : isEmailOtpSigner && otpCode.trim().length !== 6 ? (
          <>
            <FileSignature className="h-4 w-4" /> Enter your verification code
          </>
        ) : !isEmailOtpSigner && (!address || !chain) ? (
          <>
            <FileSignature className="h-4 w-4" /> Connect your wallet to sign
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
            declineMut.mutate({
              documentId,
              claimToken,
              reason: reason || undefined,
            });
          }
        }}
        disabled={declineMut.isPending || declined}
        className="w-full rounded-xl py-2.5 text-xs text-red-400/70 transition-all hover:bg-red-500/10 hover:text-red-400"
      >
        {declined ? "Declined" : "Decline to Sign"}
      </button>
      {declineMut.error && (
        <p className="flex items-center justify-center gap-1.5 text-center text-sm text-red-400">
          <AlertCircle className="h-3.5 w-3.5" /> {declineMut.error.message}
        </p>
      )}
    </motion.div>
  );
}

// ─── Walkthrough Stepper ───────────────────────────────────────────────────

type SigningPhase = "review" | "fields" | "signature" | "finalize";

function getSigningPhase(
  totalMyFields: number,
  fieldsFilled: number,
  allFieldsComplete: boolean,
  needsDrawnSignature: boolean,
  handSignature: string | null,
): { phase: SigningPhase; phaseLabel: string } {
  if (totalMyFields > 0 && !allFieldsComplete) {
    if (fieldsFilled === 0) return { phase: "review", phaseLabel: "Review document" };
    return { phase: "fields", phaseLabel: "Complete fields" };
  }
  if (needsDrawnSignature && !handSignature) {
    return { phase: "signature", phaseLabel: "Draw signature" };
  }
  return { phase: "finalize", phaseLabel: "Sign & submit" };
}

const PHASE_STEPS: { key: SigningPhase; label: string; icon: string }[] = [
  { key: "review", label: "Review", icon: "1" },
  { key: "fields", label: "Fill", icon: "2" },
  { key: "signature", label: "Sign", icon: "3" },
  { key: "finalize", label: "Submit", icon: "4" },
];

export function WalkthroughStepper({
  totalMyFields,
  fieldsFilled,
  allFieldsComplete,
  needsDrawnSignature,
  handSignature,
}: {
  totalMyFields: number;
  fieldsFilled: number;
  allFieldsComplete: boolean;
  needsDrawnSignature: boolean;
  handSignature: string | null;
}) {
  const { phase } = getSigningPhase(totalMyFields, fieldsFilled, allFieldsComplete, needsDrawnSignature, handSignature);

  const phaseOrder: SigningPhase[] = ["review", "fields", "signature", "finalize"];
  const currentIdx = phaseOrder.indexOf(phase);

  // Filter out phases that don't apply
  const steps = PHASE_STEPS.filter((s) => {
    if (s.key === "fields" && totalMyFields === 0) return false;
    if (s.key === "signature" && !needsDrawnSignature) return false;
    return true;
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card flex items-center justify-center gap-1 rounded-xl border border-border p-2 sm:gap-2 sm:p-3"
    >
      {steps.map((step, idx) => {
        const stepPhaseIdx = phaseOrder.indexOf(step.key);
        const isDone = stepPhaseIdx < currentIdx;
        const isCurrent = step.key === phase;
        const stepNum = idx + 1;

        return (
          <div key={step.key} className="flex items-center gap-1 sm:gap-2">
            {idx > 0 && <div className={`hidden h-px w-4 sm:block ${isDone ? "bg-emerald-400/40" : "bg-border"}`} />}
            <div className="flex items-center gap-1.5">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                  isDone
                    ? "bg-emerald-400/20 text-emerald-400"
                    : isCurrent
                      ? "bg-accent/20 ring-accent/30 text-accent ring-1"
                      : "bg-surface-hover text-muted"
                }`}
              >
                {isDone ? <Check className="h-3 w-3" /> : stepNum}
              </span>
              <span
                className={`text-[10px] font-medium sm:text-xs ${
                  isCurrent ? "text-accent" : isDone ? "text-emerald-400/60" : "text-muted"
                }`}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </motion.div>
  );
}

// ─── Field Navigation Bar ───────────────────────────────────────────────────

export function FieldNavigationBar({
  currentFieldIdx,
  totalMyFields,
  myFieldsList,
  fieldValues,
  validationOptions,
  allFieldsComplete,
  needsDrawnSignature,
  handSignature,
  currentRole,
  navigateToField,
  goToPrevField,
  goToNextFieldNav,
  openConfirmModal,
}: {
  currentFieldIdx: number;
  totalMyFields: number;
  myFieldsList: InlineField[];
  fieldValues: Record<string, string>;
  validationOptions: {
    signatureReady?: boolean;
    allValues?: Record<string, string>;
  };
  allFieldsComplete: boolean;
  needsDrawnSignature: boolean;
  handSignature: string | null;
  currentRole: string;
  navigateToField: (idx: number) => void;
  goToPrevField: () => void;
  goToNextFieldNav: () => void;
  openConfirmModal: () => void;
}) {
  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.4, type: "spring", damping: 25 }}
      className="pointer-events-none fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 pb-4"
    >
      <div
        className="glass-card pointer-events-auto flex w-full max-w-lg items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3 shadow-2xl"
        style={{
          backdropFilter: "blur(20px)",
          background: "var(--glass-bg)",
        }}
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
  );
}
