"use client";

import { Check, Clock, FileText, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { AnimatedButton, FadeIn, GlassCard } from "~/components/ui/motion";
import { trpc } from "~/lib/platform/trpc";
import { ColorField, StatCard, StatusPill, TextareaField, TextField } from "./admin-shared-ui";

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

export function BrandingSection() {
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

  const editProfile = (profile: {
    id: string;
    name: string;
    isDefault: boolean;
    settings: Record<string, string | undefined>;
  }) => {
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
        <BrandingProfileList
          profiles={profiles}
          editing={editing}
          onEdit={editProfile}
          onDelete={(id) => deleteBranding.mutate({ id })}
          onNew={() => {
            setForm(EMPTY_BRANDING);
            setEditing(true);
          }}
        />
        {editing && (
          <BrandingEditForm
            form={form}
            setForm={setForm}
            onSave={saveProfile}
            onCancel={() => setEditing(false)}
            isPending={upsertBranding.isPending}
            error={upsertBranding.error?.message}
          />
        )}
        {(editing || profiles.length > 0) && <BrandingPreview form={form} />}
      </div>
    </FadeIn>
  );
}

function BrandingProfileList({
  profiles,
  editing,
  onEdit,
  onDelete,
  onNew,
}: {
  profiles: Array<{
    id: string;
    name: string;
    isDefault: boolean;
    settings: Record<string, string | undefined>;
  }>;
  editing: boolean;
  onEdit: (p: (typeof profiles)[0]) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <GlassCard className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Branding Profiles</h3>
          <p className="mt-1 text-sm text-muted">Customize logos, colors, and email experience.</p>
        </div>
        <AnimatedButton variant="primary" className="px-3 py-1.5 text-xs" onClick={onNew}>
          <Plus className="mr-1 inline h-3 w-3" /> New Profile
        </AnimatedButton>
      </div>
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
                <AnimatedButton variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => onEdit(profile)}>
                  Edit
                </AnimatedButton>
                <AnimatedButton variant="danger" className="px-2 py-1.5 text-xs" onClick={() => onDelete(profile.id)}>
                  <Trash2 className="h-3 w-3" />
                </AnimatedButton>
              </div>
            </div>
          ))}
        </div>
      )}
      {profiles.length === 0 && !editing && (
        <p className="py-4 text-center text-sm text-muted">No branding profiles yet.</p>
      )}
    </GlassCard>
  );
}

function BrandingEditForm({
  form,
  setForm,
  onSave,
  onCancel,
  isPending,
  error,
}: {
  form: BrandingForm;
  setForm: (f: BrandingForm) => void;
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
  error?: string;
}) {
  return (
    <GlassCard className="space-y-4">
      <h4 className="text-sm font-semibold">{form.id ? "Edit Profile" : "New Branding Profile"}</h4>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Profile name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <TextField label="Brand name" value={form.brandName} onChange={(v) => setForm({ ...form, brandName: v })} />
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
        <AnimatedButton className="px-4 py-2" onClick={onSave} disabled={isPending}>
          {isPending ? "Saving..." : "Save Profile"}
        </AnimatedButton>
        <AnimatedButton variant="secondary" className="px-4 py-2" onClick={onCancel}>
          Cancel
        </AnimatedButton>
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
    </GlassCard>
  );
}

function BrandingPreview({ form }: { form: BrandingForm }) {
  return (
    <GlassCard className="space-y-3">
      <h4 className="text-sm font-semibold">Brand Preview</h4>
      <div className="rounded-xl border border-border p-4">
        <div className="flex items-center gap-3">
          {form.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element -- brand logo preview */
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
  );
}

// ── Webhooks Section ──

export function WebhooksSection() {
  const utils = trpc.useUtils();
  const workspaceQuery = trpc.account.workspace.useQuery();
  const upsertWebhook = trpc.account.upsertWebhook.useMutation({
    onSuccess: () => {
      void utils.account.workspace.invalidate();
      setLabel("");
      setUrl("");
      setSecret("");
    },
  });
  const deleteWebhook = trpc.account.deleteWebhook.useMutation({
    onSuccess: () => void utils.account.workspace.invalidate(),
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
                      setEvents(selected ? current.filter((e) => e !== evt).join(",") : [...current, evt].join(","));
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

export function TemplatesSection() {
  const utils = trpc.useUtils();
  const templatesQuery = trpc.account.listTemplates.useQuery();
  const deleteTemplate = trpc.account.deleteTemplate.useMutation({
    onSuccess: () => {
      void utils.account.listTemplates.invalidate();
      void utils.account.workspace.invalidate();
    },
  });

  const templates = templatesQuery.data ?? [];

  return (
    <FadeIn>
      <div className="space-y-6">
        <GlassCard className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Document Templates</h3>
            <p className="mt-1 text-sm text-muted">Reusable signing blueprints created from the document editor.</p>
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
