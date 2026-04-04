import { pgTable, text, timestamp, pgEnum, index, unique, jsonb, integer, boolean } from "drizzle-orm/pg-core";
import { createId } from "./utils";
import type { SignerTokenGate } from "~/lib/token-gates";

export const docStatusEnum = pgEnum("doc_status", ["PENDING", "COMPLETED", "EXPIRED", "VOIDED"]);

export const signStatusEnum = pgEnum("sign_status", ["PENDING", "SIGNED", "DECLINED"]);

export const walletChainEnum = pgEnum("wallet_chain", ["ETH", "SOL", "BTC", "BASE"]);

/** Proof mode determines the architecture for a document. */
export const proofModeEnum = pgEnum("proof_mode", [
  "PRIVATE", // Web2 only: email signing, off-chain audit trail
  "HYBRID", // Web2 + Web3: email or wallet signing, hash anchored on-chain
  "CRYPTO_NATIVE", // Web3 only: wallet signing, hash anchored, optional on-chain storage
]);

/** How a signer authenticates — wallet vs email verification. */
export const signMethodEnum = pgEnum("sign_method", [
  "WALLET", // Crypto wallet signature (existing)
  "EMAIL_OTP", // Email OTP verification + explicit consent
]);

export const recipientRoleEnum = pgEnum("recipient_role", ["SIGNER", "APPROVER", "CC", "WITNESS", "OBSERVER"]);

export const integrationKindEnum = pgEnum("integration_kind", ["SMS", "PAYMENT", "IDV", "SSO", "ADDRESS", "FORENSIC"]);

/** Identity verification level per signer. */
export const identityLevelEnum = pgEnum("identity_level", [
  "L0_WALLET", // Wallet only (anonymous)
  "L1_EMAIL", // Email verification
  "L2_VERIFIED", // Email + IP/device logs
  "L3_KYC", // Optional KYC (extensible)
]);

/** Audit event types for the immutable event log. */
export const auditEventTypeEnum = pgEnum("audit_event_type", [
  "DOCUMENT_CREATED",
  "DOCUMENT_VIEWED",
  "DOCUMENT_COMPLETED",
  "DOCUMENT_VOIDED",
  "DOCUMENT_EXPIRED",
  "SIGNER_INVITED",
  "SIGNER_VIEWED",
  "SIGNER_SIGNED",
  "SIGNER_DECLINED",
  "SIGNER_OTP_SENT",
  "SIGNER_OTP_VERIFIED",
  "SIGNATURE_VERIFIED",
  "PROOF_PACKET_GENERATED",
  "AUDIT_HASH_ANCHORED",
  "ACCESS_REFRESHED",
]);

export type PostSignReveal = {
  enabled: boolean;
  summary?: string;
  sections?: Array<{
    title: string;
    content: string;
    icon?: string;
  }>;
  downloads?: Array<{
    label: string;
    filename: string;
    description?: string;
    icon?: string;
    uploadedByAddress?: string;
    uploadedByLabel?: string;
    uploadedAt?: string;
  }>;
  testbedAccess?: {
    enabled: boolean;
    description?: string;
    proxyEndpoint?: string;
  };
};

export type SignerField = {
  id?: string;
  type: string;
  label: string;
  value: string | null;
  required: boolean;
  options?: string[];
  settings?: Record<string, unknown>;
};

export type DeliveryMethod = "EMAIL" | "SMS";

export type ReminderCadence = "NONE" | "DAILY" | "EVERY_2_DAYS" | "EVERY_3_DAYS" | "WEEKLY";

export type ReminderConfig = {
  enabled: boolean;
  cadence: ReminderCadence;
  maxSends: number;
  sentCount?: number;
  lastSentAt?: string;
  nextReminderAt?: string;
  channels?: DeliveryMethod[];
};

export type BrandingSettings = {
  brandName?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  emailFromName?: string;
  emailReplyTo?: string;
  emailFooter?: string;
  signingIntro?: string;
  emailIntro?: string;
};

