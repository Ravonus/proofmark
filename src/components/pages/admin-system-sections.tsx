"use client";

import { Crown, Database, RefreshCw, Server, Sparkles, Users } from "lucide-react";
import { FadeIn, GlassCard } from "~/components/ui/motion";
import { CHAIN_META, type WalletChain } from "~/lib/crypto/chains";
import { trpc } from "~/lib/platform/trpc";
import { EnvRow, StatCard, StatusPill, SystemRow } from "./admin-shared-ui";

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
  featureStates: Array<{
    id: string;
    label: string;
    summary: string;
    oss: boolean;
    effectiveEnabled: boolean;
  }>;
};

type CollabCapabilitiesQuery = {
  data?: { available?: boolean };
};

type ActiveCollabSession = {
  session: {
    id: string;
    title: string;
    createdAt: string | number | Date;
    hostUserId: string;
  };
  participants: Array<{ isActive: boolean }>;
};

type CollabSessionsQuery = {
  data?: ActiveCollabSession[];
  refetch: () => Promise<unknown>;
  isFetching: boolean;
};

type CollabAdminApi = {
  capabilities: {
    useQuery: () => CollabCapabilitiesQuery;
  };
  list: {
    useQuery: (input: { status: "active" }, options: { enabled: boolean }) => CollabSessionsQuery;
  };
};

/* ── Security Section ────────────────────────────────────────── */

export function SecuritySection(_props: { status?: OperatorStatus | null }) {
  return (
    <FadeIn>
      <div className="space-y-6">
        <EncryptionCard />
        <ForensicCard />
        <AuditTrailCard />
        <VerificationLevelsCard />
        <ProofModesCard />
      </div>
    </FadeIn>
  );
}

function EncryptionCard() {
  return (
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
        <SystemRow label="Vault Architecture" value="Zero-knowledge \u2014 DEK never leaves client" tone="success" />
      </div>
    </GlassCard>
  );
}

function ForensicCard() {
  return (
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
  );
}

function AuditTrailCard() {
  return (
    <GlassCard className="space-y-4">
      <h4 className="text-sm font-semibold">Audit Trail</h4>
      <p className="text-xs text-muted">
        Immutable, hash-chained audit event log. Each event includes SHA-256(prevHash + eventData) for tamper detection.
      </p>
      <div className="space-y-3">
        <SystemRow label="Hash Algorithm" value="SHA-256" tone="info" />
        <SystemRow label="Chain Integrity" value="Running hash chain (append-only)" tone="success" />
        <SystemRow label="Event Types" value="15 distinct event types" tone="info" />
        <SystemRow label="Actor Tracking" value="wallet | email | system" tone="info" />
      </div>
    </GlassCard>
  );
}

