"use client";

import { useMemo, useRef, useState } from "react";
import { useConnectedIdentity } from "~/components/hooks/use-connected-identity";
import { FadeIn, GlassCard, W3SButton } from "~/components/ui/motion";
import type { WalletChain } from "~/lib/crypto/chains";
import { trpc } from "~/lib/platform/trpc";
import { OperatorConsole } from "./operator-console";
import { ColorField, TextareaField, TextField } from "./workspace-form-fields";
import { AddressSectionCard, SmsSectionCard, TemplatesSectionCard, WebhooksSectionCard } from "./workspace-sections";

type BrandingForm = {
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

type CollabCapabilitiesQuery = {
  data?: { available?: boolean };
};

type CollabSessionsQuery = {
  data?: unknown[];
};

type CollabSettingsApi = {
  capabilities: {
    useQuery: () => CollabCapabilitiesQuery;
  };
  list: {
    useQuery: (input: { status: "active" }, options: { enabled: boolean }) => CollabSessionsQuery;
  };
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

export type WorkspaceSection = "all" | "branding" | "integrations" | "webhooks" | "templates" | "collab";

/** Gate message shown when workspace is not ready. */
function useWorkspaceGate() {
  const identity = useConnectedIdentity();
  const statusQuery = trpc.account.operatorStatus.useQuery(undefined, {
    enabled: identity.isSignedIn,
  });
  const workspaceQuery = trpc.account.workspace.useQuery(undefined, {
    enabled: identity.isSignedIn,
  });

  const walletLinkMessage = statusQuery.error?.message ?? workspaceQuery.error?.message ?? "";
  const needsWalletLink = walletLinkMessage.toLowerCase().includes("link a wallet");

  if (!identity.isSignedIn) {
    const msg = identity.isLoading
      ? "Checking account access..."
      : "Sign in with email or wallet to manage workspace settings.";
    return { ready: false as const, message: msg };
  }
  if (statusQuery.isLoading || workspaceQuery.isLoading) {
    return { ready: false as const, message: "__loading__" };
  }
  if (needsWalletLink) {
    return {
      ready: false as const,
      message: "Link a wallet to this account before managing workspace settings.",
    };
  }
  if (statusQuery.error || workspaceQuery.error) {
    return {
      ready: false as const,
      message: statusQuery.error?.message ?? workspaceQuery.error?.message ?? "",
      isError: true,
    };
  }
  return {
    ready: true as const,
    statusQuery,
    workspaceQuery,
    identity,
  };
}

export function WorkspaceSettings({
  section = "all",
}: {
  section?: WorkspaceSection;
} = {}) {
  const gate = useWorkspaceGate();

  if (!gate.ready) {
    if (gate.message === "__loading__") {
      return (
        <FadeIn>
          <GlassCard className="p-8 text-center">
            <div className="border-accent/30 inline-block h-6 w-6 animate-spin rounded-full border-2 border-t-accent" />
            <p className="mt-3 text-sm text-muted">Loading workspace...</p>
          </GlassCard>
        </FadeIn>
      );
    }
    return (
      <FadeIn>
        <GlassCard className="p-8 text-center">
          <p className={"isError" in gate && gate.isError ? "text-sm text-red-300" : "text-muted"}>{gate.message}</p>
        </GlassCard>
      </FadeIn>
    );
  }

  return (
    <WorkspaceContent
      section={section}
      statusQuery={gate.statusQuery}
      workspaceQuery={gate.workspaceQuery}
      identity={gate.identity}
    />
  );
}

function WorkspaceContent({
  section,
  statusQuery,
  workspaceQuery,
  identity,
}: {
  section: WorkspaceSection;
  statusQuery: ReturnType<typeof trpc.account.operatorStatus.useQuery>;
  workspaceQuery: ReturnType<typeof trpc.account.workspace.useQuery>;
  identity: ReturnType<typeof useConnectedIdentity>;
}) {
  const utils = trpc.useUtils();
  const featuresQuery = trpc.account.featureCatalog.useQuery();
  const upsertBranding = trpc.account.upsertBranding.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });

  // Initialize branding from server data
  const hydratedRef = useRef(false);
  const wsData = workspaceQuery.data as
    | {
        branding?: Array<{
          name: string;
          settings: Record<string, string | undefined>;
        }>;
        integrations?: Array<{
          id: string;
          kind: string;
          label: string;
          provider: string;
          isDefault: boolean;
        }>;
        webhooks?: Array<{
          id: string;
          label: string;
          url: string;
          events: string[];
        }>;
        templates?: Array<{
          id: string;
          name: string;
          title: string;
          description?: string | null;
        }>;
      }
    | undefined;
  const serverProfile = wsData?.branding?.[0];
  const initialBranding = useMemo<BrandingForm>(() => {
    if (!serverProfile) return EMPTY_BRANDING;
    return {
      name: serverProfile.name,
      brandName: serverProfile.settings.brandName || "Proofmark",
      logoUrl: serverProfile.settings.logoUrl || "",
      primaryColor: serverProfile.settings.primaryColor || "#6366f1",
      accentColor: serverProfile.settings.accentColor || "#22c55e",
      emailFromName: serverProfile.settings.emailFromName || serverProfile.settings.brandName || "Proofmark",
      emailReplyTo: serverProfile.settings.emailReplyTo || "",
      emailFooter: serverProfile.settings.emailFooter || "",
      signingIntro: serverProfile.settings.signingIntro || "",
      emailIntro: serverProfile.settings.emailIntro || "",
    };
  }, [serverProfile]);
  const [branding, setBranding] = useState<BrandingForm>(EMPTY_BRANDING);
  if (serverProfile && !hydratedRef.current) {
    hydratedRef.current = true;
    setBranding(initialBranding);
  }

  const groupedFeatures = useMemo(() => {
    const catalog = featuresQuery.data ?? [];
    return {
      free: catalog.filter((feature) => feature.oss && !feature.byo),
      byo: catalog.filter((feature) => feature.oss && feature.byo),
      premium: catalog.filter((feature) => !feature.oss),
    };
  }, [featuresQuery.data]);

  const statusData = statusQuery.data as { currentWallet?: { address: string; chain: WalletChain } } | undefined;
  const currentWallet = statusData?.currentWallet ?? identity.currentWallet;
  const workspace = wsData;
  const all = section === "all";

  const saveBranding = () =>
    upsertBranding.mutate({
      name: branding.name,
      isDefault: true,
      settings: {
        brandName: branding.brandName,
        logoUrl: branding.logoUrl || undefined,
        primaryColor: branding.primaryColor,
        accentColor: branding.accentColor,
        emailFromName: branding.emailFromName,
        emailReplyTo: branding.emailReplyTo || undefined,
        emailFooter: branding.emailFooter || undefined,
        signingIntro: branding.signingIntro || undefined,
        emailIntro: branding.emailIntro || undefined,
      },
    });

  return (
    <div className="space-y-6">
      {all && currentWallet ? (
        <FadeIn>
          <OperatorConsole
            currentAddress={currentWallet.address}
            currentChain={currentWallet.chain as WalletChain} // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion
          />
        </FadeIn>
      ) : null}

      {all && (
        <FadeIn>
          <FeatureCatalogCard groupedFeatures={groupedFeatures} />
        </FadeIn>
      )}

      {(all || section === "branding") && (
        <FadeIn delay={0.06}>
          <BrandingCard
            branding={branding}
            setBranding={setBranding}
            isPending={upsertBranding.isPending}
            onSave={saveBranding}
          />
        </FadeIn>
      )}

      {(all || section === "integrations") && (
        <>
          <FadeIn delay={0.12}>
            <SmsSectionCard integrations={workspace?.integrations} />
          </FadeIn>
          <FadeIn delay={0.18}>
            <AddressSectionCard integrations={workspace?.integrations} />
          </FadeIn>
        </>
      )}

      {(all || section === "webhooks") && (
        <FadeIn delay={0.24}>
          <WebhooksSectionCard webhooks={workspace?.webhooks} />
        </FadeIn>
      )}

      {(all || section === "collab") && (
        <FadeIn delay={0.28}>
          <CollabSettingsCard />
        </FadeIn>
      )}

      {(all || section === "templates") && (
        <FadeIn delay={0.3}>
          <TemplatesSectionCard templates={workspace?.templates} />
        </FadeIn>
      )}
    </div>
  );
}