export type IntegrationConfig = {
  provider: string;
  enabled?: boolean;
  from?: string;
  senderId?: string;
  accountSid?: string;
  authToken?: string;
  apiKey?: string;
  apiSecret?: string;
  clientId?: string;
  clientSecret?: string;
  profileId?: string;
  endpoint?: string;
  issuer?: string;
  scopes?: string[];
  headers?: Record<string, string>;
  metadata?: Record<string, string | number | boolean>;
};

export type TemplateSigner = {
  label: string;
  email?: string | null;
  phone?: string | null;
  role?: "SIGNER" | "APPROVER" | "CC" | "WITNESS" | "OBSERVER";
  deliveryMethods?: DeliveryMethod[];
  fields?: SignerField[];
  tokenGates?: SignerTokenGate | null;
};

export type TemplateDefaults = {
  proofMode?: "PRIVATE" | "HYBRID" | "CRYPTO_NATIVE";
  signingOrder?: "parallel" | "sequential";
  expiresInDays?: number;
  reminder?: ReminderConfig;
};

export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    title: text("title").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull().unique(),
    createdBy: text("created_by").notNull(),
    createdByEmail: text("created_by_email"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at"),
    status: docStatusEnum("status").default("PENDING").notNull(),
    accessToken: text("access_token").notNull().unique(),
    ipfsCid: text("ipfs_cid"),
    // Post-signing reveal content — only shown after the user signs
    postSignReveal: jsonb("post_sign_reveal").$type<PostSignReveal>(),

    // ── Proof mode & signing flow ──
    proofMode: proofModeEnum("proof_mode").default("HYBRID").notNull(),
    signingOrder: text("signing_order").default("parallel").notNull(), // "parallel" | "sequential"
    // For sequential signing: which signer index is currently active (0-based)
    currentSignerIndex: integer("current_signer_index").default(0),

    // ── Encryption at rest ──
    // When enabled, `content` stores AES-256-GCM encrypted base64 blob
    encryptedAtRest: boolean("encrypted_at_rest").default(false).notNull(),
    // The document encryption key, itself encrypted with the server master key
    encryptionKeyWrapped: text("encryption_key_wrapped"),
    // ── Eye/gaze tracking requirement ──
    // "off" = no gaze tracking, "full" = entire document, "signing_only" = wallet+signature steps
    gazeTracking: text("gaze_tracking").default("off").notNull(), // "off" | "full" | "signing_only"

    templateId: text("template_id"),
    brandingProfileId: text("branding_profile_id"),
    pdfStyleTemplateId: text("pdf_style_template_id"),
    reminderConfig: jsonb("reminder_config").$type<ReminderConfig>(),

    // ── Document Groups (batch signing) ──
    // All documents sharing the same groupId are siblings.
    // The discloser signs once and the signature propagates to all.
    groupId: text("group_id"),
  },
  (t) => [
    index("documents_created_by_idx").on(t.createdBy),
    index("documents_content_hash_idx").on(t.contentHash),
    index("documents_access_token_idx").on(t.accessToken),
    index("documents_ipfs_cid_idx").on(t.ipfsCid),
    index("documents_proof_mode_idx").on(t.proofMode),
    index("documents_group_id_idx").on(t.groupId),
  ],
);