function VerificationLevelsCard() {
  const levels = [
    {
      pill: "L0",
      tone: "muted" as const,
      title: "Wallet Only",
      desc: "Anonymous wallet-based signing.",
    },
    {
      pill: "L1",
      tone: "info" as const,
      title: "Email Verification",
      desc: "Email OTP verified identity.",
    },
    {
      pill: "L2",
      tone: "success" as const,
      title: "Verified + Device Logs",
      desc: "Email + IP/device forensic evidence.",
    },
    {
      pill: "L3",
      tone: "warning" as const,
      title: "KYC",
      desc: "Full KYC with third-party provider integration (extensible).",
    },
  ];
  return (
    <GlassCard className="space-y-4">
      <h4 className="text-sm font-semibold">Identity Verification Levels</h4>
      <div className="space-y-2">
        {levels.map((l) => (
          <div key={l.pill} className="bg-surface/30 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <StatusPill tone={l.tone} label={l.pill} />
              <p className="text-sm font-medium">{l.title}</p>
            </div>
            <p className="mt-1 text-xs text-muted">{l.desc}</p>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function ProofModesCard() {
  const modes = [
    {
      pill: "PRIVATE",
      tone: "muted" as const,
      title: "Web2 Only",
      desc: "Email signing, off-chain audit trail. No blockchain.",
    },
    {
      pill: "HYBRID",
      tone: "info" as const,
      title: "Web2 + Web3",
      desc: "Email or wallet signing, hash anchored on-chain.",
    },
    {
      pill: "CRYPTO NATIVE",
      tone: "success" as const,
      title: "Web3 Only",
      desc: "Wallet signing, hash anchored, optional on-chain storage.",
    },
  ];
  return (
    <GlassCard className="space-y-4">
      <h4 className="text-sm font-semibold">Proof Modes</h4>
      <div className="space-y-2">
        {modes.map((m) => (
          <div key={m.pill} className="bg-surface/30 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <StatusPill tone={m.tone} label={m.pill} />
              <p className="text-sm font-medium">{m.title}</p>
            </div>
            <p className="mt-1 text-xs text-muted">{m.desc}</p>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

/* ── System Section ──────────────────────────────────────────── */

export function SystemSection({ status }: { status?: OperatorStatus | null }) {
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
            <SystemRow label="PDF Upload Limit" value={status ? `${status.pdfUploadMaxMb} MB` : "\u2014"} />
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
            <EnvRow label="PROOFMARK_DEPLOYMENT_MODE" value={status?.deploymentMode ?? "\u2014"} />
            <EnvRow label="PDF_UPLOAD_MAX_MB" value={status ? `${status.pdfUploadMaxMb}` : "\u2014"} />
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

/* ── Premium Section ─────────────────────────────────────────── */

function CollabSessionsAdmin() {
  const collabApi = trpc.collab as CollabAdminApi;
  const capabilities = collabApi.capabilities.useQuery();
  const available = capabilities.data?.available ?? false;
  const sessionsQuery = collabApi.list.useQuery({ status: "active" }, { enabled: available });
  const sessions = sessionsQuery.data ?? [];

  return (
    <GlassCard className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Active Sessions</h4>
        <button
          onClick={() => void sessionsQuery.refetch()}
          className="text-muted transition-colors hover:text-secondary"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${sessionsQuery.isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>
      {sessions.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted">No active collaboration sessions.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const activeCount = s.participants.filter((p) => p.isActive).length;
            return (
              <div
                key={s.session.id}
                className="bg-surface/30 flex items-center justify-between rounded-lg border border-border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{s.session.title}</p>
                  <p className="text-xs text-muted">
                    Host: {s.session.hostUserId.slice(0, 10)}... &middot;{" "}
                    {new Date(s.session.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <Users className="h-3 w-3" />
                    {activeCount}
                  </span>
                  <StatusPill tone="success" label="Live" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}

function FeatureStatusList({
  features,
}: {
  features: Array<{
    id: string;
    label: string;
    summary: string;
    effectiveEnabled: boolean;
  }>;
}) {
  return (
    <div className="space-y-2">
      {features.map((f) => (
        <div key={f.id} className="bg-surface/30 flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium">{f.label}</p>
            <p className="text-xs text-muted">{f.summary}</p>
          </div>
          <StatusPill tone={f.effectiveEnabled ? "success" : "danger"} label={f.effectiveEnabled ? "On" : "Off"} />
        </div>
      ))}
    </div>
  );
}

export function PremiumSection({ status }: { status?: OperatorStatus | null }) {
  const premiumFeatures = status?.featureStates.filter((f) => !f.oss) ?? [];
  const enabledCount = premiumFeatures.filter((f) => f.effectiveEnabled).length;

  const blockchainChains = [
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
  ] as const;

  const collabFeatures = premiumFeatures.filter((f) => f.id.startsWith("collab_"));
  const aiFeatures = premiumFeatures.filter((f) => f.id.startsWith("ai_"));
  const enterpriseFeatures = premiumFeatures.filter(
    (f) =>
      !f.id.startsWith("collab_") &&
      !f.id.startsWith("ai_") &&
      f.id !== "blockchain_anchoring" &&
      f.id !== "html_inscriptions" &&
      f.id !== "auto_wallet" &&
      f.id !== "post_sign_access",
  );

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

        <GlassCard className="space-y-4">
          <h4 className="text-sm font-semibold">Blockchain Anchoring</h4>
          <p className="text-xs text-muted">
            Write document hashes to Base (L2), Solana, and Bitcoin for cryptographic proof of signature timing.
          </p>
          <div className="space-y-2">
            {blockchainChains.map((chain) => {
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

        <GlassCard className="space-y-4">
          <h4 className="text-sm font-semibold">Collaboration Layer</h4>
          <p className="text-xs text-muted">
            Real-time collaborative workspaces with CRDT co-editing, WebSocket sidecar, and shared AI conversations.
          </p>
          <FeatureStatusList features={collabFeatures} />
        </GlassCard>

        <CollabSessionsAdmin />

        <GlassCard className="space-y-4">
          <h4 className="text-sm font-semibold">AI Features</h4>
          <p className="text-xs text-muted">
            AI-powered features including smart scraper, editor assistant, signer Q&A, BYOK, and enterprise sharing.
          </p>
          <FeatureStatusList features={aiFeatures} />
        </GlassCard>

        <GlassCard className="space-y-4">
          <h4 className="text-sm font-semibold">Enterprise Features</h4>
          <FeatureStatusList features={enterpriseFeatures} />
        </GlassCard>

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
