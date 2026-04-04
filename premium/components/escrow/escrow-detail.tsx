"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  XCircle,
  Lock,
  AlertTriangle,
  Eye,
  Gavel,
  Wallet,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Ban,
  Send,
  Vote,
} from "lucide-react";
import { useWallet } from "~/components/wallet-provider";
import { GlassCard, W3SButton, FadeIn, StaggerContainer, StaggerItem } from "~/components/ui/motion";
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
type EscrowAsset = {
  displayAmount: string;
  chain: string;
  kind: string;
};
type EscrowOutcome = {
  index: number;
  description: string;
  payouts: Record<string, unknown>;
};
type EscrowOracleConfig = {
  provider: string;
  marketQuestion?: string;
  marketId?: string;
  marketUrl?: string;
};
type EscrowContract = {
  id: string;
  title: string;
  description: string;
  mode: EscrowMode;
  status: EscrowStatus;
  assets: EscrowAsset[];
  participants: EscrowParticipant[];
  outcomes: EscrowOutcome[];
  resolutionMethod: string;
  acknowledgedWarnings: string[];
  termsHash: string;
  termSignatures: string[];
  createdAt: string;
  updatedAt: string;
  resolvedOutcomeIndex?: number;
  oracleConfig?: EscrowOracleConfig;
  onChainAddress?: string;
  onChainNetwork?: string;
  deployTxHash?: string;
};
type EscrowParticipant = {
  id: string;
  label: string;
  role: string;
  address?: string;
  accepted?: boolean;
  deposited?: boolean;
};

/* ------------------------------------------------------------------ */
/*  Status & mode config (shared with dashboard)                       */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<EscrowStatus, { label: string; color: string; icon: typeof Clock; bgColor: string }> = {
  DRAFT: { label: "Draft", color: "text-muted", icon: Clock, bgColor: "bg-gray-500/10" },
  AWAITING_SIGNATURES: {
    label: "Awaiting Signatures",
    color: "text-yellow-400",
    icon: Clock,
    bgColor: "bg-yellow-500/10",
  },
  AWAITING_DEPOSITS: {
    label: "Awaiting Deposits",
    color: "text-yellow-400",
    icon: Wallet,
    bgColor: "bg-yellow-500/10",
  },
  ACTIVE: { label: "Active", color: "text-green-400", icon: CheckCircle2, bgColor: "bg-green-500/10" },
  MONITORING: { label: "Monitoring", color: "text-blue-400", icon: Eye, bgColor: "bg-blue-500/10" },
  DISPUTED: { label: "Disputed", color: "text-red-400", icon: AlertTriangle, bgColor: "bg-red-500/10" },
  RESOLVING: { label: "Resolving", color: "text-orange-400", icon: Gavel, bgColor: "bg-orange-500/10" },
  RESOLVED: { label: "Resolved", color: "text-green-400", icon: CheckCircle2, bgColor: "bg-green-500/10" },
  SETTLED: { label: "Settled", color: "text-green-500", icon: CheckCircle2, bgColor: "bg-green-500/10" },
  CANCELLED: { label: "Cancelled", color: "text-muted", icon: XCircle, bgColor: "bg-gray-500/10" },
  VOIDED: { label: "Voided", color: "text-red-500", icon: XCircle, bgColor: "bg-red-500/10" },
  EXPIRED: { label: "Expired", color: "text-muted", icon: Clock, bgColor: "bg-gray-500/10" },
  LOCKED_FOREVER: { label: "Locked Forever", color: "text-red-600", icon: Lock, bgColor: "bg-red-600/10" },
};

