CREATE TYPE "public"."escrow_asset_chain" AS ENUM('ETH', 'SOL', 'BTC', 'FIAT');--> statement-breakpoint
CREATE TYPE "public"."escrow_asset_kind" AS ENUM('NATIVE', 'ERC20', 'ERC721', 'ERC1155', 'SPL_TOKEN', 'SPL_NFT', 'BRC20', 'ORDINAL', 'USD', 'CUSTOM');--> statement-breakpoint
CREATE TYPE "public"."escrow_mode" AS ENUM('FULL_ESCROW', 'MULTI_ESCROW', 'COMMUNITY_ESCROW', 'SELF_CUSTODY', 'LOCKED_CANCELLABLE', 'LOCKED_PERMANENT', 'HONOR_SYSTEM', 'CASUAL', 'PLATFORM_ESCROW', 'DESIGNATED_ORACLE');--> statement-breakpoint
CREATE TYPE "public"."escrow_participant_role" AS ENUM('PARTY', 'ESCROW_AGENT', 'DESIGNATED_ORACLE', 'COMMUNITY_VOTER', 'OBSERVER');--> statement-breakpoint
CREATE TYPE "public"."escrow_resolution_method" AS ENUM('ESCROW_DECISION', 'MULTI_SIG', 'COMMUNITY_VOTE', 'MUTUAL_AGREEMENT', 'ORACLE', 'PLATFORM_ORACLE', 'TIMEOUT', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('DRAFT', 'AWAITING_SIGNATURES', 'AWAITING_DEPOSITS', 'ACTIVE', 'MONITORING', 'DISPUTED', 'RESOLVING', 'RESOLVED', 'SETTLED', 'CANCELLED', 'VOIDED', 'EXPIRED', 'LOCKED_FOREVER');--> statement-breakpoint
CREATE TABLE "escrow_community_votes" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_id" text NOT NULL,
	"voter_address" text NOT NULL,
	"voter_chain" "escrow_asset_chain" NOT NULL,
	"outcome_index" integer NOT NULL,
	"signature" text NOT NULL,
	"token_balance" text,
	"voted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrow_contracts" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"mode" "escrow_mode" NOT NULL,
	"status" "escrow_status" DEFAULT 'DRAFT' NOT NULL,
	"resolution_method" "escrow_resolution_method" NOT NULL,
	"terms_hash" text NOT NULL,
	"terms_content" text,
	"assets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_outcome_index" integer,
	"on_chain_address" text,
	"on_chain_network" "escrow_asset_chain",
	"deploy_tx_hash" text,
	"multi_escrow_config" jsonb,
	"community_vote_config" jsonb,
	"monitoring_config" jsonb,
	"psbt_config" jsonb,
	"oracle_config" jsonb,
	"fee_config" jsonb,
	"designated_oracle_config" jsonb,
	"acknowledged_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "escrow_events" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor" text NOT NULL,
	"data" jsonb,
	"event_hash" text NOT NULL,
	"prev_event_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrow_monitor_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"check_type" text NOT NULL,
	"expected_value" text NOT NULL,
	"actual_value" text NOT NULL,
	"passed" boolean NOT NULL,
	"chain_data" jsonb,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrow_oracle_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_id" text NOT NULL,
	"oracle_participant_id" text NOT NULL,
	"outcome_index" integer NOT NULL,
	"rationale" text,
	"custom_split" jsonb,
	"signature" text NOT NULL,
	"decided_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrow_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_id" text NOT NULL,
	"label" text NOT NULL,
	"address" text,
	"chain" "escrow_asset_chain",
	"role" "escrow_participant_role" NOT NULL,
	"accepted" boolean DEFAULT false NOT NULL,
	"signature" text,
	"accepted_at" timestamp,
	"deposited" boolean DEFAULT false NOT NULL,
	"deposit_tx_hash" text,
	"deposit_amount" text,
	"vote_outcome_index" integer,
	"vote_signature" text,
	"voted_at" timestamp,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"resolution_rationale" text,
	"custom_payout_split" jsonb,
	"email" text,
	"phone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "escrow_rwa_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"method" text NOT NULL,
	"verified_by" text NOT NULL,
	"valid" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrow_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"escrow_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"address" text NOT NULL,
	"chain" "escrow_asset_chain" NOT NULL,
	"signature" text NOT NULL,
	"signed_message" text NOT NULL,
	"signed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "gaze_tracking" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "mobile_sign_sessions" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "signers" ADD COLUMN "social_verifications" jsonb;--> statement-breakpoint
ALTER TABLE "escrow_community_votes" ADD CONSTRAINT "escrow_community_votes_escrow_id_escrow_contracts_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrow_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_events" ADD CONSTRAINT "escrow_events_escrow_id_escrow_contracts_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrow_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_monitor_snapshots" ADD CONSTRAINT "escrow_monitor_snapshots_escrow_id_escrow_contracts_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrow_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_monitor_snapshots" ADD CONSTRAINT "escrow_monitor_snapshots_participant_id_escrow_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."escrow_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_oracle_decisions" ADD CONSTRAINT "escrow_oracle_decisions_escrow_id_escrow_contracts_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrow_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_oracle_decisions" ADD CONSTRAINT "escrow_oracle_decisions_oracle_participant_id_escrow_participants_id_fk" FOREIGN KEY ("oracle_participant_id") REFERENCES "public"."escrow_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_participants" ADD CONSTRAINT "escrow_participants_escrow_id_escrow_contracts_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrow_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_rwa_verifications" ADD CONSTRAINT "escrow_rwa_verifications_escrow_id_escrow_contracts_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrow_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_signatures" ADD CONSTRAINT "escrow_signatures_escrow_id_escrow_contracts_id_fk" FOREIGN KEY ("escrow_id") REFERENCES "public"."escrow_contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_signatures" ADD CONSTRAINT "escrow_signatures_participant_id_escrow_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."escrow_participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "escrow_community_votes_escrow_idx" ON "escrow_community_votes" USING btree ("escrow_id");--> statement-breakpoint
CREATE INDEX "escrow_community_votes_voter_idx" ON "escrow_community_votes" USING btree ("voter_address");--> statement-breakpoint
CREATE INDEX "escrow_contracts_created_by_idx" ON "escrow_contracts" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "escrow_contracts_status_idx" ON "escrow_contracts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "escrow_contracts_mode_idx" ON "escrow_contracts" USING btree ("mode");--> statement-breakpoint
CREATE INDEX "escrow_contracts_terms_hash_idx" ON "escrow_contracts" USING btree ("terms_hash");--> statement-breakpoint
CREATE INDEX "escrow_contracts_document_idx" ON "escrow_contracts" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "escrow_contracts_on_chain_idx" ON "escrow_contracts" USING btree ("on_chain_address");--> statement-breakpoint
CREATE INDEX "escrow_events_escrow_idx" ON "escrow_events" USING btree ("escrow_id");--> statement-breakpoint
CREATE INDEX "escrow_events_type_idx" ON "escrow_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "escrow_events_created_idx" ON "escrow_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "escrow_monitor_escrow_idx" ON "escrow_monitor_snapshots" USING btree ("escrow_id");--> statement-breakpoint
CREATE INDEX "escrow_monitor_participant_idx" ON "escrow_monitor_snapshots" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "escrow_monitor_checked_idx" ON "escrow_monitor_snapshots" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "escrow_oracle_decisions_escrow_idx" ON "escrow_oracle_decisions" USING btree ("escrow_id");--> statement-breakpoint
CREATE INDEX "escrow_oracle_decisions_oracle_idx" ON "escrow_oracle_decisions" USING btree ("oracle_participant_id");--> statement-breakpoint
CREATE INDEX "escrow_participants_escrow_idx" ON "escrow_participants" USING btree ("escrow_id");--> statement-breakpoint
CREATE INDEX "escrow_participants_address_idx" ON "escrow_participants" USING btree ("address");--> statement-breakpoint
CREATE INDEX "escrow_participants_role_idx" ON "escrow_participants" USING btree ("escrow_id","role");--> statement-breakpoint
CREATE INDEX "escrow_rwa_escrow_idx" ON "escrow_rwa_verifications" USING btree ("escrow_id");--> statement-breakpoint
CREATE INDEX "escrow_rwa_asset_idx" ON "escrow_rwa_verifications" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "escrow_rwa_method_idx" ON "escrow_rwa_verifications" USING btree ("method");--> statement-breakpoint
CREATE INDEX "escrow_signatures_escrow_idx" ON "escrow_signatures" USING btree ("escrow_id");--> statement-breakpoint
CREATE INDEX "escrow_signatures_participant_idx" ON "escrow_signatures" USING btree ("participant_id");