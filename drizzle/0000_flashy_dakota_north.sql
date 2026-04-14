CREATE TYPE "public"."ai_feature" AS ENUM('scraper_fix', 'editor_assistant', 'signer_qa', 'general');--> statement-breakpoint
CREATE TYPE "public"."ai_key_source" AS ENUM('platform', 'byok', 'enterprise_shared', 'connector');--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('anthropic', 'openai', 'google', 'mistral', 'cohere', 'groq', 'together', 'perplexity', 'xai', 'deepseek', 'openrouter', 'litellm');--> statement-breakpoint
CREATE TYPE "public"."ai_rate_limit_mode" AS ENUM('platform', 'admin');--> statement-breakpoint
CREATE TYPE "public"."audit_event_type" AS ENUM('DOCUMENT_CREATED', 'DOCUMENT_VIEWED', 'DOCUMENT_COMPLETED', 'DOCUMENT_VOIDED', 'DOCUMENT_EXPIRED', 'SIGNER_INVITED', 'SIGNER_VIEWED', 'SIGNER_SIGNED', 'SIGNER_DECLINED', 'SIGNER_OTP_SENT', 'SIGNER_OTP_VERIFIED', 'SIGNATURE_VERIFIED', 'PROOF_PACKET_GENERATED', 'AUDIT_HASH_ANCHORED', 'ACCESS_REFRESHED');--> statement-breakpoint
CREATE TYPE "public"."connector_status" AS ENUM('online', 'offline', 'error');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('PENDING', 'COMPLETED', 'EXPIRED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."identity_level" AS ENUM('L0_WALLET', 'L1_EMAIL', 'L2_VERIFIED', 'L3_KYC');--> statement-breakpoint
CREATE TYPE "public"."integration_kind" AS ENUM('SMS', 'PAYMENT', 'IDV', 'SSO', 'ADDRESS', 'FORENSIC');--> statement-breakpoint
CREATE TYPE "public"."proof_mode" AS ENUM('PRIVATE', 'HYBRID', 'CRYPTO_NATIVE');--> statement-breakpoint
CREATE TYPE "public"."recipient_role" AS ENUM('SIGNER', 'APPROVER', 'CC', 'WITNESS', 'OBSERVER');--> statement-breakpoint
CREATE TYPE "public"."sign_method" AS ENUM('WALLET', 'EMAIL_OTP');--> statement-breakpoint
CREATE TYPE "public"."sign_status" AS ENUM('PENDING', 'SIGNED', 'DECLINED');--> statement-breakpoint
CREATE TYPE "public"."vault_unlock_method" AS ENUM('PASSWORD', 'DEVICE_PASSCODE', 'HARDWARE_KEY', 'TOTP_2FA');--> statement-breakpoint
CREATE TYPE "public"."wallet_chain" AS ENUM('ETH', 'SOL', 'BTC', 'BASE');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"document_id" text,
	"feature" "ai_feature" NOT NULL,
	"title" text,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_provider_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"label" text NOT NULL,
	"key_source" "ai_key_source" DEFAULT 'byok' NOT NULL,
	"config" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_rate_limits" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"user_id" text,
	"feature" "ai_feature",
	"mode" "ai_rate_limit_mode" DEFAULT 'platform' NOT NULL,
	"requests_per_month" integer DEFAULT 500 NOT NULL,
	"tokens_per_month" integer DEFAULT 1000000 NOT NULL,
	"max_requests_per_hour" integer DEFAULT 30 NOT NULL,
	"max_requests_per_week" integer DEFAULT 200 NOT NULL,
	"admin_requests_per_hour" integer,
	"admin_requests_per_day" integer,
	"admin_requests_per_month" integer,
	"admin_tokens_per_hour" integer,
	"admin_tokens_per_day" integer,
	"admin_tokens_per_month" integer,
	"current_hour_requests" integer DEFAULT 0 NOT NULL,
	"current_hour_tokens" integer DEFAULT 0 NOT NULL,
	"current_day_requests" integer DEFAULT 0 NOT NULL,
	"current_day_tokens" integer DEFAULT 0 NOT NULL,
	"current_week_requests" integer DEFAULT 0 NOT NULL,
	"current_month_requests" integer DEFAULT 0 NOT NULL,
	"current_month_tokens" integer DEFAULT 0 NOT NULL,
	"hour_window_reset_at" timestamp,
	"day_window_reset_at" timestamp,
	"week_window_reset_at" timestamp,
	"month_window_reset_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"user_id" text,
	"provider" "ai_provider" NOT NULL,
	"model" text NOT NULL,
	"feature" "ai_feature" NOT NULL,
	"document_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"key_source" "ai_key_source" DEFAULT 'platform' NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"event_type" "audit_event_type" NOT NULL,
	"actor" text NOT NULL,
	"actor_type" text DEFAULT 'wallet' NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb,
	"event_hash" text NOT NULL,
	"prev_event_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"nonce" text NOT NULL,
	"address" text NOT NULL,
	"chain" "wallet_chain" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed" timestamp,
	CONSTRAINT "auth_challenges_nonce_unique" UNIQUE("nonce")
);
--> statement-breakpoint
CREATE TABLE "branding_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"user_id" text,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "connector_access_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "connector_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"user_id" text,
	"connector_version" text,
	"machine_id" text,
	"label" text,
	"status" "connector_status" DEFAULT 'offline' NOT NULL,
	"last_heartbeat_at" timestamp,
	"capabilities" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connector_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"connector_session_id" text NOT NULL,
	"owner_address" text NOT NULL,
	"task_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"claimed_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "document_index" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"title" text NOT NULL,
	"snippet" text DEFAULT '',
	"status" text DEFAULT 'PENDING' NOT NULL,
	"proof_mode" text DEFAULT 'HYBRID' NOT NULL,
	"signer_count" integer DEFAULT 0 NOT NULL,
	"signed_count" integer DEFAULT 0 NOT NULL,
	"signer_labels" text DEFAULT '',
	"signer_domains" text DEFAULT '',
	"tags" jsonb DEFAULT '[]'::jsonb,
	"category" text,
	"hash_prefix" text,
	"cid_prefix" text,
	"anchored_on_base" boolean DEFAULT false,
	"anchored_on_sol" boolean DEFAULT false,
	"anchored_on_btc" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"expires_at" timestamp,
	CONSTRAINT "document_index_document_id_unique" UNIQUE("document_id")
);
--> statement-breakpoint
CREATE TABLE "document_key_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"recipient_address" text NOT NULL,
	"recipient_chain" "wallet_chain" NOT NULL,
	"encrypted_document_key" text NOT NULL,
	"on_chain_ref" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"signers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"defaults" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_by_email" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"status" "doc_status" DEFAULT 'PENDING' NOT NULL,
	"access_token" text NOT NULL,
	"ipfs_cid" text,
	"post_sign_reveal" jsonb,
	"proof_mode" "proof_mode" DEFAULT 'HYBRID' NOT NULL,
	"signing_order" text DEFAULT 'parallel' NOT NULL,
	"current_signer_index" integer DEFAULT 0,
	"encrypted_at_rest" boolean DEFAULT false NOT NULL,
	"encryption_key_wrapped" text,
	"template_id" text,
	"branding_profile_id" text,
	"reminder_config" jsonb,
	CONSTRAINT "documents_content_hash_unique" UNIQUE("content_hash"),
	CONSTRAINT "documents_access_token_unique" UNIQUE("access_token")
);
--> statement-breakpoint
CREATE TABLE "integration_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"config" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chain" "wallet_chain" NOT NULL,
	"address" text NOT NULL,
	"public_key" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "managed_wallets_user_chain_uniq" UNIQUE("user_id","chain")
);
--> statement-breakpoint
CREATE TABLE "mobile_sign_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"document_id" text NOT NULL,
	"signer_label" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"signature_data" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "mobile_sign_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"address" text NOT NULL,
	"chain" "wallet_chain" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "signers" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"label" text NOT NULL,
	"address" text,
	"chain" "wallet_chain",
	"email" text,
	"status" "sign_status" DEFAULT 'PENDING' NOT NULL,
	"signature" text,
	"signed_at" timestamp,
	"scheme" text,
	"hand_signature_data" text,
	"hand_signature_hash" text,
	"fields" jsonb,
	"field_values" jsonb,
	"claim_token" text NOT NULL,
	"last_ip" text,
	"ip_updated_at" timestamp,
	"sign_method" "sign_method" DEFAULT 'WALLET' NOT NULL,
	"otp_code" text,
	"otp_expires_at" timestamp,
	"otp_verified_at" timestamp,
	"consent_text" text,
	"consent_at" timestamp,
	"phone" text,
	"delivery_methods" jsonb,
	"role" "recipient_role" DEFAULT 'SIGNER' NOT NULL,
	"decline_reason" text,
	"declined_at" timestamp,
	"identity_level" "identity_level" DEFAULT 'L0_WALLET' NOT NULL,
	"signer_order" integer DEFAULT 0 NOT NULL,
	"user_agent" text,
	"forensic_evidence" jsonb,
	"forensic_hash" text,
	CONSTRAINT "signers_claim_token_unique" UNIQUE("claim_token"),
	CONSTRAINT "signers_doc_address_uniq" UNIQUE("document_id","address")
);
--> statement-breakpoint
CREATE TABLE "user_vaults" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"unlock_method" "vault_unlock_method" NOT NULL,
	"wrapped_dek" text NOT NULL,
	"kdf_params" jsonb NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"wallet_address" text,
	"wallet_chain" "wallet_chain",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"secret" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_tasks" ADD CONSTRAINT "connector_tasks_connector_session_id_connector_sessions_id_fk" FOREIGN KEY ("connector_session_id") REFERENCES "public"."connector_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_index" ADD CONSTRAINT "document_index_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_key_shares" ADD CONSTRAINT "document_key_shares_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_wallets" ADD CONSTRAINT "managed_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signers" ADD CONSTRAINT "signers_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_vaults" ADD CONSTRAINT "user_vaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_owner_doc_idx" ON "ai_conversations" USING btree ("owner_address","document_id");--> statement-breakpoint
