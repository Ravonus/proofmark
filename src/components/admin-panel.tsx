"use client";

import { useState, useEffect } from "react";
import { trpc } from "~/lib/trpc";
import { FadeIn, GlassCard, AnimatedButton } from "~/components/ui/motion";
import { CHAIN_META, addressPreview, type WalletChain } from "~/lib/chains";
import { AiProviderSettings } from "~/components/ai/ai-provider-settings";
import { useConnectedIdentity } from "~/components/use-connected-identity";
import {
  Users,
  ToggleRight,
  BarChart3,
  Server,
  ChevronRight,
  Crown,
  Search,
  Shield,
  Palette,
  Plug,
  Webhook,
  FileText,
  Brain,
  Lock,
  Sparkles,
  Trash2,
  Plus,
  RefreshCw,
  AlertTriangle,
  Check,
  Clock,
  FileCheck,
  FilePlus,
  FileX,
  UserCheck,
  Activity,
  Database,
  CreditCard,
  MessageSquare,
  MapPin,
  Key,
  Gauge,
} from "lucide-react";

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
  | "ai"
  | "security"
  | "system"
  | "premium";

const ADMIN_TABS: { id: AdminTab; label: string; icon: typeof Users; premiumOnly?: boolean }[] = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "users", label: "Users", icon: Users },
  { id: "features", label: "Features", icon: ToggleRight },
  { id: "branding", label: "Branding", icon: Palette },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "webhooks", label: "Webhooks", icon: Webhook },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "ai", label: "AI & Limits", icon: Brain, premiumOnly: true },
  { id: "security", label: "Security", icon: Lock },
  { id: "system", label: "System", icon: Server },
  { id: "premium", label: "Premium", icon: Sparkles, premiumOnly: true },
];

// ── Main Component ──

