"use client";

import { motion } from "framer-motion";
import { Ban, Check, CheckCircle, Download, ExternalLink, Eye, Link2, PackageOpen, PenLine, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { CHAIN_META, type WalletChain } from "~/lib/crypto/chains";
import { trpc } from "~/lib/platform/trpc";
import { PostSignDownloadManager } from "../post-sign/post-sign-download-manager";
import type { DocWithSigners, GroupedDoc } from "./dashboard-types";

/* ── Expiration Badge ────────────────────────────────────────── */

export function ExpirationBadge({ expiresAt }: { expiresAt: Date }) {
  const now = new Date();
  const diff = expiresAt.getTime() - now.getTime();
  if (diff <= 0) return <span className="text-[10px] font-medium text-[var(--danger)]">Expired</span>;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  const color = days <= 3 ? "text-[var(--danger)]" : days <= 7 ? "text-[var(--warning)]" : "text-muted";
  return <span className={`text-[10px] ${color}`}>{days}d left</span>;
}

/* ── Action Link ─────────────────────────────────────────────── */

function ActionLink({
  href,
  icon,
  label,
  accent,
  external,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  accent?: boolean;
  external?: boolean;
}) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 rounded-xs px-2 py-1 text-[9px] font-medium transition-colors ${
        accent
          ? "bg-[var(--accent-subtle)] text-accent hover:bg-[var(--accent-muted)]"
          : "bg-[var(--bg-inset)] text-secondary hover:bg-[var(--bg-hover)]"
      }`}
    >
      {icon}
      {label}
    </a>
  );
}

/* ── Status Badge ────────────────────────────────────────────── */

export function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { cls: string; icon: React.ReactNode; dot: string }> = {
    COMPLETED: {
      cls: "text-[var(--success)]",
      icon: <CheckCircle className="h-3 w-3" />,
      dot: "status-dot-success",
    },
    PENDING: {
      cls: "text-[var(--warning)]",
      icon: <PenLine className="h-3 w-3" />,
      dot: "status-dot-warning",
    },
    EXPIRED: {
      cls: "text-[var(--danger)]",
      icon: <PenLine className="h-3 w-3" />,
      dot: "status-dot-danger",
    },
    VOIDED: {
      cls: "text-[var(--danger)]",
      icon: <PenLine className="h-3 w-3" />,
      dot: "status-dot-danger",
    },
  };
  const c = config[status] ?? { cls: "text-muted", icon: null, dot: "" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.1em] ${c.cls}`}>
      <span className={`status-dot ${c.dot}`} />
      {status}
    </span>
  );
}

/* ── Doc Card Footer ─────────────────────────────────────────── */

