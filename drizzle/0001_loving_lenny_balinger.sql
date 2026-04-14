CREATE TYPE "public"."collab_ai_thread_type" AS ENUM('shared', 'private');--> statement-breakpoint
CREATE TYPE "public"."collab_annotation_type" AS ENUM('highlight', 'comment', 'bookmark', 'suggestion');--> statement-breakpoint
CREATE TYPE "public"."collab_participant_role" AS ENUM('host', 'editor', 'viewer', 'commentor');--> statement-breakpoint
CREATE TYPE "public"."collab_session_status" AS ENUM('active', 'paused', 'closed');--> statement-breakpoint
CREATE TABLE "feature_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"user_chain" "wallet_chain" NOT NULL,
	"feature_id" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "feature_overrides_user_feature_uniq" UNIQUE("user_address","user_chain","feature_id")
);
--> statement-breakpoint
CREATE TABLE "pdf_style_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_address" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"settings" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_config" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"owner_address" text NOT NULL,
	"owner_chain" "wallet_chain" NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL,
	"setup_signature" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_ai_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"thread_type" "collab_ai_thread_type" NOT NULL,
	"owner_user_id" text,
	"title" text DEFAULT 'Conversation' NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_annotations" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"type" "collab_annotation_type" NOT NULL,
	"anchor" jsonb NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collab_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "collab_participant_role" DEFAULT 'viewer' NOT NULL,
	"display_name" text NOT NULL,
	"color" text NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "collab_participants_session_user_uniq" UNIQUE("session_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "collab_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text,
	"host_user_id" text NOT NULL,
	"title" text NOT NULL,
	"status" "collab_session_status" DEFAULT 'active' NOT NULL,
	"join_token" text NOT NULL,
	"yjs_state" "bytea",
	"pdf_blob_url" text,
	"pdf_analysis" jsonb,
	"settings" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	CONSTRAINT "collab_sessions_join_token_unique" UNIQUE("join_token")
);
--> statement-breakpoint
CREATE TABLE "collab_shareable_links" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"created_by" text NOT NULL,
	"token" text NOT NULL,
	"anchor" jsonb NOT NULL,
	"ai_breakdown" jsonb,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "collab_shareable_links_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "pdf_style_template_id" text;--> statement-breakpoint
CREATE INDEX "feature_overrides_user_idx" ON "feature_overrides" USING btree ("user_address","user_chain");--> statement-breakpoint
CREATE INDEX "feature_overrides_feature_idx" ON "feature_overrides" USING btree ("feature_id");--> statement-breakpoint
CREATE INDEX "pdf_style_templates_owner_idx" ON "pdf_style_templates" USING btree ("owner_address");--> statement-breakpoint
CREATE INDEX "collab_ai_threads_session_idx" ON "collab_ai_threads" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "collab_ai_threads_session_type_idx" ON "collab_ai_threads" USING btree ("session_id","thread_type");--> statement-breakpoint
CREATE INDEX "collab_ai_threads_owner_idx" ON "collab_ai_threads" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "collab_annotations_session_idx" ON "collab_annotations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "collab_annotations_author_idx" ON "collab_annotations" USING btree ("author_user_id");--> statement-breakpoint
CREATE INDEX "collab_annotations_session_type_idx" ON "collab_annotations" USING btree ("session_id","type");--> statement-breakpoint
CREATE INDEX "collab_participants_session_idx" ON "collab_participants" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "collab_participants_user_idx" ON "collab_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "collab_sessions_host_idx" ON "collab_sessions" USING btree ("host_user_id");--> statement-breakpoint
CREATE INDEX "collab_sessions_status_idx" ON "collab_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "collab_sessions_document_idx" ON "collab_sessions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "collab_shareable_links_session_idx" ON "collab_shareable_links" USING btree ("session_id");