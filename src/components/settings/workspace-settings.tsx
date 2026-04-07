"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import { trpc } from "~/lib/platform/trpc";
import { FadeIn, GlassCard, W3SButton } from "~/components/ui/motion";
import { CHAIN_META, addressPreview, type WalletChain } from "~/lib/crypto/chains";
import { useConnectedIdentity } from "~/components/hooks/use-connected-identity";

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

export function WorkspaceSettings({ section = "all" }: { section?: WorkspaceSection } = {}) {
  const utils = trpc.useUtils();
  const identity = useConnectedIdentity();
  const statusQuery = trpc.account.operatorStatus.useQuery(undefined, { enabled: identity.isSignedIn });
  const workspaceQuery = trpc.account.workspace.useQuery(undefined, { enabled: identity.isSignedIn });
  const featuresQuery = trpc.account.featureCatalog.useQuery();

  const upsertBranding = trpc.account.upsertBranding.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });
  const upsertIntegration = trpc.account.upsertIntegration.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });
  const upsertWebhook = trpc.account.upsertWebhook.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });
  const deleteTemplate = trpc.account.deleteTemplate.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });
  const deleteWebhook = trpc.account.deleteWebhook.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });

  // Initialize branding from server data (replaces useEffect hydration)
  const hydratedRef = useRef(false);
  const serverProfile = workspaceQuery.data?.branding[0];
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
  const [smsProvider, setSmsProvider] = useState("TWILIO");
  const [smsLabel, setSmsLabel] = useState("Primary SMS");
  const [smsFrom, setSmsFrom] = useState("");
  const [smsAccountSid, setSmsAccountSid] = useState("");
  const [smsAuthToken, setSmsAuthToken] = useState("");
  const [smsApiKey, setSmsApiKey] = useState("");
  const [smsApiSecret, setSmsApiSecret] = useState("");
  const [addressProvider, setAddressProvider] = useState("MAPBOX");
  const [addressLabel, setAddressLabel] = useState("Primary Address Search");
  const [addressApiKey, setAddressApiKey] = useState("");
  const [addressEndpoint, setAddressEndpoint] = useState("");
  const [addressHeaders, setAddressHeaders] = useState("");
  const [addressCountryCodes, setAddressCountryCodes] = useState("");
  const [webhookLabel, setWebhookLabel] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookEvents, setWebhookEvents] = useState("DOCUMENT_COMPLETED,SIGNER_SIGNED,SIGNER_DECLINED");

  const groupedFeatures = useMemo(() => {
    const catalog = featuresQuery.data ?? [];
    return {
      free: catalog.filter((feature) => feature.oss && !feature.byo),
      byo: catalog.filter((feature) => feature.oss && feature.byo),
      premium: catalog.filter((feature) => !feature.oss),
    };
  }, [featuresQuery.data]);

  const currentWallet = statusQuery.data?.currentWallet ?? identity.currentWallet;
  const walletLinkMessage = statusQuery.error?.message ?? workspaceQuery.error?.message ?? "";
  const needsWalletLink = walletLinkMessage.toLowerCase().includes("link a wallet");

  if (!identity.isSignedIn) {
    return (
      <FadeIn>
        <GlassCard className="p-8 text-center">
          <p className="text-muted">
            {identity.isLoading
              ? "Checking account access..."
              : "Sign in with email or wallet to manage workspace settings."}
          </p>
        </GlassCard>
      </FadeIn>
    );
  }

  if (statusQuery.isLoading || workspaceQuery.isLoading) {
    return (
      <FadeIn>
        <GlassCard className="p-8 text-center">
          <div className="border-accent/30 inline-block h-6 w-6 animate-spin rounded-full border-2 border-t-accent" />
          <p className="mt-3 text-sm text-muted">Loading workspace...</p>
        </GlassCard>
      </FadeIn>
    );
  }

  if (needsWalletLink) {
    return (
      <FadeIn>
        <GlassCard className="p-8 text-center">
          <p className="text-muted">Link a wallet to this account before managing workspace settings.</p>
        </GlassCard>
      </FadeIn>
    );
  }

  if (statusQuery.error || workspaceQuery.error) {
    return (
      <FadeIn>
        <GlassCard className="p-8 text-center">
          <p className="text-sm text-red-300">{statusQuery.error?.message ?? workspaceQuery.error?.message}</p>
        </GlassCard>
      </FadeIn>
    );
  }

  const workspace = workspaceQuery.data;

  const all = section === "all";

  return (
    <div className="space-y-6">
      {all && currentWallet ? (
        <FadeIn>
          <OperatorConsole currentAddress={currentWallet.address} currentChain={currentWallet.chain} />
        </FadeIn>
      ) : null}

      {all && (
        <FadeIn>
          <GlassCard className="space-y-3">
            <div>
              <h3 className="text-lg font-semibold">Open-source by default</h3>
              <p className="mt-1 text-sm text-muted">
                Most features stay self-hostable, including the encrypted vault. Premium is reserved for
                blockchain-backed and other heavy managed services, not for locking the platform.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <FeatureColumn title="Free" items={groupedFeatures.free.map((item) => item.label)} tone="free" />
              <FeatureColumn
                title="Bring Your Own API"
                items={groupedFeatures.byo.map((item) => item.label)}
                tone="byo"
              />
              <FeatureColumn
                title="Premium App"
                items={groupedFeatures.premium.map((item) => item.label)}
                tone="premium"
              />
            </div>
          </GlassCard>
        </FadeIn>
      )}

      {(all || section === "branding") && (
        <FadeIn delay={0.06}>
          <GlassCard className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Branding</h3>
              <p className="mt-1 text-sm text-muted">
                Apply a logo, colors, and sender identity across emails and signing flows.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                label="Profile name"
                value={branding.name}
                onChange={(value) => setBranding((current) => ({ ...current, name: value }))}
              />
              <TextField
                label="Brand name"
                value={branding.brandName}
                onChange={(value) => setBranding((current) => ({ ...current, brandName: value }))}
              />
              <TextField
                label="Logo URL"
                value={branding.logoUrl}
                onChange={(value) => setBranding((current) => ({ ...current, logoUrl: value }))}
              />
              <TextField
                label="Reply-to email"
                value={branding.emailReplyTo}
                onChange={(value) => setBranding((current) => ({ ...current, emailReplyTo: value }))}
              />
              <ColorField
                label="Primary color"
                value={branding.primaryColor}
                onChange={(value) => setBranding((current) => ({ ...current, primaryColor: value }))}
              />
              <ColorField
                label="Accent color"
                value={branding.accentColor}
                onChange={(value) => setBranding((current) => ({ ...current, accentColor: value }))}
              />
              <TextField
                label="From name"
                value={branding.emailFromName}
                onChange={(value) => setBranding((current) => ({ ...current, emailFromName: value }))}
              />
              <TextField
                label="Signing intro"
                value={branding.signingIntro}
                onChange={(value) => setBranding((current) => ({ ...current, signingIntro: value }))}
              />
            </div>
            <TextareaField
              label="Email intro"
              value={branding.emailIntro}
              onChange={(value) => setBranding((current) => ({ ...current, emailIntro: value }))}
            />
            <TextareaField
              label="Email footer"
              value={branding.emailFooter}
              onChange={(value) => setBranding((current) => ({ ...current, emailFooter: value }))}
            />
            <W3SButton
              className="px-4 py-2"
              onClick={() =>
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
                })
              }
              disabled={upsertBranding.isPending}
            >
              Save Branding
            </W3SButton>
          </GlassCard>
        </FadeIn>
      )}

      {(all || section === "integrations") && (
        <>
          <FadeIn delay={0.12}>
            <GlassCard className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">SMS Provider</h3>
                <p className="mt-1 text-sm text-muted">
                  Bring your own Twilio, Vonage, or Telnyx account for SMS invites and reminders.
                </p>
              </div>
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
              <W3SButton
                className="px-4 py-2"
                onClick={() =>
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
                      apiKey: smsProvider === "TWILIO" ? undefined : smsApiKey || undefined,
                      apiSecret: smsProvider === "VONAGE" ? smsApiSecret || undefined : undefined,
                    },
                  })
                }
                disabled={upsertIntegration.isPending || !smsFrom}
              >
                Save SMS Provider
              </W3SButton>
              {workspace?.integrations.filter((entry) => entry.kind === "SMS").length ? (
                <div className="space-y-2">
                  {workspace.integrations
                    .filter((entry) => entry.kind === "SMS")
                    .map((entry) => (
                      <div key={entry.id} className="bg-surface/30 rounded-xl border border-border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{entry.label}</p>
                            <p className="text-muted">
                              {entry.provider} · {entry.isDefault ? "Default" : "Secondary"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              ) : null}
            </GlassCard>
          </FadeIn>

          <FadeIn delay={0.18}>
            <GlassCard className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">Address Autocomplete</h3>
                <p className="mt-1 text-sm text-muted">
                  Bring your own geocoder for signer-side address suggestions and multi-field autofill.
                </p>
              </div>
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
                  <TextField label="Endpoint" value={addressEndpoint} onChange={setAddressEndpoint} />
                )}
                <TextField label="Country codes" value={addressCountryCodes} onChange={setAddressCountryCodes} />
                {addressProvider === "CUSTOM" && (
                  <TextareaField label="Custom headers (JSON)" value={addressHeaders} onChange={setAddressHeaders} />
                )}
              </div>
              <W3SButton
                className="px-4 py-2"
                onClick={() => {
                  let parsedHeaders: Record<string, string> | undefined;
                  if (addressProvider === "CUSTOM" && addressHeaders.trim()) {
                    try {
                      parsedHeaders = JSON.parse(addressHeaders) as Record<string, string>;
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
                      apiKey: addressProvider === "CUSTOM" ? undefined : addressApiKey || undefined,
                      endpoint: addressProvider === "CUSTOM" ? addressEndpoint || undefined : undefined,
                      headers: parsedHeaders,
                      metadata: addressCountryCodes.trim() ? { countryCodes: addressCountryCodes } : undefined,
                    },
                  });
                }}
                disabled={
                  upsertIntegration.isPending || (addressProvider === "CUSTOM" ? !addressEndpoint : !addressApiKey)
                }
              >
                Save Address Provider
              </W3SButton>
              {workspace?.integrations.filter((entry) => entry.kind === "ADDRESS").length ? (
                <div className="space-y-2">
                  {workspace.integrations
                    .filter((entry) => entry.kind === "ADDRESS")
                    .map((entry) => (
                      <div key={entry.id} className="bg-surface/30 rounded-xl border border-border p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">{entry.label}</p>
                            <p className="text-muted">
                              {entry.provider} · {entry.isDefault ? "Default" : "Secondary"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              ) : null}
            </GlassCard>
          </FadeIn>
        </>
      )}

      {(all || section === "webhooks") && (
        <FadeIn delay={0.24}>
          <GlassCard className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Webhooks</h3>
              <p className="mt-1 text-sm text-muted">
                Forward signed lifecycle events to your own systems with HMAC signatures.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField label="Label" value={webhookLabel} onChange={setWebhookLabel} />
              <TextField label="Webhook URL" value={webhookUrl} onChange={setWebhookUrl} />
            </div>
            <TextField label="Shared secret" value={webhookSecret} onChange={setWebhookSecret} password />
            <TextareaField label="Events (comma separated)" value={webhookEvents} onChange={setWebhookEvents} />
            <W3SButton
              className="px-4 py-2"
              onClick={() =>
                upsertWebhook.mutate({
                  label: webhookLabel,
                  url: webhookUrl,
                  secret: webhookSecret || undefined,
                  active: true,
                  events: webhookEvents
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                })
              }
              disabled={upsertWebhook.isPending || !webhookLabel || !webhookUrl}
            >
              Save Webhook
            </W3SButton>
            <div className="space-y-2">
              {workspace?.webhooks.map((hook) => (
                <div key={hook.id} className="bg-surface/30 rounded-xl border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{hook.label}</p>
                      <p className="text-sm text-muted">{hook.url}</p>
                      <p className="mt-1 text-xs text-muted">{hook.events.join(", ") || "All events"}</p>
                    </div>
                    <W3SButton
                      variant="danger"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => deleteWebhook.mutate({ id: hook.id })}
                    >
                      Remove
                    </W3SButton>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </FadeIn>
      )}

      {(all || section === "collab") && (
        <FadeIn delay={0.28}>
          <CollabSettingsCard />
        </FadeIn>
      )}

      {(all || section === "templates") && (
        <FadeIn delay={0.3}>
          <GlassCard className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">Reusable Templates</h3>
              <p className="mt-1 text-sm text-muted">
                Save templates directly from the document editor, then reuse them when creating new packets.
              </p>
            </div>
            <div className="space-y-3">
              {workspace?.templates.length ? (
                workspace.templates.map((template) => (
                  <div key={template.id} className="bg-surface/30 rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{template.name}</p>
                        <p className="text-sm text-muted">{template.title}</p>
                        {template.description ? (
                          <p className="mt-1 text-xs text-muted">{template.description}</p>
                        ) : null}
                      </div>
                      <W3SButton
                        variant="danger"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => deleteTemplate.mutate({ id: template.id })}
                      >
                        Delete
                      </W3SButton>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted">No saved templates yet.</p>
              )}
            </div>
          </GlassCard>
        </FadeIn>
      )}
    </div>
  );
}

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

function FeatureColumn({ title, items, tone }: { title: string; items: string[]; tone: "free" | "byo" | "premium" }) {
  const toneClass =
    tone === "free"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
      : tone === "byo"
        ? "border-sky-400/20 bg-sky-400/10 text-sky-200"
        : "border-amber-400/20 bg-amber-400/10 text-amber-200";

  return (
    <div className={`rounded-xl border p-4 ${toneClass}`}>
      <p className="text-sm font-semibold">{title}</p>
      <div className="mt-3 space-y-2 text-xs">
        {items.length ? items.map((item) => <p key={item}>{item}</p>) : <p>None</p>}
      </div>
    </div>
  );
}

function OperatorConsole({ currentAddress, currentChain }: { currentAddress: string; currentChain: WalletChain }) {
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

  const canManageAny = !!statusQuery.data && (statusQuery.data.canManageSelf || statusQuery.data.canManageOthers);

  const featureAccessQuery = trpc.account.featureAccess.useQuery(
    { address: targetAddress, chain: targetChain },
    { enabled: canManageAny && !!targetAddress },
  );
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

  const premiumFeatures = featureAccessQuery.data?.featureStates.filter((feature) => !feature.oss) ?? [];
  const enabledPremiumCount = premiumFeatures.filter((feature) => feature.effectiveEnabled).length;

  const saveBatch = (
    overrides: Array<{ featureId: (typeof premiumFeatures)[number]["id"]; enabled: boolean | null }>,
  ) => {
    setOverrides.mutate({
      address: targetAddress,
      chain: targetChain,
      overrides,
    });
  };

  return (
    <GlassCard className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Operator Console</h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Premium runtime and wallet feature access are separate now. Use this panel to grant or suppress premium
            features for the wallet you are testing, and use the owner wallet for cross-user control.
          </p>
        </div>
        {statusQuery.data ? (
          <div className="flex flex-wrap gap-2 text-xs">
            <StatusPill
              tone={statusQuery.data.premiumRuntimeAvailable ? "success" : "danger"}
              label={`Runtime: ${statusQuery.data.premiumRuntimeAvailable ? "Premium Loaded" : "OSS Only"}`}
            />
            <StatusPill tone="info" label={`Mode: ${statusQuery.data.deploymentMode}`} />
            <StatusPill
              tone={statusQuery.data.ownerConfigured ? "success" : "warning"}
              label={statusQuery.data.ownerConfigured ? "Owner Wallet Configured" : "Owner Wallet Not Configured"}
            />
            {statusQuery.data.isOwner ? <StatusPill tone="success" label="Owner Wallet Active" /> : null}
          </div>
        ) : null}
      </div>

      {statusQuery.isLoading ? (
        <p className="text-sm text-muted">Loading operator status...</p>
      ) : statusQuery.data ? (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <StatusCard
              title="Current Wallet"
              value={`${CHAIN_META[currentChain].icon} ${addressPreview(currentAddress)}`}
              detail={CHAIN_META[currentChain].label}
            />
            <StatusCard
              title="Control Scope"
              value={statusQuery.data.canManageOthers ? "All wallets" : "Current wallet"}
              detail={
                statusQuery.data.canManageOthers
                  ? "Owner wallet can manage any known user."
                  : "Dev mode lets this wallet manage its own flags."
              }
            />
            <StatusCard
              title="Target Premium"
              value={featureAccessQuery.data ? `${enabledPremiumCount}/${premiumFeatures.length}` : "—"}
              detail={featureAccessQuery.data ? "Premium features enabled for selected wallet." : "Select a wallet."}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_220px]">
            <TextField label="Target wallet" value={targetAddress} onChange={setTargetAddress} />
            <SelectField
              label="Target chain"
              value={targetChain}
              onChange={(value) => setTargetChain(value as WalletChain)}
              options={["ETH", "BTC", "SOL"]}
            />
            <label className="space-y-1">
              <span className="text-xs uppercase tracking-wide text-muted">Active owner</span>
              <div className="bg-surface/30 flex min-h-[42px] items-center rounded-xl px-3 py-2 text-sm text-secondary ring-1 ring-border">
                {statusQuery.data.ownerWallet
                  ? `${CHAIN_META[statusQuery.data.ownerWallet.chain].icon} ${addressPreview(statusQuery.data.ownerWallet.address)}`
                  : "Not configured"}
              </div>
            </label>
          </div>

          {statusQuery.data.canManageOthers && knownWalletsQuery.data?.length ? (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted">Known wallets</p>
              <div className="flex flex-wrap gap-2">
                {knownWalletsQuery.data.slice(0, 10).map((wallet) => (
                  <button
                    key={`${wallet.chain}:${wallet.address}`}
                    type="button"
                    onClick={() => {
                      setTargetAddress(wallet.address);
                      setTargetChain(wallet.chain);
                    }}
                    className="bg-surface/30 hover:bg-surface/50 rounded-full border border-border px-3 py-1.5 text-xs text-secondary transition-colors"
                  >
                    {CHAIN_META[wallet.chain].icon} {addressPreview(wallet.address)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {featureAccessQuery.isLoading ? (
            <p className="text-sm text-muted">Loading feature access...</p>
          ) : featureAccessQuery.error ? (
            <p className="text-sm text-red-300">{featureAccessQuery.error.message}</p>
          ) : featureAccessQuery.data ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-medium">
                    Managing {CHAIN_META[featureAccessQuery.data.target.chain].label} wallet{" "}
                    <span className="text-secondary">{addressPreview(featureAccessQuery.data.target.address)}</span>
                  </p>
                  <p className="text-xs text-muted">
                    `Runtime: Premium Loaded` means code is available. Individual toggles decide whether this wallet can
                    use it.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <W3SButton
                    variant="primary"
                    className="px-3 py-1.5 text-xs"
                    disabled={setOverrides.isPending || !statusQuery.data.premiumRuntimeAvailable}
                    onClick={() =>
                      saveBatch(
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
                    disabled={setOverrides.isPending}
                    onClick={() =>
                      saveBatch(
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
                    disabled={setOverrides.isPending}
                    onClick={() =>
                      saveBatch(
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

              <div className="space-y-3">
                {premiumFeatures.map((feature) => (
                  <div key={feature.id} className="bg-surface/30 rounded-xl border border-border p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{feature.label}</p>
                          <StatusPill
                            tone={feature.effectiveEnabled ? "success" : "danger"}
                            label={feature.effectiveEnabled ? "Enabled" : "Disabled"}
                          />
                          <StatusPill
                            tone={
                              feature.source === "override_off"
                                ? "danger"
                                : feature.source === "override_on"
                                  ? "info"
                                  : feature.source === "premium_runtime"
                                    ? "warning"
                                    : "muted"
                            }
                            label={feature.source.replace(/_/g, " ")}
                          />
                        </div>
                        <p className="text-sm text-muted">{feature.summary}</p>
                      </div>
                      <W3SButton
                        variant={feature.effectiveEnabled ? "secondary" : "primary"}
                        className="px-3 py-2 text-xs"
                        disabled={setOverrides.isPending || (!feature.deploymentEnabled && !feature.oss)}
                        onClick={() =>
                          saveBatch([
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
                ))}
              </div>

              {setOverrides.error ? <p className="text-sm text-red-300">{setOverrides.error.message}</p> : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted">Operator controls are unavailable until wallet auth finishes.</p>
      )}
    </GlassCard>
  );
}

function StatusCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="bg-surface/30 rounded-xl border border-border p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-2 text-sm font-semibold text-primary">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
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
