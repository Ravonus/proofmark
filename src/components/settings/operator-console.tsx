"use client";

import { useEffect, useState } from "react";
import { GlassCard, W3SButton } from "~/components/ui/motion";
import { addressPreview, CHAIN_META, type WalletChain } from "~/lib/crypto/chains";
import { trpc } from "~/lib/platform/trpc";
import { SelectField, StatusCard, StatusPill, TextField } from "./workspace-form-fields";

/* ── Premium feature row ─────────────────────────────────────── */

function PremiumFeatureRow({
  feature,
  isPending,
  premiumRuntimeAvailable: _premiumRuntimeAvailable,
  onSaveBatch,
}: {
  feature: {
    id: string;
    label: string;
    summary: string;
    effectiveEnabled: boolean;
    deploymentEnabled: boolean;
    oss: boolean;
    source: string;
  };
  isPending: boolean;
  premiumRuntimeAvailable: boolean;
  onSaveBatch: (overrides: Array<{ featureId: string; enabled: boolean | null }>) => void;
}) {
  const sourceTone =
    feature.source === "override_off"
      ? "danger"
      : feature.source === "override_on"
        ? "info"
        : feature.source === "premium_runtime"
          ? "warning"
          : "muted";

  return (
    <div className="bg-surface/30 rounded-xl border border-border p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{feature.label}</p>
            <StatusPill
              tone={feature.effectiveEnabled ? "success" : "danger"}
              label={feature.effectiveEnabled ? "Enabled" : "Disabled"}
            />
            <StatusPill
              tone={sourceTone as "success" | "warning" | "danger" | "info" | "muted"}
              label={feature.source.replace(/_/g, " ")}
            />
          </div>
          <p className="text-sm text-muted">{feature.summary}</p>
        </div>
        <W3SButton
          variant={feature.effectiveEnabled ? "secondary" : "primary"}
          className="px-3 py-2 text-xs"
          disabled={isPending || (!feature.deploymentEnabled && !feature.oss)}
          onClick={() =>
            onSaveBatch([
              {
                featureId: feature.id,
                enabled: feature.effectiveEnabled ? false : null,
              },
            ])
          }
        >
          {feature.effectiveEnabled ? "Turn Off" : feature.deploymentEnabled ? "Turn On" : "Runtime Off"}
        </W3SButton>
      </div>
    </div>
  );
}

/* ── Bulk actions bar ────────────────────────────────────────── */

function BulkActionsBar({
  premiumFeatures,
  isPending,
  premiumRuntimeAvailable,
  targetAddress,
  targetChain,
  onSaveBatch,
}: {
  premiumFeatures: Array<{ id: string }>;
  isPending: boolean;
  premiumRuntimeAvailable: boolean;
  targetAddress: string;
  targetChain: WalletChain;
  onSaveBatch: (overrides: Array<{ featureId: string; enabled: boolean | null }>) => void;
}) {
  const featureAccessQuery = trpc.account.featureAccess.useQuery(
    { address: targetAddress, chain: targetChain },
    { enabled: !!targetAddress },
  );

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-medium">
          Managing {featureAccessQuery.data ? `${CHAIN_META[featureAccessQuery.data.target.chain].label} wallet ` : ""}
          <span className="text-secondary">
            {featureAccessQuery.data ? addressPreview(featureAccessQuery.data.target.address) : ""}
          </span>
        </p>
        <p className="text-xs text-muted">
          `Runtime: Premium Loaded` means code is available. Individual toggles decide whether this wallet can use it.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <W3SButton
          variant="primary"
          className="px-3 py-1.5 text-xs"
          disabled={isPending || !premiumRuntimeAvailable}
          onClick={() =>
            onSaveBatch(
              premiumFeatures.map((feature) => ({
                featureId: feature.id,
                enabled: true,
              })),
            )
          }
        >
          Enable All Premium
        </W3SButton>
        <W3SButton
          variant="danger"
          className="px-3 py-1.5 text-xs"
          disabled={isPending}
          onClick={() =>
            onSaveBatch(
              premiumFeatures.map((feature) => ({
                featureId: feature.id,
                enabled: false,
              })),
            )
          }
        >
          Disable All Premium
        </W3SButton>
        <W3SButton
          variant="secondary"
          className="px-3 py-1.5 text-xs"
          disabled={isPending}
          onClick={() =>
            onSaveBatch(
              premiumFeatures.map((feature) => ({
                featureId: feature.id,
                enabled: null,
              })),
            )
          }
        >
          Clear Overrides
        </W3SButton>
      </div>
    </div>
  );
}

/* ── Known wallets picker ────────────────────────────────────── */

