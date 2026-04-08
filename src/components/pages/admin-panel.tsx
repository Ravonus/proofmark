"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronRight,
  Clock,
  Crown,
  FileCheck,
  FilePlus,
  FileText,
  FileX,
  Lock,
  Palette,
  Plug,
  RefreshCw,
  Server,
  Shield,
  Sparkles,
  ToggleRight,
  UserCheck,
  Users,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { useConnectedIdentity } from "~/components/hooks/use-connected-identity";
import { FadeIn, GlassCard } from "~/components/ui/motion";
import { CHAIN_META, type WalletChain } from "~/lib/crypto/chains";
import { trpc } from "~/lib/platform/trpc";
import { BrandingSection, TemplatesSection, WebhooksSection } from "./admin-branding-webhooks";
import { IntegrationsSection } from "./admin-integrations";
import { StatCard, StatusPill, TierCard } from "./admin-shared-ui";
import { PremiumSection, SecuritySection, SystemSection } from "./admin-system-sections";
import { UsersSection } from "./admin-users";

// ── Types ──

type OperatorStatus = {
  deploymentMode: string;
  pdfUploadMaxMb: number;
  premiumRuntimeAvailable: boolean;
  ownerWallet: { address: string; chain: WalletChain } | null;
  ownerConfigured: boolean;
  isOwner: boolean;
  canManageSelf: boolean;
  canManageOthers: boolean;
  enabledPremiumCount: number;
  currentWallet?: { address: string; chain: WalletChain } | null;
  linkedWallets?: Array<{ address: string; chain: WalletChain }>;
  featureStates: Array<{
    id: string;
    label: string;
    summary: string;
    oss: boolean;
    effectiveEnabled: boolean;
  }>;
};

type AdminTab =
  | "overview"
  | "users"
  | "features"
  | "branding"
  | "integrations"
  | "webhooks"
  | "templates"
  | "security"
  | "system"
  | "premium";

const ADMIN_TABS: {
  id: AdminTab;
  label: string;
  icon: typeof Users;
  premiumOnly?: boolean;
}[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "users", label: "Users", icon: Users },
  { id: "features", label: "Features", icon: ToggleRight },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "security", label: "Security", icon: Lock },
  { id: "system", label: "System", icon: Server },
  { id: "premium", label: "Premium", icon: Sparkles, premiumOnly: true },
];

// ── Gate Hook ──

function useAdminGate() {
  const identity = useConnectedIdentity();
  const statusQuery = trpc.account.operatorStatus.useQuery(undefined, {
    enabled: identity.isSignedIn,
  });
  const isDev =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const walletLinkMessage = statusQuery.error?.message ?? "";
  const needsWalletLink = walletLinkMessage.toLowerCase().includes("link a wallet");

  if (!identity.isSignedIn) {
    const msg = identity.isLoading ? "Checking account access..." : "Sign in with email or wallet to access admin.";
    return { ready: false as const, message: msg };
  }
  if (statusQuery.isLoading) {
    return { ready: false as const, message: "__loading__" };
  }
  if (needsWalletLink) {
    return { ready: false as const, message: "__walletLink__" };
  }
  if (statusQuery.error) {
    return {
      ready: false as const,
      message: statusQuery.error.message,
      isError: true,
    };
  }
  if (!isDev && statusQuery.data && !statusQuery.data.isOwner && !statusQuery.data.canManageOthers) {
    return { ready: false as const, message: "__denied__" };
  }
  return {
    ready: true as const,
    statusQuery,
    identity,
    isDev,
  };
}

// ── Main Component ──

