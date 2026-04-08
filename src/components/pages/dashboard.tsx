"use client";

import { motion } from "framer-motion";
import {
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Inbox,
  Lock,
  PenLine,
  Search,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useSession } from "~/lib/auth/auth-client";
import { trpc } from "~/lib/platform/trpc";
import { useWallet } from "../layout/wallet-provider";
import { FadeIn, GlassCard } from "../ui/motion";
import { DocCard, GroupCard } from "./dashboard-cards";
import { type DashboardItem, type DocWithSigners, groupDocuments, isGroup } from "./dashboard-types";

const ITEMS_PER_PAGE = 10;

/* ── Skeleton Loading ────────────────────────────────────────── */

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

/* ── Pagination Controls ─────────────────────────────────────── */

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

/* ── Onboarding Empty State ──────────────────────────────────── */

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
            <OnboardingStep key={step.label} step={step} isLast={i === steps.length - 1} />
          ))}
        </div>
      </GlassCard>
    </FadeIn>
  );
}

function OnboardingStep({
  step,
  isLast,
}: {
  step: {
    label: string;
    description: string;
    icon: React.ReactNode;
    done: boolean;
    cta?: boolean;
    locked?: boolean;
  };
  isLast: boolean;
}) {
  return (
    <div className="flex gap-3">
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
        {!isLast && (
          <div className={`my-0.5 h-8 w-px ${step.done ? "bg-[var(--success-30)]" : "bg-[var(--border)]"}`} />
        )}
      </div>

      <div className="pb-3 pt-0.5">
        <p
          className={`text-[13px] font-medium ${
            step.done
              ? "text-[var(--success)] line-through decoration-[var(--success-30)]"
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
  );
}

/* ── Filter Tab ──────────────────────────────────────────────── */

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

/* ── Hooks ───────────────────────────────────────────────────── */

function useFilteredDocs(docsQuery: { data?: unknown[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [page, setPage] = useState(1);

  const { filtered, counts } = useMemo(() => {
    const docs = (docsQuery.data ?? []) as unknown as DocWithSigners[];
    const items = groupDocuments(docs);
    const c = {
      ALL: items.length,
      PENDING: items.filter((d) => d.status === "PENDING").length,
      COMPLETED: items.filter((d) => d.status === "COMPLETED").length,
    };

    let result = items;
    if (statusFilter !== "ALL") {
      result = result.filter((d) => d.status === statusFilter);
    }
    if (search.trim()) {
      result = filterBySearch(result, search);
    }
    return { filtered: result, counts: c };
  }, [docsQuery.data, statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const effectivePage = Math.min(page, totalPages);
  const paginatedDocs = filtered.slice((effectivePage - 1) * ITEMS_PER_PAGE, effectivePage * ITEMS_PER_PAGE);

  return {
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    page: effectivePage,
    setPage,
    totalPages,
    filtered,
    paginatedDocs,
    counts,
  };
}

function filterBySearch(items: DashboardItem[], search: string): DashboardItem[] {
  const q = search.toLowerCase();
  return items.filter((d) => {
    if (isGroup(d)) {
      return (
        d.title.toLowerCase().includes(q) ||
        d.recipients.some((r) => r.label.toLowerCase().includes(q)) ||
        (d.discloser?.label.toLowerCase().includes(q) ?? false)
      );
    }
    return (
      d.title.toLowerCase().includes(q) ||
      d.contentHash.toLowerCase().includes(q) ||
      d.signers.some((s) => s.label.toLowerCase().includes(q))
    );
  });
}

/* ── Dashboard (main export) ─────────────────────────────────── */

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

  const {
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    page,
    setPage,
    totalPages,
    filtered,
    paginatedDocs,
    counts,
  } = useFilteredDocs(docsQuery);

  if (!signedIn) {
    return <NotSignedInState mounted={mounted} authenticating={authenticating} connected={connected} />;
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
  if (docs.length === 0) return <OnboardingChecklist />;

  return (
    <div className="space-y-4">
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
            {paginatedDocs.map((item, i) => (
              <motion.div
                key={isGroup(item) ? item.groupId : item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.3,
                  ease: [0.23, 1, 0.32, 1],
                  delay: i < 5 ? i * 0.04 : 0,
                }}
              >
                {isGroup(item) ? (
                  <GroupCard group={item} isLast={i === paginatedDocs.length - 1} />
                ) : (
                  <DocCard doc={item} isLast={i === paginatedDocs.length - 1} />
                )}
              </motion.div>
            ))}
          </div>
        </FadeIn>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}

/* ── Not Signed In State ─────────────────────────────────────── */

function NotSignedInState({
  mounted,
  authenticating,
  connected,
}: {
  mounted: boolean;
  authenticating: boolean;
  connected: boolean;
}) {
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
            className="mt-3 inline-block h-4 w-4 rounded-full border border-[var(--accent-30)] border-t-[var(--accent)]"
            animate={{ rotate: 360 }}
            transition={{
              duration: 0.7,
              repeat: Infinity,
              ease: "linear",
            }}
          />
        )}
      </GlassCard>
    </FadeIn>
  );
}
// build 1775607265