const MODE_LABELS: Record<EscrowMode, string> = {
  FULL_ESCROW: "Full Escrow",
  MULTI_ESCROW: "Multi-Sig Escrow",
  COMMUNITY_ESCROW: "Community Vote",
  SELF_CUSTODY: "Self Custody",
  LOCKED_CANCELLABLE: "Locked (Cancellable)",
  LOCKED_PERMANENT: "Locked (Permanent)",
  HONOR_SYSTEM: "Honor System",
  CASUAL: "Casual Bet",
  PLATFORM_ESCROW: "Oracle-Linked",
  DESIGNATED_ORACLE: "Pick a Judge",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text);
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function StatusHeader({ status }: { status: EscrowStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ${config.bgColor} ${config.color}`}
    >
      <Icon className="h-4 w-4" />
      {config.label}
    </div>
  );
}

function ParticipantCard({ participant }: { participant: EscrowParticipant }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{participant.label}</span>
          <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-muted">
            {participant.role}
          </span>
        </div>
        {participant.address && (
          <button
            className="mt-0.5 flex items-center gap-1 text-xs text-muted hover:text-[var(--accent)]"
            onClick={() => copyToClipboard(participant.address!)}
          >
            {shortenAddress(participant.address)} <Copy className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {participant.accepted ? (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Signed
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-yellow-400">
            <Clock className="h-3.5 w-3.5" /> Pending
          </span>
        )}
        {participant.deposited && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <Wallet className="h-3.5 w-3.5" /> Deposited
          </span>
        )}
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <GlassCard hover={false}>
      <button className="flex w-full items-center justify-between" onClick={() => setOpen(!open)}>
        <h3 className="text-sm font-semibold">{title}</h3>
        {open ? <ChevronUp className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}
      </button>
      {open && <div className="mt-3 space-y-2">{children}</div>}
    </GlassCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Placeholder escrow (until tRPC is wired)                           */
/* ------------------------------------------------------------------ */

function useMockEscrow(id: string): { escrow: EscrowContract | null; loading: boolean } {
  // Placeholder — replace with tRPC query
  return {
    loading: false,
    escrow: {
      id,
      title: "Sample Escrow",
      description: "This is a placeholder escrow. Connect the tRPC router to load real data.",
      mode: "FULL_ESCROW" as EscrowMode,
      status: "DRAFT" as EscrowStatus,
      assets: [],
      participants: [
        { id: "1", label: "Party A", role: "PARTY", accepted: false, deposited: false },
        { id: "2", label: "Party B", role: "PARTY", accepted: false, deposited: false },
      ],
      outcomes: [
        { index: 0, description: "Party A wins", payouts: {} },
        { index: 1, description: "Party B wins", payouts: {} },
      ],
      resolutionMethod: "ESCROW_DECISION" as const,
      acknowledgedWarnings: [],
      termsHash: "placeholder",
      termSignatures: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function EscrowDetail({ escrowId }: { escrowId: string }) {
  const router = useRouter();
  const { address } = useWallet();
  const { escrow, loading } = useMockEscrow(escrowId);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass-card animate-pulse rounded-xl p-6">
            <div className="h-5 w-1/3 rounded bg-[var(--bg-hover)]" />
            <div className="mt-3 h-4 w-2/3 rounded bg-[var(--bg-hover)]" />
          </div>
        ))}
      </div>
    );
  }

  if (!escrow) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <XCircle className="mb-4 h-8 w-8 text-muted" />
        <h3 className="text-lg font-semibold">Escrow not found</h3>
        <W3SButton variant="secondary" className="mt-4" onClick={() => router.push("/escrow")}>
          <ArrowLeft className="h-4 w-4" /> Back to Escrows
        </W3SButton>
      </div>
    );
  }

  const isParty = escrow.participants.some((p) => p.address === address && p.role === "PARTY");
  const isAgent = escrow.participants.some((p) => p.address === address && p.role === "ESCROW_AGENT");
  const myParticipant = escrow.participants.find((p) => p.address === address);
  const canSign = myParticipant && !myParticipant.accepted && escrow.status === "AWAITING_SIGNATURES";
  const canDeposit = myParticipant?.accepted && !myParticipant.deposited && escrow.status === "AWAITING_DEPOSITS";
  const canResolve = isAgent && (escrow.status === "ACTIVE" || escrow.status === "DISPUTED");

  return (
    <div className="space-y-6">
      {/* Back button */}
      <FadeIn>
        <button
          className="flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-primary"
          onClick={() => router.push("/escrow")}
        >
          <ArrowLeft className="h-4 w-4" /> Back to Escrows
        </button>
      </FadeIn>

      {/* Header */}
      <FadeIn delay={0.05}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-bold">{escrow.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusHeader status={escrow.status} />
              <span className="text-xs text-muted">{MODE_LABELS[escrow.mode]}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {canSign && (
              <W3SButton variant="primary" size="sm">
                <CheckCircle2 className="h-4 w-4" /> Sign Terms
              </W3SButton>
            )}
            {canDeposit && (
              <W3SButton variant="primary" size="sm">
                <Send className="h-4 w-4" /> Deposit
              </W3SButton>
            )}
            {canResolve && (
              <W3SButton variant="accent-outline" size="sm">
                <Vote className="h-4 w-4" /> Resolve
              </W3SButton>
            )}
          </div>
        </div>
      </FadeIn>

      {/* Terms */}
      <FadeIn delay={0.1}>
        <CollapsibleSection title="Terms">
          <p className="whitespace-pre-wrap text-sm text-secondary">{escrow.description}</p>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted">
            <span>Terms hash: {shortenAddress(escrow.termsHash)}</span>
            <button onClick={() => copyToClipboard(escrow.termsHash)}>
              <Copy className="h-3 w-3" />
            </button>
          </div>
        </CollapsibleSection>
      </FadeIn>

      {/* Participants */}
      <FadeIn delay={0.15}>
        <CollapsibleSection title={`Participants (${escrow.participants.length})`}>
          <StaggerContainer className="space-y-2">
            {escrow.participants.map((p) => (
              <StaggerItem key={p.id}>
                <ParticipantCard participant={p} />
              </StaggerItem>
            ))}
          </StaggerContainer>
        </CollapsibleSection>
      </FadeIn>

      {/* Outcomes */}
      <FadeIn delay={0.2}>
        <CollapsibleSection title={`Outcomes (${escrow.outcomes.length})`}>
          <div className="space-y-2">
            {escrow.outcomes.map((outcome) => (
              <div
                key={outcome.index}
                className={`flex items-center justify-between rounded-lg border p-3 ${
                  escrow.resolvedOutcomeIndex === outcome.index
                    ? "border-green-500/50 bg-green-500/5"
                    : "border-[var(--border)] bg-[var(--bg-surface)]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-hover)] text-xs font-semibold">
                    {outcome.index + 1}
                  </span>
                  <span className="text-sm">{outcome.description}</span>
                </div>
                {escrow.resolvedOutcomeIndex === outcome.index && (
                  <span className="flex items-center gap-1 text-xs font-semibold text-green-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Winner
                  </span>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      </FadeIn>

      {/* Asset info */}
      {escrow.assets.length > 0 && (
        <FadeIn delay={0.25}>
          <CollapsibleSection title="Assets" defaultOpen={false}>
            <div className="space-y-2">
              {escrow.assets.map((asset, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-sm"
                >
                  <span>{asset.displayAmount}</span>
                  <span className="text-xs text-muted">
                    {asset.chain} / {asset.kind}
                  </span>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        </FadeIn>
      )}

      {/* Oracle info (for PLATFORM_ESCROW) */}
      {escrow.oracleConfig && (
        <FadeIn delay={0.3}>
          <CollapsibleSection title="Oracle">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Provider</dt>
                <dd className="font-medium">{escrow.oracleConfig.provider}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Market</dt>
                <dd className="font-medium">{escrow.oracleConfig.marketQuestion ?? escrow.oracleConfig.marketId}</dd>
              </div>
              {escrow.oracleConfig.marketUrl && (
                <a
                  href={escrow.oracleConfig.marketUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                >
                  View market <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </dl>
          </CollapsibleSection>
        </FadeIn>
      )}

      {/* On-chain info */}
      {escrow.onChainAddress && (
        <FadeIn delay={0.35}>
          <CollapsibleSection title="On-Chain" defaultOpen={false}>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Contract</dt>
                <dd className="flex items-center gap-1 font-mono text-xs">
                  {shortenAddress(escrow.onChainAddress)}
                  <button onClick={() => copyToClipboard(escrow.onChainAddress!)}>
                    <Copy className="h-3 w-3 text-muted" />
                  </button>
                </dd>
              </div>
              {escrow.onChainNetwork && (
                <div className="flex justify-between">
                  <dt className="text-muted">Network</dt>
                  <dd className="font-medium">{escrow.onChainNetwork}</dd>
                </div>
              )}
              {escrow.deployTxHash && (
                <div className="flex justify-between">
                  <dt className="text-muted">Deploy TX</dt>
                  <dd className="font-mono text-xs">{shortenAddress(escrow.deployTxHash)}</dd>
                </div>
              )}
            </dl>
          </CollapsibleSection>
        </FadeIn>
      )}

      {/* Danger zone */}
      {(isParty || isAgent) && escrow.status !== "SETTLED" && escrow.status !== "CANCELLED" && (
        <FadeIn delay={0.4}>
          <CollapsibleSection title="Actions" defaultOpen={false}>
            <div className="flex flex-wrap gap-2">
              {escrow.status === "ACTIVE" && isParty && (
                <W3SButton variant="danger" size="sm">
                  <AlertTriangle className="h-4 w-4" /> Raise Dispute
                </W3SButton>
              )}
              {escrow.mode !== "LOCKED_PERMANENT" && (
                <W3SButton variant="ghost" size="sm">
                  <Ban className="h-4 w-4" /> Request Cancel
                </W3SButton>
              )}
            </div>
          </CollapsibleSection>
        </FadeIn>
      )}

      {/* Metadata */}
      <FadeIn delay={0.45}>
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Created {new Date(escrow.createdAt).toLocaleString()}</span>
          <span>ID: {shortenAddress(escrow.id)}</span>
        </div>
      </FadeIn>
    </div>
  );
}
