/**
 * Workspace & configuration tables — split from schema.ts for file-length compliance.
 *
 * Contains: vaults, managed wallets, document key shares, document search index,
 * branding, integrations, templates, PDF style templates, webhooks.
 */
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import {
  type BrandingSettings,
  documents,
  type IntegrationConfig,
  type PdfStyleSettings,
  type TemplateDefaults,
  type TemplateSigner,
  users,
} from "./schema";
import { integrationKindEnum, walletChainEnum } from "./schema-enums";
import { createId } from "./utils";

// ── Client-side key vault (zero-knowledge — server never sees raw DEK) ──

/** Methods that can unlock the user's DEK. */
export const vaultUnlockMethodEnum = pgEnum("vault_unlock_method", [
  "PASSWORD", // Argon2id(password) → KEK → wraps DEK (not recommended)
  "DEVICE_PASSCODE", // WebAuthn PRF with device biometrics/PIN
  "HARDWARE_KEY", // FIDO2 hardware security key (YubiKey, etc.)
  "TOTP_2FA", // TOTP combined with a recovery key
]);

/**
 * User key vault — stores the encrypted DEK(s) for each user.
 * The DEK is generated client-side and NEVER sent to the server in plaintext.
 * Each row is a different unlock method that can decrypt the same DEK.
 */
export const userVaults = pgTable(
  "user_vaults",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    unlockMethod: vaultUnlockMethodEnum("unlock_method").notNull(),
    // DEK wrapped (encrypted) by the KEK derived from this unlock method
    // Base64-encoded: [salt][iv][wrapped_dek][auth_tag]
    wrappedDek: text("wrapped_dek").notNull(),
    // Key derivation parameters (JSON: algorithm, salt, iterations, etc.)
    kdfParams: jsonb("kdf_params")
      .$type<{
        algorithm: string; // "argon2id" | "webauthn-prf" | "hkdf"
        salt: string; // Base64 salt
        iterations?: number; // For password-based KDF
        memory?: number; // Argon2 memory cost
        credentialId?: string; // WebAuthn credential ID
      }>()
      .notNull(),
    // Optional label for the user to identify this method
    label: text("label"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at"),
  },
  (t) => [index("user_vaults_user_idx").on(t.userId), index("user_vaults_method_idx").on(t.userId, t.unlockMethod)],
);

/**
 * Managed wallets — auto-generated for Web2 users who don't have their own.
 * Private keys are encrypted with the user's DEK (zero-knowledge).
 * The server stores only encrypted blobs.
 */
export const managedWallets = pgTable(
  "managed_wallets",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chain: walletChainEnum("chain").notNull(),
    // Public address — stored in plaintext (it's public)
    address: text("address").notNull(),
    publicKey: text("public_key").notNull(),
    // Private key encrypted with user's DEK — NEVER decryptable by server
    // Base64: [iv][encrypted_privkey][auth_tag]
    encryptedPrivateKey: text("encrypted_private_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("managed_wallets_user_idx").on(t.userId),
    unique("managed_wallets_user_chain_uniq").on(t.userId, t.chain),
  ],
);

/**
 * Document key shares — for on-chain encrypted document storage.
 * Each authorized party gets a copy of the document DEK encrypted
 * with their wallet's public key. On Base/SOL this is contract-gated;
 * on BTC it's ordinal inscription under the party's child.
 */
export const documentKeyShares = pgTable(
  "document_key_shares",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    // The wallet that can decrypt this share
    recipientAddress: text("recipient_address").notNull(),
    recipientChain: walletChainEnum("recipient_chain").notNull(),
    // Document DEK encrypted with recipient's public key
    // On Base/SOL: ECIES (secp256k1/ed25519) encrypted DEK
    // On BTC: same, stored as ordinal child data
    encryptedDocumentKey: text("encrypted_document_key").notNull(),
    // On-chain reference (contract address / inscription ID)
    onChainRef: text("on_chain_ref"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("doc_key_shares_doc_idx").on(t.documentId),
    index("doc_key_shares_recipient_idx").on(t.recipientAddress),
  ],
);

// ── Search index (plaintext metadata — NEVER sensitive content) ──
// Populated at document creation time with non-sensitive fields.
// Even when document content is encrypted, this lets users search/filter.