export const signers = pgTable(
  "signers",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    address: text("address"),
    chain: walletChainEnum("chain"),
    email: text("email"),
    status: signStatusEnum("status").default("PENDING").notNull(),
    signature: text("signature"),
    signedAt: timestamp("signed_at"),
    scheme: text("scheme"),
    handSignatureData: text("hand_signature_data"),
    handSignatureHash: text("hand_signature_hash"),
    // Hash of (contentHash + all field values) at time of signing — proves signer
    // saw the specific document state, not just the template.
    documentStateHash: text("document_state_hash"),
    // ── Finalization (discloser's second wallet sig covering the complete document) ──
    finalizationSignature: text("finalization_signature"),
    finalizationStateHash: text("finalization_state_hash"),
    finalizationSignedAt: timestamp("finalization_signed_at"),
    // For bulk finalization: the full message that was signed, containing all
    // individual state hashes. Stored on each contract so any single contract
    // is independently verifiable in court without needing the siblings.
    finalizationMessage: text("finalization_message"),
    fields: jsonb("fields").$type<SignerField[]>(),
    fieldValues: jsonb("field_values").$type<Record<string, string>>(),
    tokenGates: jsonb("token_gates").$type<SignerTokenGate>(),
    claimToken: text("claim_token").notNull().unique(),
    lastIp: text("last_ip"),
    ipUpdatedAt: timestamp("ip_updated_at"),

    // ── Email signing (Web2 mode) ──
    signMethod: signMethodEnum("sign_method").default("WALLET").notNull(),
    // Email OTP fields
    otpCode: text("otp_code"),
    otpExpiresAt: timestamp("otp_expires_at"),
    otpVerifiedAt: timestamp("otp_verified_at"),
    // Explicit consent for ESIGN/UETA compliance
    consentText: text("consent_text"),
    consentAt: timestamp("consent_at"),
    phone: text("phone"),
    deliveryMethods: jsonb("delivery_methods").$type<DeliveryMethod[]>(),
    role: recipientRoleEnum("role").default("SIGNER").notNull(),
    declineReason: text("decline_reason"),
    declinedAt: timestamp("declined_at"),

    // ── Identity level ──
    identityLevel: identityLevelEnum("identity_level").default("L0_WALLET").notNull(),

    // ── Sequential signing order (0-based position) ──
    signerOrder: integer("signer_order").default(0).notNull(),

    // ── Device/session metadata captured at signing ──
    userAgent: text("user_agent"),

    // ── Social verification results (OAuth-verified accounts) ──
    socialVerifications: jsonb("social_verifications").$type<
      Array<{
        provider: "x" | "github" | "discord" | "google";
        username: string;
        profileId: string;
        verifiedAt: string;
        fieldId: string;
      }>
    >(),

    // ── Account linking ──
    // Set when a user creates an account and their verified identifiers
    // match this signer. Links guest signing history to their account.
    userId: text("user_id"),

    // ── Forensic evidence packet (device fingerprint, geo, behavioral) ──
    forensicEvidence: jsonb("forensic_evidence"),
    forensicHash: text("forensic_hash"),

    // ── Document Group role ──
    // "discloser" = shared signer whose signature propagates across group siblings.
    // "recipient" or null = normal per-document signer.
    groupRole: text("group_role"),
  },
  (t) => [
    unique("signers_doc_address_uniq").on(t.documentId, t.address),
    index("signers_address_idx").on(t.address),
    index("signers_document_id_idx").on(t.documentId),
    index("signers_claim_token_idx").on(t.claimToken),
  ],
);

export const walletSessions = pgTable(
  "wallet_sessions",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    token: text("token").notNull().unique(),
    address: text("address").notNull(),
    chain: walletChainEnum("chain").notNull(),
    userId: text("user_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [
    index("wallet_sessions_token_idx").on(t.token),
    index("wallet_sessions_address_idx").on(t.address, t.chain),
    index("wallet_sessions_user_idx").on(t.userId),
  ],
);

/**
 * Per-wallet feature overrides for operator/dev control.
 *
 * This lets an owner wallet or a dev session enable/disable features for a
 * specific wallet without changing the deployment-wide premium runtime.
 */
export const featureOverrides = pgTable(
  "feature_overrides",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userAddress: text("user_address").notNull(),
    userChain: walletChainEnum("user_chain").notNull(),
    featureId: text("feature_id").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedBy: text("updated_by").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("feature_overrides_user_feature_uniq").on(t.userAddress, t.userChain, t.featureId),
    index("feature_overrides_user_idx").on(t.userAddress, t.userChain),
    index("feature_overrides_feature_idx").on(t.featureId),
  ],
);

export const authChallenges = pgTable(
  "auth_challenges",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    nonce: text("nonce").notNull().unique(),
    address: text("address").notNull(),
    chain: walletChainEnum("chain").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumed: timestamp("consumed"),
  },
  (t) => [index("auth_challenges_nonce_idx").on(t.nonce)],
);