export function AdminPanel() {
  const gate = useAdminGate();
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  if (!gate.ready) {
    return <AdminGateMessage gate={gate} />;
  }

  const { statusQuery, identity, isDev } = gate;
  const premiumAvailable = statusQuery.data?.premiumRuntimeAvailable ?? false;
  const visibleTabs = ADMIN_TABS.filter((tab) => !tab.premiumOnly || premiumAvailable);
  const currentWallet = statusQuery.data?.currentWallet ?? identity.currentWallet;

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="w-full shrink-0 lg:w-52">
        <GlassCard className="p-2">
          {isDev && (
            <div className="mb-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-amber-300">
              Dev Mode
            </div>
          )}
          <nav className="space-y-0.5">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors ${
                    active
                      ? "bg-[var(--bg-hover)] text-primary"
                      : "text-muted hover:bg-[var(--bg-hover)] hover:text-secondary"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{tab.label}</span>
                  {tab.premiumOnly && <Crown className="h-3 w-3 shrink-0 text-amber-400/60" />}
                  {active && <ChevronRight className="h-3.5 w-3.5 text-muted" />}
                </button>
              );
            })}
          </nav>
        </GlassCard>
      </div>

      <div className="min-w-0 flex-1 space-y-6">
        {activeTab === "overview" && <OverviewSection status={statusQuery.data} />}
        {activeTab === "users" && (
          <UsersSection currentAddress={currentWallet?.address} currentChain={currentWallet?.chain} />
        )}
        {activeTab === "features" && <GlobalFeaturesSection />}
        {activeTab === "branding" && <BrandingSection />}
        {activeTab === "integrations" && <IntegrationsSection />}
        {activeTab === "webhooks" && <WebhooksSection />}
        {activeTab === "templates" && <TemplatesSection />}
        {activeTab === "security" && <SecuritySection status={statusQuery.data} />}
        {activeTab === "system" && <SystemSection status={statusQuery.data} />}
        {activeTab === "premium" && <PremiumSection status={statusQuery.data} />}
      </div>
    </div>
  );
}

function AdminGateMessage({ gate }: { gate: { message: string; isError?: boolean } }) {
  if (gate.message === "__loading__") {
    return (
      <FadeIn>
        <GlassCard className="p-8 text-center">
          <div className="border-accent/30 inline-block h-6 w-6 animate-spin rounded-full border-2 border-t-accent" />
          <p className="mt-3 text-sm text-muted">Loading admin panel...</p>
        </GlassCard>
      </FadeIn>
    );
  }
  if (gate.message === "__walletLink__") {
    return (
      <FadeIn>
        <GlassCard className="p-8 text-center">
          <Shield className="mx-auto h-8 w-8 text-amber-300" />
          <p className="mt-3 text-sm text-muted">
            Link the owner wallet to this account before opening admin settings.
          </p>
        </GlassCard>
      </FadeIn>
    );
  }
  if (gate.message === "__denied__") {
    return (
      <FadeIn>
        <GlassCard className="p-8 text-center">
          <Shield className="mx-auto h-8 w-8 text-red-400" />
          <p className="mt-3 text-sm text-red-300">Access denied. Admin requires an owner-linked account.</p>
        </GlassCard>
      </FadeIn>
    );
  }
  return (
    <FadeIn>
      <GlassCard className="p-8 text-center">
        <p className={gate.isError ? "text-sm text-red-300" : "text-muted"}>{gate.message}</p>
      </GlassCard>
    </FadeIn>
  );
}

// ── Overview Section ──

