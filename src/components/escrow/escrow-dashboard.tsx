// @ts-nocheck -- premium module with dynamic types from private repo
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Shield,
  Clock,
  CheckCircle2,
  XCircle,
  Lock,
  AlertTriangle,
  Eye,
  ArrowRight,
  Handshake,
  Gavel,
  Users,
  Wallet,
  TrendingUp,
  DollarSign,
} from "lucide-react";
import { useWallet } from "~/components/wallet-provider";
import { GlassCard, W3SButton, StaggerContainer, StaggerItem } from "~/components/ui/motion";
// Inlined from premium/escrow/types to avoid hard import
type EscrowStatus =
  | "DRAFT"
  | "AWAITING_SIGNATURES"
  | "AWAITING_DEPOSITS"
  | "ACTIVE"
  | "MONITORING"
  | "DISPUTED"
  | "RESOLVING"
  | "RESOLVED"
  | "SETTLED"
  | "CANCELLED"
  | "VOIDED"
  | "EXPIRED"
  | "LOCKED_FOREVER";
type EscrowMode =
  | "FULL_ESCROW"
  | "MULTI_ESCROW"
  | "COMMUNITY_ESCROW"
  | "SELF_CUSTODY"
  | "LOCKED_CANCELLABLE"
  | "LOCKED_PERMANENT"
  | "HONOR_SYSTEM"
  | "CASUAL"
  | "PLATFORM_ESCROW"
  | "DESIGNATED_ORACLE";

/* ------------------------------------------------------------------ */
/*  Status & mode display config                                       */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<EscrowStatus, { label: string; color: string; icon: typeof Clock }> = {
  DRAFT: { label: "Draft", color: "text-muted", icon: Clock },
  AWAITING_SIGNATURES: { label: "Awaiting Signatures", color: "text-yellow-400", icon: Clock },
  AWAITING_DEPOSITS: { label: "Awaiting Deposits", color: "text-yellow-400", icon: Wallet },
  ACTIVE: { label: "Active", color: "text-green-400", icon: CheckCircle2 },
  MONITORING: { label: "Monitoring", color: "text-blue-400", icon: Eye },
  DISPUTED: { label: "Disputed", color: "text-red-400", icon: AlertTriangle },
  RESOLVING: { label: "Resolving", color: "text-orange-400", icon: Gavel },
  RESOLVED: { label: "Resolved", color: "text-green-400", icon: CheckCircle2 },
  SETTLED: { label: "Settled", color: "text-green-500", icon: CheckCircle2 },
  CANCELLED: { label: "Cancelled", color: "text-muted", icon: XCircle },
  VOIDED: { label: "Voided", color: "text-red-500", icon: XCircle },
  EXPIRED: { label: "Expired", color: "text-muted", icon: Clock },
  LOCKED_FOREVER: { label: "Locked Forever", color: "text-red-600", icon: Lock },
};

const MODE_CONFIG: Record<EscrowMode, { label: string; icon: typeof Shield; description: string }> = {
  FULL_ESCROW: { label: "Full Escrow", icon: Shield, description: "Trusted escrow agent holds funds" },
  MULTI_ESCROW: { label: "Multi-Sig Escrow", icon: Users, description: "M-of-N agents must agree" },
  COMMUNITY_ESCROW: { label: "Community Vote", icon: Users, description: "Community decides the outcome" },
  SELF_CUSTODY: { label: "Self Custody", icon: Eye, description: "Funds monitored in your wallet" },
  LOCKED_CANCELLABLE: { label: "Locked (Cancellable)", icon: Lock, description: "Locked with mutual cancel option" },
  LOCKED_PERMANENT: { label: "Locked (Permanent)", icon: Lock, description: "Locked forever if unresolved" },
  HONOR_SYSTEM: { label: "Honor System", icon: Handshake, description: "No enforcement — trust-based" },
  CASUAL: { label: "Casual Bet", icon: DollarSign, description: "Fun bet between friends" },
  PLATFORM_ESCROW: { label: "Platform Escrow", icon: TrendingUp, description: "Oracle-linked auto-resolution" },
  DESIGNATED_ORACLE: { label: "Pick a Judge", icon: Gavel, description: "Specific people decide the outcome" },
};

/* ------------------------------------------------------------------ */
/*  Mock data (until tRPC router is wired)                             */
/* ------------------------------------------------------------------ */

type EscrowListItem = {
  id: string;
  title: string;
  mode: EscrowMode;
  status: EscrowStatus;
  parties: string[];
  asset: string;
  amount: string;
  createdAt: string;
};

// Placeholder — will be replaced by tRPC query
function useMockEscrows(): { escrows: EscrowListItem[]; loading: boolean } {
  return { escrows: [], loading: false };
}