export const documentIndex = pgTable(
  "document_index",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" })
      .unique(),
    // Owner (wallet address or user ID) — for scoping searches
    ownerId: text("owner_id").notNull(),

    // ── Searchable metadata (all plaintext, non-sensitive) ──
    title: text("title").notNull(),
    // First ~100 chars of content (or empty if encrypted/sensitive)
    snippet: text("snippet").default(""),
    status: text("status").notNull().default("PENDING"),
    proofMode: text("proof_mode").notNull().default("HYBRID"),

    // Counts for quick filtering
    signerCount: integer("signer_count").notNull().default(0),
    signedCount: integer("signed_count").notNull().default(0),

    // Signer labels (non-sensitive — e.g. "Party A, Party B")
    signerLabels: text("signer_labels").default(""),
    // Signer email domains only (e.g. "gmail.com, company.co") — NOT full emails
    signerDomains: text("signer_domains").default(""),

    // Tags — user-defined labels for organization
    tags: jsonb("tags").$type<string[]>().default([]),

    // Document type / category
    category: text("category"), // "NDA" | "SERVICE_AGREEMENT" | "INVOICE" | etc.

    // Partial content hash (first 8 chars) — enough to search, not enough to identify
    hashPrefix: text("hash_prefix"),
    // Partial IPFS CID (first 12 chars)
    cidPrefix: text("cid_prefix"),

    // Chain anchoring status
    anchoredOnBase: boolean("anchored_on_base").default(false),
    anchoredOnSol: boolean("anchored_on_sol").default(false),
    anchoredOnBtc: boolean("anchored_on_btc").default(false),

    // Dates for range filtering
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    expiresAt: timestamp("expires_at"),
  },
  (t) => [
    index("doc_index_owner_idx").on(t.ownerId),
    index("doc_index_title_idx").on(t.title),
    index("doc_index_status_idx").on(t.ownerId, t.status),
    index("doc_index_category_idx").on(t.ownerId, t.category),
    index("doc_index_created_idx").on(t.ownerId, t.createdAt),
    index("doc_index_hash_prefix_idx").on(t.hashPrefix),
    // GIN index on tags for array containment queries
    // (Drizzle doesn't support GIN directly — use raw SQL migration)
  ],
);

export const brandingProfiles = pgTable(
  "branding_profiles",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    name: text("name").notNull(),
    settings: jsonb("settings").$type<BrandingSettings>().notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("branding_profiles_owner_idx").on(t.ownerAddress),
    index("branding_profiles_default_idx").on(t.ownerAddress, t.isDefault),
  ],
);

export const integrationConfigs = pgTable(
  "integration_configs",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    kind: integrationKindEnum("kind").notNull(),
    provider: text("provider").notNull(),
    label: text("label").notNull(),
    config: jsonb("config").$type<IntegrationConfig>().notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("integration_configs_owner_idx").on(t.ownerAddress),
    index("integration_configs_kind_idx").on(t.ownerAddress, t.kind),
    index("integration_configs_default_idx").on(t.ownerAddress, t.kind, t.isDefault),
  ],
);

export const documentTemplates = pgTable(
  "document_templates",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    signers: jsonb("signers").$type<TemplateSigner[]>().default([]).notNull(),
    defaults: jsonb("defaults").$type<TemplateDefaults>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("document_templates_owner_idx").on(t.ownerAddress),
    index("document_templates_name_idx").on(t.ownerAddress, t.name),
  ],
);

// ── PDF Style Templates ────────────────────────────────────────────────────

export const pdfStyleTemplates = pgTable(
  "pdf_style_templates",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    settings: jsonb("settings").$type<PdfStyleSettings>().notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    isBuiltIn: boolean("is_built_in").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("pdf_style_templates_owner_idx").on(t.ownerAddress)],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    label: text("label").notNull(),
    url: text("url").notNull(),
    secret: text("secret"),
    events: jsonb("events").$type<string[]>().default([]).notNull(),
    active: boolean("active").default(true).notNull(),
    lastTriggeredAt: timestamp("last_triggered_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("webhook_endpoints_owner_idx").on(t.ownerAddress),
    index("webhook_endpoints_active_idx").on(t.ownerAddress, t.active),
  ],
);

// ── Inferred types ──

export type BrandingProfile = typeof brandingProfiles.$inferSelect;
export type NewBrandingProfile = typeof brandingProfiles.$inferInsert;
export type IntegrationRecord = typeof integrationConfigs.$inferSelect;
export type NewIntegrationRecord = typeof integrationConfigs.$inferInsert;
export type DocumentTemplate = typeof documentTemplates.$inferSelect;
export type NewDocumentTemplate = typeof documentTemplates.$inferInsert;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
export type PdfStyleTemplate = typeof pdfStyleTemplates.$inferSelect;
export type NewPdfStyleTemplate = typeof pdfStyleTemplates.$inferInsert;
