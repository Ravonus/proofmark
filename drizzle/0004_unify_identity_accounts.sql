ALTER TABLE "sessions" RENAME TO "wallet_sessions";--> statement-breakpoint
ALTER TABLE "wallet_sessions" RENAME CONSTRAINT "sessions_pkey" TO "wallet_sessions_pkey";--> statement-breakpoint
ALTER TABLE "wallet_sessions" RENAME CONSTRAINT "sessions_token_unique" TO "wallet_sessions_token_unique";--> statement-breakpoint
ALTER INDEX "sessions_token_idx" RENAME TO "wallet_sessions_token_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "sessions_address_idx";--> statement-breakpoint
ALTER TABLE "wallet_sessions" ADD COLUMN "user_id" text;--> statement-breakpoint
CREATE INDEX "wallet_sessions_address_idx" ON "wallet_sessions" USING btree ("address","chain");--> statement-breakpoint
CREATE INDEX "wallet_sessions_user_idx" ON "wallet_sessions" USING btree ("user_id");--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "public"."account_merge_request_status" AS ENUM('PENDING', 'DISMISSED', 'MERGED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE "user_wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"address" text NOT NULL,
	"chain" "wallet_chain" NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "user_wallets_chain_address_uniq" UNIQUE("chain","address")
);--> statement-breakpoint
CREATE INDEX "user_wallets_user_idx" ON "user_wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_wallets_address_idx" ON "user_wallets" USING btree ("address","chain");--> statement-breakpoint
CREATE INDEX "user_wallets_primary_idx" ON "user_wallets" USING btree ("user_id","is_primary");--> statement-breakpoint

INSERT INTO "user_wallets" ("id", "user_id", "address", "chain", "is_primary", "verified_at", "created_at", "updated_at")
SELECT
	'uw_' || substr(md5(random()::text || clock_timestamp()::text || u.id), 1, 24),
	u."id",
	u."wallet_address",
	u."wallet_chain",
	true,
	COALESCE(u."updated_at", u."created_at", now()),
	COALESCE(u."created_at", now()),
	COALESCE(u."updated_at", u."created_at", now())
FROM "users" u
WHERE u."wallet_address" IS NOT NULL
  AND u."wallet_chain" IS NOT NULL
ON CONFLICT ("chain", "address") DO NOTHING;--> statement-breakpoint

UPDATE "wallet_sessions" ws
SET "user_id" = u."id"
FROM "users" u
WHERE u."wallet_address" IS NOT NULL
  AND u."wallet_chain" IS NOT NULL
  AND ws."address" = u."wallet_address"
  AND ws."chain" = u."wallet_chain";--> statement-breakpoint

CREATE TABLE "account_merge_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"current_user_id" text NOT NULL,
	"conflicting_user_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"wallet_chain" "wallet_chain" NOT NULL,
	"email" text,
	"reason" text,
	"status" "account_merge_request_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	CONSTRAINT "account_merge_requests_current_user_id_users_id_fk" FOREIGN KEY ("current_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "account_merge_requests_conflicting_user_id_users_id_fk" FOREIGN KEY ("conflicting_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "account_merge_requests_user_wallet_uniq" UNIQUE("current_user_id","conflicting_user_id","wallet_chain","wallet_address")
);--> statement-breakpoint
CREATE INDEX "account_merge_requests_current_idx" ON "account_merge_requests" USING btree ("current_user_id","status");--> statement-breakpoint
CREATE INDEX "account_merge_requests_conflicting_idx" ON "account_merge_requests" USING btree ("conflicting_user_id","status");--> statement-breakpoint
CREATE INDEX "account_merge_requests_wallet_idx" ON "account_merge_requests" USING btree ("wallet_address","wallet_chain","status");--> statement-breakpoint

CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);--> statement-breakpoint
CREATE INDEX "sessions_token_idx" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint