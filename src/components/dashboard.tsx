"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useSession } from "~/lib/auth-client";
import { trpc } from "~/lib/trpc";
import { useWallet } from "./wallet-provider";
import { PostSignDownloadManager } from "./post-sign-download-manager";
import { CHAIN_META, addressPreview, type WalletChain } from "~/lib/chains";
import { FadeIn, GlassCard } from "./ui/motion";
import {
  Lock,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  Download,
  ExternalLink,
  Eye,
  Send,
  Ban,
  PackageOpen,
  Search,
  ChevronLeft,
  ChevronRight,
  FileText,
  Wallet,
  PenLine,
  Inbox,
} from "lucide-react";

const ITEMS_PER_PAGE = 10;

/* ── Skeleton Loading ─────────────────────────────────────────────────────── */

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`shimmer-skeleton rounded-xs ${className}`} />;
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 border-b border-[var(--border-subtle)] px-4 py-3">
      <SkeletonBlock className="h-3.5 w-40" />
      <SkeletonBlock className="ml-auto h-3.5 w-16" />
      <SkeletonBlock className="h-3.5 w-20" />
      <SkeletonBlock className="h-3.5 w-12" />
    </div>
  );
}

/* ── Status Badge ─────────────────────────────────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { cls: string; icon: React.ReactNode; dot: string }> = {
    COMPLETED: {
      cls: "text-[var(--success)]",
      icon: <CheckCircle className="h-3 w-3" />,
      dot: "status-dot-success",
    },
    PENDING: {
      cls: "text-[var(--warning)]",
      icon: <Clock className="h-3 w-3" />,
      dot: "status-dot-warning",
    },
    EXPIRED: {
      cls: "text-[var(--danger)]",
      icon: <AlertCircle className="h-3 w-3" />,
      dot: "status-dot-danger",
    },
    VOIDED: {
      cls: "text-[var(--danger)]",
      icon: <XCircle className="h-3 w-3" />,
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

/* ── Pagination Controls ──────────────────────────────────────────────────── */

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}) {
  if (totalPages <= 1) return null;

  const pages: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, start + 4);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="mt-4 flex items-center justify-center gap-1">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[10px] font-medium text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30"
      >
        <ChevronLeft className="h-3 w-3" />
        Prev
      </button>

      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={`rounded-sm px-2.5 py-1 text-[10px] font-medium transition-all ${
            p === page
              ? "border border-[var(--border-accent)] bg-[var(--accent-subtle)] text-accent"
              : "text-muted hover:bg-[var(--bg-hover)] hover:text-secondary"
          }`}
        >
          {p}
        </button>
      ))}

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
        className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-[10px] font-medium text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-secondary disabled:cursor-not-allowed disabled:opacity-30"
      >
        Next
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ── Onboarding Empty State ───────────────────────────────────────────────── */