// Mobile signing sessions — QR code → phone → signature → back to desktop
export const mobileSignSessions = pgTable(
  "mobile_sign_sessions",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    token: text("token").notNull().unique(),
    documentId: text("document_id").notNull(),
    signerLabel: text("signer_label").notNull(),
    status: text("status").notNull().default("waiting"), // waiting | signed | expired
    signatureData: text("signature_data"), // base64 PNG from phone
    metadata: jsonb("metadata"), // mobile forensic data (device info, timed strokes, fingerprint)
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [index("mobile_sign_token_idx").on(t.token)],
);

// ── Immutable audit event log (append-only) ──
export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    eventType: auditEventTypeEnum("event_type").notNull(),
    // Actor: wallet address, email, or "system"
    actor: text("actor").notNull(),
    actorType: text("actor_type").notNull().default("wallet"), // "wallet" | "email" | "system"
    // Metadata captured at event time
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // Additional structured data per event
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    // Running hash: SHA-256(prevHash + eventData) for tamper detection
    eventHash: text("event_hash").notNull(),
    prevEventHash: text("prev_event_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("audit_events_document_idx").on(t.documentId),
    index("audit_events_type_idx").on(t.eventType),
    index("audit_events_created_idx").on(t.createdAt),
    index("audit_events_actor_idx").on(t.actor),
  ],
);

// ── Better Auth user accounts (Web2 login) ──
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    email: text("email").notNull().unique(),
    name: text("name"),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    // Link to wallet address if they also connect a wallet
    walletAddress: text("wallet_address"),
    walletChain: walletChainEnum("wallet_chain"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("users_email_idx").on(t.email), index("users_wallet_idx").on(t.walletAddress)],
);

export const mergeRequestStatusEnum = pgEnum("account_merge_request_status", ["PENDING", "DISMISSED", "MERGED"]);

export const userWallets = pgTable(
  "user_wallets",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    chain: walletChainEnum("chain").notNull(),
    isPrimary: boolean("is_primary").default(false).notNull(),
    verifiedAt: timestamp("verified_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("user_wallets_chain_address_uniq").on(t.chain, t.address),
    index("user_wallets_user_idx").on(t.userId),
    index("user_wallets_address_idx").on(t.address, t.chain),
    index("user_wallets_primary_idx").on(t.userId, t.isPrimary),
  ],
);

export const accountMergeRequests = pgTable(
  "account_merge_requests",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    currentUserId: text("current_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conflictingUserId: text("conflicting_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    walletAddress: text("wallet_address").notNull(),
    walletChain: walletChainEnum("wallet_chain").notNull(),
    email: text("email"),
    reason: text("reason"),
    status: mergeRequestStatusEnum("status").default("PENDING").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [
    unique("account_merge_requests_user_wallet_uniq").on(
      t.currentUserId,
      t.conflictingUserId,
      t.walletChain,
      t.walletAddress,
    ),
    index("account_merge_requests_current_idx").on(t.currentUserId, t.status),
    index("account_merge_requests_conflicting_idx").on(t.conflictingUserId, t.status),
    index("account_merge_requests_wallet_idx").on(t.walletAddress, t.walletChain, t.status),
  ],
);

// Better Auth accounts table (social/email providers)
export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    idToken: text("id_token"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

// Better Auth verification tokens (email verify, password reset, magic links)
export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("sessions_token_idx").on(t.token), index("sessions_user_idx").on(t.userId)],
);

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

export type PdfStyleSettings = {
  themePreset: string;
  customOverrides?: Record<string, unknown>;
  tocEnabled?: boolean;
  tocPageThreshold?: number;
  fieldSummaryStyle?: "hybrid" | "cards" | "table";
  fieldIndexEnabled?: boolean;
  fieldIndexPerSigner?: boolean;
  fieldIndexCombined?: boolean;
};

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

// ── AI Provider & Usage ──

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
  "platform", // Proofmark-managed key
  "byok", // User's own API key
  "enterprise_shared", // Shared from enterprise admin
  "connector", // Via OpenClaw connector
  "server_runtime", // Server-local CLI (Claude Code, Codex)
]);

export const aiFeatureEnum = pgEnum("ai_feature", [
  "scraper_fix", // Smart PDF analysis fix
  "editor_assistant", // Guided document editing
  "signer_qa", // Signer document Q&A
  "general", // General-purpose AI calls
]);

