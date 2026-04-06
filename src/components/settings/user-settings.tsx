"use client";

import { useRef, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { trpc } from "~/lib/trpc";
import { FadeIn, GlassCard, W3SButton } from "~/components/ui/motion";
import { CHAIN_META, addressPreview } from "~/lib/chains";
import { Select } from "~/components/ui/select";
import { useConnectedIdentity } from "~/components/hooks/use-connected-identity";
import { User, ToggleRight, Palette, Bot } from "lucide-react";

// Premium AI settings — dynamically loaded, absent in OSS builds
const AiProviderSettings = dynamic(
  () => import("../../../premium/components/ai/ai-provider-settings").then((m) => m.AiProviderSettings),
  { ssr: false, loading: () => <p className="p-4 text-xs text-muted">Loading AI settings...</p> },
);

type SettingsTab = "account" | "pdf" | "features" | "ai";

const TABS: { id: SettingsTab; label: string; icon: typeof User }[] = [
  { id: "account", label: "Account", icon: User },
  { id: "pdf", label: "PDF", icon: Palette },
  { id: "features", label: "Features", icon: ToggleRight },
  { id: "ai", label: "AI", icon: Bot },
];

export function UserSettings() {
  const identity = useConnectedIdentity();
  const statusQuery = trpc.account.operatorStatus.useQuery(undefined, { enabled: identity.isSignedIn });
  const currentWallet = statusQuery.data?.currentWallet ?? identity.currentWallet;

  const [activeTab, setActiveTab] = useState<SettingsTab>("account");

  const visibleTabs = TABS;

  const walletLinkMessage = statusQuery.error?.message ?? "";
  const needsWalletLink = walletLinkMessage.toLowerCase().includes("link a wallet");

  if (!identity.isSignedIn) {
    return (
      <FadeIn>
        <GlassCard className="p-6 text-center">
          <p className="text-[12px] text-muted">
            {identity.isLoading ? "Checking account access..." : "Sign in with email or wallet to manage settings."}
          </p>
        </GlassCard>
      </FadeIn>
    );
  }

  if (statusQuery.isLoading) {
    return (
      <FadeIn>
        <GlassCard className="p-6 text-center">
          <div className="inline-block h-4 w-4 animate-spin rounded-full border border-[var(--accent-30)] border-t-[var(--accent)]" />
          <p className="mt-2 text-[11px] text-muted">Loading settings...</p>
        </GlassCard>
      </FadeIn>
    );
  }

  if (needsWalletLink) {
    return (
      <FadeIn>
        <GlassCard className="p-6 text-center">
          <p className="text-[12px] text-muted">Link a wallet to this account before managing wallet-owned settings.</p>
        </GlassCard>
      </FadeIn>
    );
  }

  if (statusQuery.error) {
    return (
      <FadeIn>
        <GlassCard className="p-6 text-center">
          <p className="text-[12px] text-red-300">{statusQuery.error.message}</p>
        </GlassCard>
      </FadeIn>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Sidebar */}
      <div className="w-full shrink-0 lg:w-48">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-1">
          <nav className="space-y-px">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-[var(--bg-hover)] text-primary"
                      : "text-muted hover:bg-[var(--bg-hover)] hover:text-secondary"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1">{tab.label}</span>
                  {active && (
                    <motion.span
                      layoutId="settings-tab"
                      className="absolute bottom-1 left-0 top-1 w-px bg-[var(--accent)]"
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-4">
        {activeTab === "account" && currentWallet && (
          <AccountSection address={currentWallet.address} chain={currentWallet.chain} status={statusQuery.data} />
        )}
        {activeTab === "pdf" && <PdfSection />}
        {activeTab === "features" && currentWallet && (
          <FeaturesSection address={currentWallet.address} chain={currentWallet.chain} />
        )}
        {activeTab === "ai" && <AiProviderSettings />}
      </div>
    </div>
  );
}

function AccountSection({
  address,
  chain,
  status,
}: {
  address: string;
  chain: string;
  status?: {
    deploymentMode: string;
    premiumRuntimeAvailable: boolean;
    isOwner: boolean;
    canManageSelf: boolean;
    enabledPremiumCount: number;
    currentWallet?: { address: string; chain: string } | null;
  };
}) {
  const walletMeta = CHAIN_META[chain as keyof typeof CHAIN_META];

  return (
    <FadeIn>
      <GlassCard className="space-y-3">
        <div>
          <h3 className="text-[14px] font-semibold">Account</h3>
          <p className="mt-0.5 text-[11px] text-muted">Your wallet identity and deployment status.</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <InfoCard
            label="Wallet"
            value={`${walletMeta?.icon ?? "?"} ${addressPreview(address)}`}
            detail={walletMeta?.label ?? chain}
          />
          <InfoCard label="Full Address" value={address} detail="Your connected wallet address" mono />
          <InfoCard
            label="Deployment"
            value={status?.deploymentMode === "premium" ? "Premium" : "OSS"}
            detail={status?.premiumRuntimeAvailable ? "Premium runtime loaded" : "Open-source mode"}
          />
          <InfoCard
            label="Role"
            value={status?.isOwner ? "Owner" : "User"}
            detail={status?.isOwner ? "Full admin access" : "Standard user"}
          />
        </div>
      </GlassCard>
    </FadeIn>
  );
}

type FieldSummaryStyle = "hybrid" | "cards" | "table";

function buildPdfStyleSettings(themePreset: string, fieldSummaryStyle: FieldSummaryStyle) {
  return {
    themePreset,
    fieldSummaryStyle,
    fieldIndexEnabled: fieldSummaryStyle === "table",
    fieldIndexPerSigner: true,
    fieldIndexCombined: true,
  };
}

function PdfSection() {
  const utils = trpc.useUtils();
  const templatesQuery = trpc.account.listPdfStyleTemplates.useQuery();
  const createTemplate = trpc.account.createPdfStyleTemplate.useMutation({
    onSuccess: async () => {
      await utils.account.listPdfStyleTemplates.invalidate();
    },
  });
  const updateTemplate = trpc.account.updatePdfStyleTemplate.useMutation({
    onSuccess: async () => {
      await utils.account.listPdfStyleTemplates.invalidate();
    },
  });

  const defaultTemplate = (templatesQuery.data ?? []).find((template) => template.isDefault) ?? null;

  // Derive initial values from template data without useEffect
  const templateSyncKey = defaultTemplate
    ? `${defaultTemplate.id}:${String(defaultTemplate.updatedAt)}`
    : "builtin-default";
  const lastSyncRef = useRef<string | null>(null);

  const initialTheme = useMemo(() => {
    if (lastSyncRef.current === templateSyncKey) return null;
    lastSyncRef.current = templateSyncKey;
    return defaultTemplate?.settings.themePreset ?? "classic";
  }, [templateSyncKey, defaultTemplate]);

  const [themePreset, setThemePreset] = useState("classic");
  const [fieldSummaryStyle, setFieldSummaryStyle] = useState<FieldSummaryStyle>("hybrid");

  // Sync from server when data changes
  if (initialTheme !== null && initialTheme !== themePreset) {
    setThemePreset(initialTheme);
    const savedStyle = defaultTemplate?.settings.fieldSummaryStyle;
    setFieldSummaryStyle(
      savedStyle === "cards" || savedStyle === "table" || savedStyle === "hybrid" ? savedStyle : "hybrid",
    );
  }

  const saving = createTemplate.isPending || updateTemplate.isPending;

  const handleSave = () => {
    const settings = buildPdfStyleSettings(themePreset, fieldSummaryStyle);
    if (defaultTemplate) {
      updateTemplate.mutate({
        id: defaultTemplate.id,
        name: defaultTemplate.name,
        description: defaultTemplate.description ?? "Default PDF settings for newly created documents.",
        settings,
        isDefault: true,
      });
      return;
    }

    createTemplate.mutate({
      name: "Default PDF Style",
      description: "Default PDF settings for newly created documents.",
      settings,
      isDefault: true,
    });
  };

  return (
    <FadeIn>
      <GlassCard className="space-y-4">
        <div>
          <h3 className="text-[14px] font-semibold">PDF Defaults</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            Default PDF look for new documents. Override per document during creation.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            label="Theme"
            value={themePreset}
            onChange={setThemePreset}
            options={[
              { value: "classic", label: "Classic", description: "Clean Proofmark default" },
              { value: "modern", label: "Modern", description: "Blue accent, fuller chrome" },
              { value: "legal", label: "Legal", description: "Navy tone, denser legal styling" },
              { value: "minimal", label: "Minimal", description: "Reduced chrome, lighter framing" },
            ]}
          />
          <Select
            label="Completed Fields"
            value={fieldSummaryStyle}
            onChange={(value) => setFieldSummaryStyle(value as FieldSummaryStyle)}
            options={[
              { value: "hybrid", label: "Hybrid", description: "Cards with indexed context (Default)" },
              { value: "cards", label: "Cards", description: "Visual completed-field blocks" },
              { value: "table", label: "Table", description: "Compact index-style table" },
            ]}
          />
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-inset)] p-3">
          <p className="text-[12px] font-medium">Current behavior</p>
          <p className="mt-0.5 text-[10px] text-muted">
            {fieldSummaryStyle === "hybrid"
              ? "Hybrid format: cleaner cards with document-order context."
              : fieldSummaryStyle === "cards"
                ? "Graphical card list format."
                : "Compact table/index layout."}
          </p>
          <p className="mt-1 text-[9px] text-faint">
            {defaultTemplate
              ? `Updates template "${defaultTemplate.name}".`
              : "Creates a reusable default PDF style template."}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] text-muted">New documents inherit this style.</p>
          <W3SButton variant="primary" size="sm" loading={saving} onClick={handleSave}>
            Save Defaults
          </W3SButton>
        </div>
      </GlassCard>
    </FadeIn>
  );
}