function OverviewSection({ status }: { status?: OperatorStatus | null }) {
  const knownWalletsQuery = trpc.account.knownWallets.useQuery(undefined, {
    enabled: !!status?.canManageOthers,
  });
  const statsQuery = trpc.account.adminStats.useQuery();
  const stats = statsQuery.data;
  const docs = stats?.documents;

  return (
    <FadeIn>
      <div className="space-y-6">
        <GlassCard className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Admin Dashboard</h3>
            <button
              type="button"
              onClick={() => statsQuery.refetch()}
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-secondary"
            >
              <RefreshCw className={`h-4 w-4 ${statsQuery.isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Deployment"
              value={status?.deploymentMode === "premium" ? "Premium" : "OSS"}
              icon={<Server className="h-4 w-4" />}
              tone={status?.premiumRuntimeAvailable ? "success" : "muted"}
            />
            <StatCard
              label="Known Wallets"
              value={String(knownWalletsQuery.data?.length ?? 0)}
              icon={<Users className="h-4 w-4" />}
              tone="info"
            />
            <StatCard
              label="Premium Runtime"
              value={status?.premiumRuntimeAvailable ? "Active" : "Inactive"}
              icon={<Crown className="h-4 w-4" />}
              tone={status?.premiumRuntimeAvailable ? "success" : "danger"}
            />
            <StatCard
              label="Owner Wallet"
              value={status?.ownerConfigured ? "Configured" : "Not Set"}
              icon={<Shield className="h-4 w-4" />}
              tone={status?.ownerConfigured ? "success" : "warning"}
            />
          </div>
        </GlassCard>

        {docs && (
          <GlassCard className="space-y-4">
            <h3 className="text-lg font-semibold">Documents</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard label="Total" value={String(docs.total)} icon={<FileText className="h-4 w-4" />} tone="info" />
              <StatCard
                label="Pending"
                value={String(docs.pending)}
                icon={<Clock className="h-4 w-4" />}
                tone="warning"
              />
              <StatCard
                label="Completed"
                value={String(docs.completed)}
                icon={<FileCheck className="h-4 w-4" />}
                tone="success"
              />
              <StatCard
                label="Expired"
                value={String(docs.expired)}
                icon={<FileX className="h-4 w-4" />}
                tone="danger"
              />
              <StatCard
                label="Voided"
                value={String(docs.voided)}
                icon={<AlertTriangle className="h-4 w-4" />}
                tone="muted"
              />
            </div>
          </GlassCard>
        )}

        {stats && (
          <GlassCard className="space-y-4">
            <h3 className="text-lg font-semibold">Platform Activity</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Total Signers"
                value={String(stats.signers.total)}
                icon={<FilePlus className="h-4 w-4" />}
                tone="info"
              />
              <StatCard
                label="Signed"
                value={String(stats.signers.signed)}
                icon={<UserCheck className="h-4 w-4" />}
                tone="success"
              />
              <StatCard
                label="Web2 Users"
                value={String(stats.users)}
                icon={<Users className="h-4 w-4" />}
                tone="info"
              />
              <StatCard
                label="Audit Events"
                value={String(stats.auditEvents)}
                icon={<Activity className="h-4 w-4" />}
                tone="muted"
              />
            </div>
          </GlassCard>
        )}

        {status?.ownerWallet && (
          <GlassCard className="space-y-2">
            <h4 className="text-sm font-semibold">Owner Wallet</h4>
            <p className="text-sm text-secondary">
              {CHAIN_META[status.ownerWallet.chain].icon} {status.ownerWallet.address}
            </p>
            <p className="text-xs text-muted">{CHAIN_META[status.ownerWallet.chain].label}</p>
          </GlassCard>
        )}
      </div>
    </FadeIn>
  );
}

// ── Global Features Section ──

function GlobalFeaturesSection() {
  const featuresQuery = trpc.account.featureCatalog.useQuery();
  const catalog = featuresQuery.data ?? [];
  const grouped = {
    core: catalog.filter((f) => f.oss && !f.byo),
    byo: catalog.filter((f) => f.oss && f.byo),
    premium: catalog.filter((f) => !f.oss),
  };
  const categories = [...new Set(catalog.map((f) => f.category))];

  return (
    <FadeIn>
      <div className="space-y-6">
        <GlassCard className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Feature Catalog</h3>
            <p className="mt-1 text-sm text-muted">
              All {catalog.length} features available in this deployment. Use the Users tab to manage per-wallet access.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <TierCard title="OSS Core" count={grouped.core.length} tone="success" items={grouped.core} />
            <TierCard title="Bring Your Own" count={grouped.byo.length} tone="info" items={grouped.byo} />
            <TierCard title="Premium" count={grouped.premium.length} tone="warning" items={grouped.premium} />
          </div>
        </GlassCard>

        <GlassCard className="space-y-4">
          <h3 className="text-lg font-semibold">By Category</h3>
          <div className="space-y-4">
            {categories.map((cat) => {
              const features = catalog.filter((f) => f.category === cat);
              return (
                <div key={cat}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{cat}</p>
                  <div className="space-y-1">
                    {features.map((f) => (
                      <div
                        key={f.id}
                        className="bg-surface/30 flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium">{f.label}</p>
                          <p className="text-xs text-muted">{f.summary}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusPill tone={f.oss ? "success" : "warning"} label={f.oss ? "OSS" : "Premium"} />
                          {f.byo && <StatusPill tone="info" label="BYO" />}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>
    </FadeIn>
  );
}