function OnboardingChecklist() {
  const steps = [
    {
      label: "Connect Wallet",
      description: "Authenticate with your crypto wallet",
      icon: <Wallet className="h-3.5 w-3.5" />,
      done: true,
    },
    {
      label: "Create Your First Document",
      description: "Upload or draft a document for signing",
      icon: <FileText className="h-3.5 w-3.5" />,
      done: false,
      cta: true,
    },
    {
      label: "Send for Signature",
      description: "Invite signers and get it signed on-chain",
      icon: <PenLine className="h-3.5 w-3.5" />,
      done: false,
      locked: true,
    },
  ];

  return (
    <FadeIn>
      <GlassCard className="p-6" hover={false}>
        <h3 className="mb-5 text-xs font-semibold uppercase tracking-[0.1em] text-muted">Get started</h3>
        <div className="mx-auto max-w-sm">
          {steps.map((step, i) => (
            <div key={step.label} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border ${
                    step.done
                      ? "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]"
                      : step.locked
                        ? "border-[var(--border)] bg-[var(--bg-inset)] text-faint"
                        : "border-[var(--border-accent)] bg-[var(--accent-subtle)] text-accent"
                  }`}
                >
                  {step.done ? <CheckCircle className="h-3.5 w-3.5" /> : step.icon}
                </div>
                {i < steps.length - 1 && (
                  <div className={`my-0.5 h-8 w-px ${step.done ? "bg-[var(--success)]/30" : "bg-[var(--border)]"}`} />
                )}
              </div>

              <div className="pb-3 pt-0.5">
                <p
                  className={`text-[13px] font-medium ${
                    step.done
                      ? "decoration-[var(--success)]/30 text-[var(--success)] line-through"
                      : step.locked
                        ? "text-faint"
                        : "text-primary"
                  }`}
                >
                  {step.label}
                </p>
                <p className="mt-0.5 text-[11px] text-muted">{step.description}</p>
                {step.cta && (
                  <Link
                    href="/"
                    className="mt-2 inline-flex items-center gap-1 rounded-sm bg-[var(--accent)] px-2.5 py-1 text-[10px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
                  >
                    Create Document
                  </Link>
                )}
                {step.locked && (
                  <span className="mt-1 inline-flex items-center gap-1 text-[10px] text-faint">
                    <Lock className="h-2.5 w-2.5" />
                    Complete previous step
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </FadeIn>
  );
}

/* ── Filter Tab ───────────────────────────────────────────────────────────── */

function FilterTab({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
        active ? "text-primary" : "text-muted hover:text-secondary"
      }`}
    >
      {icon}
      {label}
      <span className="text-faint">{count}</span>
      {active && (
        <motion.span
          layoutId="filter-indicator"
          className="absolute inset-x-0 -bottom-px h-px bg-[var(--accent)]"
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}
    </button>
  );
}

/* ── Dashboard (main export) ──────────────────────────────────────────────── */

export function Dashboard() {
  const { connected, authenticated, authenticating } = useWallet();
  const { data: session } = useSession();
  const [mounted] = useState(() => typeof window !== "undefined");
  const signedIn = Boolean(authenticated || session?.user);

  const identityQuery = trpc.auth.identityStatus.useQuery(undefined, {
    enabled: signedIn,
    retry: false,
  });

  const docsQuery = trpc.document.listByAddress.useQuery(undefined, {
    enabled: signedIn,
  });

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);

  // Derive filtered docs with useMemo instead of useEffect for page reset
  const { filtered, counts } = useMemo(() => {
    const docs = docsQuery.data ?? [];
    const c = {
      ALL: docs.length,
      PENDING: docs.filter((d) => d.status === "PENDING").length,
      COMPLETED: docs.filter((d) => d.status === "COMPLETED").length,
    };

    let result = docs;
    if (statusFilter !== "ALL") {
      result = result.filter((d) => d.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.contentHash.toLowerCase().includes(q) ||
          d.signers.some((s) => s.label.toLowerCase().includes(q)),
      );
    }
    return { filtered: result, counts: c };
  }, [docsQuery.data, statusFilter, search]);

  // Reset page when filters change
  const effectivePage = (() => {
    const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
    return Math.min(page, totalPages);
  })();

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginatedDocs = filtered.slice((effectivePage - 1) * ITEMS_PER_PAGE, effectivePage * ITEMS_PER_PAGE);

  if (!signedIn) {
    const showAuthenticating = mounted && authenticating;
    return (
      <FadeIn>
        <GlassCard className="p-8 text-center" hover={false}>
          <div className="mb-3 flex justify-center text-faint">
            <Lock className="h-8 w-8" />
          </div>
          <p className="text-sm text-muted">
            {showAuthenticating
              ? "Verifying wallet ownership..."
              : connected
                ? "Finish wallet verification or sign in with email to view your documents"
                : "Sign in with email or connect a wallet to view your documents"}
          </p>
          {showAuthenticating && (
            <motion.div
              className="border-[var(--accent)]/30 mt-3 inline-block h-4 w-4 rounded-full border border-t-accent"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
            />
          )}
        </GlassCard>
      </FadeIn>
    );
  }

  if (docsQuery.isLoading || identityQuery.isLoading) {
    return (
      <FadeIn>
        <div className="glass-card-flat overflow-hidden rounded-lg">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </FadeIn>
    );
  }

  const docs = docsQuery.data ?? [];

  if (docs.length === 0) {
    return <OnboardingChecklist />;
  }

  return (
    <div className="space-y-4">
      {/* Search + filters */}
      <FadeIn>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search by title, signer, or hash..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-sm border border-[var(--border)] bg-[var(--bg-inset)] py-1.5 pl-8 pr-3 text-[12px] outline-none transition-all placeholder:text-muted focus:border-[var(--accent)] focus:shadow-[0_0_0_2px_var(--accent-subtle)]"
            />
          </div>
          <div className="flex items-center border-b border-[var(--border)]">
            <FilterTab
              active={statusFilter === "ALL"}
              onClick={() => {
                setStatusFilter("ALL");
                setPage(1);
              }}
              icon={<Inbox className="h-3 w-3" />}
              label="All"
              count={counts.ALL}
            />
            <FilterTab
              active={statusFilter === "PENDING"}
              onClick={() => {
                setStatusFilter("PENDING");
                setPage(1);
              }}
              icon={<Clock className="h-3 w-3" />}
              label="Pending"
              count={counts.PENDING}
            />
            <FilterTab
              active={statusFilter === "COMPLETED"}
              onClick={() => {
                setStatusFilter("COMPLETED");
                setPage(1);
              }}
              icon={<CheckCircle className="h-3 w-3" />}
              label="Completed"
              count={counts.COMPLETED}
            />
          </div>
        </div>
      </FadeIn>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6 text-center">
          <p className="text-[12px] text-muted">No documents match your search.</p>
        </div>
      )}

      {paginatedDocs.length > 0 && (
        <FadeIn>
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            {paginatedDocs.map((doc, i) => (
              <motion.div
                key={doc.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.3,
                  ease: [0.23, 1, 0.32, 1],
                  delay: i < 5 ? i * 0.04 : 0,
                }}
              >
                <DocCard doc={doc} isLast={i === paginatedDocs.length - 1} />
              </motion.div>
            ))}
          </div>
        </FadeIn>
      )}

      <Pagination page={effectivePage} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

/* ── Types ────────────────────────────────────────────────────────────────── */

type DocWithSigners = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  createdBy: string;
  viewerIsCreator: boolean;
  contentHash: string;
  expiresAt: Date | null;
  postSignReveal: {
    enabled: boolean;
    summary?: string;
    sections?: Array<{
      title: string;
      content: string;
      icon?: string;
    }>;
    downloads?: Array<{
      label: string;
      filename: string;
      description?: string;
      icon?: string;
      uploadedByAddress?: string;
      uploadedByLabel?: string;
      uploadedAt?: string;
    }>;
    testbedAccess?: {
      enabled: boolean;
      description?: string;
      proxyEndpoint?: string;
    };
  } | null;
  signers: Array<{
    id: string;
    label: string;
    address: string | null;
    chain: string | null;
    status: string;
    signedAt: Date | null;
    isYou: boolean;
  }>;
};

