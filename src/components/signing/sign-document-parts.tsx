"use client";

import { memo } from "react";
import { trpc } from "~/lib/platform/trpc";
import { CHAIN_META, addressPreview, type WalletChain } from "~/lib/crypto/chains";
import { getRecipientCompletedLabel, isViewOnlyRecipientRole } from "~/lib/signing/recipient-roles";
import { describeSignerTokenGate } from "~/lib/token-gates";
import { AlertCircle, Check } from "lucide-react";
import type { SignerInfo } from "./sign-document-helpers";

// ─── Sub-components ──────────────────────────────────────────────────────────

export function CenterCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4">
      <div className="glass-card space-y-4 rounded-2xl p-8 text-center">{children}</div>
    </div>
  );
}

export const DocumentHeader = memo(function DocumentHeader({
  doc,
  signedCount,
  totalRecipients,
}: {
  doc: { title: string; status: string; signers: SignerInfo[] };
  signedCount: number;
  totalRecipients: number;
}) {
  const total = Math.max(totalRecipients, 1);
  const pct = total > 0 ? (signedCount / total) * 100 : 0;
  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="mb-3 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <h1 className="text-xl font-bold">{doc.title}</h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${doc.status === "COMPLETED" ? "border border-green-500/20 bg-green-500/20 text-green-400" : "border border-amber-500/20 bg-amber-500/20 text-amber-400"}`}
        >
          {doc.status === "COMPLETED" ? "Fully Complete" : `${signedCount}/${total} Complete`}
        </span>
      </div>
      <div className="bg-surface-hover/50 h-1.5 overflow-hidden rounded-full">
        <div
          className={`h-full rounded-full transition-all duration-700 ${signedCount === total ? "bg-green-400" : "bg-accent"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
});

export const SignerList = memo(function SignerList({
  signers,
  currentAddress,
}: {
  signers: SignerInfo[];
  currentAddress: string | null;
}) {
  return (
    <div className="glass-card space-y-3 rounded-2xl p-5">
      <h3 className="text-sm font-medium text-secondary">Recipients</h3>
      <div className="space-y-2">
        {signers.map((signer, idx) => {
          const meta = signer.chain ? CHAIN_META[signer.chain as WalletChain] : null;
          const isMe =
            signer.isYou || (currentAddress && signer.address?.toLowerCase() === currentAddress.toLowerCase());
          const role = signer.role ?? "SIGNER";
          const roleLabel = role.toLowerCase().replace(/_/g, " ");
          const contactLabel = signer.address ? addressPreview(signer.address) : signer.email || "Not yet claimed";
          const tokenGateLabel = signer.tokenGates ? describeSignerTokenGate(signer.tokenGates) : null;
          const statusLabel =
            signer.status === "SIGNED"
              ? getRecipientCompletedLabel(role)
              : signer.status === "DECLINED"
                ? "Declined"
                : isViewOnlyRecipientRole(role)
                  ? "View-only"
                  : signer.canSign === false
                    ? "Waiting turn"
                    : "Pending";
          const statusClassName =
            signer.status === "SIGNED"
              ? "text-green-400"
              : signer.status === "DECLINED"
                ? "text-red-400"
                : signer.canSign === false && !isViewOnlyRecipientRole(role)
                  ? "text-sky-400"
                  : isViewOnlyRecipientRole(role)
                    ? "text-muted"
                    : "text-amber-400";
          return (
            <div
              key={idx}
              className={`flex items-center justify-between rounded-xl px-4 py-3 ${isMe ? "bg-accent/10 ring-accent/20 ring-1" : "bg-surface-card"}`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${signer.status === "SIGNED" ? "bg-green-500/15" : "bg-surface-hover"}`}
                >
                  {signer.status === "SIGNED" ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : meta ? (
                    <span style={{ color: meta.color }}>{meta.icon}</span>
                  ) : (
                    <span className="text-xs text-muted">?</span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">
                    {signer.label}
                    {isMe && <span className="ml-2 text-[10px] font-normal text-accent">(you)</span>}
                  </p>
                  <p className="font-mono text-xs text-muted">{contactLabel}</p>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{roleLabel}</p>
                  {tokenGateLabel && (
                    <p className="mt-1 text-[10px] text-amber-300/80">Token-gated: {tokenGateLabel}</p>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className={`flex items-center justify-end gap-1 text-xs font-medium ${statusClassName}`}>
                  {signer.status === "SIGNED" && <Check className="h-3 w-3" />}
                  {statusLabel}
                </p>
                {signer.signedAt && (
                  <p className="text-[10px] text-muted">{new Date(signer.signedAt).toLocaleDateString()}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export function CreatorClaimSlot({ documentId, signers }: { documentId: string; signers: SignerInfo[] }) {
  const claimMut = trpc.document.claimSlot.useMutation();
  const pendingSlots = signers.filter((s) => s.status === "PENDING" && !s.isClaimed);
  if (pendingSlots.length === 0)
    return (
      <div className="glass-card border-accent/20 bg-accent/5 rounded-2xl p-6 text-center">
        <p className="text-sm text-muted">All signer slots are claimed or signed.</p>
      </div>
    );
  if (claimMut.data) {
    if (typeof window !== "undefined") window.location.href = claimMut.data.signUrl;
    return (
      <div className="glass-card rounded-2xl border-green-500/20 bg-green-500/5 p-6 text-center">
        <p className="font-medium text-green-400">Redirecting...</p>
      </div>
    );
  }
  return (
    <div className="glass-card border-accent/20 bg-accent/5 space-y-4 rounded-2xl p-6">
      <p className="text-sm font-medium text-secondary">You created this document — claim a signer slot:</p>
      <div className="space-y-2">
        {pendingSlots.map((slot) => (
          <button
            key={slot.id}
            className="hover:bg-surface-hover/60 flex w-full items-center justify-between rounded-xl border border-border bg-surface-card px-4 py-3 transition-colors"
            onClick={() => claimMut.mutate({ documentId, signerId: slot.id })}
            disabled={claimMut.isPending}
          >
            <span className="text-sm font-medium">{slot.label}</span>
            <span className="text-xs text-accent">Claim & Sign</span>
          </button>
        ))}
      </div>
      {claimMut.error && (
        <p className="flex items-center gap-1 text-xs text-red-400">
          <AlertCircle className="h-3 w-3" /> {claimMut.error.message}
        </p>
      )}
    </div>
  );
}

export { WalletPicker as ChainButtons } from "~/components/layout/wallet-provider";
