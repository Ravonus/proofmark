"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, Eye, FileSignature, Loader2, PenTool, QrCode, X } from "lucide-react";
import { addressPreview, CHAIN_META, type WalletChain } from "~/lib/crypto/chains";
import type { BehavioralTracker } from "~/lib/forensic";
import { getRecipientActionLabel } from "~/lib/signing/recipient-roles";
import { SignaturePad } from "./signature-pad";

// ─── Token Gate Card ────────────────────────────────────────────────────────

type TokenGateWallet = {
  chain: WalletChain;
  address?: string;
  status: string;
  message: string;
};

export function TokenGateCard({
  tokenGateSummary,
  tokenGateCardState,
  requiresTokenGateWalletProofs,
  tokenGateEvaluation,
  tokenGateBlocked,
  tokenGateWallets,
  tokenGateWalletError,
  verifyingTokenGateChain,
  connected,
  chain,
  connectTokenGateChain,
  verifyTokenGateWallet,
}: {
  tokenGateSummary: string | null;
  tokenGateCardState: string;
  requiresTokenGateWalletProofs: boolean;
  tokenGateEvaluation: { status?: string; summary?: string } | null;
  tokenGateBlocked: boolean;
  tokenGateWallets: TokenGateWallet[];
  tokenGateWalletError: string | null;
  verifyingTokenGateChain: WalletChain | null;
  connected: boolean;
  chain: WalletChain | null;
  connectTokenGateChain: (chain: WalletChain) => void;
  verifyTokenGateWallet: (chain: WalletChain) => void;
}) {
  return (
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
        <TokenGateWalletProofs
          tokenGateWallets={tokenGateWallets}
          tokenGateEvaluation={tokenGateEvaluation}
          tokenGateWalletError={tokenGateWalletError}
          verifyingTokenGateChain={verifyingTokenGateChain}
          connected={connected}
          chain={chain}
          connectTokenGateChain={connectTokenGateChain}
          verifyTokenGateWallet={verifyTokenGateWallet}
        />
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
  );
}

function TokenGateWalletProofs({
  tokenGateWallets,
  tokenGateEvaluation,
  tokenGateWalletError,
  verifyingTokenGateChain,
  connected,
  chain,
  connectTokenGateChain,
  verifyTokenGateWallet,
}: {
  tokenGateWallets: TokenGateWallet[];
  tokenGateEvaluation: { status?: string; summary?: string } | null;
  tokenGateWalletError: string | null;
  verifyingTokenGateChain: WalletChain | null;
  connected: boolean;
  chain: WalletChain | null;
  connectTokenGateChain: (chain: WalletChain) => void;
  verifyTokenGateWallet: (chain: WalletChain) => void;
}) {
  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-muted">
        Verify each required chain wallet below. Proofmark will run the live checks for that wallet, and dev bypass only
        changes the final result after those checks complete.
      </p>
      {tokenGateWallets.map((walletCheck) => (
        <TokenGateWalletRow
          key={walletCheck.chain}
          walletCheck={walletCheck}
          connected={connected}
          chain={chain}
          verifyingTokenGateChain={verifyingTokenGateChain}
          connectTokenGateChain={connectTokenGateChain}
          verifyTokenGateWallet={verifyTokenGateWallet}
        />
      ))}
      <p
        className={`text-xs ${
          tokenGateEvaluation?.status === "eligible"
            ? "text-green-400"
            : tokenGateWallets.some((w) => w.status === "failed")
              ? "text-red-400"
              : "text-amber-300"
        }`}
      >
        {tokenGateEvaluation?.summary ?? "Verify all required wallets to continue."}
      </p>
      {tokenGateWalletError && <p className="text-xs text-red-400">{tokenGateWalletError}</p>}
    </div>
  );
}