/* ------------------------------------------------------------------ */
/*  Filter tabs                                                        */
/* ------------------------------------------------------------------ */

type FilterTab = "all" | "active" | "pending" | "completed";

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "pending", label: "Pending" },
  { key: "completed", label: "Completed" },
];

function filterEscrows(escrows: EscrowListItem[], tab: FilterTab): EscrowListItem[] {
  switch (tab) {
    case "active":
      return escrows.filter((e) => ["ACTIVE", "MONITORING", "DISPUTED", "RESOLVING"].includes(e.status));
    case "pending":
      return escrows.filter((e) => ["DRAFT", "AWAITING_SIGNATURES", "AWAITING_DEPOSITS"].includes(e.status));
    case "completed":
      return escrows.filter((e) =>
        ["RESOLVED", "SETTLED", "CANCELLED", "VOIDED", "EXPIRED", "LOCKED_FOREVER"].includes(e.status),
      );
    default:
      return escrows;
  }
}

/* ------------------------------------------------------------------ */
/*  Components                                                         */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: EscrowStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${config.color}`}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
}

function ModeBadge({ mode }: { mode: EscrowMode }) {
  const config = MODE_CONFIG[mode];
  const Icon = config.icon;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-secondary">
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function EscrowCard({ escrow }: { escrow: EscrowListItem }) {
  const router = useRouter();

  return (
    <GlassCard className="cursor-pointer" onClick={() => router.push(`/escrow/${escrow.id}`)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{escrow.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <ModeBadge mode={escrow.mode} />
            <StatusBadge status={escrow.status} />
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted">
            <span>{escrow.parties.length} parties</span>
            <span>
              {escrow.amount} {escrow.asset}
            </span>
            <span>{new Date(escrow.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        <ArrowRight className="mt-1 h-4 w-4 flex-shrink-0 text-muted" />
      </div>
    </GlassCard>
  );
}

function EmptyState() {
  const router = useRouter();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        <Handshake className="h-8 w-8 text-muted" />
      </div>
      <h3 className="text-lg font-semibold">No escrows yet</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        Create your first escrow, bet, or agreement. Choose from full escrow, self-custody, oracle-linked, or casual
        bets between friends.
      </p>
      <W3SButton variant="primary" className="mt-6" onClick={() => router.push("/escrow/create")}>
        <Plus className="h-4 w-4" /> Create Escrow
      </W3SButton>
    </div>
  );
}

function ModeCard({ mode, onClick }: { mode: EscrowMode; onClick: () => void }) {
  const config = MODE_CONFIG[mode];
  const Icon = config.icon;

  return (
    <motion.button
      className="glass-card flex w-full items-start gap-3 rounded-xl p-4 text-left"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
    >
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-2">
        <Icon className="h-4 w-4 text-[var(--accent)]" />
      </div>
      <div>
        <p className="text-sm font-semibold">{config.label}</p>
        <p className="mt-0.5 text-xs text-muted">{config.description}</p>
      </div>
    </motion.button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function EscrowDashboard() {
  const { authenticated } = useWallet();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [showQuickCreate, setShowQuickCreate] = useState(false);
  const { escrows, loading } = useMockEscrows();

  const filtered = filterEscrows(escrows, activeTab);

  if (!authenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Lock className="mb-4 h-8 w-8 text-muted" />
        <h3 className="text-lg font-semibold">Connect your wallet</h3>
        <p className="mt-1 text-sm text-muted">Sign in with your wallet to view and create escrows</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex items-center justify-between gap-4">
        {/* Filter tabs */}
        <div className="flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.key ? "bg-[var(--accent)] text-white" : "text-muted hover:text-primary"
              }`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <W3SButton variant="primary" size="sm" onClick={() => setShowQuickCreate(!showQuickCreate)}>
          <Plus className="h-4 w-4" /> New Escrow
        </W3SButton>
      </div>

      {/* Quick-create mode picker */}
      <AnimatePresence>
        {showQuickCreate && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="glass-card rounded-2xl border border-[var(--border)] p-5">
              <h3 className="mb-3 text-sm font-semibold">Choose escrow type</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(Object.keys(MODE_CONFIG) as EscrowMode[]).map((mode) => (
                  <ModeCard key={mode} mode={mode} onClick={() => router.push(`/escrow/create?mode=${mode}`)} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Escrow list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card animate-pulse rounded-xl p-4">
              <div className="h-4 w-1/3 rounded bg-[var(--bg-hover)]" />
              <div className="mt-2 h-3 w-1/2 rounded bg-[var(--bg-hover)]" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <StaggerContainer className="space-y-3">
          {filtered.map((escrow) => (
            <StaggerItem key={escrow.id}>
              <EscrowCard escrow={escrow} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}
    </div>
  );
}
