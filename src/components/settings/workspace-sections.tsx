"use client";

import { useState } from "react";
import { GlassCard, W3SButton } from "~/components/ui/motion";
import { trpc } from "~/lib/platform/trpc";
import { SelectField, TextareaField, TextField } from "./workspace-form-fields";

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

/* ── SMS provider fields per provider ────────────────────────── */

function SmsProviderFields({
  provider,
  accountSid,
  authToken,
  apiKey,
  apiSecret,
  onAccountSid,
  onAuthToken,
  onApiKey,
  onApiSecret,
}: {
  provider: string;
  accountSid: string;
  authToken: string;
  apiKey: string;
  apiSecret: string;
  onAccountSid: (v: string) => void;
  onAuthToken: (v: string) => void;
  onApiKey: (v: string) => void;
  onApiSecret: (v: string) => void;
}) {
  if (provider === "TWILIO") {
    return (
      <>
        <TextField label="Account SID" value={accountSid} onChange={onAccountSid} />
        <TextField label="Auth token" value={authToken} onChange={onAuthToken} password />
      </>
    );
  }
  if (provider === "VONAGE") {
    return (
      <>
        <TextField label="API key" value={apiKey} onChange={onApiKey} />
        <TextField label="API secret" value={apiSecret} onChange={onApiSecret} password />
      </>
    );
  }
  if (provider === "TELNYX") {
    return <TextField label="API key" value={apiKey} onChange={onApiKey} password />;
  }
  return null;
}

/* ── Integration entry list ──────────────────────────────────── */

function IntegrationEntryList({
  entries,
}: {
  entries: Array<{
    id: string;
    label: string;
    provider: string;
    isDefault: boolean;
  }>;
}) {
  if (!entries.length) return null;
  return (
    <div className="space-y-2">
      {entries.map((entry) => (
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
  );
}

/* ── SMS Section ─────────────────────────────────────────────── */

export function SmsSectionCard({
  integrations,
}: {
  integrations?: Array<{
    id: string;
    kind: string;
    label: string;
    provider: string;
    isDefault: boolean;
  }>;
}) {
  const utils = trpc.useUtils();
  const upsertIntegration = trpc.account.upsertIntegration.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });
  const [provider, setProvider] = useState("TWILIO");
  const [label, setLabel] = useState("Primary SMS");
  const [from, setFrom] = useState("");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  const smsEntries = (integrations ?? []).filter((e) => e.kind === "SMS");

  return (
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
          value={provider}
          onChange={setProvider}
          options={["TWILIO", "VONAGE", "TELNYX"]}
        />
        <TextField label="Label" value={label} onChange={setLabel} />
        <TextField label="From number / sender" value={from} onChange={setFrom} />
        <SmsProviderFields
          provider={provider}
          accountSid={accountSid}
          authToken={authToken}
          apiKey={apiKey}
          apiSecret={apiSecret}
          onAccountSid={setAccountSid}
          onAuthToken={setAuthToken}
          onApiKey={setApiKey}
          onApiSecret={setApiSecret}
        />
      </div>
      <W3SButton
        className="px-4 py-2"
        onClick={() =>
          upsertIntegration.mutate({
            kind: "SMS",
            provider,
            label,
            isDefault: true,
            config: {
              provider,
              enabled: true,
              from,
              accountSid: provider === "TWILIO" ? accountSid : undefined,
              authToken: provider === "TWILIO" ? authToken : undefined,
              apiKey: provider === "TWILIO" ? undefined : apiKey || undefined,
              apiSecret: provider === "VONAGE" ? apiSecret || undefined : undefined,
            },
          })
        }
        disabled={upsertIntegration.isPending || !from}
      >
        Save SMS Provider
      </W3SButton>
      <IntegrationEntryList entries={smsEntries} />
    </GlassCard>
  );
}

/* ── Address Section ─────────────────────────────────────────── */

export function AddressSectionCard({
  integrations,
}: {
  integrations?: Array<{
    id: string;
    kind: string;
    label: string;
    provider: string;
    isDefault: boolean;
  }>;
}) {
  const utils = trpc.useUtils();
  const upsertIntegration = trpc.account.upsertIntegration.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });
  const [provider, setProvider] = useState("MAPBOX");
  const [label, setLabel] = useState("Primary Address Search");
  const [apiKeyVal, setApiKeyVal] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [headers, setHeaders] = useState("");
  const [countryCodes, setCountryCodes] = useState("");

  const addressEntries = (integrations ?? []).filter((e) => e.kind === "ADDRESS");

  return (
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
          value={provider}
          onChange={setProvider}
          options={["MAPBOX", "GEOAPIFY", "CUSTOM"]}
        />
        <TextField label="Label" value={label} onChange={setLabel} />
        {provider !== "CUSTOM" ? (
          <TextField label="API key" value={apiKeyVal} onChange={setApiKeyVal} password />
        ) : (
          <TextField label="Endpoint" value={endpoint} onChange={setEndpoint} />
        )}
        <TextField label="Country codes" value={countryCodes} onChange={setCountryCodes} />
        {provider === "CUSTOM" && <TextareaField label="Custom headers (JSON)" value={headers} onChange={setHeaders} />}
      </div>
      <W3SButton
        className="px-4 py-2"
        onClick={() => {
          let parsedHeaders: Record<string, string> | undefined;
          if (provider === "CUSTOM" && headers.trim()) {
            try {
              parsedHeaders = JSON.parse(headers) as Record<string, string>;
            } catch {
              return;
            }
          }

          upsertIntegration.mutate({
            kind: "ADDRESS",
            provider,
            label,
            isDefault: true,
            config: {
              provider,
              enabled: true,
              apiKey: provider === "CUSTOM" ? undefined : apiKeyVal || undefined,
              endpoint: provider === "CUSTOM" ? endpoint || undefined : undefined,
              headers: parsedHeaders,
              metadata: countryCodes.trim() ? { countryCodes } : undefined,
            },
          });
        }}
        disabled={upsertIntegration.isPending || (provider === "CUSTOM" ? !endpoint : !apiKeyVal)}
      >
        Save Address Provider
      </W3SButton>
      <IntegrationEntryList entries={addressEntries} />
    </GlassCard>
  );
}