function DocCardFooter({
  doc,
  copiedSignerId,
  copySignUrl,
  showDownloadsManager,
  setShowDownloadsManager,
}: {
  doc: DocWithSigners;
  copiedSignerId: string | null;
  copySignUrl: (url: string, id: string) => void;
  showDownloadsManager: boolean;
  setShowDownloadsManager: (fn: (v: boolean) => boolean) => void;
}) {
  const utils = trpc.useUtils();
  const resendMut = trpc.document.resendInvite.useMutation();
  const voidMut = trpc.document.voidDocument.useMutation({
    onSuccess: () => utils.document.listByAddress.invalidate(),
  });
  const isCreator = doc.viewerIsCreator;
  const sharedFileCount = doc.postSignReveal?.downloads?.length ?? 0;

  return (
    <div className="border-t border-[var(--border-subtle)] px-4 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {doc.status === "PENDING" &&
          isCreator &&
          doc.signers
            .filter((s) => s.status === "PENDING")
            .map((s) => (
              <span key={s.id} className="inline-flex items-center gap-0.5">
                {s.signUrl && (
                  <button
                    onClick={() => copySignUrl(s.signUrl!, s.id)}
                    className="bg-accent/[0.08] hover:bg-accent/[0.15] inline-flex items-center gap-1 rounded-xs px-2 py-1 text-[9px] font-medium text-accent transition-colors"
                  >
                    {copiedSignerId === s.id ? <Check className="h-2.5 w-2.5" /> : <Link2 className="h-2.5 w-2.5" />}
                    {copiedSignerId === s.id ? "Copied!" : `Link ${s.label}`}
                  </button>
                )}
                <button
                  onClick={() => {
                    resendMut.mutate({
                      documentId: doc.id,
                      signerId: s.id,
                    });
                  }}
                  disabled={resendMut.isPending}
                  className="inline-flex items-center gap-1 rounded-xs bg-blue-500/[0.08] px-2 py-1 text-[9px] font-medium text-blue-400 transition-colors hover:bg-blue-500/[0.15] disabled:opacity-40"
                >
                  <Send className="h-2.5 w-2.5" />
                  Resend
                </button>
              </span>
            ))}

        {doc.status === "COMPLETED" && (
          <>
            <ActionLink href={`/api/pdf/${doc.id}`} icon={<Download className="h-2.5 w-2.5" />} label="PDF" accent />
            <ActionLink href={`/view/${doc.id}`} icon={<ExternalLink className="h-2.5 w-2.5" />} label="View" accent />
            <ActionLink
              href={`/verify/${doc.contentHash}`}
              icon={<ExternalLink className="h-2.5 w-2.5" />}
              label="Verify"
            />
            <ActionLink
              href={`/api/proof-packet/${doc.id}`}
              icon={<Download className="h-2.5 w-2.5" />}
              label="Evidence"
              external
            />
            <ActionLink href={`/sign/${doc.id}`} icon={<Eye className="h-2.5 w-2.5" />} label="Document" />
          </>
        )}

        {isCreator && (
          <button
            onClick={() => setShowDownloadsManager((current) => !current)}
            className="inline-flex items-center gap-1 rounded-xs bg-[var(--bg-inset)] px-2 py-1 text-[9px] font-medium text-secondary transition-colors hover:bg-[var(--bg-hover)]"
          >
            <PackageOpen className="h-2.5 w-2.5" />
            {showDownloadsManager
              ? "Hide documents"
              : sharedFileCount > 0
                ? `Manage documents (${sharedFileCount})`
                : "Add documents"}
          </button>
        )}

        {doc.status === "PENDING" && isCreator && (
          <button
            onClick={() => {
              if (confirm("Void this document? All pending signatures will be cancelled.")) {
                voidMut.mutate({ documentId: doc.id });
              }
            }}
            disabled={voidMut.isPending}
            className="ml-auto inline-flex items-center gap-1 rounded-xs bg-[var(--danger-subtle)] px-2 py-1 text-[9px] font-medium text-[var(--danger)] transition-colors hover:bg-red-500/15 disabled:opacity-40"
          >
            <Ban className="h-2.5 w-2.5" />
            Void
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Document Card ───────────────────────────────────────────── */

export function DocCard({ doc, isLast }: { doc: DocWithSigners; isLast: boolean }) {
  const [showDownloadsManager, setShowDownloadsManager] = useState(false);
  const [copiedSignerId, setCopiedSignerId] = useState<string | null>(null);
  const copySignUrl = useCallback((signUrl: string, signerId: string) => {
    void navigator.clipboard.writeText(signUrl).then(() => {
      setCopiedSignerId(signerId);
      setTimeout(() => setCopiedSignerId(null), 2000);
    });
  }, []);
  const signedCount = doc.signers.filter((s) => s.status === "SIGNED").length;
  const isCreator = doc.viewerIsCreator;
  const mySigner = doc.signers.find((s) => s.isYou);
  const needsMySignature = mySigner?.status === "PENDING";
  const progress = (signedCount / doc.signers.length) * 100;
  const hasFooter = (doc.status === "PENDING" && isCreator) || doc.status === "COMPLETED" || isCreator;

  return (
    <div className={`overflow-hidden bg-[var(--bg-card)] ${!isLast ? "border-b border-[var(--border-subtle)]" : ""}`}>
      <Link href={`/sign/${doc.id}`} className="group block px-4 py-3 transition-colors hover:bg-[var(--bg-hover)]">
        <DocCardHeader doc={doc} needsMySignature={needsMySignature ?? false} />
        <ProgressBar progress={progress} label={`${signedCount}/${doc.signers.length}`} />
        <SignerChips signers={doc.signers} />
      </Link>

      {hasFooter && (
        <DocCardFooter
          doc={doc}
          copiedSignerId={copiedSignerId}
          copySignUrl={copySignUrl}
          showDownloadsManager={showDownloadsManager}
          setShowDownloadsManager={setShowDownloadsManager}
        />
      )}

      {isCreator && showDownloadsManager && (
        <div className="border-t border-[var(--border-subtle)] px-4 py-3">
          <PostSignDownloadManager documentId={doc.id} documentTitle={doc.title} reveal={doc.postSignReveal} />
        </div>
      )}
    </div>
  );
}

/* ── Shared sub-components ───────────────────────────────────── */

function DocCardHeader({ doc, needsMySignature }: { doc: DocWithSigners; needsMySignature: boolean }) {
  const isCreator = doc.viewerIsCreator;
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h4 className="truncate text-[13px] font-medium">{doc.title}</h4>
          {needsMySignature && (
            <motion.span
              className="shrink-0 rounded-xs border border-[var(--border-accent)] bg-[var(--accent-subtle)] px-1.5 py-px text-[9px] font-medium text-accent"
              animate={{ opacity: [1, 0.6, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              Action Required
            </motion.span>
          )}
        </div>
        <p className="mt-0.5 text-[10px] text-muted">
          {new Date(doc.createdAt).toLocaleDateString()} &bull;{" "}
          {isCreator ? "Created by you" : `By ${doc.createdBy.slice(0, 6)}...${doc.createdBy.slice(-4)}`}
          {doc.expiresAt && doc.status === "PENDING" && (
            <>
              {" "}
              &bull; <ExpirationBadge expiresAt={new Date(doc.expiresAt)} />
            </>
          )}
        </p>
      </div>
      <StatusBadge status={doc.status} />
    </div>
  );
}

function ProgressBar({ progress, label }: { progress: number; label: string }) {
  return (
    <div className="mt-2 flex items-center gap-3">
      <div className="h-px flex-1 bg-[var(--border)]">
        <motion.div
          className={`h-full ${progress >= 100 ? "bg-[var(--success)]" : "bg-accent"}`}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{
            duration: 0.6,
            ease: [0.23, 1, 0.32, 1],
            delay: 0.15,
          }}
        />
      </div>
      <span className="shrink-0 text-[10px] text-muted">{label}</span>
    </div>
  );
}

function SignerChips({ signers }: { signers: DocWithSigners["signers"] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {signers.map((s) => {
        const meta = CHAIN_META[s.chain as WalletChain];
        return (
          <span
            key={s.id}
            className={`inline-flex items-center gap-1 rounded-xs px-1.5 py-px text-[9px] transition-colors ${
              s.status === "SIGNED"
                ? "border border-[var(--success-10)] bg-[var(--success-subtle)] text-[var(--success)]"
                : "border border-[var(--border)] bg-[var(--bg-inset)] text-muted"
            }`}
          >
            <span style={{ color: meta?.color }}>{meta?.icon}</span>
            {s.label}
            {s.status === "SIGNED" && <CheckCircle className="h-2 w-2" />}
          </span>
        );
      })}
    </div>
  );
}

/* ── Group Card Expanded Rows ────────────────────────────────── */

function GroupExpandedRows({
  group,
  copiedId,
  copyUrl,
}: {
  group: GroupedDoc;
  copiedId: string | null;
  copyUrl: (url: string, id: string) => void;
}) {
  const resendMut = trpc.document.resendInvite.useMutation();
  const discloserSigned = group.discloser?.status === "SIGNED";

  return (
    <div className="border-t border-[var(--border-subtle)]">
      {group.discloser && (
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
          <span
            className={`inline-flex items-center gap-1 rounded-xs px-1.5 py-px text-[9px] ${
              discloserSigned
                ? "border border-[var(--success-10)] bg-[var(--success-subtle)] text-[var(--success)]"
                : "border border-[var(--border)] bg-[var(--bg-inset)] text-muted"
            }`}
          >
            {group.discloser.label}
            {discloserSigned && <CheckCircle className="h-2 w-2" />}
          </span>
          <span className="text-[8px] text-muted">Discloser</span>
          <div className="flex-1" />
          {group.discloser.signUrl && !discloserSigned && (
            <button
              onClick={() => copyUrl(group.discloser!.signUrl!, "discloser")}
              className="bg-accent/[0.08] hover:bg-accent/[0.15] inline-flex items-center gap-1 rounded-xs px-2 py-1 text-[9px] font-medium text-accent transition-colors"
            >
              {copiedId === "discloser" ? <Check className="h-2.5 w-2.5" /> : <Link2 className="h-2.5 w-2.5" />}
              {copiedId === "discloser" ? "Copied!" : "Copy Link"}
            </button>
          )}
          {discloserSigned && (
            <Link
              href={`/sign/${group.primaryDoc.id}`}
              className="inline-flex items-center gap-1 rounded-xs bg-[var(--bg-inset)] px-2 py-1 text-[9px] font-medium text-secondary transition-colors hover:bg-[var(--bg-hover)]"
            >
              <Eye className="h-2.5 w-2.5" />
              View
            </Link>
          )}
        </div>
      )}
      {group.recipients.map((r) => (
        <RecipientRow key={r.id} r={r} copiedId={copiedId} copyUrl={copyUrl} resendMut={resendMut} />
      ))}
    </div>
  );
}

function RecipientRow({
  r,
  copiedId,
  copyUrl,
  resendMut,
}: {
  r: GroupedDoc["recipients"][number];
  copiedId: string | null;
  copyUrl: (url: string, id: string) => void;
  resendMut: {
    mutate: (input: { documentId: string; signerId: string }) => void;
    isPending: boolean;
  };
}) {
  const meta = CHAIN_META[r.chain as WalletChain];
  return (
    <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2 last:border-b-0">
      <span
        className={`inline-flex items-center gap-1 rounded-xs px-1.5 py-px text-[9px] ${
          r.status === "SIGNED"
            ? "border border-[var(--success-10)] bg-[var(--success-subtle)] text-[var(--success)]"
            : "border border-[var(--border)] bg-[var(--bg-inset)] text-muted"
        }`}
      >
        {meta && <span style={{ color: meta.color }}>{meta.icon}</span>}
        {r.label}
        {r.status === "SIGNED" && <CheckCircle className="h-2 w-2" />}
      </span>
      <div className="flex-1" />
      {r.status === "SIGNED" && (
        <Link
          href={`/sign/${r.documentId}`}
          className="inline-flex items-center gap-1 rounded-xs bg-[var(--bg-inset)] px-2 py-1 text-[9px] font-medium text-secondary transition-colors hover:bg-[var(--bg-hover)]"
        >
          <Eye className="h-2.5 w-2.5" />
          View
        </Link>
      )}
      {r.signUrl && r.status === "PENDING" && (
        <button
          onClick={() => copyUrl(r.signUrl!, r.id)}
          className="bg-accent/[0.08] hover:bg-accent/[0.15] inline-flex items-center gap-1 rounded-xs px-2 py-1 text-[9px] font-medium text-accent transition-colors"
        >
          {copiedId === r.id ? <Check className="h-2.5 w-2.5" /> : <Link2 className="h-2.5 w-2.5" />}
          {copiedId === r.id ? "Copied!" : "Copy Link"}
        </button>
      )}
      {r.status === "PENDING" && (
        <button
          onClick={() =>
            resendMut.mutate({
              documentId: r.documentId,
              signerId: r.id,
            })
          }
          disabled={resendMut.isPending}
          className="inline-flex items-center gap-1 rounded-xs bg-blue-500/[0.08] px-2 py-1 text-[9px] font-medium text-blue-400 transition-colors hover:bg-blue-500/[0.15] disabled:opacity-40"
        >
          <Send className="h-2.5 w-2.5" />
          Resend
        </button>
      )}
    </div>
  );
}

/* ── Group Card ──────────────────────────────────────────────── */

export function GroupCard({ group, isLast }: { group: GroupedDoc; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showDownloadsManager, setShowDownloadsManager] = useState(false);
  const utils = trpc.useUtils();
  const voidMut = trpc.document.voidDocument.useMutation({
    onSuccess: () => utils.document.listByAddress.invalidate(),
  });
  const sharedFileCount = group.primaryDoc.postSignReveal?.downloads?.length ?? 0;

  const copyUrl = useCallback((url: string, id: string) => {
    void navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  const signedRecipients = group.recipients.filter((r) => r.status === "SIGNED").length;
  const totalRecipients = group.recipients.length;
  const discloserSigned = group.discloser?.status === "SIGNED";
  const progress = ((signedRecipients + (discloserSigned ? 1 : 0)) / (totalRecipients + 1)) * 100;

  return (
    <div className={`overflow-hidden bg-[var(--bg-card)] ${!isLast ? "border-b border-[var(--border-subtle)]" : ""}`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="group block w-full px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="truncate text-[13px] font-medium">{group.title}</h4>
              <span className="shrink-0 rounded-xs border border-[var(--border)] bg-[var(--bg-inset)] px-1.5 py-px text-[9px] font-medium text-muted">
                {totalRecipients} recipients
              </span>
            </div>
            <p className="mt-0.5 text-[10px] text-muted">
              {new Date(group.createdAt).toLocaleDateString()} &bull; Created by you
              {group.expiresAt && group.status === "PENDING" && (
                <>
                  {" "}
                  &bull; <ExpirationBadge expiresAt={new Date(group.expiresAt)} />
                </>
              )}
            </p>
          </div>
          <StatusBadge status={group.status} />
        </div>

        <ProgressBar
          progress={progress}
          label={`${signedRecipients + (discloserSigned ? 1 : 0)}/${totalRecipients + 1}`}
        />

        <div className="mt-2 flex flex-wrap gap-1">
          {group.discloser && (
            <span
              className={`inline-flex items-center gap-1 rounded-xs px-1.5 py-px text-[9px] transition-colors ${
                discloserSigned
                  ? "border border-[var(--success-10)] bg-[var(--success-subtle)] text-[var(--success)]"
                  : "border border-[var(--border)] bg-[var(--bg-inset)] text-muted"
              }`}
            >
              {group.discloser.label}
              {discloserSigned && <CheckCircle className="h-2 w-2" />}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-xs border border-[var(--border)] bg-[var(--bg-inset)] px-1.5 py-px text-[9px] text-muted">
            {signedRecipients}/{totalRecipients} recipients signed
          </span>
          <span className="ml-auto text-[9px] text-muted">{expanded ? "\u25B2 Collapse" : "\u25BC Expand"}</span>
        </div>
      </button>

      {expanded && <GroupExpandedRows group={group} copiedId={copiedId} copyUrl={copyUrl} />}

      {group.viewerIsCreator && (
        <div className="border-t border-[var(--border-subtle)] px-4 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setShowDownloadsManager((v) => !v)}
              className="inline-flex items-center gap-1 rounded-xs bg-[var(--bg-inset)] px-2 py-1 text-[9px] font-medium text-secondary transition-colors hover:bg-[var(--bg-hover)]"
            >
              <PackageOpen className="h-2.5 w-2.5" />
              {showDownloadsManager
                ? "Hide documents"
                : sharedFileCount > 0
                  ? `Manage documents (${sharedFileCount})`
                  : "Add documents"}
            </button>

            {group.status === "PENDING" && (
              <button
                onClick={() => {
                  if (confirm("Void ALL contracts in this group? All pending signatures will be cancelled.")) {
                    for (const d of group.docs) {
                      if (d.status === "PENDING") voidMut.mutate({ documentId: d.id });
                    }
                  }
                }}
                disabled={voidMut.isPending}
                className="ml-auto inline-flex items-center gap-1 rounded-xs bg-[var(--danger-subtle)] px-2 py-1 text-[9px] font-medium text-[var(--danger)] transition-colors hover:bg-red-500/15 disabled:opacity-40"
              >
                <Ban className="h-2.5 w-2.5" />
                Void Group
              </button>
            )}
          </div>
        </div>
      )}

      {group.viewerIsCreator && showDownloadsManager && (
        <div className="border-t border-[var(--border-subtle)] px-4 py-3">
          <PostSignDownloadManager
            documentId={group.primaryDoc.id}
            documentTitle={group.title}
            reveal={group.primaryDoc.postSignReveal}
          />
        </div>
      )}
    </div>
  );
}