export const connectorStatusEnum = pgEnum("connector_status", ["online", "offline", "error"]);

/** Per-account AI provider configuration (BYOK keys, model preferences). */
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

export type AiProviderConfig = {
  apiKey?: string; // Encrypted at rest
  baseUrl?: string; // Custom endpoint (e.g. LiteLLM proxy)
  defaultModel?: string; // e.g. "claude-sonnet-4-20250514", "gpt-4o"
  fallbackProvider?: string; // Provider ID to fall back to on failure
  maxTokens?: number;
  temperature?: number;
  enabled?: boolean;
  organizationId?: string; // For OpenAI org headers
  projectId?: string; // For provider-specific project scoping
};

/** Append-only AI usage log for cost tracking and analytics. */
export const aiUsageLogs = pgTable(
  "ai_usage_logs",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    userId: text("user_id"), // For enterprise per-user tracking
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

export const aiRateLimitModeEnum = pgEnum("ai_rate_limit_mode", [
  "platform", // Simple monthly cap with hourly/weekly circuit breakers (what users get from us)
  "admin", // Enterprise admin sets per-user granular limits
]);

/**
 * AI rate limits — two modes:
 *
 * "platform" mode (for regular users on our AI):
 *   Monthly request/token allowance. Soft circuit breakers pause usage
 *   if a user burns through too much in a short window (5 req/hour or
 *   weekly burst). Resets monthly. Simple and user-friendly.
 *
 * "admin" mode (enterprise sharing their own keys to team members):
 *   Granular per-user limits set by the admin. Hard caps on requests
 *   and tokens per hour/day/month. Admin controls everything.
 */
export const aiRateLimits = pgTable(
  "ai_rate_limits",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    userId: text("user_id"), // null = account-level limit
    feature: aiFeatureEnum("feature"), // null = applies to all features
    mode: aiRateLimitModeEnum("mode").default("platform").notNull(),

    // ── Platform mode: simple monthly cap + circuit breakers ──
    requestsPerMonth: integer("requests_per_month").default(500).notNull(),
    requestsPerDay: integer("requests_per_day"), // null = no daily cap; free tier: 3
    tokensPerMonth: integer("tokens_per_month").default(1000000).notNull(),
    // Circuit breakers — soft pause if user is burning through too fast
    maxRequestsPerHour: integer("max_requests_per_hour").default(30).notNull(),
    maxRequestsPerWeek: integer("max_requests_per_week").default(200).notNull(),

    // ── Admin mode: granular per-user limits (enterprise) ──
    adminRequestsPerHour: integer("admin_requests_per_hour"),
    adminRequestsPerDay: integer("admin_requests_per_day"),
    adminRequestsPerMonth: integer("admin_requests_per_month"),
    adminTokensPerHour: integer("admin_tokens_per_hour"),
    adminTokensPerDay: integer("admin_tokens_per_day"),
    adminTokensPerMonth: integer("admin_tokens_per_month"),

    // ── Rolling counters ──
    currentHourRequests: integer("current_hour_requests").default(0).notNull(),
    currentHourTokens: integer("current_hour_tokens").default(0).notNull(),
    currentDayRequests: integer("current_day_requests").default(0).notNull(),
    currentDayTokens: integer("current_day_tokens").default(0).notNull(),
    currentWeekRequests: integer("current_week_requests").default(0).notNull(),
    currentMonthRequests: integer("current_month_requests").default(0).notNull(),
    currentMonthTokens: integer("current_month_tokens").default(0).notNull(),

    // ── Window resets ──
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
  | { op: "add_field"; afterTokenIndex: number; field: Record<string, unknown> }
  | { op: "remove_field"; fieldId: string };

/** Persisted AI conversation threads (editor assistant + signer Q&A). */
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    ownerAddress: text("owner_address").notNull(),
    documentId: text("document_id").references(() => documents.id, { onDelete: "cascade" }),
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

/** OpenClaw Connector sessions — tracks active connector instances. */
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

export type ConnectorCapabilities = {
  supportedTools?: string[]; // ["claude-code", "codex", "openclaw"]
  localModels?: string[]; // Locally available models
  maxConcurrency?: number;
};

/** Access tokens for connector-to-platform authentication. */
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

/** Pending tasks for connectors to pick up (message queue pattern). */
export const connectorTasks = pgTable(
  "connector_tasks",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    connectorSessionId: text("connector_session_id")
      .notNull()
      .references(() => connectorSessions.id, { onDelete: "cascade" }),
    ownerAddress: text("owner_address").notNull(),
    taskType: text("task_type").notNull(), // "ai_completion" | "code_edit" | "code_review"
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").default("pending").notNull(), // pending | claimed | completed | failed
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
  "not_installed", "installing", "installed", "auth_pending", "ready", "error",
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

/** Server-side AI CLI installs — tracks Claude Code, Codex, OpenClaw on the host. */
export const aiRuntimeInstalls = pgTable(
  "ai_runtime_installs",
  {
    id: text("id").primaryKey().$defaultFn(createId),
    tool: runtimeToolEnum("tool").notNull().unique(),
    status: runtimeInstallStatusEnum("status").default("not_installed").notNull(),
    binaryPath: text("binary_path"),
    version: text("version"),
    authStatus: runtimeAuthStatusEnum("auth_status").default("none").notNull(),
    authCredentials: jsonb("auth_credentials").$type<RuntimeAuthCredentials>(),
    installMethod: text("install_method"), // "npm" | "cargo" | "manual"
    lastHealthCheckAt: timestamp("last_health_check_at"),
    errorMessage: text("error_message"),
    config: jsonb("config").$type<RuntimeConfig>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

/** Persistent CLI pipe sessions — tracks running Claude/Codex processes on the server. */
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
  (t) => [
    index("ai_runtime_sessions_tool_status_idx").on(t.tool, t.status),
  ],
);

export type AiRuntimeInstall = typeof aiRuntimeInstalls.$inferSelect;
export type AiRuntimeSession = typeof aiRuntimeSessions.$inferSelect;

// ── Platform configuration (single-row, set on first-time setup) ──

export const platformConfig = pgTable("platform_config", {
  id: text("id").primaryKey().default("singleton"),
  ownerAddress: text("owner_address").notNull(),
  ownerChain: walletChainEnum("owner_chain").notNull(),
  claimedAt: timestamp("claimed_at").defaultNow().notNull(),
  setupSignature: text("setup_signature").notNull(),
});

export type PlatformConfig = typeof platformConfig.$inferSelect;

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Signer = typeof signers.$inferSelect;
export type NewSigner = typeof signers.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type WalletSession = typeof walletSessions.$inferSelect;
export type AuthChallenge = typeof authChallenges.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type User = typeof users.$inferSelect;
export type UserWallet = typeof userWallets.$inferSelect;
export type AccountMergeRequest = typeof accountMergeRequests.$inferSelect;
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
export type AiProviderConfigRecord = typeof aiProviderConfigs.$inferSelect;
export type NewAiProviderConfigRecord = typeof aiProviderConfigs.$inferInsert;
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;
export type AiConversation = typeof aiConversations.$inferSelect;
export type ConnectorSession = typeof connectorSessions.$inferSelect;
export type ConnectorAccessToken = typeof connectorAccessTokens.$inferSelect;
export type ConnectorTask = typeof connectorTasks.$inferSelect;

// ── Verification Sessions ──
// Tracks identity verifications (social OAuth, wallet, email, IDV) across
// contracts. Once verified, the session can be reused within the expiry window.

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
    // The verified identity — normalized (lowercase email, lowercase address, lowercase handle)
    identifier: text("identifier").notNull(),
    // Which provider verified this identity
    provider: verificationProviderEnum("provider").notNull(),
    // Provider-specific profile ID (e.g. X user ID, GitHub user ID)
    profileId: text("profile_id"),
    // Display name / username from the provider
    displayName: text("display_name"),
    // When the verification happened
    verifiedAt: timestamp("verified_at").defaultNow().notNull(),
    // When this session expires and re-verification is needed
    expiresAt: timestamp("expires_at").notNull(),
    // Optional: the wallet chain if provider is "wallet"
    chain: walletChainEnum("chain"),
    // Additional provider metadata (avatar URL, scope, etc.)
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
