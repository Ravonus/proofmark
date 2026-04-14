import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import type { SignerTokenGate } from "~/lib/token-gates";
import { walletChainEnum } from "./schema-enums";
import { createId } from "./utils";

export { integrationKindEnum, walletChainEnum } from "./schema-enums";

export const docStatusEnum = pgEnum("doc_status", [
	"PENDING",
	"COMPLETED",
	"EXPIRED",
	"VOIDED",
]);

export const signStatusEnum = pgEnum("sign_status", [
	"PENDING",
	"SIGNED",
	"DECLINED",
]);

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

export const recipientRoleEnum = pgEnum("recipient_role", [
	"SIGNER",
	"APPROVER",
	"CC",
	"WITNESS",
	"OBSERVER",
]);

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

export type PdfStyleSettings = {
	themePreset: string;
	fieldSummaryStyle: "hybrid" | "cards" | "table";
	fieldIndexEnabled?: boolean;
	fieldIndexPerSigner?: boolean;
	fieldIndexCombined?: boolean;
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

export type ReminderCadence =
	| "NONE"
	| "DAILY"
	| "EVERY_2_DAYS"
	| "EVERY_3_DAYS"
	| "WEEKLY";

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
		identityLevel: identityLevelEnum("identity_level")
			.default("L0_WALLET")
			.notNull(),

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
		unique("feature_overrides_user_feature_uniq").on(
			t.userAddress,
			t.userChain,
			t.featureId,
		),
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
		createdAt: timestamp("created_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
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
		twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
		image: text("image"),
		// Link to wallet address if they also connect a wallet
		walletAddress: text("wallet_address"),
		walletChain: walletChainEnum("wallet_chain"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(t) => [
		index("users_email_idx").on(t.email),
		index("users_wallet_idx").on(t.walletAddress),
	],
);

export const mergeRequestStatusEnum = pgEnum("account_merge_request_status", [
	"PENDING",
	"DISMISSED",
	"MERGED",
]);

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
		index("account_merge_requests_conflicting_idx").on(
			t.conflictingUserId,
			t.status,
		),
		index("account_merge_requests_wallet_idx").on(
			t.walletAddress,
			t.walletChain,
			t.status,
		),
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
	(t) => [
		index("sessions_token_idx").on(t.token),
		index("sessions_user_idx").on(t.userId),
	],
);

export const twoFactors = pgTable(
	"two_factors",
	{
		id: text("id").primaryKey().$defaultFn(createId),
		secret: text("secret").notNull(),
		backupCodes: text("backup_codes").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(t) => [
		unique("two_factors_user_id_unique").on(t.userId),
		index("two_factors_secret_idx").on(t.secret),
		index("two_factors_user_idx").on(t.userId),
	],
);

// ══════════════════════════════════════════════════════════════════════════════
// WORKSPACE TABLES — defined in schema-workspace.ts, re-exported for compatibility.
// ════════════════════════════════════════════════════════════════���═════════════

export type {
	BrandingProfile,
	DocumentTemplate,
	IntegrationRecord,
	NewBrandingProfile,
	NewDocumentTemplate,
	NewIntegrationRecord,
	NewPdfStyleTemplate,
	NewWebhookEndpoint,
	PdfStyleTemplate,
	WebhookEndpoint,
} from "./schema-workspace";
export {
	brandingProfiles,
	documentIndex,
	documentKeyShares,
	documentTemplates,
	integrationConfigs,
	managedWallets,
	pdfStyleTemplates,
	userVaults,
	vaultUnlockMethodEnum,
	webhookEndpoints,
} from "./schema-workspace";

// ══════════════════════════════════════════════════════════════════════════════
// PREMIUM TABLES — defined in schema-premium.ts, re-exported for compatibility.
// ══════════════════════════════════════════════════════════════════════════════

export type {
	AiChatMessage,
	AiConversation,
	AiEditOperation,
	AiProviderConfig,
	AiProviderConfigRecord,
	AiRuntimeInstall,
	AiRuntimeSession,
	AiUsageLog,
	ConnectorAccessToken,
	ConnectorCapabilities,
	ConnectorSession,
	ConnectorTask,
	NewAiProviderConfigRecord,
	NewVerificationSession,
	PlatformConfig,
	RuntimeAuthCredentials,
	RuntimeConfig,
	VerificationSession,
} from "./schema-premium";
export {
	aiConversations,
	aiFeatureEnum,
	aiKeySourceEnum,
	aiProviderConfigs,
	aiProviderEnum,
	aiRateLimitModeEnum,
	aiRateLimits,
	aiRuntimeInstalls,
	aiRuntimeSessions,
	aiUsageLogs,
	connectorAccessTokens,
	connectorSessions,
	connectorStatusEnum,
	connectorTasks,
	platformConfig,
	runtimeAuthStatusEnum,
	runtimeInstallStatusEnum,
	runtimeSessionStatusEnum,
	runtimeToolEnum,
	verificationProviderEnum,
	verificationSessions,
} from "./schema-premium";

// ══════════════════════════════════════════════════════════════════════════════
// BILLING TABLES — defined in schema-billing.ts, re-exported for compatibility.
// ══════════════════════════════════════════════════════════════════════════════

export type {
	AiUsageBillingRecord,
	BillingFeatureLimits,
	BillingPlan,
	ContractDeployment,
	CryptoPaymentEvent,
	CryptoPlan,
	CryptoSubscription,
	FreeTierLimits,
	HashAnchor,
	Invoice,
	NewBillingPlan,
	NewSubscription,
	Subscription,
	SubscriptionNft,
	TokenPricingEntry,
	UsageMetric,
} from "./schema-billing";
export {
	aiUsageBilling,
	billingPlans,
	contractDeployments,
	cryptoPaymentEvents,
	cryptoPlans,
	cryptoSubscriptions,
	DEFAULT_FREE_TIER,
	hashAnchors,
	invoices,
	subscriptionNfts,
	subscriptions,
	usageMetrics,
} from "./schema-billing";
export {
	billingIntervalEnum,
	invoiceStatusEnum,
	subscriptionStatusEnum,
} from "./schema-enums";

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type Signer = typeof signers.$inferSelect;
export type NewSigner = typeof signers.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type WalletSession = typeof walletSessions.$inferSelect;
export type AuthChallenge = typeof authChallenges.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type User = typeof users.$inferSelect;
export type TwoFactor = typeof twoFactors.$inferSelect;
export type UserWallet = typeof userWallets.$inferSelect;
export type AccountMergeRequest = typeof accountMergeRequests.$inferSelect;
