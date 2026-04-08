/**
 * Premium tables extracted from schema.ts for Biome file-length compliance.
 * Drizzle requires all tables in the migration folder; these are re-exported
 * from schema.ts so existing imports continue to work unchanged.
 */

import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
// Forward-reference: documents table lives in schema.ts but is needed for FK.
// We use a lazy import at the cost of a small indirection.
import { documents, walletChainEnum } from "./schema";
import { createId } from "./utils";

// ── AI Provider & Usage (premium) ──

export const aiProviderEnum = pgEnum("ai_provider", [
  "anthropic",
  "openai",
  "google",
  "mistral",
  "cohere",
  "groq",
  "together",
  "perplexity",
  "xai",
  "deepseek",
  "openrouter",
  "litellm",
]);

export const aiKeySourceEnum = pgEnum("ai_key_source", [
  "platform",
  "byok",
  "enterprise_shared",
  "connector",
  "server_runtime",
]);

export const aiFeatureEnum = pgEnum("ai_feature", ["scraper_fix", "editor_assistant", "signer_qa", "general"]);

export const connectorStatusEnum = pgEnum("connector_status", ["online", "offline", "error"]);

export type AiProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  fallbackProvider?: string;
  maxTokens?: number;
  temperature?: number;
  enabled?: boolean;
  organizationId?: string;
  projectId?: string;
};

export const aiProviderConfigs = pgTable(
  "ai_provider_configs",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    provider: aiProviderEnum("provider").notNull(),
    label: text("label").notNull(),
    keySource: aiKeySourceEnum("key_source").default("byok").notNull(),
    config: jsonb("config").$type<AiProviderConfig>().notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("ai_provider_configs_owner_idx").on(t.ownerAddress),
    index("ai_provider_configs_owner_provider_idx").on(t.ownerAddress, t.provider),
  ],
);

export const aiUsageLogs = pgTable(
  "ai_usage_logs",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    userId: text("user_id"),
    provider: aiProviderEnum("provider").notNull(),
    model: text("model").notNull(),
    feature: aiFeatureEnum("feature").notNull(),
    documentId: text("document_id"),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    latencyMs: integer("latency_ms").default(0).notNull(),
    costCents: integer("cost_cents").default(0).notNull(),
    keySource: aiKeySourceEnum("key_source").default("platform").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("ai_usage_logs_owner_created_idx").on(t.ownerAddress, t.createdAt),
    index("ai_usage_logs_owner_feature_idx").on(t.ownerAddress, t.feature),
    index("ai_usage_logs_document_idx").on(t.documentId),
  ],
);

export const aiRateLimitModeEnum = pgEnum("ai_rate_limit_mode", ["platform", "admin"]);

export const aiRateLimits = pgTable(
  "ai_rate_limits",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    userId: text("user_id"),
    feature: aiFeatureEnum("feature"),
    mode: aiRateLimitModeEnum("mode").default("platform").notNull(),
    requestsPerMonth: integer("requests_per_month").default(500).notNull(),
    requestsPerDay: integer("requests_per_day"),
    tokensPerMonth: integer("tokens_per_month").default(1000000).notNull(),
    maxRequestsPerHour: integer("max_requests_per_hour").default(30).notNull(),
    maxRequestsPerWeek: integer("max_requests_per_week").default(200).notNull(),
    adminRequestsPerHour: integer("admin_requests_per_hour"),
    adminRequestsPerDay: integer("admin_requests_per_day"),
    adminRequestsPerMonth: integer("admin_requests_per_month"),
    adminTokensPerHour: integer("admin_tokens_per_hour"),
    adminTokensPerDay: integer("admin_tokens_per_day"),
    adminTokensPerMonth: integer("admin_tokens_per_month"),
    currentHourRequests: integer("current_hour_requests").default(0).notNull(),
    currentHourTokens: integer("current_hour_tokens").default(0).notNull(),
    currentDayRequests: integer("current_day_requests").default(0).notNull(),
    currentDayTokens: integer("current_day_tokens").default(0).notNull(),
    currentWeekRequests: integer("current_week_requests").default(0).notNull(),
    currentMonthRequests: integer("current_month_requests").default(0).notNull(),
    currentMonthTokens: integer("current_month_tokens").default(0).notNull(),
    hourWindowResetAt: timestamp("hour_window_reset_at"),
    dayWindowResetAt: timestamp("day_window_reset_at"),
    weekWindowResetAt: timestamp("week_window_reset_at"),
    monthWindowResetAt: timestamp("month_window_reset_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("ai_rate_limits_owner_user_idx").on(t.ownerAddress, t.userId)],
);

export type AiChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: {
    editOperations?: AiEditOperation[];
    selectedRange?: { start: number; end: number };
    fieldContext?: string[];
  };
};

export type AiEditOperation =
  | { op: "insert_token"; index: number; token: Record<string, unknown> }
  | { op: "delete_token"; index: number }
  | { op: "update_token"; index: number; updates: Record<string, unknown> }
  | { op: "update_field"; fieldId: string; updates: Record<string, unknown> }
  | {
      op: "add_field";
      afterTokenIndex: number;
      field: Record<string, unknown>;
    }
  | { op: "remove_field"; fieldId: string };

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    documentId: text("document_id").references(() => documents.id, {
      onDelete: "cascade",
    }),
    feature: aiFeatureEnum("feature").notNull(),
    title: text("title"),
    messages: jsonb("messages").$type<AiChatMessage[]>().default([]).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("ai_conversations_owner_doc_idx").on(t.ownerAddress, t.documentId),
    index("ai_conversations_doc_feature_idx").on(t.documentId, t.feature),
  ],
);

export type ConnectorCapabilities = {
  supportedTools?: string[];
  localModels?: string[];
  maxConcurrency?: number;
};

export const connectorSessions = pgTable(
  "connector_sessions",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    userId: text("user_id"),
    connectorVersion: text("connector_version"),
    machineId: text("machine_id"),
    label: text("label"),
    status: connectorStatusEnum("status").default("offline").notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at"),
    capabilities: jsonb("capabilities").$type<ConnectorCapabilities>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("connector_sessions_owner_idx").on(t.ownerAddress),
    index("connector_sessions_owner_status_idx").on(t.ownerAddress, t.status),
  ],
);

export const connectorAccessTokens = pgTable(
  "connector_access_tokens",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    userId: text("user_id"),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull(),
    scopes: jsonb("scopes").$type<string[]>().default([]).notNull(),
    expiresAt: timestamp("expires_at"),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("connector_tokens_hash_idx").on(t.tokenHash), index("connector_tokens_owner_idx").on(t.ownerAddress)],
);

export const connectorTasks = pgTable(
  "connector_tasks",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    connectorSessionId: text("connector_session_id")
      .notNull()
      .references(() => connectorSessions.id, { onDelete: "cascade" }),
    ownerAddress: text("owner_address").notNull(),
    taskType: text("task_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").default("pending").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    claimedAt: timestamp("claimed_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("connector_tasks_session_status_idx").on(t.connectorSessionId, t.status),
    index("connector_tasks_owner_idx").on(t.ownerAddress),
  ],
);

// ── Server AI Runtime ──

export const runtimeToolEnum = pgEnum("runtime_tool", ["claude-code", "codex", "openclaw"]);
export const runtimeInstallStatusEnum = pgEnum("runtime_install_status", [
  "not_installed",
  "installing",
  "installed",
  "auth_pending",
  "ready",
  "error",
]);
export const runtimeAuthStatusEnum = pgEnum("runtime_auth_status", ["none", "pending", "authorized", "expired"]);
export const runtimeSessionStatusEnum = pgEnum("runtime_session_status", ["starting", "active", "idle", "dead"]);

export type RuntimeConfig = {
  maxSessionsPerTool?: number;
  idleTimeoutMs?: number;
  requestTimeoutMs?: number;
  enabledForUsers?: boolean;
  fiveHourMaxRequests?: number;
};

export type RuntimeAuthCredentials = {
  iv: string;
  ciphertext: string;
  tag: string;
};

export const aiRuntimeInstalls = pgTable("ai_runtime_installs", {
  id: text("id").primaryKey().$defaultFn(createId),
  tool: runtimeToolEnum("tool").notNull().unique(),
  status: runtimeInstallStatusEnum("status").default("not_installed").notNull(),
  binaryPath: text("binary_path"),
  version: text("version"),
  authStatus: runtimeAuthStatusEnum("auth_status").default("none").notNull(),
  authCredentials: jsonb("auth_credentials").$type<RuntimeAuthCredentials>(),
  installMethod: text("install_method"),
  lastHealthCheckAt: timestamp("last_health_check_at"),
  errorMessage: text("error_message"),
  config: jsonb("config").$type<RuntimeConfig>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const aiRuntimeSessions = pgTable(
  "ai_runtime_sessions",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    tool: runtimeToolEnum("tool").notNull(),
    pid: integer("pid"),
    status: runtimeSessionStatusEnum("status").default("starting").notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    lastActivityAt: timestamp("last_activity_at"),
    requestCount: integer("request_count").default(0).notNull(),
    errorCount: integer("error_count").default(0).notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ai_runtime_sessions_tool_status_idx").on(t.tool, t.status)],
);

export type AiRuntimeInstall = typeof aiRuntimeInstalls.$inferSelect;
export type AiRuntimeSession = typeof aiRuntimeSessions.$inferSelect;

// ── Platform configuration ──

export const platformConfig = pgTable("platform_config", {
  id: text("id").primaryKey().default("singleton"),
  ownerAddress: text("owner_address").notNull(),
  ownerChain: walletChainEnum("owner_chain").notNull(),
  claimedAt: timestamp("claimed_at").defaultNow().notNull(),
  setupSignature: text("setup_signature").notNull(),
});

export type PlatformConfig = typeof platformConfig.$inferSelect;

// ── Premium type aliases ──

export type AiProviderConfigRecord = typeof aiProviderConfigs.$inferSelect;
export type NewAiProviderConfigRecord = typeof aiProviderConfigs.$inferInsert;
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;
export type AiConversation = typeof aiConversations.$inferSelect;
export type ConnectorSession = typeof connectorSessions.$inferSelect;
export type ConnectorAccessToken = typeof connectorAccessTokens.$inferSelect;
export type ConnectorTask = typeof connectorTasks.$inferSelect;

// ── Verification Sessions ──

export const verificationProviderEnum = pgEnum("verification_provider", [
  "x",
  "github",
  "discord",
  "google",
  "email",
  "wallet",
  "idv",
]);

export const verificationSessions = pgTable(
  "verification_sessions",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    identifier: text("identifier").notNull(),
    provider: verificationProviderEnum("provider").notNull(),
    profileId: text("profile_id"),
    displayName: text("display_name"),
    verifiedAt: timestamp("verified_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    chain: walletChainEnum("chain"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("verification_sessions_identifier_idx").on(t.identifier),
    index("verification_sessions_provider_idx").on(t.provider),
    unique("verification_sessions_identifier_provider_uniq").on(t.identifier, t.provider),
    index("verification_sessions_expires_at_idx").on(t.expiresAt),
  ],
);

export type VerificationSession = typeof verificationSessions.$inferSelect;
export type NewVerificationSession = typeof verificationSessions.$inferInsert;
