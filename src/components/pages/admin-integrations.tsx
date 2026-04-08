"use client";

import { CreditCard, Key, MapPin, MessageSquare } from "lucide-react";
import { useState } from "react";
import { AnimatedButton, GlassCard } from "~/components/ui/motion";
import { trpc } from "~/lib/platform/trpc";
import { IntegrationList, SelectField, TextareaField, TextField } from "./admin-shared-ui";

export function IntegrationsSection() {
  const utils = trpc.useUtils();
  const workspaceQuery = trpc.account.workspace.useQuery();
  const upsertIntegration = trpc.account.upsertIntegration.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });
  const deleteIntegration = trpc.account.deleteIntegration.useMutation({
    onSuccess: () => utils.account.workspace.invalidate(),
  });

  const integrations = workspaceQuery.data?.integrations ?? [];
  const [activeIntTab, setActiveIntTab] = useState<"sms" | "address" | "payment" | "sso">("sms");

  const intTabs = [
    {
      id: "sms" as const,
      label: "SMS",
      icon: MessageSquare,
      count: integrations.filter((i) => i.kind === "SMS").length,
    },
    {
      id: "address" as const,
      label: "Address",
      icon: MapPin,
      count: integrations.filter((i) => i.kind === "ADDRESS").length,
    },
    {
      id: "payment" as const,
      label: "Payments",
      icon: CreditCard,
      count: integrations.filter((i) => i.kind === "PAYMENT").length,
    },
    {
      id: "sso" as const,
      label: "SSO",
      icon: Key,
      count: integrations.filter((i) => i.kind === "SSO").length,
    },
  ];

  return (
    <div className="space-y-6">
      <GlassCard className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Integration Providers</h3>
          <p className="mt-1 text-sm text-muted">
            Configure your own API keys for SMS, address autocomplete, payments, and SSO. These are &quot;Bring Your
            Own&quot; integrations that work in both OSS and Premium.
          </p>
        </div>
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

      {activeIntTab === "sms" && (
        <SmsPanel
          integrations={integrations}
          upsertIntegration={upsertIntegration}
          deleteIntegration={deleteIntegration}
        />
      )}
      {activeIntTab === "address" && (
        <AddressPanel
          integrations={integrations}
          upsertIntegration={upsertIntegration}
          deleteIntegration={deleteIntegration}
        />
      )}
      {activeIntTab === "payment" && (
        <PaymentPanel
          integrations={integrations}
          upsertIntegration={upsertIntegration}
          deleteIntegration={deleteIntegration}
        />
      )}
      {activeIntTab === "sso" && (
        <SsoPanel
          integrations={integrations}
          upsertIntegration={upsertIntegration}
          deleteIntegration={deleteIntegration}
        />
      )}
    </div>
  );
}

type MutationProp = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutate: (input: any) => void;
  isPending: boolean;
};

function SmsPanel({
  integrations,
  upsertIntegration,
  deleteIntegration,
}: {
  integrations: Array<{
    id: string;
    kind: string;
    label: string;
    provider: string;
    isDefault: boolean;
    config: { enabled?: boolean };
  }>;
  upsertIntegration: MutationProp;
  deleteIntegration: MutationProp;
}) {
  const [provider, setProvider] = useState("TWILIO");
  const [label, setLabel] = useState("Primary SMS");
  const [from, setFrom] = useState("");
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  const smsItems = integrations.filter((i) => i.kind === "SMS");

  return (
    <GlassCard className="space-y-4">
      <h4 className="text-sm font-semibold">SMS Provider</h4>
      <p className="text-xs text-muted">Twilio, Vonage, or Telnyx for SMS invites and reminders.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <SelectField
          label="Provider"
          value={provider}
          onChange={setProvider}
          options={["TWILIO", "VONAGE", "TELNYX"]}
        />
        <TextField label="Label" value={label} onChange={setLabel} />
        <TextField label="From number / sender" value={from} onChange={setFrom} />
        {provider === "TWILIO" && (
          <>
            <TextField label="Account SID" value={accountSid} onChange={setAccountSid} />
            <TextField label="Auth token" value={authToken} onChange={setAuthToken} password />
          </>
        )}
        {provider === "VONAGE" && (
          <>
            <TextField label="API key" value={apiKey} onChange={setApiKey} />
            <TextField label="API secret" value={apiSecret} onChange={setApiSecret} password />
          </>
        )}
        {provider === "TELNYX" && <TextField label="API key" value={apiKey} onChange={setApiKey} password />}
      </div>
      <AnimatedButton
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
              apiKey: provider !== "TWILIO" ? apiKey || undefined : undefined,
              apiSecret: provider === "VONAGE" ? apiSecret || undefined : undefined,
            },
          })
        }
        disabled={upsertIntegration.isPending || !from}
      >
        Save SMS Provider
      </AnimatedButton>
      <IntegrationList items={smsItems} onDelete={(id) => deleteIntegration.mutate({ id })} />
    </GlassCard>
  );
}

