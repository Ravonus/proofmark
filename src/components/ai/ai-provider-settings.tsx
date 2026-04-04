// @ts-nocheck
"use client";

/**
 * AI Provider Settings — three ways to get AI:
 *
 *   1. Platform AI (included) — we manage the keys, user just uses it
 *   2. Connect Your Tools — bridge Claude Code, Codex, OpenClaw via the Rust connector
 *   3. Bring Your Own Key — user supplies their own API keys
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  Check,
  Eye,
  EyeOff,
  Loader2,
  Settings,
  BarChart3,
  Key,
  Zap,
  AlertCircle,
  Sparkles,
  Shield,
  Terminal,
  Copy,
  Wifi,
  WifiOff,
  Share2,
  Users,
} from "lucide-react";
import { trpc } from "~/lib/trpc";

// ── Types ──

type ProviderFormState = {
  id?: string;
  provider: string;
  label: string;
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  isDefault: boolean;
  organizationId: string;
};

const INITIAL_FORM: ProviderFormState = {
  provider: "anthropic",
  label: "",
  apiKey: "",
  baseUrl: "",
  defaultModel: "",
  isDefault: false,
  organizationId: "",
};

// ── Main Component ──

export function AiProviderSettings() {
  const [activeTab, setActiveTab] = useState<"providers" | "connectors" | "usage">("providers");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ProviderFormState>(INITIAL_FORM);
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Connector state
  const [newTokenLabel, setNewTokenLabel] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  // Queries
  const providersQuery = trpc.ai.listProviders.useQuery();
  const upsertMut = trpc.ai.upsertProvider.useMutation({
    onSuccess: () => { providersQuery.refetch(); setShowForm(false); setForm(INITIAL_FORM); },
  });
  const deleteMut = trpc.ai.deleteProvider.useMutation({ onSuccess: () => providersQuery.refetch() });
  const testMut = trpc.ai.testProvider.useMutation();

  // Connector queries
  const sessionsQuery = trpc.connector.listSessions.useQuery(undefined, { enabled: activeTab === "connectors" });
  const tokensQuery = trpc.connector.listTokens.useQuery(undefined, { enabled: activeTab === "connectors" });
  const createTokenMut = trpc.connector.createToken.useMutation({
    onSuccess: (data) => {
      setCreatedToken(data.token);
      setNewTokenLabel("");
      tokensQuery.refetch();
    },
  });
  const revokeTokenMut = trpc.connector.revokeToken.useMutation({ onSuccess: () => tokensQuery.refetch() });
  const removeSessionMut = trpc.connector.removeSession.useMutation({ onSuccess: () => sessionsQuery.refetch() });

  const registry = providersQuery.data?.registry ?? [];
  const configs = providersQuery.data?.providers ?? [];
  const platformProviders = providersQuery.data?.platform ?? [];

  const handleSave = () => {
    upsertMut.mutate({
      id: form.id,
      provider: form.provider,
      label: form.label || registry.find((r) => r.name === form.provider)?.label || form.provider,
      apiKey: form.apiKey || undefined,
      baseUrl: form.baseUrl || undefined,
      defaultModel: form.defaultModel || undefined,
      isDefault: form.isDefault,
      organizationId: form.organizationId || undefined,
    });
  };

  const handleTest = async () => {
    setTestResult(null);
    const selectedModel = form.defaultModel || registry.find((r) => r.name === form.provider)?.models[0]?.id || "";
    const result = await testMut.mutateAsync({
      provider: form.provider, model: selectedModel, apiKey: form.apiKey, baseUrl: form.baseUrl || undefined,
    });
    setTestResult({
      success: result.success,
      message: result.success ? `Connected! (${result.latencyMs}ms)` : result.error || "Connection failed",
    });
  };

  const handleEdit = (config: (typeof configs)[0]) => {
    setForm({ id: config.id, provider: config.provider, label: config.label ?? "", apiKey: "", baseUrl: "", defaultModel: config.defaultModel ?? "", isDefault: config.isDefault, organizationId: "" });
    setShowForm(true);
  };

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const selectedProviderModels = registry.find((r) => r.name === form.provider)?.models ?? [];
  const sessions = sessionsQuery.data ?? [];
  const tokens = tokensQuery.data ?? [];
  const onlineSessions = sessions.filter((s) => s.status === "online");

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div className="flex w-fit gap-1 rounded-lg border border-white/5 bg-white/5 p-1">
        <TabButton active={activeTab === "providers"} onClick={() => setActiveTab("providers")} icon={Key} label="Providers" />
        <TabButton active={activeTab === "connectors"} onClick={() => setActiveTab("connectors")} icon={Terminal} label="Connectors" badge={onlineSessions.length || undefined} />
        <TabButton active={activeTab === "usage"} onClick={() => setActiveTab("usage")} icon={BarChart3} label="Usage & Limits" />
      </div>

      {/* ═══ Providers Tab ═══ */}
      {activeTab === "providers" && (
        <div className="space-y-6">

          {/* Platform AI */}
          {platformProviders.length > 0 && (
            <div className="space-y-3">
              <SectionHeader icon={Sparkles} iconColor="text-blue-400" title="Platform AI" badge="included" badgeColor="bg-green-500/20 text-green-300" />
              <p className="text-xs text-zinc-500">Managed by us — no API key needed. Just use AI features and it works.</p>
              <div className="space-y-2">
                {platformProviders.map((p) => (
                  <div key={p.provider} className="flex items-center justify-between rounded-xl border border-green-500/10 bg-green-500/[0.03] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-2 rounded-full bg-green-400" />
                      <div>
                        <div className="text-sm font-medium text-white">{p.label}</div>
                        <div className="text-xs text-zinc-500">{p.defaultModel} · platform-managed</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Shield className="h-3.5 w-3.5 text-green-400/60" />
                      <span className="text-xs text-green-400/80">Ready</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {platformProviders.length === 0 && configs.length === 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <p className="text-sm font-medium text-amber-200">No AI providers available</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    The app auto-detects platform keys from runtime env vars when they exist. Otherwise add your own API
                    key below, or connect Claude Code / Codex from the Connectors tab.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Divider */}
          {platformProviders.length > 0 && <Divider label="or bring your own" />}

          {/* BYOK providers */}
          <div className="space-y-3">
            <SectionHeader icon={Key} iconColor="text-zinc-400" title="Your API Keys" />
            {configs.length > 0 && (
              <div className="space-y-2">
                {configs.map((config) => (
                  <div key={config.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className={`h-2 w-2 rounded-full ${config.enabled ? "bg-green-400" : "bg-zinc-600"}`} />
                      <div>
                        <div className="text-sm font-medium text-white">{config.label}</div>
                        <div className="text-xs text-zinc-500">{config.provider} · {config.defaultModel || "default"} · {config.hasKey ? "key set" : "no key"}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {config.isDefault && <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">default</span>}
                      <button onClick={() => handleEdit(config)} className="rounded-lg p-1.5 transition hover:bg-white/10"><Settings className="h-3.5 w-3.5 text-zinc-400" /></button>
                      <button onClick={() => deleteMut.mutate({ id: config.id })} className="rounded-lg p-1.5 transition hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5 text-zinc-400 hover:text-red-400" /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!showForm && (
              <button
                onClick={() => { setForm(INITIAL_FORM); setShowForm(true); setTestResult(null); }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-3 text-sm text-zinc-400 transition hover:border-blue-500/30 hover:text-blue-300"
              >
                <Plus className="h-4 w-4" /> Add Your Own API Key
              </button>
            )}

            {/* BYOK Form */}
            <AnimatePresence>
              {showForm && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="space-y-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
                    <h3 className="text-sm font-medium text-white">{form.id ? "Edit Provider" : "Add Provider"}</h3>
                    <FormField label="Provider">
                      <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value, defaultModel: "" })} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none">
                        {registry.map((r) => <option key={r.name} value={r.name}>{r.label}{r.isAggregator ? " (aggregator)" : ""}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Label (optional)">
                      <input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={registry.find((r) => r.name === form.provider)?.label} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none" />
                    </FormField>
                    <FormField label="API Key">
                      <div className="relative">
                        <input type={showKey ? "text" : "password"} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={form.id ? "••••••• (leave blank to keep)" : "sk-..."} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 pr-10 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none" />
                        <button onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1">
                          {showKey ? <EyeOff className="h-3.5 w-3.5 text-zinc-500" /> : <Eye className="h-3.5 w-3.5 text-zinc-500" />}
                        </button>
                      </div>
                    </FormField>
                    <FormField label="Default Model">
                      <select value={form.defaultModel} onChange={(e) => setForm({ ...form, defaultModel: e.target.value })} className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none">
                        <option value="">Auto (cheapest capable)</option>
                        {selectedProviderModels.map((m) => <option key={m.id} value={m.id}>{m.name} — ${m.inputPricePer1k}/1K in, ${m.outputPricePer1k}/1K out</option>)}
                      </select>
                    </FormField>
                    {(form.provider === "litellm" || form.provider === "openrouter") && (
                      <FormField label="Custom Base URL">
                        <input type="text" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="http://localhost:4000/v1" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none" />
                      </FormField>
                    )}
                    {testResult && (
                      <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${testResult.success ? "border border-green-500/20 bg-green-500/10 text-green-300" : "border border-red-500/20 bg-red-500/10 text-red-300"}`}>
                        {testResult.success ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />} {testResult.message}
                      </div>
                    )}
                    <div className="flex gap-2 pt-2">
                      <button onClick={handleTest} disabled={!form.apiKey || testMut.isPending} className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-sm text-zinc-300 transition hover:bg-white/10 disabled:opacity-40">
                        {testMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Test
                      </button>
                      <button onClick={handleSave} disabled={upsertMut.isPending} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600/20 px-3 py-2 text-sm text-blue-300 transition hover:bg-blue-600/30 disabled:opacity-40">
                        {upsertMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                      </button>
                      <button onClick={() => { setShowForm(false); setTestResult(null); }} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/10">Cancel</button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* ═══ Connectors Tab ═══ */}
      {activeTab === "connectors" && (
        <div className="space-y-6">

          {/* Explainer */}
          <div className="rounded-xl border border-purple-500/15 bg-purple-500/[0.04] p-4">
            <div className="flex items-start gap-3">
              <Terminal className="mt-0.5 h-5 w-5 shrink-0 text-purple-400" />
              <div>
                <p className="text-sm font-medium text-white">Connect Claude Code, Codex, or OpenClaw</p>
                <p className="mt-1 text-xs text-zinc-400">
                  Install our open-source connector app on your machine. It bridges your local AI tools
                  directly to the platform — use your own Claude or Codex subscription for AI features here,
                  or share access with your team on enterprise.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ToolBadge label="Claude Code" />
                  <ToolBadge label="OpenAI Codex" />
                  <ToolBadge label="OpenClaw" />
                </div>
              </div>
            </div>
          </div>

          {/* Active connectors */}
          <div className="space-y-3">
            <SectionHeader icon={Wifi} iconColor="text-green-400" title="Active Connectors" badge={onlineSessions.length ? `${onlineSessions.length} online` : undefined} badgeColor="bg-green-500/20 text-green-300" />

            {sessions.length > 0 ? (
              <div className="space-y-2">
                {sessions.map((session) => (
                  <div key={session.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                    <div className="flex items-center gap-3">
                      {session.status === "online" ? <Wifi className="h-3.5 w-3.5 text-green-400" /> : <WifiOff className="h-3.5 w-3.5 text-zinc-500" />}
                      <div>
                        <div className="text-sm font-medium text-white">{session.label || session.machineId || "Connector"}</div>
                        <div className="text-xs text-zinc-500">
                          v{session.connectorVersion || "?"} · {session.status}
                          {session.capabilities?.supportedTools?.length ? ` · ${session.capabilities.supportedTools.join(", ")}` : ""}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => removeSessionMut.mutate({ sessionId: session.id })} className="rounded-lg p-1.5 transition hover:bg-red-500/10">
                      <Trash2 className="h-3.5 w-3.5 text-zinc-400 hover:text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">No connectors registered. Install the app and connect it with a token below.</p>
            )}
          </div>

          {/* Access tokens */}
          <div className="space-y-3">
            <SectionHeader icon={Key} iconColor="text-zinc-400" title="Access Tokens" />
            <p className="text-xs text-zinc-500">
              Generate a token and paste it into the connector app config. Each token can be shared with team members on enterprise plans.
            </p>

            {/* Create token */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTokenLabel}
                onChange={(e) => setNewTokenLabel(e.target.value)}
                placeholder="Token label (e.g. 'My MacBook')"
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none"
              />
              <button
                onClick={() => createTokenMut.mutate({ label: newTokenLabel || "Connector Token" })}
                disabled={createTokenMut.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-purple-600/20 px-4 py-2 text-sm text-purple-300 transition hover:bg-purple-600/30 disabled:opacity-40"
              >
                {createTokenMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Generate
              </button>
            </div>

            {/* Newly created token (shown once) */}
            {createdToken && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-green-500/20 bg-green-500/5 p-4">
                <p className="mb-2 text-xs font-medium text-green-300">Token created — copy it now. You won't see it again.</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-lg bg-black/30 px-3 py-2 font-mono text-xs text-green-200">{createdToken}</code>
                  <button
                    onClick={() => handleCopyToken(createdToken)}
                    className="shrink-0 rounded-lg bg-green-500/20 p-2 transition hover:bg-green-500/30"
                  >
                    {copiedToken ? <Check className="h-4 w-4 text-green-300" /> : <Copy className="h-4 w-4 text-green-300" />}
                  </button>
                </div>
                <button onClick={() => setCreatedToken(null)} className="mt-2 text-xs text-zinc-500 transition hover:text-zinc-400">Dismiss</button>
              </motion.div>
            )}

            {/* Existing tokens */}
            {tokens.length > 0 && (
              <div className="space-y-2">
                {tokens.map((token) => (
                  <div key={token.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Key className="h-3.5 w-3.5 text-zinc-500" />
                      <div>
                        <div className="text-sm font-medium text-white">{token.label}</div>
                        <div className="flex items-center gap-2 text-xs text-zinc-500">
                          {token.revokedAt ? (
                            <span className="text-red-400">revoked</span>
                          ) : (
                            <>
                              {token.lastUsedAt && <span>last used {new Date(token.lastUsedAt).toLocaleDateString()}</span>}
                              {token.expiresAt && <span>· expires {new Date(token.expiresAt).toLocaleDateString()}</span>}
                              {!token.lastUsedAt && !token.expiresAt && <span>never used</span>}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {!token.revokedAt && (
                      <button onClick={() => revokeTokenMut.mutate({ id: token.id })} className="rounded-lg px-2 py-1 text-xs text-red-400 transition hover:bg-red-500/10">
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Enterprise sharing callout */}
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
            <div className="flex items-start gap-3">
              <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
              <div>
                <p className="text-sm font-medium text-zinc-300">Enterprise: Share with your team</p>
                <p className="mt-1 text-xs text-zinc-500">
                  On enterprise plans, generate tokens for team members so they can use your Claude or Codex
                  subscription through the platform. Set per-user rate limits from the Usage tab.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Usage & Limits Tab ═══ */}
      {activeTab === "usage" && <UsageLimitsTab />}
    </div>
  );
}

// ── Usage & Limits Tab ──

function UsageLimitsTab() {
  const usageQuery = trpc.ai.usageSummary.useQuery({});
  const defaultLimits = trpc.ai.getUserLimitStatus.useQuery({});
  const setDefaultMut = trpc.ai.setDefaultLimits.useMutation({ onSuccess: () => defaultLimits.refetch() });

  // Per-user limit editing
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [userLimitForm, setUserLimitForm] = useState({ userId: "", requestsPerMonth: "", tokensPerMonth: "", requestsPerHour: "", requestsPerDay: "" });
  const setUserLimitsMut = trpc.ai.setUserLimits.useMutation({ onSuccess: () => { setEditingUser(null); defaultLimits.refetch(); } });

  // Default limits form
  const [defaultForm, setDefaultForm] = useState({
    requestsPerMonth: "",
    tokensPerMonth: "",
    maxRequestsPerHour: "",
    maxRequestsPerWeek: "",
  });
  const [showDefaultForm, setShowDefaultForm] = useState(false);

  const limits = defaultLimits.data;

  return (
    <div className="space-y-6">

      {/* Usage overview */}
      {usageQuery.data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <UsageCard label="Requests" value={usageQuery.data.totalRequests.toLocaleString()} />
            <UsageCard label="Input Tokens" value={formatTokens(usageQuery.data.totalInputTokens)} />
            <UsageCard label="Output Tokens" value={formatTokens(usageQuery.data.totalOutputTokens)} />
            <UsageCard label="Cost" value={`$${(usageQuery.data.totalCostCents / 100).toFixed(2)}`} />
          </div>
          <BreakdownSection title="By Feature" data={usageQuery.data.byFeature} formatKey={formatFeatureName} />
          <BreakdownSection title="By Provider" data={usageQuery.data.byProvider} />
        </>
      )}

      <Divider label="rate limits" />

      {/* Account default limits */}
      <div className="space-y-3">
        <SectionHeader icon={Shield} iconColor="text-blue-400" title="Default Limits" badge={limits?.mode ?? undefined} badgeColor="bg-blue-500/20 text-blue-300" />
        <p className="text-xs text-zinc-500">
          Account-wide defaults apply to everyone unless overridden per user. Controls how much AI your team can use.
        </p>

        {limits && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <LimitCard label="Monthly Requests" used={limits.used.monthRequests} cap={limits.caps.monthlyRequests} />
            <LimitCard label="Monthly Tokens" used={limits.used.monthTokens} cap={limits.caps.monthlyTokens} format={formatTokens} />
            {limits.caps.hourlyRequests != null && <LimitCard label="Hourly Limit" used={limits.used.hourRequests} cap={limits.caps.hourlyRequests} />}
            {limits.caps.dailyRequests != null && <LimitCard label="Daily Limit" used={limits.used.dayRequests} cap={limits.caps.dailyRequests} />}
          </div>
        )}

        {!showDefaultForm ? (
          <button onClick={() => {
            setShowDefaultForm(true);
            if (limits) {
              setDefaultForm({
                requestsPerMonth: String(limits.caps.monthlyRequests),
                tokensPerMonth: String(limits.caps.monthlyTokens),
                maxRequestsPerHour: limits.caps.hourlyRequests != null ? String(limits.caps.hourlyRequests) : "",
                maxRequestsPerWeek: "",
              });
            }
          }} className="flex items-center gap-1.5 text-xs text-blue-400 transition hover:text-blue-300">
            <Settings className="h-3 w-3" /> Edit default limits
          </button>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
            <h4 className="text-sm font-medium text-white">Account Default Limits</h4>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Requests / month">
                <input type="number" value={defaultForm.requestsPerMonth} onChange={(e) => setDefaultForm({ ...defaultForm, requestsPerMonth: e.target.value })} placeholder="500" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
              </FormField>
              <FormField label="Tokens / month">
                <input type="number" value={defaultForm.tokensPerMonth} onChange={(e) => setDefaultForm({ ...defaultForm, tokensPerMonth: e.target.value })} placeholder="1000000" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
              </FormField>
              <FormField label="Max requests / hour (circuit breaker)">
                <input type="number" value={defaultForm.maxRequestsPerHour} onChange={(e) => setDefaultForm({ ...defaultForm, maxRequestsPerHour: e.target.value })} placeholder="30" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
              </FormField>
              <FormField label="Max requests / week (circuit breaker)">
                <input type="number" value={defaultForm.maxRequestsPerWeek} onChange={(e) => setDefaultForm({ ...defaultForm, maxRequestsPerWeek: e.target.value })} placeholder="200" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-blue-500/50 focus:outline-none" />
              </FormField>
            </div>
            <div className="flex gap-2">
              <button onClick={() => {
                setDefaultMut.mutate({
                  requestsPerMonth: defaultForm.requestsPerMonth ? parseInt(defaultForm.requestsPerMonth) : undefined,
                  tokensPerMonth: defaultForm.tokensPerMonth ? parseInt(defaultForm.tokensPerMonth) : undefined,
                  maxRequestsPerHour: defaultForm.maxRequestsPerHour ? parseInt(defaultForm.maxRequestsPerHour) : undefined,
                  maxRequestsPerWeek: defaultForm.maxRequestsPerWeek ? parseInt(defaultForm.maxRequestsPerWeek) : undefined,
                });
                setShowDefaultForm(false);
              }} disabled={setDefaultMut.isPending} className="flex items-center gap-1.5 rounded-lg bg-blue-600/20 px-3 py-2 text-sm text-blue-300 transition hover:bg-blue-600/30 disabled:opacity-40">
                {setDefaultMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save Defaults
              </button>
              <button onClick={() => setShowDefaultForm(false)} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/10">Cancel</button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Per-user overrides */}
      <div className="space-y-3">
        <SectionHeader icon={Users} iconColor="text-zinc-400" title="Per-User Overrides" />
        <p className="text-xs text-zinc-500">
          Set custom limits for specific team members. Overrides the account defaults above. Use this to give power users more capacity, or restrict users who are burning through tokens.
        </p>

        {/* Add per-user limit */}
        {editingUser === null ? (
          <button
            onClick={() => { setEditingUser("new"); setUserLimitForm({ userId: "", requestsPerMonth: "", tokensPerMonth: "", requestsPerHour: "", requestsPerDay: "" }); }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-3 text-sm text-zinc-400 transition hover:border-blue-500/30 hover:text-blue-300"
          >
            <Plus className="h-4 w-4" /> Set limits for a user
          </button>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-3">
            <h4 className="text-sm font-medium text-white">User Limit Override</h4>
            <FormField label="User ID or email">
              <input type="text" value={userLimitForm.userId} onChange={(e) => setUserLimitForm({ ...userLimitForm, userId: e.target.value })} placeholder="user@company.com or user ID" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none" />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Requests / month">
                <input type="number" value={userLimitForm.requestsPerMonth} onChange={(e) => setUserLimitForm({ ...userLimitForm, requestsPerMonth: e.target.value })} placeholder="inherit default" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none" />
              </FormField>
              <FormField label="Tokens / month">
                <input type="number" value={userLimitForm.tokensPerMonth} onChange={(e) => setUserLimitForm({ ...userLimitForm, tokensPerMonth: e.target.value })} placeholder="inherit default" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none" />
              </FormField>
              <FormField label="Requests / hour">
                <input type="number" value={userLimitForm.requestsPerHour} onChange={(e) => setUserLimitForm({ ...userLimitForm, requestsPerHour: e.target.value })} placeholder="no hourly limit" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none" />
              </FormField>
              <FormField label="Requests / day">
                <input type="number" value={userLimitForm.requestsPerDay} onChange={(e) => setUserLimitForm({ ...userLimitForm, requestsPerDay: e.target.value })} placeholder="no daily limit" className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none" />
              </FormField>
            </div>
            <div className="flex gap-2">
              <button onClick={() => {
                if (!userLimitForm.userId) return;
                setUserLimitsMut.mutate({
                  userId: userLimitForm.userId,
                  requestsPerMonth: userLimitForm.requestsPerMonth ? parseInt(userLimitForm.requestsPerMonth) : undefined,
                  tokensPerMonth: userLimitForm.tokensPerMonth ? parseInt(userLimitForm.tokensPerMonth) : undefined,
                  requestsPerHour: userLimitForm.requestsPerHour ? parseInt(userLimitForm.requestsPerHour) : undefined,
                  requestsPerDay: userLimitForm.requestsPerDay ? parseInt(userLimitForm.requestsPerDay) : undefined,
                });
              }} disabled={!userLimitForm.userId || setUserLimitsMut.isPending} className="flex items-center gap-1.5 rounded-lg bg-amber-600/20 px-3 py-2 text-sm text-amber-300 transition hover:bg-amber-600/30 disabled:opacity-40">
                {setUserLimitsMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save Override
              </button>
              <button onClick={() => setEditingUser(null)} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/10">Cancel</button>
            </div>
          </motion.div>
        )}
      </div>

      {usageQuery.data?.totalRequests === 0 && !limits && (
        <div className="py-8 text-center text-sm text-zinc-500">No AI usage yet. Limits will appear once AI features are used.</div>
      )}
    </div>
  );
}

// ── Sub-components ──

function TabButton({ active, onClick, icon: Icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string; badge?: number }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ${active ? "bg-blue-600/20 text-blue-300" : "text-zinc-400 hover:text-zinc-300"}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
      {badge != null && <span className="rounded-full bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-300">{badge}</span>}
    </button>
  );
}

function SectionHeader({ icon: Icon, iconColor, title, badge, badgeColor }: { icon: React.ComponentType<{ className?: string }>; iconColor: string; title: string; badge?: string; badgeColor?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-4 w-4 ${iconColor}`} />
      <h4 className="text-sm font-medium text-white">{title}</h4>
      {badge && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badgeColor}`}>{badge}</span>}
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-white/5" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">{label}</span>
      <div className="h-px flex-1 bg-white/5" />
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs text-zinc-400">{label}</label>{children}</div>;
}

function UsageCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-3">
      <div className="text-lg font-medium text-white">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function LimitCard({ label, used, cap, format }: { label: string; used: number; cap: number; format?: (n: number) => string }) {
  const fmt = format ?? ((n: number) => n.toLocaleString());
  const pct = cap > 0 ? Math.min((used / cap) * 100, 100) : 0;
  const color = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-green-500";

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-zinc-500">{label}</span>
        <span className="text-[10px] text-zinc-600">{Math.round(pct)}%</span>
      </div>
      <div className="text-sm font-medium text-white">{fmt(used)} <span className="text-zinc-500">/ {fmt(cap)}</span></div>
      <div className="mt-1.5 h-1 rounded-full bg-white/5">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ToolBadge({ label }: { label: string }) {
  return <span className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2.5 py-1 text-[11px] font-medium text-purple-300">{label}</span>;
}

function BreakdownSection({ title, data, formatKey }: { title: string; data: Record<string, { requests: number; costCents: number }>; formatKey?: (key: string) => string }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  return (
    <div>
      <h4 className="mb-2 text-xs text-zinc-400">{title}</h4>
      <div className="space-y-1">
        {entries.map(([key, d]) => (
          <div key={key} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
            <span className="text-sm text-zinc-300">{formatKey ? formatKey(key) : key}</span>
            <span className="text-xs text-zinc-500">{d.requests} req · ${(d.costCents / 100).toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatFeatureName(feature: string): string {
  return feature.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