function ExpirationBadge({ expiresAt }: { expiresAt: Date }) {
  const now = new Date();
  const diff = expiresAt.getTime() - now.getTime();
  if (diff <= 0) return <span className="text-[10px] font-medium text-[var(--danger)]">Expired</span>;
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  const color = days <= 3 ? "text-[var(--danger)]" : days <= 7 ? "text-[var(--warning)]" : "text-muted";
  return <span className={`text-[10px] ${color}`}>{days}d left</span>;
}

/* ── Document Card ────────────────────────────────────────────────────────── */

function DocCard({ doc, isLast }: { doc: DocWithSigners; isLast: boolean }) {
  const utils = trpc.useUtils();
  const [showDownloadsManager, setShowDownloadsManager] = useState(false);
  const voidMut = trpc.document.voidDocument.useMutation({
    onSuccess: () => utils.document.listByAddress.invalidate(),
  });
  const resendMut = trpc.document.resendInvite.useMutation();
  const signedCount = doc.signers.filter((s) => s.status === "SIGNED").length;
  const isCreator = doc.viewerIsCreator;
  const mySigner = doc.signers.find((s) => s.isYou);
  const needsMySignature = mySigner?.status === "PENDING";
  const progress = (signedCount / doc.signers.length) * 100;
  const sharedFileCount = doc.postSignReveal?.downloads?.length ?? 0;
  const hasFooter = (doc.status === "PENDING" && isCreator) || doc.status === "COMPLETED" || isCreator;

  return (
    <div className={`overflow-hidden bg-[var(--bg-card)] ${!isLast ? "border-b border-[var(--border-subtle)]" : ""}`}>
      <a href={`/sign/${doc.id}`} className="group block px-4 py-3 transition-colors hover:bg-[var(--bg-hover)]">
        {/* Header row */}
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
              {isCreator ? "Created by you" : `By ${addressPreview(doc.createdBy)}`}
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

        {/* Progress bar */}
        <div className="mt-2 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--border)]">
            <motion.div
              className={`h-full ${signedCount === doc.signers.length ? "bg-[var(--success)]" : "bg-accent"}`}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1], delay: 0.15 }}
            />
          </div>
          <span className="shrink-0 text-[10px] text-muted">
            {signedCount}/{doc.signers.length}
          </span>
        </div>

        {/* Signer chips */}
        <div className="mt-2 flex flex-wrap gap-1">
          {doc.signers.map((s) => {
            const meta = CHAIN_META[s.chain as WalletChain];
            return (
              <span
                key={s.id}
                className={`inline-flex items-center gap-1 rounded-xs px-1.5 py-px text-[9px] transition-colors ${
                  s.status === "SIGNED"
                    ? "border-[var(--success)]/10 border bg-[var(--success-subtle)] text-[var(--success)]"
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
      </a>

      {hasFooter && (
        <div className="border-t border-[var(--border-subtle)] px-4 py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {doc.status === "PENDING" &&
              isCreator &&
              doc.signers
                .filter((s) => s.status === "PENDING")
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() => {
                      resendMut.mutate({ documentId: doc.id, signerId: s.id });
                    }}
                    disabled={resendMut.isPending}
                    className="bg-blue-500/8 inline-flex items-center gap-1 rounded-xs px-2 py-1 text-[9px] font-medium text-blue-400 transition-colors hover:bg-blue-500/15 disabled:opacity-40"
                  >
                    <Send className="h-2.5 w-2.5" />
                    Resend {s.label}
                  </button>
                ))}

            {doc.status === "COMPLETED" && (
              <>
                <ActionLink
                  href={`/api/pdf/${doc.id}`}
                  icon={<Download className="h-2.5 w-2.5" />}
                  label="PDF"
                  accent
                />
                <ActionLink
                  href={`/view/${doc.id}`}
                  icon={<ExternalLink className="h-2.5 w-2.5" />}
                  label="View"
                  accent
                />
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
      )}

      {isCreator && showDownloadsManager && (
        <div className="border-t border-[var(--border-subtle)] px-4 py-3">
          <PostSignDownloadManager documentId={doc.id} documentTitle={doc.title} reveal={doc.postSignReveal} />
        </div>
      )}
    </div>
  );
}

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