/* ── Branding Card ───────────────────────────────────────────── */

function BrandingCard({
  branding,
  setBranding,
  isPending,
  onSave,
}: {
  branding: BrandingForm;
  setBranding: React.Dispatch<React.SetStateAction<BrandingForm>>;
  isPending: boolean;
  onSave: () => void;
}) {
  const update = (field: keyof BrandingForm) => (value: string) =>
    setBranding((current) => ({ ...current, [field]: value }));

  return (
    <GlassCard className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Branding</h3>
        <p className="mt-1 text-sm text-muted">
          Apply a logo, colors, and sender identity across emails and signing flows.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Profile name" value={branding.name} onChange={update("name")} />
        <TextField label="Brand name" value={branding.brandName} onChange={update("brandName")} />
        <TextField label="Logo URL" value={branding.logoUrl} onChange={update("logoUrl")} />
        <TextField label="Reply-to email" value={branding.emailReplyTo} onChange={update("emailReplyTo")} />
        <ColorField label="Primary color" value={branding.primaryColor} onChange={update("primaryColor")} />
        <ColorField label="Accent color" value={branding.accentColor} onChange={update("accentColor")} />
        <TextField label="From name" value={branding.emailFromName} onChange={update("emailFromName")} />
        <TextField label="Signing intro" value={branding.signingIntro} onChange={update("signingIntro")} />
      </div>
      <TextareaField label="Email intro" value={branding.emailIntro} onChange={update("emailIntro")} />
      <TextareaField label="Email footer" value={branding.emailFooter} onChange={update("emailFooter")} />
      <W3SButton className="px-4 py-2" onClick={onSave} disabled={isPending}>
        Save Branding
      </W3SButton>
    </GlassCard>
  );
}