/* ── Webhooks Section ────────────────────────────────────────── */

export function WebhooksSectionCard({
  webhooks,
}: {
  webhooks?: Array<{
    id: string;
    label: string;
    url: string;
    events: string[];
  }>;
}) {
  const utils = trpc.useUtils();
  const upsertWebhook = trpc.account.upsertWebhook.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });
  const deleteWebhook = trpc.account.deleteWebhook.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [events, setEvents] = useState("DOCUMENT_COMPLETED,SIGNER_SIGNED,SIGNER_DECLINED");

  return (
    <GlassCard className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Webhooks</h3>
        <p className="mt-1 text-sm text-muted">
          Forward signed lifecycle events to your own systems with HMAC signatures.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Label" value={label} onChange={setLabel} />
        <TextField label="Webhook URL" value={url} onChange={setUrl} />
      </div>
      <TextField label="Shared secret" value={secret} onChange={setSecret} password />
      <TextareaField label="Events (comma separated)" value={events} onChange={setEvents} />
      <W3SButton
        className="px-4 py-2"
        onClick={() =>
          upsertWebhook.mutate({
            label,
            url,
            secret: secret || undefined,
            active: true,
            events: events
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          })
        }
        disabled={upsertWebhook.isPending || !label || !url}
      >
        Save Webhook
      </W3SButton>
      <div className="space-y-2">
        {(webhooks ?? []).map((hook) => (
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
  );
}

/* ── Branding Section ────────────────────────────────────────── */

export function BrandingSectionCard({
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
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const { ColorField } = require("./workspace-form-fields");
  return (
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
          onChange={(v: string) => setBranding((c: BrandingForm) => ({ ...c, name: v }))}
        />
        <TextField
          label="Brand name"
          value={branding.brandName}
          onChange={(v: string) => setBranding((c: BrandingForm) => ({ ...c, brandName: v }))}
        />
        <TextField
          label="Logo URL"
          value={branding.logoUrl}
          onChange={(v: string) => setBranding((c: BrandingForm) => ({ ...c, logoUrl: v }))}
        />
        <TextField
          label="Reply-to email"
          value={branding.emailReplyTo}
          onChange={(v: string) => setBranding((c: BrandingForm) => ({ ...c, emailReplyTo: v }))}
        />
        <ColorField
          label="Primary color"
          value={branding.primaryColor}
          onChange={(v: string) => setBranding((c: BrandingForm) => ({ ...c, primaryColor: v }))}
        />
        <ColorField
          label="Accent color"
          value={branding.accentColor}
          onChange={(v: string) => setBranding((c: BrandingForm) => ({ ...c, accentColor: v }))}
        />
        <TextField
          label="From name"
          value={branding.emailFromName}
          onChange={(v: string) => setBranding((c: BrandingForm) => ({ ...c, emailFromName: v }))}
        />
        <TextField
          label="Signing intro"
          value={branding.signingIntro}
          onChange={(v: string) => setBranding((c: BrandingForm) => ({ ...c, signingIntro: v }))}
        />
      </div>
      <TextareaField
        label="Email intro"
        value={branding.emailIntro}
        onChange={(v: string) => setBranding((c: BrandingForm) => ({ ...c, emailIntro: v }))}
      />
      <TextareaField
        label="Email footer"
        value={branding.emailFooter}
        onChange={(v: string) => setBranding((c: BrandingForm) => ({ ...c, emailFooter: v }))}
      />
      <W3SButton className="px-4 py-2" onClick={onSave} disabled={isPending}>
        Save Branding
      </W3SButton>
    </GlassCard>
  );
}

/* ── Templates Section ───────────────────────────────────────── */

export function TemplatesSectionCard({
  templates,
}: {
  templates?: Array<{
    id: string;
    name: string;
    title: string;
    description?: string | null;
  }>;
}) {
  const utils = trpc.useUtils();
  const deleteTemplate = trpc.account.deleteTemplate.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });

  return (
    <GlassCard className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Reusable Templates</h3>
        <p className="mt-1 text-sm text-muted">
          Save templates directly from the document editor, then reuse them when creating new packets.
        </p>
      </div>
      <div className="space-y-3">
        {templates?.length ? (
          templates.map((template) => (
            <div key={template.id} className="bg-surface/30 rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{template.name}</p>
                  <p className="text-sm text-muted">{template.title}</p>
                  {template.description ? <p className="mt-1 text-xs text-muted">{template.description}</p> : null}
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
  );
}