function FeaturesSection({ address, chain }: { address: string; chain: string }) {
  const utils = trpc.useUtils();
  const featureAccessQuery = trpc.account.featureAccess.useQuery(
    { address, chain: chain as "ETH" | "SOL" | "BTC" },
    { enabled: !!address },
  );
  const statusQuery = trpc.account.operatorStatus.useQuery();
  const setOverrides = trpc.account.setFeatureOverrides.useMutation({
    onSuccess: () => {
      void utils.account.operatorStatus.invalidate();
      void utils.account.featureAccess.invalidate();
    },
  });

  const premiumFeatures = featureAccessQuery.data?.featureStates.filter((f) => !f.oss) ?? [];
  const ossFeatures = featureAccessQuery.data?.featureStates.filter((f) => f.oss) ?? [];
  const canManage = statusQuery.data?.canManageSelf || statusQuery.data?.canManageOthers;

  const toggleFeature = (featureId: string, currentlyEnabled: boolean) => {
    setOverrides.mutate({
      address,
      chain: chain as "ETH" | "SOL" | "BTC",
      overrides: [{ featureId: featureId as never, enabled: currentlyEnabled ? false : null }],
    });
  };

  return (
    <div className="space-y-4">
      <FadeIn>
        <GlassCard className="space-y-3">
          <div>
            <h3 className="text-[14px] font-semibold">Core Features</h3>
            <p className="mt-0.5 text-[11px] text-muted">Always available in every deployment.</p>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {ossFeatures.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-2 rounded-sm border border-[var(--success-15)] bg-[var(--success-subtle)] px-2.5 py-1.5 text-[11px]"
              >
                <span className="status-dot status-dot-success" />
                <span>{f.label}</span>
                {f.byo && (
                  <span className="bg-sky-400/8 ml-auto rounded-xs border border-sky-400/20 px-1 py-px text-[8px] text-sky-300">
                    BYO
                  </span>
                )}
              </div>
            ))}
          </div>
        </GlassCard>
      </FadeIn>

      <FadeIn delay={0.06}>
        <GlassCard className="space-y-3">
          <div>
            <h3 className="text-[14px] font-semibold">Premium Features</h3>
            <p className="mt-0.5 text-[11px] text-muted">
              {canManage ? "Features enabled by the administrator." : "Premium feature access for your wallet."}
            </p>
          </div>

          {featureAccessQuery.isLoading ? (
            <p className="text-[11px] text-muted">Loading...</p>
          ) : premiumFeatures.length === 0 ? (
            <p className="text-[11px] text-muted">No premium features available.</p>
          ) : (
            <div className="space-y-1.5">
              {premiumFeatures.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-inset)] p-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-[12px] font-medium">{f.label}</p>
                      <StatusPill
                        tone={f.effectiveEnabled ? "success" : "danger"}
                        label={f.effectiveEnabled ? "On" : "Off"}
                      />
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted">{f.summary}</p>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => toggleFeature(f.id, f.effectiveEnabled)}
                      disabled={setOverrides.isPending || (!f.deploymentEnabled && !f.oss)}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                        f.effectiveEnabled ? "bg-accent" : "bg-[var(--border)]"
                      } ${setOverrides.isPending ? "opacity-50" : ""}`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                          f.effectiveEnabled ? "translate-x-[18px]" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {setOverrides.error && <p className="text-[11px] text-[var(--danger)]">{setOverrides.error.message}</p>}
        </GlassCard>
      </FadeIn>
    </div>
  );
}

function InfoCard({ label, value, detail, mono }: { label: string; value: string; detail: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg-inset)] p-3">
      <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={`mt-1.5 text-[12px] font-medium text-primary ${mono ? "break-all font-mono text-[10px]" : ""}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[10px] text-muted">{detail}</p>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "warning" | "danger" | "info" | "muted" }) {
  const cls =
    tone === "success"
      ? "border-[var(--success-20)] bg-[var(--success-subtle)] text-[var(--success)]"
      : tone === "warning"
        ? "border-[var(--warning-20)] bg-[var(--warning-subtle)] text-[var(--warning)]"
        : tone === "danger"
          ? "border-[var(--danger-20)] bg-[var(--danger-subtle)] text-[var(--danger)]"
          : tone === "info"
            ? "border-sky-400/20 bg-sky-400/8 text-sky-300"
            : "border-[var(--border)] bg-[var(--bg-inset)] text-muted";

  return (
    <span className={`rounded-xs border px-1.5 py-px text-[8px] font-medium uppercase tracking-[0.1em] ${cls}`}>
      {label}
    </span>
  );
}