function AddressPanel({
  integrations,
  upsertIntegration,
  deleteIntegration,
}: {
  integrations: Array<{
    id: string;
    kind: string;
    label: string;
    provider: string;
    isDefault: boolean;
    config: { enabled?: boolean };
  }>;
  upsertIntegration: MutationProp;
  deleteIntegration: MutationProp;
}) {
  const [provider, setProvider] = useState("MAPBOX");
  const [label, setLabel] = useState("Primary Address Search");
  const [apiKeyVal, setApiKeyVal] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [headers, setHeaders] = useState("");

  const items = integrations.filter((i) => i.kind === "ADDRESS");

  return (
    <GlassCard className="space-y-4">
      <h4 className="text-sm font-semibold">Address Autocomplete</h4>
      <p className="text-xs text-muted">Geocoding for signer-side address suggestions.</p>
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
          <TextField label="Endpoint URL" value={endpoint} onChange={setEndpoint} />
        )}
        {provider === "CUSTOM" && <TextareaField label="Custom headers (JSON)" value={headers} onChange={setHeaders} />}
      </div>
      <AnimatedButton
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
              apiKey: provider !== "CUSTOM" ? apiKeyVal || undefined : undefined,
              endpoint: provider === "CUSTOM" ? endpoint || undefined : undefined,
              headers: parsedHeaders,
            },
          });
        }}
        disabled={upsertIntegration.isPending || (provider === "CUSTOM" ? !endpoint : !apiKeyVal)}
      >
        Save Address Provider
      </AnimatedButton>
      <IntegrationList items={items} onDelete={(id) => deleteIntegration.mutate({ id })} />
    </GlassCard>
  );
}

function PaymentPanel({
  integrations,
  upsertIntegration,
  deleteIntegration,
}: {
  integrations: Array<{
    id: string;
    kind: string;
    label: string;
    provider: string;
    isDefault: boolean;
    config: { enabled?: boolean };
  }>;
  upsertIntegration: MutationProp;
  deleteIntegration: MutationProp;
}) {
  const [provider, setProvider] = useState("STRIPE");
  const [label, setLabel] = useState("Primary Payments");
  const [apiKeyVal, setApiKeyVal] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const items = integrations.filter((i) => i.kind === "PAYMENT");

  return (
    <GlassCard className="space-y-4">
      <h4 className="text-sm font-semibold">Payment Collection</h4>
      <p className="text-xs text-muted">Collect payments inside the signing flow.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <SelectField label="Provider" value={provider} onChange={setProvider} options={["STRIPE", "CUSTOM"]} />
        <TextField label="Label" value={label} onChange={setLabel} />
        <TextField label="API key (publishable)" value={apiKeyVal} onChange={setApiKeyVal} password />
        <TextField label="API secret" value={apiSecret} onChange={setApiSecret} password />
      </div>
      <AnimatedButton
        className="px-4 py-2"
        onClick={() =>
          upsertIntegration.mutate({
            kind: "PAYMENT",
            provider,
            label,
            isDefault: true,
            config: {
              provider,
              enabled: true,
              apiKey: apiKeyVal || undefined,
              apiSecret: apiSecret || undefined,
            },
          })
        }
        disabled={upsertIntegration.isPending || !apiKeyVal}
      >
        Save Payment Provider
      </AnimatedButton>
      <IntegrationList items={items} onDelete={(id) => deleteIntegration.mutate({ id })} />
    </GlassCard>
  );
}

function SsoPanel({
  integrations,
  upsertIntegration,
  deleteIntegration,
}: {
  integrations: Array<{
    id: string;
    kind: string;
    label: string;
    provider: string;
    isDefault: boolean;
    config: { enabled?: boolean };
  }>;
  upsertIntegration: MutationProp;
  deleteIntegration: MutationProp;
}) {
  const [provider, setProvider] = useState("GOOGLE");
  const [label, setLabel] = useState("Primary SSO");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [issuer, setIssuer] = useState("");
  const items = integrations.filter((i) => i.kind === "SSO");

  return (
    <GlassCard className="space-y-4">
      <h4 className="text-sm font-semibold">SSO / OAuth Providers</h4>
      <p className="text-xs text-muted">Identity providers for Web2 login.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <SelectField
          label="Provider"
          value={provider}
          onChange={setProvider}
          options={["GOOGLE", "AUTH0", "OKTA", "CUSTOM"]}
        />
        <TextField label="Label" value={label} onChange={setLabel} />
        <TextField label="Client ID" value={clientId} onChange={setClientId} />
        <TextField label="Client Secret" value={clientSecret} onChange={setClientSecret} password />
        {(provider === "AUTH0" || provider === "OKTA" || provider === "CUSTOM") && (
          <TextField label="Issuer URL" value={issuer} onChange={setIssuer} />
        )}
      </div>
      <AnimatedButton
        className="px-4 py-2"
        onClick={() =>
          upsertIntegration.mutate({
            kind: "SSO",
            provider,
            label,
            isDefault: true,
            config: {
              provider,
              enabled: true,
              clientId: clientId || undefined,
              clientSecret: clientSecret || undefined,
              issuer: issuer || undefined,
            },
          })
        }
        disabled={upsertIntegration.isPending || !clientId}
      >
        Save SSO Provider
      </AnimatedButton>
      <IntegrationList items={items} onDelete={(id) => deleteIntegration.mutate({ id })} />
    </GlassCard>
  );
}