/* ── Feature Catalog Card ────────────────────────────────────── */

function FeatureCatalogCard({
  groupedFeatures,
}: {
  groupedFeatures: {
    free: Array<{ label: string }>;
    byo: Array<{ label: string }>;
    premium: Array<{ label: string }>;
  };
}) {
  return (
    <GlassCard className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold">Open-source by default</h3>
        <p className="mt-1 text-sm text-muted">
          Most features stay self-hostable, including the encrypted vault. Premium is reserved for blockchain-backed and
          other heavy managed services, not for locking the platform.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <FeatureColumn title="Free" items={groupedFeatures.free.map((item) => item.label)} tone="free" />
        <FeatureColumn title="Bring Your Own API" items={groupedFeatures.byo.map((item) => item.label)} tone="byo" />
        <FeatureColumn title="Premium App" items={groupedFeatures.premium.map((item) => item.label)} tone="premium" />
      </div>
    </GlassCard>
  );
}

/* ── Collab Settings Card ────────────────────────────────────── */

function CollabSettingsCard() {
  const collabApi = trpc.collab as CollabSettingsApi;
  const capabilities = collabApi.capabilities.useQuery();
  const available = capabilities.data?.available ?? false;
  const sessions = collabApi.list.useQuery({ status: "active" }, { enabled: available });
  const sessionCount = sessions.data?.length ?? 0;

  return (
    <GlassCard className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Collaboration</h3>
        <p className="mt-1 text-sm text-muted">
          Real-time co-editing with CRDT sync, shared AI conversations, and annotation tools.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div
          className={`rounded-xl border p-4 ${available ? "border-emerald-400/20 bg-emerald-400/10" : "border-zinc-700/30 bg-zinc-800/20"}`}
        >
          <p className="text-xs font-medium text-muted">Status</p>
          <p className={`mt-1 text-sm font-semibold ${available ? "text-emerald-300" : "text-zinc-400"}`}>
            {available ? "Available" : "Premium Required"}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-700/30 bg-zinc-800/20 p-4">
          <p className="text-xs font-medium text-muted">Active Sessions</p>
          <p className="mt-1 text-sm font-semibold">{sessionCount}</p>
        </div>
      </div>

      {available ? (
        <div className="rounded-lg bg-[var(--bg-surface)] p-4 text-sm text-secondary">
          <p className="text-xs font-medium text-muted">Configuration</p>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            <li>
              WebSocket server: Rust engine on port 9090 at{" "}
              <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono">/ws/collab/&#123;sessionId&#125;</code>
            </li>
            <li>CRDT: Yjs/Yrs with binary sync protocol</li>
            <li>Start sessions from the document editor via the Collab button</li>
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted">
          Run <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono">npm run paid</code> with the premium directory
          to enable collaboration features.
        </p>
      )}
    </GlassCard>
  );
}

/* ── Feature Column ──────────────────────────────────────────── */

function FeatureColumn({ title, items, tone }: { title: string; items: string[]; tone: "free" | "byo" | "premium" }) {
  const toneMap: Record<string, string> = {
    free: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    byo: "border-sky-400/20 bg-sky-400/10 text-sky-200",
    premium: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  };
  const toneClass = toneMap[tone];

  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <p className="text-sm font-semibold">{title}</p>
      <div className="mt-3 space-y-2 text-xs">
        {items.length ? items.map((item) => <p key={item}>{item}</p>) : <p>None</p>}
      </div>
    </div>
  );
}