export function AdminPanel() {
  const identity = useConnectedIdentity();
  const statusQuery = trpc.account.operatorStatus.useQuery(undefined, { enabled: identity.isSignedIn });
  const [isDev, setIsDev] = useState(false);
  useEffect(() => {
    setIsDev(window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
  }, []);

  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  const premiumAvailable = statusQuery.data?.premiumRuntimeAvailable ?? false;
  const visibleTabs = ADMIN_TABS.filter((tab) => !tab.premiumOnly || premiumAvailable);
  const currentWallet = statusQuery.data?.currentWallet ?? identity.currentWallet;
  const walletLinkMessage = statusQuery.error?.message ?? "";
  const needsWalletLink = walletLinkMessage.toLowerCase().includes("link a wallet");

  if (!identity.isSignedIn) {
    return (
      <FadeIn>
        <GlassCard className="p-8 text-center">
          <p className="text-muted">
            {identity.isLoading ? "Checking account access..." : "Sign in with email or wallet to access admin."}
          </p>
        </GlassCard>
      </FadeIn>
    );
  }

  if (statusQuery.isLoading) {
    return (
      <FadeIn>
        <GlassCard className="p-8 text-center">
          <div className="border-accent/30 inline-block h-6 w-6 animate-spin rounded-full border-2 border-t-accent" />
          <p className="mt-3 text-sm text-muted">Loading admin panel...</p>
        </GlassCard>
      </FadeIn>
    );
  }

  if (needsWalletLink) {
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

  if (statusQuery.error) {
    return (
      <FadeIn>
        <GlassCard className="p-8 text-center">
          <p className="text-sm text-red-300">{statusQuery.error.message}</p>
        </GlassCard>
      </FadeIn>
    );
  }

  if (!isDev && statusQuery.data && !statusQuery.data.isOwner && !statusQuery.data.canManageOthers) {
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
    <div className="flex flex-col gap-6 lg:flex-row">
      {/* Sidebar */}
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

      {/* Content */}
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
        {activeTab === "ai" && <AiLimitsSection />}
        {activeTab === "security" && <SecuritySection status={statusQuery.data} />}
        {activeTab === "system" && <SystemSection status={statusQuery.data} />}
        {activeTab === "premium" && <PremiumSection status={statusQuery.data} />}
      </div>
    </div>
  );
}

// ── Overview Section (Enhanced) ──

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
        {/* Top-level stats */}
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

        {/* Document stats */}
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

        {/* Signer / User / Audit stats */}
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

        {/* Owner wallet info */}
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

// ── Users Section ──

function UsersSection({
  currentAddress,
  currentChain,
}: {
  currentAddress?: string | null;
  currentChain?: WalletChain | string | null;
}) {
  const utils = trpc.useUtils();
  const knownWalletsQuery = trpc.account.knownWallets.useQuery();
  const [selectedWallet, setSelectedWallet] = useState<{ address: string; chain: WalletChain } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const featureAccessQuery = trpc.account.featureAccess.useQuery(
    { address: selectedWallet?.address ?? "", chain: selectedWallet?.chain },
    { enabled: !!selectedWallet },
  );

  const setOverrides = trpc.account.setFeatureOverrides.useMutation({
    onSuccess: () => {
      void utils.account.featureAccess.invalidate();
      void utils.account.operatorStatus.invalidate();
    },
  });

  const wallets = knownWalletsQuery.data ?? [];
  const filteredWallets = searchQuery
    ? wallets.filter((w) => w.address.toLowerCase().includes(searchQuery.toLowerCase()))
    : wallets;

  const premiumFeatures = featureAccessQuery.data?.featureStates.filter((f) => !f.oss) ?? [];
  const ossFeatures = featureAccessQuery.data?.featureStates.filter((f) => f.oss) ?? [];

  const toggleFeature = (featureId: string, currentlyEnabled: boolean) => {
    if (!selectedWallet) return;
    setOverrides.mutate({
      address: selectedWallet.address,
      chain: selectedWallet.chain,
      overrides: [{ featureId: featureId as never, enabled: currentlyEnabled ? false : null }],
    });
  };

  const batchOverride = (features: typeof premiumFeatures, enabled: boolean | null) => {
    if (!selectedWallet) return;
    setOverrides.mutate({
      address: selectedWallet.address,
      chain: selectedWallet.chain,
      overrides: features.map((f) => ({ featureId: f.id as never, enabled })),
    });
  };

  return (
    <div className="space-y-6">
      <FadeIn>
        <GlassCard className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">User Management</h3>
              <p className="mt-1 text-sm text-muted">
                Select a wallet to manage feature access and subscription overrides.
              </p>
            </div>
            <span className="bg-surface/40 rounded-full border border-border px-2.5 py-1 text-xs text-muted">
              {wallets.length} users
            </span>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search by wallet address..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-surface/50 w-full rounded-xl py-2 pl-10 pr-3 text-sm outline-none ring-1 ring-border focus:ring-accent"
            />
          </div>

          <div className="max-h-[400px] space-y-1 overflow-y-auto">
            {knownWalletsQuery.isLoading ? (
              <p className="py-4 text-center text-sm text-muted">Loading users...</p>
            ) : filteredWallets.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted">
                {searchQuery ? "No wallets match your search." : "No known wallets yet."}
              </p>
            ) : (
              filteredWallets.map((wallet) => {
                const isSelected = selectedWallet?.address === wallet.address && selectedWallet?.chain === wallet.chain;
                const isCurrent = currentAddress === wallet.address && currentChain === wallet.chain;
                return (
                  <button
                    key={`${wallet.chain}:${wallet.address}`}
                    type="button"
                    onClick={() => setSelectedWallet({ address: wallet.address, chain: wallet.chain })}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                      isSelected ? "bg-accent/10 ring-accent/30 ring-1" : "hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    <span className="text-lg">{CHAIN_META[wallet.chain].icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{wallet.address}</p>
                      <p className="text-xs text-muted">
                        {CHAIN_META[wallet.chain].label}
                        {wallet.lastSeenAt && ` · Last seen ${new Date(wallet.lastSeenAt).toLocaleDateString()}`}
                      </p>
                    </div>
                    {isCurrent && (
                      <span className="rounded border border-sky-400/20 bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                        You
                      </span>
                    )}
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                  </button>
                );
              })
            )}
          </div>
        </GlassCard>
      </FadeIn>

      {selectedWallet && (
        <FadeIn>
          <GlassCard className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold">
                  {CHAIN_META[selectedWallet.chain].icon} {addressPreview(selectedWallet.address)}
                </h3>
                <p className="mt-1 text-xs text-muted">
                  {CHAIN_META[selectedWallet.chain].label} · {selectedWallet.address}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <AnimatedButton
                  variant="primary"
                  className="px-3 py-1.5 text-xs"
                  disabled={setOverrides.isPending}
                  onClick={() => batchOverride(premiumFeatures, true)}
                >
                  Enable All Premium
                </AnimatedButton>
                <AnimatedButton
                  variant="danger"
                  className="px-3 py-1.5 text-xs"
                  disabled={setOverrides.isPending}
                  onClick={() => batchOverride(premiumFeatures, false)}
                >
                  Disable All Premium
                </AnimatedButton>
                <AnimatedButton
                  variant="secondary"
                  className="px-3 py-1.5 text-xs"
                  disabled={setOverrides.isPending}
                  onClick={() => batchOverride(premiumFeatures, null)}
                >
                  Clear Overrides
                </AnimatedButton>
              </div>
            </div>

            {featureAccessQuery.isLoading ? (
              <p className="text-sm text-muted">Loading features...</p>
            ) : (
              <>
                {/* Premium features */}
                {premiumFeatures.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">Premium Features</p>
                    {premiumFeatures.map((f) => (
                      <FeatureToggleRow
                        key={f.id}
                        feature={f}
                        onToggle={toggleFeature}
                        pending={setOverrides.isPending}
                      />
                    ))}
                  </div>
                )}
                {/* OSS features */}
                {ossFeatures.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">OSS Features</p>
                    {ossFeatures.map((f) => (
                      <FeatureToggleRow
                        key={f.id}
                        feature={f}
                        onToggle={toggleFeature}
                        pending={setOverrides.isPending}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {setOverrides.error && <p className="text-sm text-red-300">{setOverrides.error.message}</p>}
          </GlassCard>
        </FadeIn>
      )}
    </div>
  );
}

function FeatureToggleRow({
  feature,
  onToggle,
  pending,
}: {
  feature: { id: string; label: string; summary: string; effectiveEnabled: boolean; source: string };
  onToggle: (id: string, enabled: boolean) => void;
  pending: boolean;
}) {
  return (
    <div className="bg-surface/30 flex items-center justify-between gap-3 rounded-xl border border-border p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{feature.label}</p>
          <StatusPill
            tone={feature.effectiveEnabled ? "success" : "danger"}
            label={feature.effectiveEnabled ? "On" : "Off"}
          />
          <StatusPill
            tone={feature.source === "override_on" ? "info" : feature.source === "override_off" ? "danger" : "muted"}
            label={feature.source.replace(/_/g, " ")}
          />
        </div>
        <p className="mt-0.5 text-xs text-muted">{feature.summary}</p>
      </div>
      <button
        type="button"
        onClick={() => onToggle(feature.id, feature.effectiveEnabled)}
        disabled={pending}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          feature.effectiveEnabled ? "bg-accent" : "bg-[var(--border)]"
        } ${pending ? "opacity-50" : ""}`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            feature.effectiveEnabled ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
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
                          {f.oss ? (
                            <StatusPill tone="success" label="OSS" />
                          ) : (
                            <StatusPill tone="warning" label="Premium" />
                          )}
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

// ── Branding Section ──

type BrandingForm = {
  id?: string;
  name: string;
  brandName: string;
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  emailFromName: string;
  emailReplyTo: string;
  emailFooter: string;
  signingIntro: string;
  emailIntro: string;
};

const EMPTY_BRANDING: BrandingForm = {
  name: "Default Branding",
  brandName: "Proofmark",
  logoUrl: "",
  primaryColor: "#6366f1",
  accentColor: "#22c55e",
  emailFromName: "Proofmark",
  emailReplyTo: "",
  emailFooter: "",
  signingIntro: "",
  emailIntro: "",
};

function BrandingSection() {
  const utils = trpc.useUtils();
  const workspaceQuery = trpc.account.workspace.useQuery();
  const upsertBranding = trpc.account.upsertBranding.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });
  const deleteBranding = trpc.account.deleteBranding.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });

  const [form, setForm] = useState<BrandingForm>(EMPTY_BRANDING);
  const [editing, setEditing] = useState(false);

  const profiles = workspaceQuery.data?.branding ?? [];

  const editProfile = (profile: (typeof profiles)[0]) => {
    setForm({
      id: profile.id,
      name: profile.name,
      brandName: profile.settings.brandName || "Proofmark",
      logoUrl: profile.settings.logoUrl || "",
      primaryColor: profile.settings.primaryColor || "#6366f1",
      accentColor: profile.settings.accentColor || "#22c55e",
      emailFromName: profile.settings.emailFromName || "Proofmark",
      emailReplyTo: profile.settings.emailReplyTo || "",
      emailFooter: profile.settings.emailFooter || "",
      signingIntro: profile.settings.signingIntro || "",
      emailIntro: profile.settings.emailIntro || "",
    });
    setEditing(true);
  };

  const saveProfile = () => {
    upsertBranding.mutate({
      id: form.id,
      name: form.name,
      isDefault: true,
      settings: {
        brandName: form.brandName,
        logoUrl: form.logoUrl || undefined,
        primaryColor: form.primaryColor,
        accentColor: form.accentColor,
        emailFromName: form.emailFromName,
        emailReplyTo: form.emailReplyTo || undefined,
        emailFooter: form.emailFooter || undefined,
        signingIntro: form.signingIntro || undefined,
        emailIntro: form.emailIntro || undefined,
      },
    });
    setEditing(false);
  };

  return (
    <FadeIn>
      <div className="space-y-6">
        <GlassCard className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold">Branding Profiles</h3>
              <p className="mt-1 text-sm text-muted">
                Customize logos, colors, and email experience. The default profile applies to all new documents.
              </p>
            </div>
            <AnimatedButton
              variant="primary"
              className="px-3 py-1.5 text-xs"
              onClick={() => {
                setForm(EMPTY_BRANDING);
                setEditing(true);
              }}
            >
              <Plus className="mr-1 inline h-3 w-3" /> New Profile
            </AnimatedButton>
          </div>

          {/* Existing profiles */}
          {profiles.length > 0 && (
            <div className="space-y-2">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  className="bg-surface/30 flex items-center justify-between gap-3 rounded-xl border border-border p-4"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="h-8 w-8 rounded-lg border border-white/10"
                      style={{
                        background: `linear-gradient(135deg, ${profile.settings.primaryColor || "#6366f1"}, ${profile.settings.accentColor || "#22c55e"})`,
                      }}
                    />
                    <div>
                      <p className="text-sm font-medium">{profile.name}</p>
                      <p className="text-xs text-muted">{profile.settings.brandName || "Proofmark"}</p>
                    </div>
                    {profile.isDefault && <StatusPill tone="success" label="Default" />}
                  </div>
                  <div className="flex gap-2">
                    <AnimatedButton
                      variant="secondary"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => editProfile(profile)}
                    >
                      Edit
                    </AnimatedButton>
                    <AnimatedButton
                      variant="danger"
                      className="px-2 py-1.5 text-xs"
                      onClick={() => deleteBranding.mutate({ id: profile.id })}
                    >
                      <Trash2 className="h-3 w-3" />
                    </AnimatedButton>
                  </div>
                </div>
              ))}
            </div>
          )}

          {profiles.length === 0 && !editing && (
            <p className="py-4 text-center text-sm text-muted">
              No branding profiles yet. Create one to customize your signing experience.
            </p>
          )}
        </GlassCard>

        {/* Edit form */}
        {editing && (
          <GlassCard className="space-y-4">
            <h4 className="text-sm font-semibold">{form.id ? "Edit Profile" : "New Branding Profile"}</h4>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label="Profile name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <TextField
                label="Brand name"
                value={form.brandName}
                onChange={(v) => setForm({ ...form, brandName: v })}
              />
              <TextField label="Logo URL" value={form.logoUrl} onChange={(v) => setForm({ ...form, logoUrl: v })} />
              <TextField
                label="Reply-to email"
                value={form.emailReplyTo}
                onChange={(v) => setForm({ ...form, emailReplyTo: v })}
              />
              <ColorField
                label="Primary color"
                value={form.primaryColor}
                onChange={(v) => setForm({ ...form, primaryColor: v })}
              />
              <ColorField
                label="Accent color"
                value={form.accentColor}
                onChange={(v) => setForm({ ...form, accentColor: v })}
              />
              <TextField
                label="From name"
                value={form.emailFromName}
                onChange={(v) => setForm({ ...form, emailFromName: v })}
              />
              <TextField
                label="Signing intro"
                value={form.signingIntro}
                onChange={(v) => setForm({ ...form, signingIntro: v })}
              />
            </div>
            <TextareaField
              label="Email intro"
              value={form.emailIntro}
              onChange={(v) => setForm({ ...form, emailIntro: v })}
            />
            <TextareaField
              label="Email footer"
              value={form.emailFooter}
              onChange={(v) => setForm({ ...form, emailFooter: v })}
            />
            <div className="flex gap-2">
              <AnimatedButton className="px-4 py-2" onClick={saveProfile} disabled={upsertBranding.isPending}>
                {upsertBranding.isPending ? "Saving..." : "Save Profile"}
              </AnimatedButton>
              <AnimatedButton variant="secondary" className="px-4 py-2" onClick={() => setEditing(false)}>
                Cancel
              </AnimatedButton>
            </div>
            {upsertBranding.error && <p className="text-sm text-red-300">{upsertBranding.error.message}</p>}
          </GlassCard>
        )}

        {/* Preview */}
        {(editing || profiles.length > 0) && (
          <GlassCard className="space-y-3">
            <h4 className="text-sm font-semibold">Brand Preview</h4>
            <div className="rounded-xl border border-border p-4">
              <div className="flex items-center gap-3">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt="Logo" className="h-8 w-8 rounded-lg object-contain" />
                ) : (
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold text-white"
                    style={{ backgroundColor: form.primaryColor || "#6366f1" }}
                  >
                    {(form.brandName || "P")[0]}
                  </div>
                )}
                <span className="text-sm font-semibold" style={{ color: form.primaryColor || "#6366f1" }}>
                  {form.brandName || "Proofmark"}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <div className="h-6 w-16 rounded" style={{ backgroundColor: form.primaryColor || "#6366f1" }} />
                <div className="h-6 w-16 rounded" style={{ backgroundColor: form.accentColor || "#22c55e" }} />
              </div>
              {form.signingIntro && <p className="mt-3 text-xs text-muted">{form.signingIntro}</p>}
            </div>
          </GlassCard>
        )}
      </div>
    </FadeIn>
  );
}

// ── Integrations Section ──

function IntegrationsSection() {
  const utils = trpc.useUtils();
  const workspaceQuery = trpc.account.workspace.useQuery();
  const upsertIntegration = trpc.account.upsertIntegration.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });
  const deleteIntegration = trpc.account.deleteIntegration.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });

  const integrations = workspaceQuery.data?.integrations ?? [];

  // SMS state
  const [smsProvider, setSmsProvider] = useState("TWILIO");
  const [smsLabel, setSmsLabel] = useState("Primary SMS");
  const [smsFrom, setSmsFrom] = useState("");
  const [smsAccountSid, setSmsAccountSid] = useState("");
  const [smsAuthToken, setSmsAuthToken] = useState("");
  const [smsApiKey, setSmsApiKey] = useState("");
  const [smsApiSecret, setSmsApiSecret] = useState("");

  // Address state
  const [addressProvider, setAddressProvider] = useState("MAPBOX");
  const [addressLabel, setAddressLabel] = useState("Primary Address Search");
  const [addressApiKey, setAddressApiKey] = useState("");
  const [addressEndpoint, setAddressEndpoint] = useState("");
  const [addressHeaders, setAddressHeaders] = useState("");

  // Payment state
  const [payProvider, setPayProvider] = useState("STRIPE");
  const [payLabel, setPayLabel] = useState("Primary Payments");
  const [payApiKey, setPayApiKey] = useState("");
  const [payApiSecret, setPayApiSecret] = useState("");

  // SSO state
  const [ssoProvider, setSsoProvider] = useState("GOOGLE");
  const [ssoLabel, setSsoLabel] = useState("Primary SSO");
  const [ssoClientId, setSsoClientId] = useState("");
  const [ssoClientSecret, setSsoClientSecret] = useState("");
  const [ssoIssuer, setSsoIssuer] = useState("");

  const [activeIntTab, setActiveIntTab] = useState<"sms" | "address" | "payment" | "sso">("sms");

  const smsIntegrations = integrations.filter((i) => i.kind === "SMS");
  const addressIntegrations = integrations.filter((i) => i.kind === "ADDRESS");
  const paymentIntegrations = integrations.filter((i) => i.kind === "PAYMENT");
  const ssoIntegrations = integrations.filter((i) => i.kind === "SSO");

  const saveSms = () => {
    upsertIntegration.mutate({
      kind: "SMS",
      provider: smsProvider,
      label: smsLabel,
      isDefault: true,
      config: {
        provider: smsProvider,
        enabled: true,
        from: smsFrom,
        accountSid: smsProvider === "TWILIO" ? smsAccountSid : undefined,
        authToken: smsProvider === "TWILIO" ? smsAuthToken : undefined,
        apiKey: smsProvider !== "TWILIO" ? smsApiKey || undefined : undefined,
        apiSecret: smsProvider === "VONAGE" ? smsApiSecret || undefined : undefined,
      },
    });
  };

  const saveAddress = () => {
    let parsedHeaders: Record<string, string> | undefined;
    if (addressProvider === "CUSTOM" && addressHeaders.trim()) {
      try {
        parsedHeaders = JSON.parse(addressHeaders);
      } catch {
        return;
      }
    }
    upsertIntegration.mutate({
      kind: "ADDRESS",
      provider: addressProvider,
      label: addressLabel,
      isDefault: true,
      config: {
        provider: addressProvider,
        enabled: true,
        apiKey: addressProvider !== "CUSTOM" ? addressApiKey || undefined : undefined,
        endpoint: addressProvider === "CUSTOM" ? addressEndpoint || undefined : undefined,
        headers: parsedHeaders,
      },
    });
  };

  const savePayment = () => {
    upsertIntegration.mutate({
      kind: "PAYMENT",
      provider: payProvider,
      label: payLabel,
      isDefault: true,
      config: {
        provider: payProvider,
        enabled: true,
        apiKey: payApiKey || undefined,
        apiSecret: payApiSecret || undefined,
      },
    });
  };

  const saveSso = () => {
    upsertIntegration.mutate({
      kind: "SSO",
      provider: ssoProvider,
      label: ssoLabel,
      isDefault: true,
      config: {
        provider: ssoProvider,
        enabled: true,
        clientId: ssoClientId || undefined,
        clientSecret: ssoClientSecret || undefined,
        issuer: ssoIssuer || undefined,
      },
    });
  };

  const intTabs = [
    { id: "sms" as const, label: "SMS", icon: MessageSquare, count: smsIntegrations.length },
    { id: "address" as const, label: "Address", icon: MapPin, count: addressIntegrations.length },
    { id: "payment" as const, label: "Payments", icon: CreditCard, count: paymentIntegrations.length },
    { id: "sso" as const, label: "SSO", icon: Key, count: ssoIntegrations.length },
  ];

  return (
    <FadeIn>
      <div className="space-y-6">
        <GlassCard className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Integration Providers</h3>
            <p className="mt-1 text-sm text-muted">
              Configure your own API keys for SMS, address autocomplete, payments, and SSO. These are &quot;Bring Your
              Own&quot; integrations that work in both OSS and Premium.
            </p>
          </div>

          {/* Sub-tabs */}
          <div className="bg-surface/30 flex gap-1 rounded-lg border border-border p-1">
            {intTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveIntTab(tab.id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    activeIntTab === tab.id ? "bg-accent/20 text-accent" : "text-muted hover:text-secondary"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {tab.label}
                  {tab.count > 0 && <span className="bg-surface/50 rounded-full px-1.5 text-[10px]">{tab.count}</span>}
                </button>
              );
            })}
          </div>
        </GlassCard>

        {/* SMS */}
        {activeIntTab === "sms" && (
          <GlassCard className="space-y-4">
            <h4 className="text-sm font-semibold">SMS Provider</h4>
            <p className="text-xs text-muted">Twilio, Vonage, or Telnyx for SMS invites and reminders.</p>
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label="Provider"
                value={smsProvider}
                onChange={setSmsProvider}
                options={["TWILIO", "VONAGE", "TELNYX"]}
              />
              <TextField label="Label" value={smsLabel} onChange={setSmsLabel} />
              <TextField label="From number / sender" value={smsFrom} onChange={setSmsFrom} />
              {smsProvider === "TWILIO" && (
                <>
                  <TextField label="Account SID" value={smsAccountSid} onChange={setSmsAccountSid} />
                  <TextField label="Auth token" value={smsAuthToken} onChange={setSmsAuthToken} password />
                </>
              )}
              {smsProvider === "VONAGE" && (
                <>
                  <TextField label="API key" value={smsApiKey} onChange={setSmsApiKey} />
                  <TextField label="API secret" value={smsApiSecret} onChange={setSmsApiSecret} password />
                </>
              )}
              {smsProvider === "TELNYX" && (
                <TextField label="API key" value={smsApiKey} onChange={setSmsApiKey} password />
              )}
            </div>
            <AnimatedButton className="px-4 py-2" onClick={saveSms} disabled={upsertIntegration.isPending || !smsFrom}>
              Save SMS Provider
            </AnimatedButton>
            <IntegrationList items={smsIntegrations} onDelete={(id) => deleteIntegration.mutate({ id })} />
          </GlassCard>
        )}

        {/* Address */}
        {activeIntTab === "address" && (
          <GlassCard className="space-y-4">
            <h4 className="text-sm font-semibold">Address Autocomplete</h4>
            <p className="text-xs text-muted">
              Geocoding for signer-side address suggestions — Mapbox, Geoapify, or custom endpoint.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label="Provider"
                value={addressProvider}
                onChange={setAddressProvider}
                options={["MAPBOX", "GEOAPIFY", "CUSTOM"]}
              />
              <TextField label="Label" value={addressLabel} onChange={setAddressLabel} />
              {addressProvider !== "CUSTOM" ? (
                <TextField label="API key" value={addressApiKey} onChange={setAddressApiKey} password />
              ) : (
                <TextField label="Endpoint URL" value={addressEndpoint} onChange={setAddressEndpoint} />
              )}
              {addressProvider === "CUSTOM" && (
                <TextareaField label="Custom headers (JSON)" value={addressHeaders} onChange={setAddressHeaders} />
              )}
            </div>
            <AnimatedButton
              className="px-4 py-2"
              onClick={saveAddress}
              disabled={
                upsertIntegration.isPending || (addressProvider === "CUSTOM" ? !addressEndpoint : !addressApiKey)
              }
            >
              Save Address Provider
            </AnimatedButton>
            <IntegrationList items={addressIntegrations} onDelete={(id) => deleteIntegration.mutate({ id })} />
          </GlassCard>
        )}

        {/* Payment */}
        {activeIntTab === "payment" && (
          <GlassCard className="space-y-4">
            <h4 className="text-sm font-semibold">Payment Collection</h4>
            <p className="text-xs text-muted">
              Collect payments inside the signing flow with Stripe or a custom provider.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label="Provider"
                value={payProvider}
                onChange={setPayProvider}
                options={["STRIPE", "CUSTOM"]}
              />
              <TextField label="Label" value={payLabel} onChange={setPayLabel} />
              <TextField label="API key (publishable)" value={payApiKey} onChange={setPayApiKey} password />
              <TextField label="API secret" value={payApiSecret} onChange={setPayApiSecret} password />
            </div>
            <AnimatedButton
              className="px-4 py-2"
              onClick={savePayment}
              disabled={upsertIntegration.isPending || !payApiKey}
            >
              Save Payment Provider
            </AnimatedButton>
            <IntegrationList items={paymentIntegrations} onDelete={(id) => deleteIntegration.mutate({ id })} />
          </GlassCard>
        )}

        {/* SSO */}
        {activeIntTab === "sso" && (
          <GlassCard className="space-y-4">
            <h4 className="text-sm font-semibold">SSO / OAuth Providers</h4>
            <p className="text-xs text-muted">
              Identity providers for Web2 login: Google, Auth0, Okta, or custom OIDC.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label="Provider"
                value={ssoProvider}
                onChange={setSsoProvider}
                options={["GOOGLE", "AUTH0", "OKTA", "CUSTOM"]}
              />
              <TextField label="Label" value={ssoLabel} onChange={setSsoLabel} />
              <TextField label="Client ID" value={ssoClientId} onChange={setSsoClientId} />
              <TextField label="Client Secret" value={ssoClientSecret} onChange={setSsoClientSecret} password />
              {(ssoProvider === "AUTH0" || ssoProvider === "OKTA" || ssoProvider === "CUSTOM") && (
                <TextField label="Issuer URL" value={ssoIssuer} onChange={setSsoIssuer} />
              )}
            </div>
            <AnimatedButton
              className="px-4 py-2"
              onClick={saveSso}
              disabled={upsertIntegration.isPending || !ssoClientId}
            >
              Save SSO Provider
            </AnimatedButton>
            <IntegrationList items={ssoIntegrations} onDelete={(id) => deleteIntegration.mutate({ id })} />
          </GlassCard>
        )}
      </div>
    </FadeIn>
  );
}

function IntegrationList({
  items,
  onDelete,
}: {
  items: Array<{ id: string; label: string; provider: string; isDefault: boolean; config: { enabled?: boolean } }>;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Configured</p>
      {items.map((entry) => (
        <div
          key={entry.id}
          className="bg-surface/30 flex items-center justify-between rounded-xl border border-border p-3 text-sm"
        >
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${entry.config.enabled !== false ? "bg-emerald-400" : "bg-zinc-600"}`}
            />
            <div>
              <p className="font-medium">{entry.label}</p>
              <p className="text-xs text-muted">
                {entry.provider}
                {entry.isDefault ? " · Default" : ""}
              </p>
            </div>
          </div>
          <AnimatedButton variant="danger" className="px-2 py-1 text-xs" onClick={() => onDelete(entry.id)}>
            <Trash2 className="h-3 w-3" />
          </AnimatedButton>
        </div>
      ))}
    </div>
  );
}

// ── Webhooks Section ──

function WebhooksSection() {
  const utils = trpc.useUtils();
  const workspaceQuery = trpc.account.workspace.useQuery();
  const upsertWebhook = trpc.account.upsertWebhook.useMutation({
    onSuccess: () => {
      utils.account.workspace.invalidate();
      setLabel("");
      setUrl("");
      setSecret("");
    },
  });
  const deleteWebhook = trpc.account.deleteWebhook.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState("DOCUMENT_COMPLETED,SIGNER_SIGNED,SIGNER_DECLINED");

  const webhooks = workspaceQuery.data?.webhooks ?? [];

  const ALL_EVENTS = [
    "DOCUMENT_CREATED",
    "DOCUMENT_COMPLETED",
    "DOCUMENT_VOIDED",
    "DOCUMENT_EXPIRED",
    "SIGNER_INVITED",
    "SIGNER_SIGNED",
    "SIGNER_DECLINED",
    "SIGNER_VIEWED",
    "AUDIT_HASH_ANCHORED",
    "PROOF_PACKET_GENERATED",
  ];

  return (
    <FadeIn>
      <div className="space-y-6">
        <GlassCard className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Webhook Endpoints</h3>
            <p className="mt-1 text-sm text-muted">
              Forward document lifecycle events to your systems with HMAC-signed payloads.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <TextField label="Label" value={label} onChange={setLabel} />
            <TextField label="Webhook URL" value={url} onChange={setUrl} />
          </div>
          <TextField label="Shared secret (HMAC)" value={secret} onChange={setSecret} password />

          {/* Event selector */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Events to subscribe</p>
            <div className="flex flex-wrap gap-2">
              {ALL_EVENTS.map((evt) => {
                const selected = events
                  .split(",")
                  .map((e) => e.trim())
                  .includes(evt);
                return (
                  <button
                    key={evt}
                    type="button"
                    onClick={() => {
                      const current = events
                        .split(",")
                        .map((e) => e.trim())
                        .filter(Boolean);
                      if (selected) {
                        setEvents(current.filter((e) => e !== evt).join(","));
                      } else {
                        setEvents([...current, evt].join(","));
                      }
                    }}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-medium transition ${
                      selected
                        ? "border-accent/30 bg-accent/10 text-accent"
                        : "bg-surface/30 border-border text-muted hover:text-secondary"
                    }`}
                  >
                    {selected && <Check className="mr-1 inline h-2.5 w-2.5" />}
                    {evt.replace(/_/g, " ")}
                  </button>
                );
              })}
            </div>
          </div>

          <AnimatedButton
            className="px-4 py-2"
            onClick={() =>
              upsertWebhook.mutate({
                label,
                url,
                secret: secret || undefined,
                active: true,
                events: events
                  .split(",")
                  .map((e) => e.trim())
                  .filter(Boolean),
              })
            }
            disabled={upsertWebhook.isPending || !label || !url}
          >
            Add Webhook
          </AnimatedButton>
        </GlassCard>

        {webhooks.length > 0 && (
          <GlassCard className="space-y-3">
            <h4 className="text-sm font-semibold">Active Webhooks</h4>
            {webhooks.map((hook) => (
              <div key={hook.id} className="bg-surface/30 rounded-xl border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${hook.active ? "bg-emerald-400" : "bg-zinc-600"}`} />
                      <p className="font-medium">{hook.label}</p>
                    </div>
                    <p className="mt-1 text-sm text-muted">{hook.url}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {hook.events.map((evt) => (
                        <span
                          key={evt}
                          className="bg-surface/40 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted"
                        >
                          {evt.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                    {hook.lastTriggeredAt && (
                      <p className="mt-2 text-xs text-muted">
                        Last triggered: {new Date(hook.lastTriggeredAt).toLocaleString()}
                      </p>
                    )}
                    {hook.lastError && <p className="mt-1 text-xs text-red-300">Last error: {hook.lastError}</p>}
                  </div>
                  <AnimatedButton
                    variant="danger"
                    className="px-3 py-1.5 text-xs"
                    onClick={() => deleteWebhook.mutate({ id: hook.id })}
                  >
                    Remove
                  </AnimatedButton>
                </div>
              </div>
            ))}
          </GlassCard>
        )}
      </div>
    </FadeIn>
  );
}

// ── Templates Section ──

function TemplatesSection() {
  const utils = trpc.useUtils();
  const templatesQuery = trpc.account.listTemplates.useQuery();
  const deleteTemplate = trpc.account.deleteTemplate.useMutation({
    onSuccess: () => {
      utils.account.listTemplates.invalidate();
      utils.account.workspace.invalidate();
    },
  });

  const templates = templatesQuery.data ?? [];

  return (
    <FadeIn>
      <div className="space-y-6">
        <GlassCard className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Document Templates</h3>
            <p className="mt-1 text-sm text-muted">
              Reusable signing blueprints created from the document editor. Templates include signers, fields, and
              default settings.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Total Templates"
              value={String(templates.length)}
              icon={<FileText className="h-4 w-4" />}
              tone="info"
            />
            <StatCard
              label="With Signers"
              value={String(
                templates.filter((t) => {
                  const s = t.signers as unknown[];
                  return s && s.length > 0;
                }).length,
              )}
              icon={<Users className="h-4 w-4" />}
              tone="success"
            />
            <StatCard
              label="With Expiry"
              value={String(
                templates.filter((t) => {
                  const d = t.defaults as { expiresInDays?: number } | null;
                  return d?.expiresInDays;
                }).length,
              )}
              icon={<Clock className="h-4 w-4" />}
              tone="warning"
            />
          </div>
        </GlassCard>

        {templates.length > 0 ? (
          <GlassCard className="space-y-3">
            <h4 className="text-sm font-semibold">All Templates</h4>
            {templates.map((template) => {
              const signerCount = (template.signers as unknown[])?.length ?? 0;
              const defaults = template.defaults as {
                proofMode?: string;
                signingOrder?: string;
                expiresInDays?: number;
              } | null;
              return (
                <div key={template.id} className="bg-surface/30 rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{template.name}</p>
                      <p className="mt-0.5 text-sm text-muted">{template.title}</p>
                      {template.description && <p className="mt-1 text-xs text-muted">{template.description}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <StatusPill tone="info" label={`${signerCount} signer${signerCount !== 1 ? "s" : ""}`} />
                        {defaults?.proofMode && <StatusPill tone="muted" label={defaults.proofMode} />}
                        {defaults?.signingOrder && <StatusPill tone="muted" label={defaults.signingOrder} />}
                        {defaults?.expiresInDays && (
                          <StatusPill tone="warning" label={`${defaults.expiresInDays}d expiry`} />
                        )}
                      </div>
                    </div>
                    <AnimatedButton
                      variant="danger"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => deleteTemplate.mutate({ id: template.id })}
                    >
                      Delete
                    </AnimatedButton>
                  </div>
                </div>
              );
            })}
          </GlassCard>
        ) : (
          <GlassCard className="py-8 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-3 text-sm text-muted">No templates yet. Create one from the document editor.</p>
          </GlassCard>
        )}
      </div>
    </FadeIn>
  );
}

// ── AI & Limits Section ──

function AiLimitsSection() {
  const utils = trpc.useUtils();
  const limitsQuery = trpc.account.adminListAiLimits.useQuery();
  const usageQuery = trpc.account.adminAiUsage.useQuery();
  const toolsQuery = trpc.account.detectAiTools.useQuery(undefined, { staleTime: 60000 });
  const deleteLimitMut = trpc.account.adminDeleteAiLimit.useMutation({
    onSuccess: () => utils.account.adminListAiLimits.invalidate(),
  });
  const setLimitMut = trpc.account.adminSetAiLimits.useMutation({
    onSuccess: () => {
      utils.account.adminListAiLimits.invalidate();
      setShowForm(false);
    },
  });

  const [showForm, setShowForm] = useState(false);
  const [formOwner, setFormOwner] = useState("");
  const [formMode, setFormMode] = useState<"platform" | "admin">("platform");
  const [formReqPerMonth, setFormReqPerMonth] = useState("500");
  const [formTokPerMonth, setFormTokPerMonth] = useState("1000000");
  const [formReqPerHour, setFormReqPerHour] = useState("30");
  const [formAdminReqPerDay, setFormAdminReqPerDay] = useState("");
  const [formAdminReqPerMonth, setFormAdminReqPerMonth] = useState("1000");
  const [formAdminTokPerMonth, setFormAdminTokPerMonth] = useState("2000000");

  const runtimeQuery = trpc.runtime.getStatus.useQuery(undefined, { staleTime: 30000 });
  const runtimeInstallMut = trpc.runtime.install.useMutation({
    onSuccess: () => runtimeQuery.refetch(),
  });
  const runtimeUninstallMut = trpc.runtime.uninstall.useMutation({
    onSuccess: () => runtimeQuery.refetch(),
  });
  const runtimeAuthorizeMut = trpc.runtime.authorize.useMutation({
    onSuccess: () => runtimeQuery.refetch(),
  });
  const runtimeRevokeMut = trpc.runtime.revokeAuth.useMutation({
    onSuccess: () => runtimeQuery.refetch(),
  });
  const runtimeHealthMut = trpc.runtime.healthCheck.useMutation({
    onSuccess: () => runtimeQuery.refetch(),
  });
  const [runtimeApiKeys, setRuntimeApiKeys] = useState<Record<string, string>>({});

  const [activeAiTab, setActiveAiTab] = useState<"tools" | "providers" | "limits" | "usage" | "runtime">("tools");

  const limits = limitsQuery.data ?? [];
  const usage = usageQuery.data;

  return (
    <FadeIn>
      <div className="space-y-6">
        <GlassCard className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">AI Configuration & Rate Limits</h3>
            <p className="mt-1 text-sm text-muted">
              Manage AI providers (BYOK keys), rate limits per user, and monitor platform-wide AI usage.
            </p>
          </div>

          <div className="bg-surface/30 flex flex-wrap gap-1 rounded-lg border border-border p-1">
            {(["tools", "runtime", "providers", "limits", "usage"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveAiTab(tab)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  activeAiTab === tab ? "bg-accent/20 text-accent" : "text-muted hover:text-secondary"
                }`}
              >
                {tab === "tools" && <Sparkles className="h-3.5 w-3.5" />}
                {tab === "runtime" && <Server className="h-3.5 w-3.5" />}
                {tab === "providers" && <Key className="h-3.5 w-3.5" />}
                {tab === "limits" && <Gauge className="h-3.5 w-3.5" />}
                {tab === "usage" && <BarChart3 className="h-3.5 w-3.5" />}
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Tools detection tab */}
        {activeAiTab === "tools" && (
          <GlassCard className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold">AI CLI Tools</h4>
                <p className="text-xs text-muted">
                  Auto-detected AI tools on this server. These can be used with the OpenClaw connector for local AI
                  execution.
                </p>
              </div>
              <button
                type="button"
                onClick={() => toolsQuery.refetch()}
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-secondary"
              >
                <RefreshCw className={`h-4 w-4 ${toolsQuery.isFetching ? "animate-spin" : ""}`} />
              </button>
            </div>

            {toolsQuery.isLoading ? (
              <p className="text-sm text-muted">Scanning for AI tools...</p>
            ) : (
              <div className="space-y-3">
                {(toolsQuery.data ?? []).map((tool) => (
                  <div
                    key={tool.binary}
                    className={`rounded-xl border p-4 ${
                      tool.found ? "border-emerald-400/20 bg-emerald-400/5" : "bg-surface/30 border-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg ${
                            tool.found ? "bg-emerald-400/10 text-emerald-300" : "bg-surface/50 text-muted"
                          }`}
                        >
                          {tool.binary === "claude" ? "C" : tool.binary === "codex" ? "X" : "O"}
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{tool.name}</p>
                          <p className="font-mono text-xs text-muted">{tool.binary}</p>
                        </div>
                      </div>
                      <StatusPill
                        tone={tool.found ? "success" : "muted"}
                        label={tool.found ? "Detected" : "Not Found"}
                      />
                    </div>
                    {tool.found && (
                      <div className="mt-3 space-y-1">
                        <div className="bg-surface/20 flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-xs">
                          <span className="text-muted">Path:</span>
                          <span className="text-secondary">{tool.path}</span>
                        </div>
                        {tool.version && (
                          <div className="bg-surface/20 flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-xs">
                            <span className="text-muted">Version:</span>
                            <span className="text-secondary">{tool.version}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {!tool.found && (
                      <p className="mt-2 text-xs text-muted">
                        {tool.binary === "claude" && "Install: npm install -g @anthropic-ai/claude-code"}
                        {tool.binary === "codex" && "Install: npm install -g @openai/codex"}
                        {tool.binary === "openclaw" && "Install: cargo install openclaw"}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Connector setup hint */}
            <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 p-4">
              <h5 className="text-sm font-semibold text-sky-200">OpenClaw Connector Setup</h5>
              <p className="mt-1 text-xs text-muted">
                Detected tools can be connected to the platform via the OpenClaw connector. The connector runs locally,
                executes AI tasks, and reports results back.
              </p>
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted">1. Generate an access token in the connector settings</p>
                <p className="text-xs text-muted">2. Configure the connector with your platform URL and token</p>
                <p className="text-xs text-muted">
                  3. The connector will auto-detect installed tools and register capabilities
                </p>
              </div>
              {(toolsQuery.data ?? []).some((t) => t.found) && (
                <div className="bg-surface/20 mt-3 rounded-lg p-3 font-mono text-xs text-secondary">
                  <p className="text-muted"># Detected tool paths for connector config:</p>
                  {(toolsQuery.data ?? [])
                    .filter((t) => t.found)
                    .map((t) => (
                      <p key={t.binary}>
                        {t.binary}_path = &quot;{t.path}&quot;
                      </p>
                    ))}
                </div>
              )}
            </div>
          </GlassCard>
        )}

        {/* Runtime tab */}
        {activeAiTab === "runtime" && (
          <div className="space-y-6">
            {/* Runtime tools — install, auth, status */}
            <GlassCard className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold">Server AI Runtime</h4>
                  <p className="text-xs text-muted">
                    Install and manage Claude Code, Codex, and OpenClaw directly on this server. Local CLI tools are
                    used first (free), then fall back to API providers.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => runtimeQuery.refetch()}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-secondary"
                >
                  <RefreshCw className={`h-4 w-4 ${runtimeQuery.isFetching ? "animate-spin" : ""}`} />
                </button>
              </div>

              {/* System prerequisites */}
              {runtimeQuery.data?.prereqs && (
                <div className="flex flex-wrap gap-3">
                  {(["npm", "node", "cargo"] as const).map((dep) => {
                    const info = runtimeQuery.data!.prereqs[dep];
                    return (
                      <div key={dep} className="bg-surface/20 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs">
                        <div className={`h-2 w-2 rounded-full ${info.available ? "bg-emerald-400" : "bg-red-400"}`} />
                        <span className="font-medium">{dep}</span>
                        {info.version && <span className="text-muted">{info.version}</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              {runtimeQuery.isLoading ? (
                <p className="text-sm text-muted">Loading runtime status...</p>
              ) : (
                <div className="space-y-3">
                  {(["claude-code", "codex", "openclaw"] as const).map((tool) => {
                    const install = runtimeQuery.data?.tools?.find((t: any) => t.tool === tool);
                    const status = install?.status ?? "not_installed";
                    const authStatus = install?.authStatus ?? "none";
                    const isReady = status === "ready";
                    const isInstalled = status !== "not_installed" && status !== "installing" && status !== "error";
                    const isInstalling = runtimeInstallMut.isPending && runtimeInstallMut.variables?.tool === tool;

                    const toneClass = isReady
                      ? "border-emerald-400/20 bg-emerald-400/5"
                      : status === "error"
                        ? "border-red-400/20 bg-red-400/5"
                        : isInstalled
                          ? "border-amber-400/20 bg-amber-400/5"
                          : "border-border bg-surface/30";

                    return (
                      <div key={tool} className={`rounded-xl border p-4 ${toneClass}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg font-bold ${isReady ? "bg-emerald-400/10 text-emerald-300" : "bg-surface/50 text-muted"}`}
                            >
                              {tool === "claude-code" ? "C" : tool === "codex" ? "X" : "O"}
                            </div>
                            <div>
                              <p className="text-sm font-semibold">
                                {tool === "claude-code"
                                  ? "Claude Code"
                                  : tool === "codex"
                                    ? "OpenAI Codex"
                                    : "OpenClaw"}
                              </p>
                              <p className="font-mono text-xs text-muted">{tool}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusPill
                              tone={
                                isReady ? "success" : status === "error" ? "danger" : isInstalled ? "warning" : "muted"
                              }
                              label={
                                status === "ready"
                                  ? "Ready"
                                  : status === "auth_pending"
                                    ? "Needs Auth"
                                    : status === "installed"
                                      ? "Installed"
                                      : status === "installing"
                                        ? "Installing..."
                                        : status === "error"
                                          ? "Error"
                                          : "Not Installed"
                              }
                            />
                            {authStatus === "authorized" && <StatusPill tone="info" label="Authorized" />}
                          </div>
                        </div>

                        {/* Tool details */}
                        {install && status !== "not_installed" && (
                          <div className="mt-3 space-y-1">
                            {install.binaryPath && (
                              <div className="bg-surface/20 flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-xs">
                                <span className="text-muted">Path:</span>
                                <span className="text-secondary">{install.binaryPath}</span>
                              </div>
                            )}
                            {install.version && (
                              <div className="bg-surface/20 flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-xs">
                                <span className="text-muted">Version:</span>
                                <span className="text-secondary">{install.version}</span>
                              </div>
                            )}
                            {install.errorMessage && (
                              <div className="flex items-center gap-2 rounded-lg bg-red-400/10 px-3 py-2 text-xs text-red-300">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                {install.errorMessage}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="mt-3 flex flex-wrap gap-2">
                          {status === "not_installed" || status === "error" ? (
                            <AnimatedButton
                              onClick={() => runtimeInstallMut.mutate({ tool })}
                              disabled={isInstalling}
                              className="bg-accent/20 hover:bg-accent/30 rounded-lg px-3 py-1.5 text-xs font-medium text-accent transition disabled:opacity-50"
                            >
                              {isInstalling ? "Installing..." : "Install on Server"}
                            </AnimatedButton>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => runtimeHealthMut.mutate({ tool })}
                                className="bg-surface/30 hover:bg-surface/50 rounded-lg px-3 py-1.5 text-xs font-medium text-secondary transition"
                              >
                                Health Check
                              </button>
                              <button
                                type="button"
                                onClick={() => runtimeUninstallMut.mutate({ tool })}
                                className="rounded-lg bg-red-400/10 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:bg-red-400/20"
                              >
                                Uninstall
                              </button>
                            </>
                          )}
                        </div>

                        {/* API Key auth section */}
                        {isInstalled && authStatus !== "authorized" && (
                          <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
                            <p className="mb-2 text-xs text-amber-200">
                              {tool === "claude-code"
                                ? "Enter your Anthropic API key to authorize Claude Code:"
                                : tool === "codex"
                                  ? "Enter your OpenAI API key to authorize Codex:"
                                  : "Enter your API key:"}
                            </p>
                            <div className="flex gap-2">
                              <input
                                type="password"
                                placeholder="sk-..."
                                value={runtimeApiKeys[tool] ?? ""}
                                onChange={(e) => setRuntimeApiKeys((prev) => ({ ...prev, [tool]: e.target.value }))}
                                className="bg-surface/30 flex-1 rounded-lg border border-border px-3 py-1.5 font-mono text-xs text-secondary placeholder:text-muted"
                              />
                              <AnimatedButton
                                onClick={() => {
                                  const key = runtimeApiKeys[tool];
                                  if (key) {
                                    runtimeAuthorizeMut.mutate({ tool, apiKey: key });
                                    setRuntimeApiKeys((prev) => ({ ...prev, [tool]: "" }));
                                  }
                                }}
                                disabled={!runtimeApiKeys[tool] || runtimeAuthorizeMut.isPending}
                                className="bg-accent/20 hover:bg-accent/30 rounded-lg px-3 py-1.5 text-xs font-medium text-accent transition disabled:opacity-50"
                              >
                                Authorize
                              </AnimatedButton>
                            </div>
                          </div>
                        )}

                        {/* Authorized — show revoke option */}
                        {authStatus === "authorized" && (
                          <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-400/5 px-3 py-2">
                            <p className="text-xs text-emerald-300">API key authorized and encrypted in database</p>
                            <button
                              type="button"
                              onClick={() => runtimeRevokeMut.mutate({ tool })}
                              className="text-xs text-red-300 underline transition hover:text-red-200"
                            >
                              Revoke
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </GlassCard>

            {/* Routing status */}
            {runtimeQuery.data?.routing && (
              <GlassCard className="space-y-4">
                <h4 className="text-sm font-semibold">Request Routing</h4>
                <p className="text-xs text-muted">
                  Requests are routed in priority order: Server CLI → User Connector → BYOK → Platform API
                </p>

                <div className="space-y-2">
                  <SystemRow
                    label="Active Route"
                    value={runtimeQuery.data.routing.activeRoute}
                    tone={
                      runtimeQuery.data.routing.activeRoute.startsWith("server_cli")
                        ? "success"
                        : runtimeQuery.data.routing.activeRoute === "none"
                          ? "danger"
                          : "info"
                    }
                  />
                  <SystemRow
                    label="User Connector"
                    value={runtimeQuery.data.routing.hasConnector ? "Online" : "Offline"}
                    tone={runtimeQuery.data.routing.hasConnector ? "success" : "muted"}
                  />
                  <SystemRow
                    label="BYOK Keys"
                    value={runtimeQuery.data.routing.hasByok ? "Configured" : "None"}
                    tone={runtimeQuery.data.routing.hasByok ? "success" : "muted"}
                  />
                  <SystemRow
                    label="Platform API Keys"
                    value={runtimeQuery.data.routing.hasPlatformKeys ? "Configured" : "None"}
                    tone={runtimeQuery.data.routing.hasPlatformKeys ? "success" : "muted"}
                  />
                </div>

                {/* Per-tool routing */}
                <div className="space-y-2">
                  <h5 className="text-xs font-semibold text-muted">CLI Tool Status</h5>
                  {runtimeQuery.data.routing.serverCli.map((cli: any) => (
                    <div
                      key={cli.tool}
                      className="bg-surface/20 flex items-center justify-between rounded-lg px-3 py-2 text-xs"
                    >
                      <span className="font-medium">{cli.tool}</span>
                      <div className="flex items-center gap-2">
                        {cli.ready && !cli.rateLimited && <StatusPill tone="success" label="Active" />}
                        {cli.ready && cli.rateLimited && (
                          <StatusPill tone="warning" label={`Rate Limited: ${cli.rateLimitReason}`} />
                        )}
                        {!cli.installed && <StatusPill tone="muted" label="Not Installed" />}
                        {cli.installed && !cli.authorized && <StatusPill tone="warning" label="Not Authorized" />}
                      </div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            )}

            {/* Active pipe sessions */}
            {runtimeQuery.data?.sessions && runtimeQuery.data.sessions.length > 0 && (
              <GlassCard className="space-y-4">
                <h4 className="text-sm font-semibold">Active Sessions</h4>
                <p className="text-xs text-muted">Persistent CLI processes for low-latency AI execution.</p>

                <div className="space-y-2">
                  {runtimeQuery.data.sessions.map((session: any) => (
                    <div
                      key={session.id}
                      className="bg-surface/30 flex items-center justify-between rounded-xl border border-border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Activity className="h-4 w-4 text-emerald-400" />
                        <div>
                          <p className="text-xs font-medium">{session.tool}</p>
                          <p className="font-mono text-xs text-muted">
                            {session.requestCount} requests · {session.errorCount} errors
                          </p>
                        </div>
                      </div>
                      <StatusPill
                        tone={session.status === "active" ? "success" : session.status === "idle" ? "info" : "danger"}
                        label={session.status}
                      />
                    </div>
                  ))}
                </div>
              </GlassCard>
            )}
          </div>
        )}

        {/* Providers tab */}
        {activeAiTab === "providers" && (
          <GlassCard className="space-y-4">
            <h4 className="text-sm font-semibold">AI Provider Configuration</h4>
            <p className="text-xs text-muted">Add BYOK API keys for AI features. Supports 12+ providers.</p>
            <AiProviderSettings />
          </GlassCard>
        )}

        {/* Limits tab */}
        {activeAiTab === "limits" && (
          <div className="space-y-6">
            <GlassCard className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-semibold">Rate Limit Records</h4>
                  <p className="text-xs text-muted">
                    Platform mode: monthly cap with hourly circuit breakers. Admin mode: granular per-user limits.
                  </p>
                </div>
                <AnimatedButton variant="primary" className="px-3 py-1.5 text-xs" onClick={() => setShowForm(true)}>
                  <Plus className="mr-1 inline h-3 w-3" /> Add Limit
                </AnimatedButton>
              </div>

              {limits.length > 0 ? (
                <div className="space-y-2">
                  {limits.map((limit) => (
                    <div key={limit.id} className="bg-surface/30 rounded-xl border border-border p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{addressPreview(limit.ownerAddress)}</p>
                            <StatusPill tone={limit.mode === "admin" ? "warning" : "info"} label={limit.mode} />
                            {limit.feature && <StatusPill tone="muted" label={limit.feature} />}
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-4">
                            <span>Req/month: {limit.requestsPerMonth}</span>
                            <span>Tok/month: {(limit.tokensPerMonth / 1000).toFixed(0)}K</span>
                            <span>Req/hour: {limit.maxRequestsPerHour}</span>
                            <span>Req/week: {limit.maxRequestsPerWeek}</span>
                          </div>
                          <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted sm:grid-cols-4">
                            <span>Used month: {limit.currentMonthRequests} req</span>
                            <span>Used month: {(limit.currentMonthTokens / 1000).toFixed(0)}K tok</span>
                            <span>Used hour: {limit.currentHourRequests} req</span>
                            <span>Used day: {limit.currentDayRequests} req</span>
                          </div>
                          {limit.mode === "admin" && (
                            <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-amber-300/80 sm:grid-cols-3">
                              {limit.adminRequestsPerHour != null && (
                                <span>Admin req/hr: {limit.adminRequestsPerHour}</span>
                              )}
                              {limit.adminRequestsPerDay != null && (
                                <span>Admin req/day: {limit.adminRequestsPerDay}</span>
                              )}
                              {limit.adminRequestsPerMonth != null && (
                                <span>Admin req/mo: {limit.adminRequestsPerMonth}</span>
                              )}
                              {limit.adminTokensPerMonth != null && (
                                <span>Admin tok/mo: {(limit.adminTokensPerMonth / 1000).toFixed(0)}K</span>
                              )}
                            </div>
                          )}
                        </div>
                        <AnimatedButton
                          variant="danger"
                          className="px-2 py-1 text-xs"
                          onClick={() => deleteLimitMut.mutate({ id: limit.id })}
                        >
                          <Trash2 className="h-3 w-3" />
                        </AnimatedButton>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-muted">
                  No rate limit records. Limits are created automatically on first AI usage, or add them manually.
                </p>
              )}
            </GlassCard>

            {/* Add limit form */}
            {showForm && (
              <GlassCard className="space-y-4">
                <h4 className="text-sm font-semibold">New Rate Limit</h4>
                <div className="grid gap-3 md:grid-cols-2">
                  <TextField label="Owner address" value={formOwner} onChange={setFormOwner} />
                  <SelectField
                    label="Mode"
                    value={formMode}
                    onChange={(v) => setFormMode(v as "platform" | "admin")}
                    options={["platform", "admin"]}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <TextField label="Requests/month" value={formReqPerMonth} onChange={setFormReqPerMonth} />
                  <TextField label="Tokens/month" value={formTokPerMonth} onChange={setFormTokPerMonth} />
                  <TextField label="Max requests/hour" value={formReqPerHour} onChange={setFormReqPerHour} />
                </div>
                {formMode === "admin" && (
                  <div className="grid gap-3 md:grid-cols-3">
                    <TextField label="Admin req/day" value={formAdminReqPerDay} onChange={setFormAdminReqPerDay} />
                    <TextField
                      label="Admin req/month"
                      value={formAdminReqPerMonth}
                      onChange={setFormAdminReqPerMonth}
                    />
                    <TextField
                      label="Admin tok/month"
                      value={formAdminTokPerMonth}
                      onChange={setFormAdminTokPerMonth}
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  <AnimatedButton
                    className="px-4 py-2"
                    disabled={setLimitMut.isPending || !formOwner}
                    onClick={() =>
                      setLimitMut.mutate({
                        ownerAddress: formOwner,
                        mode: formMode,
                        requestsPerMonth: parseInt(formReqPerMonth) || 500,
                        tokensPerMonth: parseInt(formTokPerMonth) || 1000000,
                        maxRequestsPerHour: parseInt(formReqPerHour) || 30,
                        adminRequestsPerDay:
                          formMode === "admin" && formAdminReqPerDay ? parseInt(formAdminReqPerDay) : undefined,
                        adminRequestsPerMonth:
                          formMode === "admin" && formAdminReqPerMonth ? parseInt(formAdminReqPerMonth) : undefined,
                        adminTokensPerMonth:
                          formMode === "admin" && formAdminTokPerMonth ? parseInt(formAdminTokPerMonth) : undefined,
                      })
                    }
                  >
                    Create Limit
                  </AnimatedButton>
                  <AnimatedButton variant="secondary" className="px-4 py-2" onClick={() => setShowForm(false)}>
                    Cancel
                  </AnimatedButton>
                </div>
              </GlassCard>
            )}
          </div>
        )}

        {/* Usage tab */}
        {activeAiTab === "usage" && (
          <GlassCard className="space-y-4">
            <h4 className="text-sm font-semibold">Platform AI Usage</h4>
            {usage ? (
              <div className="grid gap-3 sm:grid-cols-4">
                <StatCard
                  label="Total Requests"
                  value={String(usage.totalRequests)}
                  icon={<Activity className="h-4 w-4" />}
                  tone="info"
                />
                <StatCard
                  label="Input Tokens"
                  value={formatTokens(usage.totalInputTokens)}
                  icon={<Brain className="h-4 w-4" />}
                  tone="muted"
                />
                <StatCard
                  label="Output Tokens"
                  value={formatTokens(usage.totalOutputTokens)}
                  icon={<Brain className="h-4 w-4" />}
                  tone="muted"
                />
                <StatCard
                  label="Total Cost"
                  value={`$${(usage.totalCostCents / 100).toFixed(2)}`}
                  icon={<CreditCard className="h-4 w-4" />}
                  tone="warning"
                />
              </div>
            ) : (
              <p className="py-4 text-center text-sm text-muted">No AI usage data available.</p>
            )}
          </GlassCard>
        )}
      </div>
    </FadeIn>
  );
}

// ── Security Section ──

function SecuritySection(_props: { status?: OperatorStatus | null }) {
  return (
    <FadeIn>
      <div className="space-y-6">
        <GlassCard className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Security & Encryption</h3>
            <p className="mt-1 text-sm text-muted">
              Encryption configuration, forensic evidence settings, and vault status.
            </p>
          </div>

          <div className="space-y-3">
            <SystemRow label="Encryption at Rest" value="AES-256-GCM" tone="success" />
            <SystemRow label="Master Key" value="Configured (server-side)" tone="success" />
            <SystemRow label="Document Key Wrapping" value="Per-document DEK wrapped by master KEK" tone="success" />
            <SystemRow label="Vault Architecture" value="Zero-knowledge — DEK never leaves client" tone="success" />
          </div>
        </GlassCard>

        <GlassCard className="space-y-4">
          <h4 className="text-sm font-semibold">Forensic Evidence Collection</h4>
          <p className="text-xs text-muted">
            Court-admissible evidence captured during signing: device fingerprint, geolocation, behavioral biometrics.
          </p>
          <div className="space-y-3">
            <SystemRow label="Device Fingerprinting" value="Active" tone="success" />
            <SystemRow label="IP Geolocation" value="Active" tone="success" />
            <SystemRow label="Behavioral Biometrics" value="Active (timing, movement patterns)" tone="success" />
            <SystemRow label="Evidence Hash" value="SHA-256 chain for tamper detection" tone="success" />
            <SystemRow label="User Agent Capture" value="Active" tone="success" />
          </div>
        </GlassCard>

        <GlassCard className="space-y-4">
          <h4 className="text-sm font-semibold">Audit Trail</h4>
          <p className="text-xs text-muted">
            Immutable, hash-chained audit event log. Each event includes SHA-256(prevHash + eventData) for tamper
            detection.
          </p>
          <div className="space-y-3">
            <SystemRow label="Hash Algorithm" value="SHA-256" tone="info" />
            <SystemRow label="Chain Integrity" value="Running hash chain (append-only)" tone="success" />
            <SystemRow label="Event Types" value="15 distinct event types" tone="info" />
            <SystemRow label="Actor Tracking" value="wallet | email | system" tone="info" />
          </div>
        </GlassCard>

        <GlassCard className="space-y-4">
          <h4 className="text-sm font-semibold">Identity Verification Levels</h4>
          <div className="space-y-2">
            <div className="bg-surface/30 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <StatusPill tone="muted" label="L0" />
                <p className="text-sm font-medium">Wallet Only</p>
              </div>
              <p className="mt-1 text-xs text-muted">Anonymous wallet-based signing.</p>
            </div>
            <div className="bg-surface/30 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <StatusPill tone="info" label="L1" />
                <p className="text-sm font-medium">Email Verification</p>
              </div>
              <p className="mt-1 text-xs text-muted">Email OTP verified identity.</p>
            </div>
            <div className="bg-surface/30 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <StatusPill tone="success" label="L2" />
                <p className="text-sm font-medium">Verified + Device Logs</p>
              </div>
              <p className="mt-1 text-xs text-muted">Email + IP/device forensic evidence.</p>
            </div>
            <div className="bg-surface/30 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <StatusPill tone="warning" label="L3" />
                <p className="text-sm font-medium">KYC</p>
              </div>
              <p className="mt-1 text-xs text-muted">Full KYC with third-party provider integration (extensible).</p>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="space-y-4">
          <h4 className="text-sm font-semibold">Proof Modes</h4>
          <div className="space-y-2">
            <div className="bg-surface/30 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <StatusPill tone="muted" label="PRIVATE" />
                <p className="text-sm font-medium">Web2 Only</p>
              </div>
              <p className="mt-1 text-xs text-muted">Email signing, off-chain audit trail. No blockchain.</p>
            </div>
            <div className="bg-surface/30 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <StatusPill tone="info" label="HYBRID" />
                <p className="text-sm font-medium">Web2 + Web3</p>
              </div>
              <p className="mt-1 text-xs text-muted">Email or wallet signing, hash anchored on-chain.</p>
            </div>
            <div className="bg-surface/30 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <StatusPill tone="success" label="CRYPTO NATIVE" />
                <p className="text-sm font-medium">Web3 Only</p>
              </div>
              <p className="mt-1 text-xs text-muted">Wallet signing, hash anchored, optional on-chain storage.</p>
            </div>
          </div>
        </GlassCard>
      </div>
    </FadeIn>
  );
}

// ── System Section (Enhanced) ──

function SystemSection({ status }: { status?: OperatorStatus | null }) {
  return (
    <FadeIn>
      <div className="space-y-6">
        <GlassCard className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">System Information</h3>
            <p className="mt-1 text-sm text-muted">Deployment configuration, runtime status, and environment.</p>
          </div>

          <div className="space-y-3">
            <SystemRow label="Deployment Mode" value={status?.deploymentMode ?? "unknown"} />
            <SystemRow label="PDF Upload Limit" value={status ? `${status.pdfUploadMaxMb} MB` : "—"} />
            <SystemRow
              label="Premium Runtime"
              value={status?.premiumRuntimeAvailable ? "Loaded" : "Not Available"}
              tone={status?.premiumRuntimeAvailable ? "success" : "muted"}
            />
            <SystemRow
              label="Owner Wallet"
              value={
                status?.ownerWallet
                  ? `${CHAIN_META[status.ownerWallet.chain].icon} ${status.ownerWallet.address}`
                  : "Not configured"
              }
              tone={status?.ownerConfigured ? "success" : "warning"}
            />
            <SystemRow
              label="Environment"
              value={
                typeof window !== "undefined" && window.location.hostname === "localhost" ? "Development" : "Production"
              }
            />
          </div>
        </GlassCard>

        <GlassCard className="space-y-3">
          <h4 className="text-sm font-semibold">Environment Variables</h4>
          <p className="text-xs text-muted">Server-side configuration. Sensitive values are masked.</p>
          <div className="space-y-2">
            <EnvRow label="PROOFMARK_DEPLOYMENT_MODE" value={status?.deploymentMode ?? "—"} />
            <EnvRow label="PDF_UPLOAD_MAX_MB" value={status ? `${status.pdfUploadMaxMb}` : "—"} />
            <EnvRow label="OWNER_ADDRESS" value={status?.ownerConfigured ? "Set" : "Not set"} />
            <EnvRow label="PROOFMARK_PREMIUM" value={status?.premiumRuntimeAvailable ? "1 (loaded)" : "0 (disabled)"} />
            <EnvRow label="ENCRYPTION_MASTER_KEY" value={status?.ownerConfigured ? "Set (masked)" : "Required"} />
            <EnvRow label="DATABASE_URL" value="Configured" />
          </div>
        </GlassCard>

        <GlassCard className="space-y-3">
          <h4 className="text-sm font-semibold">Database Tables</h4>
          <p className="text-xs text-muted">Core tables in the PostgreSQL schema.</p>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {[
              "documents",
              "signers",
              "sessions",
              "users",
              "accounts",
              "audit_events",
              "feature_overrides",
              "branding_profiles",
              "integration_configs",
              "document_templates",
              "webhook_endpoints",
              "ai_provider_configs",
              "ai_usage_logs",
              "ai_rate_limits",
              "ai_conversations",
              "connector_sessions",
              "user_vaults",
              "managed_wallets",
              "document_key_shares",
              "document_index",
            ].map((table) => (
              <div key={table} className="bg-surface/20 flex items-center gap-2 rounded-lg px-3 py-2">
                <Database className="h-3 w-3 text-muted" />
                <span className="font-mono text-xs text-secondary">{table}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="space-y-3">
          <h4 className="text-sm font-semibold">Supported Chains</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["ETH", "SOL", "BTC"] as const).map((chain) => (
              <div key={chain} className="bg-surface/30 flex items-center gap-3 rounded-lg border border-border p-3">
                <span className="text-xl">{CHAIN_META[chain].icon}</span>
                <div>
                  <p className="text-sm font-medium">{CHAIN_META[chain].label}</p>
                  <p className="text-xs text-muted">{chain}</p>
                </div>
              </div>
            ))}
            <div className="bg-surface/30 flex items-center gap-3 rounded-lg border border-border p-3">
              <span className="text-xl">B</span>
              <div>
                <p className="text-sm font-medium">Base (L2)</p>
                <p className="text-xs text-muted">BASE</p>
              </div>
            </div>
          </div>
        </GlassCard>
      </div>
    </FadeIn>
  );
}

// ── Premium Section ──

function PremiumSection({ status }: { status?: OperatorStatus | null }) {
  const premiumFeatures = status?.featureStates.filter((f) => !f.oss) ?? [];
  const enabledCount = premiumFeatures.filter((f) => f.effectiveEnabled).length;

  return (
    <FadeIn>
      <div className="space-y-6">
        <GlassCard className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Premium Configuration</h3>
            <p className="mt-1 text-sm text-muted">
              Premium runtime status and configuration for blockchain anchoring, collaboration, and AI enterprise
              features.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Premium Runtime"
              value={status?.premiumRuntimeAvailable ? "Active" : "Inactive"}
              icon={<Crown className="h-4 w-4" />}
              tone={status?.premiumRuntimeAvailable ? "success" : "danger"}
            />
            <StatCard
              label="Premium Features"
              value={`${enabledCount} / ${premiumFeatures.length}`}
              icon={<Sparkles className="h-4 w-4" />}
              tone={enabledCount > 0 ? "success" : "muted"}
            />
            <StatCard
              label="Deployment"
              value={status?.deploymentMode === "premium" ? "Premium" : "OSS"}
              icon={<Server className="h-4 w-4" />}
              tone={status?.deploymentMode === "premium" ? "success" : "muted"}
            />
          </div>
        </GlassCard>

        {/* Blockchain Anchoring */}
        <GlassCard className="space-y-4">
          <h4 className="text-sm font-semibold">Blockchain Anchoring</h4>
          <p className="text-xs text-muted">
            Write document hashes to Base (L2), Solana, and Bitcoin for cryptographic proof of signature timing.
          </p>
          <div className="space-y-2">
            {(
              [
                {
                  key: "base",
                  label: "Base (L2)",
                  icon: "B",
                  featureId: "blockchain_anchoring",
                  sub: "Hash Anchoring",
                },
                {
                  key: "sol",
                  label: "Solana",
                  icon: CHAIN_META.SOL.icon,
                  featureId: "blockchain_anchoring",
                  sub: "Hash Anchoring",
                },
                {
                  key: "btc",
                  label: "Bitcoin",
                  icon: CHAIN_META.BTC.icon,
                  featureId: "html_inscriptions",
                  sub: "HTML Inscriptions",
                },
              ] as const
            ).map((chain) => {
              const feat = premiumFeatures.find((f) => f.id === chain.featureId);
              return (
                <div
                  key={chain.key}
                  className="bg-surface/30 flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{chain.icon}</span>
                    <div>
                      <p className="text-sm font-medium">{chain.label}</p>
                      <p className="text-xs text-muted">{chain.sub}</p>
                    </div>
                  </div>
                  <StatusPill
                    tone={feat?.effectiveEnabled ? "success" : "danger"}
                    label={feat?.effectiveEnabled ? "Enabled" : "Disabled"}
                  />
                </div>
              );
            })}
          </div>
        </GlassCard>

        {/* Collaboration */}
        <GlassCard className="space-y-4">
          <h4 className="text-sm font-semibold">Collaboration Layer</h4>
          <p className="text-xs text-muted">
            Real-time collaborative workspaces with CRDT co-editing, WebSocket sidecar, and shared AI conversations.
          </p>
          <div className="space-y-2">
            {premiumFeatures
              .filter((f) => f.id.startsWith("collab_"))
              .map((f) => (
                <div
                  key={f.id}
                  className="bg-surface/30 flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{f.label}</p>
                    <p className="text-xs text-muted">{f.summary}</p>
                  </div>
                  <StatusPill
                    tone={f.effectiveEnabled ? "success" : "danger"}
                    label={f.effectiveEnabled ? "On" : "Off"}
                  />
                </div>
              ))}
          </div>
        </GlassCard>

        {/* AI Enterprise */}
        <GlassCard className="space-y-4">
          <h4 className="text-sm font-semibold">AI Features</h4>
          <p className="text-xs text-muted">
            AI-powered features including smart scraper, editor assistant, signer Q&A, BYOK, and enterprise sharing.
          </p>
          <div className="space-y-2">
            {premiumFeatures
              .filter((f) => f.id.startsWith("ai_"))
              .map((f) => (
                <div
                  key={f.id}
                  className="bg-surface/30 flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{f.label}</p>
                    <p className="text-xs text-muted">{f.summary}</p>
                  </div>
                  <StatusPill
                    tone={f.effectiveEnabled ? "success" : "danger"}
                    label={f.effectiveEnabled ? "On" : "Off"}
                  />
                </div>
              ))}
          </div>
        </GlassCard>

        {/* Enterprise Features */}
        <GlassCard className="space-y-4">
          <h4 className="text-sm font-semibold">Enterprise Features</h4>
          <div className="space-y-2">
            {premiumFeatures
              .filter(
                (f) =>
                  !f.id.startsWith("collab_") &&
                  !f.id.startsWith("ai_") &&
                  f.id !== "blockchain_anchoring" &&
                  f.id !== "html_inscriptions" &&
                  f.id !== "auto_wallet" &&
                  f.id !== "post_sign_access",
              )
              .map((f) => (
                <div
                  key={f.id}
                  className="bg-surface/30 flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{f.label}</p>
                    <p className="text-xs text-muted">{f.summary}</p>
                  </div>
                  <StatusPill
                    tone={f.effectiveEnabled ? "success" : "danger"}
                    label={f.effectiveEnabled ? "On" : "Off"}
                  />
                </div>
              ))}
          </div>
        </GlassCard>

        {/* How to enable premium */}
        {!status?.premiumRuntimeAvailable && (
          <GlassCard className="space-y-3">
            <h4 className="text-sm font-semibold">Enable Premium</h4>
            <p className="text-xs text-muted">
              To enable premium features, ensure the{" "}
              <code className="bg-surface/50 rounded px-1 py-0.5 font-mono text-xs">/premium</code> directory exists and
              run:
            </p>
            <div className="bg-surface/20 rounded-lg p-3 font-mono text-xs text-secondary">npm run paid</div>
            <p className="text-xs text-muted">For full premium with collaboration WebSocket server:</p>
            <div className="bg-surface/20 rounded-lg p-3 font-mono text-xs text-secondary">npm run paid:full</div>
          </GlassCard>
        )}
      </div>
    </FadeIn>
  );
}

// ── Shared UI Components ──

function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "success" | "warning" | "danger" | "info" | "muted";
}) {
  const toneClasses =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/5"
      : tone === "warning"
        ? "border-amber-400/20 bg-amber-400/5"
        : tone === "danger"
          ? "border-red-400/20 bg-red-400/5"
          : tone === "info"
            ? "border-sky-400/20 bg-sky-400/5"
            : "border-border bg-surface/30";

  return (
    <div className={`rounded-xl border p-4 ${toneClasses}`}>
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}

function TierCard({
  title,
  count,
  tone,
  items,
}: {
  title: string;
  count: number;
  tone: "success" | "info" | "warning";
  items: Array<{ id: string; label: string }>;
}) {
  const toneClass =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : tone === "info"
        ? "border-sky-400/20 bg-sky-400/10 text-sky-200"
        : "border-amber-400/20 bg-amber-400/10 text-amber-200";

  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <span className="border-current/20 rounded-full border px-1.5 py-0.5 text-[10px]">{count}</span>
      </div>
      <div className="mt-3 space-y-1.5 text-xs">
        {items.map((item) => (
          <p key={item.id}>{item.label}</p>
        ))}
      </div>
    </div>
  );
}

function SystemRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger" | "info" | "muted";
}) {
  const toneClass = tone
    ? tone === "success"
      ? "text-emerald-300"
      : tone === "warning"
        ? "text-amber-300"
        : tone === "danger"
          ? "text-red-300"
          : tone === "info"
            ? "text-sky-300"
            : "text-muted"
    : "text-secondary";

  return (
    <div className="bg-surface/30 flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <p className="text-sm text-muted">{label}</p>
      <p className={`text-sm font-medium ${toneClass}`}>{value}</p>
    </div>
  );
}

function EnvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface/20 flex items-center justify-between rounded-lg px-3 py-2 font-mono text-xs">
      <span className="text-muted">{label}</span>
      <span className="text-secondary">{value}</span>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "warning" | "danger" | "info" | "muted" }) {
  const className =
    tone === "success"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : tone === "warning"
        ? "border-amber-400/20 bg-amber-400/10 text-amber-200"
        : tone === "danger"
          ? "border-red-400/20 bg-red-400/10 text-red-200"
          : tone === "info"
            ? "border-sky-400/20 bg-sky-400/10 text-sky-200"
            : "border-border bg-surface/40 text-muted";

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${className}`}>{label}</span>
  );
}

function TextField({
  label,
  value,
  onChange,
  password = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  password?: boolean;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <input
        type={password ? "password" : "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-surface/50 w-full rounded-xl px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-accent"
      />
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="bg-surface/50 w-full rounded-xl px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-accent"
      />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <div className="bg-surface/50 flex items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-border focus-within:ring-accent">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-10 rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="flex-1 bg-transparent text-sm outline-none"
        />
      </div>
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-surface/50 w-full rounded-xl px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-accent"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