function TokenGateWalletRow({
  walletCheck,
  connected,
  chain,
  verifyingTokenGateChain,
  connectTokenGateChain,
  verifyTokenGateWallet,
}: {
  walletCheck: TokenGateWallet;
  connected: boolean;
  chain: WalletChain | null;
  verifyingTokenGateChain: WalletChain | null;
  connectTokenGateChain: (chain: WalletChain) => void;
  verifyTokenGateWallet: (chain: WalletChain) => void;
}) {
  const chainMeta = CHAIN_META[walletCheck.chain];
  const isCurrentChain = connected && chain === walletCheck.chain;
  const isVerifying = verifyingTokenGateChain === walletCheck.chain;
  const verified = walletCheck.status === "verified";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-black/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium text-primary">
          {chainMeta.label} wallet
          {walletCheck.address ? ` \u00b7 ${addressPreview(walletCheck.address)}` : ""}
        </p>
        <p
          className={`mt-1 text-xs ${
            verified ? "text-green-400" : walletCheck.status === "failed" ? "text-red-400" : "text-amber-300"
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
}

// ─── Signature Pad Modal ────────────────────────────────────────────────────

export function SignaturePadModal({
  show,
  onClose,
  sigPadMode,
  handSignature,
  fieldValues,
  initialsFieldId,
  onCapture,
  onClear,
  forensicTracker,
  email,
  address,
  documentId,
}: {
  show: boolean;
  onClose: () => void;
  sigPadMode: "signature" | "initials";
  handSignature: string | null;
  fieldValues: Record<string, string>;
  initialsFieldId: string | null;
  onCapture: (mode: "signature" | "initials", fieldId: string | null, dataUrl: string) => void;
  onClear: (mode: "signature" | "initials", fieldId: string | null) => void;
  forensicTracker: BehavioralTracker | null;
  email: string;
  address: string | null;
  documentId?: string;
}) {
  if (!show) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(8px)",
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
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
              onClick={onClose}
              data-forensic-id="signature-pad-close"
              className="rounded-lg p-1 transition-colors hover:bg-surface-elevated"
            >
              <X className="h-4 w-4 text-muted" />
            </button>
          </div>
          <SignaturePad
            onCapture={(dataUrl) => onCapture(sigPadMode, initialsFieldId, dataUrl)}
            onClear={() => onClear(sigPadMode, initialsFieldId)}
            captured={sigPadMode === "initials" ? !!(initialsFieldId && fieldValues[initialsFieldId]) : !!handSignature}
            forensicTracker={forensicTracker}
            forensicSurfaceId={sigPadMode === "initials" ? "initials-pad" : "signature-pad"}
            mode={sigPadMode}
            signerIdentity={email || address || undefined}
            documentId={documentId}
          />
          {handSignature && (
            <div className="rounded-lg bg-[var(--sig-bg)] p-3">
              <p className="mb-2 text-xs text-muted">Preview</p>
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL signature, not a remote image */}
              <img src={handSignature} alt="Signature" className="mx-auto max-h-16" />
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg bg-surface-hover py-2 text-sm text-secondary transition-colors hover:text-primary"
            >
              {handSignature ? "Done" : "Cancel"}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── QR Code Modal ──────────────────────────────────────────────────────────

export function QrModal({
  show,
  qrUrl,
  qrImage,
  qrMode,
  mobileSignStatus,
  onClose,
}: {
  show: boolean;
  qrUrl: string | null;
  qrImage: string | null;
  qrMode: string | null;
  mobileSignStatus: string | null;
  onClose: () => void;
}) {
  if (!show || !qrUrl) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(12px)",
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
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
              // eslint-disable-next-line @next/next/no-img-element -- data URL QR code, not a remote image
              <img src={qrImage} alt="Scan to sign" className="h-56 w-56" />
            ) : (
              <div className="flex h-56 w-56 items-center justify-center rounded-xl bg-surface-elevated">
                <Loader2 className="h-5 w-5 animate-spin text-white" />
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-2">
            {mobileSignStatus === "signed" ? (
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
            onClick={onClose}
            className="w-full rounded-lg bg-surface-hover py-2 text-sm text-secondary transition-colors hover:text-primary"
          >
            Cancel
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Confirm Modal ──────────────────────────────────────────────────────────

export function ConfirmModal({
  show,
  onClose,
  onConfirm,
  docTitle,
  currentSignerLabel,
  totalMyFields,
  fieldsFilled,
  chain,
  confirmSigningMessage,
  signing,
  currentRole,
}: {
  show: boolean;
  onClose: () => void;
  onConfirm: () => void;
  docTitle: string;
  currentSignerLabel: string;
  totalMyFields: number;
  fieldsFilled: number;
  chain: WalletChain | null;
  confirmSigningMessage: string;
  signing: boolean;
  currentRole: string;
}) {
  if (!show) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(12px)",
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.85, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="glass-card w-full max-w-md space-y-5 rounded-2xl p-6 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <FileSignature className="h-5 w-5 text-accent" /> Confirm Signature
            </h3>
            <button onClick={onClose} className="rounded-lg p-1 transition-colors hover:bg-surface-elevated">
              <X className="h-4 w-4 text-muted" />
            </button>
          </div>

          <div className="rounded-xl border border-border bg-surface-card p-4">
            <p className="mb-1 text-xs text-muted">Document</p>
            <p className="text-sm font-medium text-primary">{docTitle}</p>
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-surface-card p-4">
            <p className="mb-1 text-xs text-muted">Summary</p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-secondary">Recipient</span>
              <span className="font-medium text-primary">{currentSignerLabel}</span>
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

          <div className="rounded-xl border border-border bg-surface-card p-4">
            <p className="mb-2 flex items-center gap-1 text-xs text-muted">
              <Eye className="h-3 w-3" /> Signing message
            </p>
            <p className="break-all font-mono text-[11px] leading-relaxed text-muted">{confirmSigningMessage}</p>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 rounded-xl bg-surface-hover py-3 text-sm font-medium text-secondary transition-colors hover:bg-surface-elevated hover:text-primary"
            >
              Go Back
            </button>
            <button
              onClick={onConfirm}
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
    </AnimatePresence>
  );
}
