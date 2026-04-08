"use client";

import { ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { AnimatedButton, FadeIn, GlassCard } from "~/components/ui/motion";
import { addressPreview, CHAIN_META, type WalletChain } from "~/lib/crypto/chains";
import { trpc } from "~/lib/platform/trpc";
import { StatusPill } from "./admin-shared-ui";

export function UsersSection({
  currentAddress,
  currentChain,
}: {
  currentAddress?: string | null;
  currentChain?: string | null;
}) {
  const utils = trpc.useUtils();
  const knownWalletsQuery = trpc.account.knownWallets.useQuery();
  const [selectedWallet, setSelectedWallet] = useState<{
    address: string;
    chain: WalletChain;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const featureAccessQuery = trpc.account.featureAccess.useQuery(
    {
      address: selectedWallet?.address ?? "",
      chain: selectedWallet?.chain,
    },
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
      overrides: [
        {
          featureId: featureId as never,
          enabled: currentlyEnabled ? false : null,
        },
      ],
    });
  };

  const batchOverride = (features: typeof premiumFeatures, enabled: boolean | null) => {
    if (!selectedWallet) return;
    setOverrides.mutate({
      address: selectedWallet.address,
      chain: selectedWallet.chain,
      overrides: features.map((f) => ({
        featureId: f.id as never,
        enabled,
      })),
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
          <WalletList
            wallets={filteredWallets}
            selectedWallet={selectedWallet}
            currentAddress={currentAddress}
            currentChain={currentChain}
            isLoading={knownWalletsQuery.isLoading}
            searchQuery={searchQuery}
            onSelect={setSelectedWallet}
          />
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
                  {CHAIN_META[selectedWallet.chain].label} &middot; {selectedWallet.address}
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
                {premiumFeatures.length > 0 && (
                  <FeatureList
                    title="Premium Features"
                    features={premiumFeatures}
                    onToggle={toggleFeature}
                    pending={setOverrides.isPending}
                  />
                )}
                {ossFeatures.length > 0 && (
                  <FeatureList
                    title="OSS Features"
                    features={ossFeatures}
                    onToggle={toggleFeature}
                    pending={setOverrides.isPending}
                  />
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

function FeatureList({
  title,
  features,
  onToggle,
  pending,
}: {
  title: string;
  features: Array<{
    id: string;
    label: string;
    summary: string;
    effectiveEnabled: boolean;
    source: string;
  }>;
  onToggle: (id: string, enabled: boolean) => void;
  pending: boolean;
}) {
  const sourceToneMap: Record<string, "danger" | "info" | "warning" | "muted"> = {
    override_off: "danger",
    override_on: "info",
    premium_runtime: "warning",
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      {features.map((f) => (
        <div
          key={f.id}
          className="bg-surface/30 flex items-center justify-between gap-3 rounded-xl border border-border p-3"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">{f.label}</p>
              <StatusPill tone={f.effectiveEnabled ? "success" : "danger"} label={f.effectiveEnabled ? "On" : "Off"} />
              <StatusPill tone={sourceToneMap[f.source] ?? "muted"} label={f.source.replace(/_/g, " ")} />
            </div>
            <p className="mt-0.5 text-xs text-muted">{f.summary}</p>
          </div>
          <AnimatedButton
            variant={f.effectiveEnabled ? "secondary" : "primary"}
            className="px-3 py-1.5 text-xs"
            disabled={pending}
            onClick={() => onToggle(f.id, f.effectiveEnabled)}
          >
            {f.effectiveEnabled ? "Turn Off" : "Turn On"}
          </AnimatedButton>
        </div>
      ))}
    </div>
  );
}

function WalletList({
  wallets,
  selectedWallet,
  currentAddress,
  currentChain,
  isLoading,
  searchQuery,
  onSelect,
}: {
  wallets: Array<{
    address: string;
    chain: WalletChain;
    lastSeenAt?: string | Date | null;
  }>;
  selectedWallet: { address: string; chain: WalletChain } | null;
  currentAddress?: string | null;
  currentChain?: string | null;
  isLoading: boolean;
  searchQuery: string;
  onSelect: (w: { address: string; chain: WalletChain }) => void;
}) {
  if (isLoading) {
    return (
      <div className="max-h-[400px] overflow-y-auto">
        <p className="py-4 text-center text-sm text-muted">Loading users...</p>
      </div>
    );
  }
  if (wallets.length === 0) {
    return (
      <div className="max-h-[400px] overflow-y-auto">
        <p className="py-4 text-center text-sm text-muted">
          {searchQuery ? "No wallets match your search." : "No known wallets yet."}
        </p>
      </div>
    );
  }
  return (
    <div className="max-h-[400px] space-y-1 overflow-y-auto">
      {wallets.map((wallet) => {
        const isSelected = selectedWallet?.address === wallet.address && selectedWallet?.chain === wallet.chain;
        const isCurrent = currentAddress === wallet.address && currentChain === wallet.chain;
        return (
          <button
            key={`${wallet.chain}:${wallet.address}`}
            type="button"
            onClick={() =>
              onSelect({
                address: wallet.address,
                chain: wallet.chain,
              })
            }
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
              isSelected ? "bg-accent/10 ring-accent/30 ring-1" : "hover:bg-[var(--bg-hover)]"
            }`}
          >
            <span className="text-lg">{CHAIN_META[wallet.chain].icon}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{wallet.address}</p>
              <p className="text-xs text-muted">
                {CHAIN_META[wallet.chain].label}
                {wallet.lastSeenAt && ` \u00B7 Last seen ${new Date(wallet.lastSeenAt).toLocaleDateString()}`}
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
      })}
    </div>
  );
}