function KnownWalletsPicker({
  wallets,
  onSelect,
}: {
  wallets: Array<{ chain: WalletChain; address: string }>;
  onSelect: (address: string, chain: WalletChain) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-muted">Known wallets</p>
      <div className="flex flex-wrap gap-2">
        {wallets.slice(0, 10).map((wallet) => (
          <button
            key={`${wallet.chain}:${wallet.address}`}
            type="button"
            onClick={() => onSelect(wallet.address, wallet.chain)}
            className="bg-surface/30 hover:bg-surface/50 rounded-full border border-border px-3 py-1.5 text-xs text-secondary transition-colors"
          >
            {CHAIN_META[wallet.chain].icon} {addressPreview(wallet.address)}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Feature access panel ────────────────────────────────────── */

function FeatureAccessPanel({
  targetAddress,
  targetChain,
  statusData,
  setOverrides,
}: {
  targetAddress: string;
  targetChain: WalletChain;
  statusData: {
    premiumRuntimeAvailable: boolean;
    canManageSelf?: boolean;
    canManageOthers?: boolean;
  };
  setOverrides: {
    isPending: boolean;
    error: { message: string } | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutate: (...args: any[]) => void;
  };
}) {
  const canManageAny = statusData.canManageSelf || statusData.canManageOthers;
  const featureAccessQuery = trpc.account.featureAccess.useQuery(
    { address: targetAddress, chain: targetChain },
    { enabled: canManageAny && !!targetAddress },
  );

  const premiumFeatures = featureAccessQuery.data?.featureStates.filter((feature) => !feature.oss) ?? [];

  const saveBatch = (overrides: Array<{ featureId: string; enabled: boolean | null }>) => {
    setOverrides.mutate({
      address: targetAddress,
      chain: targetChain,
      overrides,
    });
  };

  if (featureAccessQuery.isLoading) {
    return <p className="text-sm text-muted">Loading feature access...</p>;
  }
  if (featureAccessQuery.error) {
    return <p className="text-sm text-red-300">{featureAccessQuery.error.message}</p>;
  }
  if (!featureAccessQuery.data) {
    return null;
  }

  return (
    <div className="space-y-4">
      <BulkActionsBar
        premiumFeatures={premiumFeatures}
        isPending={setOverrides.isPending}
        premiumRuntimeAvailable={statusData.premiumRuntimeAvailable}
        targetAddress={targetAddress}
        targetChain={targetChain}
        onSaveBatch={saveBatch}
      />

      <div className="space-y-3">
        {premiumFeatures.map((feature) => (
          <PremiumFeatureRow
            key={feature.id}
            feature={feature}
            isPending={setOverrides.isPending}
            premiumRuntimeAvailable={statusData.premiumRuntimeAvailable}
            onSaveBatch={saveBatch}
          />
        ))}
      </div>

      {setOverrides.error ? <p className="text-sm text-red-300">{setOverrides.error.message}</p> : null}
    </div>
  );
}

/* ── Main OperatorConsole component ──────────────────────────── */

export function OperatorConsole({
  currentAddress,
  currentChain,
}: {
  currentAddress: string;
  currentChain: WalletChain;
}) {
  const utils = trpc.useUtils();
  const statusQuery = trpc.account.operatorStatus.useQuery();
  const [targetAddress, setTargetAddress] = useState(currentAddress);
  const [targetChain, setTargetChain] = useState<WalletChain>(currentChain);

  useEffect(() => {
    if (!statusQuery.data?.canManageOthers) {
      setTargetAddress(currentAddress);
      setTargetChain(currentChain);
    }
  }, [currentAddress, currentChain, statusQuery.data?.canManageOthers]);

  const knownWalletsQuery = trpc.account.knownWallets.useQuery(undefined, {
    enabled: statusQuery.data?.canManageOthers ?? false,
  });

  const setOverrides = trpc.account.setFeatureOverrides.useMutation({
    onSuccess: () => {
      void utils.account.operatorStatus.invalidate();
      void utils.account.featureAccess.invalidate();
      void utils.account.knownWallets.invalidate();
    },
  });

  const canManageAny = !!statusQuery.data && (statusQuery.data.canManageSelf || statusQuery.data.canManageOthers);

  const featureAccessQuery = trpc.account.featureAccess.useQuery(
    { address: targetAddress, chain: targetChain },
    { enabled: canManageAny && !!targetAddress },
  );
  const premiumFeatures = featureAccessQuery.data?.featureStates.filter((feature) => !feature.oss) ?? [];
  const enabledPremiumCount = premiumFeatures.filter((feature) => feature.effectiveEnabled).length;

  return (
    <GlassCard className="space-y-4">
      <OperatorHeader
        statusData={statusQuery.data ?? null}
        currentAddress={currentAddress}
        currentChain={currentChain}
      />

      <OperatorBody
        statusQuery={statusQuery}
        currentAddress={currentAddress}
        currentChain={currentChain}
        targetAddress={targetAddress}
        targetChain={targetChain}
        setTargetAddress={setTargetAddress}
        setTargetChain={setTargetChain}
        knownWalletsQuery={knownWalletsQuery}
        featureAccessQuery={featureAccessQuery}
        premiumFeatures={premiumFeatures}
        enabledPremiumCount={enabledPremiumCount}
        setOverrides={setOverrides}
      />
    </GlassCard>
  );
}

/* ── Operator body (loaded state vs loading vs empty) ────────── */

function OperatorBody(props: {
  statusQuery: {
    isLoading: boolean;
    data:
      | {
          canManageSelf: boolean;
          canManageOthers: boolean;
          premiumRuntimeAvailable: boolean;
          ownerWallet?: { chain: WalletChain; address: string } | null;
        }
      | null
      | undefined;
  };
  currentAddress: string;
  currentChain: WalletChain;
  targetAddress: string;
  targetChain: WalletChain;
  setTargetAddress: (v: string) => void;
  setTargetChain: (v: WalletChain) => void;
  knownWalletsQuery: { data?: Array<{ chain: WalletChain; address: string }> };
  featureAccessQuery: { data?: { featureStates: Array<{ oss: boolean }> } };
  premiumFeatures: Array<{ id: string; effectiveEnabled: boolean }>;
  enabledPremiumCount: number;
  setOverrides: {
    isPending: boolean;
    error: { message: string } | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutate: (...args: any[]) => void;
  };
}) {
  const {
    statusQuery,
    currentAddress,
    currentChain,
    targetAddress,
    targetChain,
    setTargetAddress,
    setTargetChain,
    knownWalletsQuery,
    featureAccessQuery,
    premiumFeatures,
    enabledPremiumCount,
    setOverrides,
  } = props;

  if (statusQuery.isLoading) {
    return <p className="text-sm text-muted">Loading operator status...</p>;
  }

  if (!statusQuery.data) {
    return <p className="text-sm text-muted">Operator controls are unavailable until wallet auth finishes.</p>;
  }

  const data = statusQuery.data;

  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <StatusCard
          title="Current Wallet"
          value={`${CHAIN_META[currentChain].icon} ${addressPreview(currentAddress)}`}
          detail={CHAIN_META[currentChain].label}
        />
        <StatusCard
          title="Control Scope"
          value={data.canManageOthers ? "All wallets" : "Current wallet"}
          detail={
            data.canManageOthers
              ? "Owner wallet can manage any known user."
              : "Dev mode lets this wallet manage its own flags."
          }
        />
        <StatusCard
          title="Target Premium"
          value={featureAccessQuery.data ? `${enabledPremiumCount}/${premiumFeatures.length}` : "\u2014"}
          detail={featureAccessQuery.data ? "Premium features enabled for selected wallet." : "Select a wallet."}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px]">
        <TextField label="Target wallet" value={targetAddress} onChange={setTargetAddress} />
        <SelectField
          label="Target chain"
          value={targetChain}
          onChange={(value: string) => setTargetChain(value as WalletChain)}
          options={["ETH", "BTC", "SOL"]}
        />
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wide text-muted">Active owner</span>
          <div className="bg-surface/30 flex min-h-[42px] items-center rounded-xl px-3 py-2 text-sm text-secondary ring-1 ring-border">
            {data.ownerWallet
              ? `${CHAIN_META[data.ownerWallet.chain].icon} ${addressPreview(data.ownerWallet.address)}`
              : "Not configured"}
          </div>
        </label>
      </div>

      {data.canManageOthers && knownWalletsQuery.data?.length ? (
        <KnownWalletsPicker
          wallets={knownWalletsQuery.data}
          onSelect={(address: string, chain: WalletChain) => {
            setTargetAddress(address);
            setTargetChain(chain);
          }}
        />
      ) : null}

      <FeatureAccessPanel
        targetAddress={targetAddress}
        targetChain={targetChain}
        statusData={data}
        setOverrides={setOverrides}
      />
    </>
  );
}

/* ── Operator header with status pills ───────────────────────── */

function OperatorHeader({
  statusData,
  currentAddress: _currentAddress,
  currentChain: _currentChain,
}: {
  statusData: {
    premiumRuntimeAvailable: boolean;
    deploymentMode: string;
    ownerConfigured: boolean;
    isOwner: boolean;
  } | null;
  currentAddress: string;
  currentChain: WalletChain;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div>
        <h3 className="text-lg font-semibold">Operator Console</h3>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Premium runtime and wallet feature access are separate now. Use this panel to grant or suppress premium
          features for the wallet you are testing, and use the owner wallet for cross-user control.
        </p>
      </div>
      {statusData ? (
        <div className="flex flex-wrap gap-2 text-xs">
          <StatusPill
            tone={statusData.premiumRuntimeAvailable ? "success" : "danger"}
            label={`Runtime: ${statusData.premiumRuntimeAvailable ? "Premium Loaded" : "OSS Only"}`}
          />
          <StatusPill tone="info" label={`Mode: ${statusData.deploymentMode}`} />
          <StatusPill
            tone={statusData.ownerConfigured ? "success" : "warning"}
            label={statusData.ownerConfigured ? "Owner Wallet Configured" : "Owner Wallet Not Configured"}
          />
          {statusData.isOwner ? <StatusPill tone="success" label="Owner Wallet Active" /> : null}
        </div>
      ) : null}
    </div>
  );
}