CREATE INDEX "ai_conversations_doc_feature_idx" ON "ai_conversations" USING btree ("document_id","feature");--> statement-breakpoint
CREATE INDEX "ai_provider_configs_owner_idx" ON "ai_provider_configs" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "ai_provider_configs_owner_provider_idx" ON "ai_provider_configs" USING btree ("owner_address","provider");--> statement-breakpoint
CREATE INDEX "ai_rate_limits_owner_user_idx" ON "ai_rate_limits" USING btree ("owner_address","user_id");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_owner_created_idx" ON "ai_usage_logs" USING btree ("owner_address","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_owner_feature_idx" ON "ai_usage_logs" USING btree ("owner_address","feature");--> statement-breakpoint
CREATE INDEX "ai_usage_logs_document_idx" ON "ai_usage_logs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "audit_events_document_idx" ON "audit_events" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "audit_events_type_idx" ON "audit_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "audit_events_created_idx" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor");--> statement-breakpoint
CREATE INDEX "auth_challenges_nonce_idx" ON "auth_challenges" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "branding_profiles_owner_idx" ON "branding_profiles" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "branding_profiles_default_idx" ON "branding_profiles" USING btree ("owner_address","is_default");--> statement-breakpoint
CREATE INDEX "connector_tokens_hash_idx" ON "connector_access_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "connector_tokens_owner_idx" ON "connector_access_tokens" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "connector_sessions_owner_idx" ON "connector_sessions" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "connector_sessions_owner_status_idx" ON "connector_sessions" USING btree ("owner_address","status");--> statement-breakpoint
CREATE INDEX "connector_tasks_session_status_idx" ON "connector_tasks" USING btree ("connector_session_id","status");--> statement-breakpoint
CREATE INDEX "connector_tasks_owner_idx" ON "connector_tasks" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "doc_index_owner_idx" ON "document_index" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "doc_index_title_idx" ON "document_index" USING btree ("title");--> statement-breakpoint
CREATE INDEX "doc_index_status_idx" ON "document_index" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "doc_index_category_idx" ON "document_index" USING btree ("owner_id","category");--> statement-breakpoint
CREATE INDEX "doc_index_created_idx" ON "document_index" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "doc_index_hash_prefix_idx" ON "document_index" USING btree ("hash_prefix");--> statement-breakpoint
CREATE INDEX "doc_key_shares_doc_idx" ON "document_key_shares" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "doc_key_shares_recipient_idx" ON "document_key_shares" USING btree ("recipient_address");--> statement-breakpoint
CREATE INDEX "document_templates_owner_idx" ON "document_templates" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "document_templates_name_idx" ON "document_templates" USING btree ("owner_address","name");--> statement-breakpoint
CREATE INDEX "documents_created_by_idx" ON "documents" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "documents_content_hash_idx" ON "documents" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "documents_access_token_idx" ON "documents" USING btree ("access_token");--> statement-breakpoint
CREATE INDEX "documents_ipfs_cid_idx" ON "documents" USING btree ("ipfs_cid");--> statement-breakpoint
CREATE INDEX "documents_proof_mode_idx" ON "documents" USING btree ("proof_mode");--> statement-breakpoint
CREATE INDEX "integration_configs_owner_idx" ON "integration_configs" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "integration_configs_kind_idx" ON "integration_configs" USING btree ("owner_address","kind");--> statement-breakpoint
CREATE INDEX "integration_configs_default_idx" ON "integration_configs" USING btree ("owner_address","kind","is_default");--> statement-breakpoint
CREATE INDEX "managed_wallets_user_idx" ON "managed_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mobile_sign_token_idx" ON "mobile_sign_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_token_idx" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_address_idx" ON "sessions" USING btree ("address");--> statement-breakpoint
CREATE INDEX "signers_address_idx" ON "signers" USING btree ("address");--> statement-breakpoint
CREATE INDEX "signers_document_id_idx" ON "signers" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "signers_claim_token_idx" ON "signers" USING btree ("claim_token");--> statement-breakpoint
CREATE INDEX "user_vaults_user_idx" ON "user_vaults" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_vaults_method_idx" ON "user_vaults" USING btree ("user_id","unlock_method");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_wallet_idx" ON "users" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_owner_idx" ON "webhook_endpoints" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "webhook_endpoints_active_idx" ON "webhook_endpoints" USING btree ("owner_address","active");