import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import { env } from "~/env";

type SchemaStatement = {
  label: string;
  sql: string;
};

const schemaStatements: SchemaStatement[] = [
  {
    label: "wallet_chain enum",
    sql: `
      DO $$ BEGIN
        CREATE TYPE "wallet_chain" AS ENUM ('ETH', 'SOL', 'BTC', 'BASE');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `,
  },
  {
    label: "auth_challenges table",
    sql: `
      CREATE TABLE IF NOT EXISTS "auth_challenges" (
        "id" text PRIMARY KEY,
        "nonce" text NOT NULL,
        "address" text NOT NULL,
        "chain" "wallet_chain" NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "expires_at" timestamp NOT NULL,
        "consumed" timestamp,
        CONSTRAINT "auth_challenges_nonce_unique" UNIQUE("nonce")
      );
    `,
  },
  {
    label: "auth_challenges indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS "auth_challenges_nonce_idx" ON "auth_challenges" USING btree ("nonce");
    `,
  },
  {
    label: "users.two_factor_enabled",
    sql: `
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean NOT NULL DEFAULT false;
    `,
  },
  {
    label: "billing_interval enum",
    sql: `
      DO $$ BEGIN
        CREATE TYPE "billing_interval" AS ENUM ('monthly', 'yearly', 'lifetime');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `,
  },
  {
    label: "subscription_status enum",
    sql: `
      DO $$ BEGIN
        CREATE TYPE "subscription_status" AS ENUM ('active', 'past_due', 'canceled', 'trialing', 'paused', 'incomplete');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `,
  },
  {
    label: "invoice_status enum",
    sql: `
      DO $$ BEGIN
        CREATE TYPE "invoice_status" AS ENUM ('draft', 'open', 'paid', 'void', 'uncollectible');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `,
  },
  {
    label: "two_factors table",
    sql: `
      CREATE TABLE IF NOT EXISTS "two_factors" (
        "id" text PRIMARY KEY,
        "secret" text NOT NULL,
        "backup_codes" text NOT NULL,
        "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "two_factors_user_id_unique" UNIQUE("user_id")
      );
    `,
  },
  {
    label: "two_factors indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS "two_factors_secret_idx" ON "two_factors" USING btree ("secret");
      CREATE INDEX IF NOT EXISTS "two_factors_user_idx" ON "two_factors" USING btree ("user_id");
    `,
  },
  {
    label: "billing_plans table",
    sql: `
      CREATE TABLE IF NOT EXISTS "billing_plans" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "description" text,
        "interval" "billing_interval" NOT NULL,
        "price_in_cents" integer NOT NULL,
        "currency" text NOT NULL DEFAULT 'usd',
        "stripe_price_id" text,
        "stripe_product_id" text,
        "feature_limits" jsonb,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
    `,
  },
  {
    label: "subscriptions table",
    sql: `
      CREATE TABLE IF NOT EXISTS "subscriptions" (
        "id" text PRIMARY KEY,
        "user_id" text REFERENCES "users"("id") ON DELETE set null,
        "wallet_address" text,
        "wallet_chain" "wallet_chain",
        "plan_id" text NOT NULL REFERENCES "billing_plans"("id"),
        "status" "subscription_status" NOT NULL DEFAULT 'active',
        "stripe_customer_id" text,
        "stripe_subscription_id" text,
        "current_period_start" timestamp,
        "current_period_end" timestamp,
        "cancel_at_period_end" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now()
      );
    `,
  },
  {
    label: "invoices table",
    sql: `
      CREATE TABLE IF NOT EXISTS "invoices" (
        "id" text PRIMARY KEY,
        "subscription_id" text NOT NULL REFERENCES "subscriptions"("id") ON DELETE cascade,
        "stripe_invoice_id" text,
        "status" "invoice_status" NOT NULL DEFAULT 'draft',
        "amount_in_cents" integer NOT NULL,
        "currency" text NOT NULL DEFAULT 'usd',
        "period_start" timestamp,
        "period_end" timestamp,
        "paid_at" timestamp,
        "invoice_url" text,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `,
  },
  {
    label: "usage_metrics table",
    sql: `
      CREATE TABLE IF NOT EXISTS "usage_metrics" (
        "id" text PRIMARY KEY,
        "subscription_id" text NOT NULL REFERENCES "subscriptions"("id") ON DELETE cascade,
        "metric_key" text NOT NULL,
        "period_start" timestamp NOT NULL,
        "period_end" timestamp NOT NULL,
        "current_value" integer NOT NULL DEFAULT 0,
        "limit_value" integer,
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "usage_metrics_sub_key_period_uniq" UNIQUE("subscription_id", "metric_key", "period_start")
      );
    `,
  },
  {
    label: "crypto_plans table",
    sql: `
      CREATE TABLE IF NOT EXISTS "crypto_plans" (
        "id" text PRIMARY KEY,
        "name" text NOT NULL,
        "tier" text NOT NULL,
        "interval" "billing_interval" NOT NULL,
        "price_usdc" integer NOT NULL,
        "price_weth" text,
        "price_btc_sats" integer,
        "ai_tokens_included" integer NOT NULL DEFAULT 0,
        "ai_overage_rate_cents" integer NOT NULL DEFAULT 0,
        "features" jsonb,
        "token_pricing" jsonb,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `,
  },
  {
    label: "crypto_plans token_pricing",
    sql: `
      ALTER TABLE "crypto_plans" ADD COLUMN IF NOT EXISTS "token_pricing" jsonb;
    `,
  },
  {
    label: "crypto_subscriptions table",
    sql: `
      CREATE TABLE IF NOT EXISTS "crypto_subscriptions" (
        "id" text PRIMARY KEY,
        "subscriber_address" text NOT NULL,
        "subscriber_chain" "wallet_chain" NOT NULL,
        "plan_id" text NOT NULL REFERENCES "crypto_plans"("id"),
        "payment_chain" "wallet_chain" NOT NULL,
        "payment_token" text NOT NULL,
        "interval" "billing_interval" NOT NULL,
        "status" text NOT NULL DEFAULT 'active',
        "contract_address" text,
        "on_chain_subscription_id" text,
        "solana_account_address" text,
        "btc_payment_txid" text,
        "current_period_start" timestamp,
        "current_period_end" timestamp,
        "last_payment_verified_at" timestamp,
        "allowance_checked_at" timestamp,
        "cancelled_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        "metadata" jsonb
      );
    `,
  },
  {
    label: "crypto_payment_events table",
    sql: `
      CREATE TABLE IF NOT EXISTS "crypto_payment_events" (
        "id" text PRIMARY KEY,
        "subscription_id" text NOT NULL REFERENCES "crypto_subscriptions"("id") ON DELETE cascade,
        "event_type" text NOT NULL,
        "chain" "wallet_chain" NOT NULL,
        "tx_hash" text,
        "amount" text,
        "token_symbol" text,
        "block_number" integer,
        "event_hash" text NOT NULL,
        "prev_event_hash" text,
        "metadata" jsonb,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `,
  },
  {
    label: "hash_anchors table",
    sql: `
      CREATE TABLE IF NOT EXISTS "hash_anchors" (
        "id" text PRIMARY KEY,
        "document_hash" text NOT NULL,
        "anchor_tx_hash" text NOT NULL,
        "chain" "wallet_chain" NOT NULL DEFAULT 'BASE',
        "block_number" integer,
        "block_timestamp" timestamp,
        "batch_id" text,
        "contract_address" text NOT NULL,
        "verified" boolean NOT NULL DEFAULT false,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
    `,
  },
  {
    label: "ai_usage_billing table",
    sql: `
      CREATE TABLE IF NOT EXISTS "ai_usage_billing" (
        "id" text PRIMARY KEY,
        "owner_address" text NOT NULL,
        "subscription_id" text REFERENCES "crypto_subscriptions"("id") ON DELETE set null,
        "billing_month" text NOT NULL,
        "input_tokens_used" integer NOT NULL DEFAULT 0,
        "output_tokens_used" integer NOT NULL DEFAULT 0,
        "bundled_tokens_limit" integer NOT NULL DEFAULT 0,
        "overage_tokens" integer NOT NULL DEFAULT 0,
        "overage_cost_cents" integer NOT NULL DEFAULT 0,
        "settled" boolean NOT NULL DEFAULT false,
        "settled_at" timestamp,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "ai_usage_billing_owner_month_uniq" UNIQUE("owner_address", "billing_month")
      );
    `,
  },
  {
    label: "subscription_nfts table",
    sql: `
      CREATE TABLE IF NOT EXISTS "subscription_nfts" (
        "id" text PRIMARY KEY,
        "subscriber_address" text NOT NULL,
        "chain" "wallet_chain" NOT NULL,
        "token_id" text NOT NULL,
        "contract_address" text NOT NULL,
        "plan_id" text,
        "plan_name" text NOT NULL,
        "mint_tx_hash" text,
        "burn_tx_hash" text,
        "status" text NOT NULL DEFAULT 'active',
        "minted_at" timestamp NOT NULL DEFAULT now(),
        "burned_at" timestamp,
        CONSTRAINT "sub_nfts_address_chain_uniq" UNIQUE("subscriber_address", "chain")
      );
    `,
  },
  {
    label: "contract_deployments table",
    sql: `
      CREATE TABLE IF NOT EXISTS "contract_deployments" (
        "id" text PRIMARY KEY,
        "contract_name" text NOT NULL,
        "chain" "wallet_chain" NOT NULL,
        "address" text NOT NULL,
        "deploy_tx_hash" text,
        "deployed_at" timestamp NOT NULL DEFAULT now(),
        "is_active" boolean NOT NULL DEFAULT true,
        "metadata" jsonb,
        CONSTRAINT "contract_deploy_name_chain_uniq" UNIQUE("contract_name", "chain")
      );
    `,
  },
  {
    label: "billing indexes",
    sql: `
      CREATE INDEX IF NOT EXISTS "billing_plans_active_idx" ON "billing_plans" USING btree ("is_active");
      CREATE INDEX IF NOT EXISTS "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");
      CREATE INDEX IF NOT EXISTS "subscriptions_wallet_idx" ON "subscriptions" USING btree ("wallet_address", "wallet_chain");
      CREATE INDEX IF NOT EXISTS "subscriptions_stripe_sub_idx" ON "subscriptions" USING btree ("stripe_subscription_id");
      CREATE INDEX IF NOT EXISTS "subscriptions_stripe_cust_idx" ON "subscriptions" USING btree ("stripe_customer_id");
      CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions" USING btree ("status");
      CREATE INDEX IF NOT EXISTS "invoices_subscription_idx" ON "invoices" USING btree ("subscription_id");
      CREATE INDEX IF NOT EXISTS "invoices_stripe_idx" ON "invoices" USING btree ("stripe_invoice_id");
      CREATE INDEX IF NOT EXISTS "usage_metrics_sub_idx" ON "usage_metrics" USING btree ("subscription_id");
      CREATE INDEX IF NOT EXISTS "crypto_plans_active_idx" ON "crypto_plans" USING btree ("is_active");
      CREATE INDEX IF NOT EXISTS "crypto_subs_address_idx" ON "crypto_subscriptions" USING btree ("subscriber_address", "subscriber_chain");
      CREATE INDEX IF NOT EXISTS "crypto_subs_plan_idx" ON "crypto_subscriptions" USING btree ("plan_id");
      CREATE INDEX IF NOT EXISTS "crypto_subs_status_idx" ON "crypto_subscriptions" USING btree ("status");
      CREATE INDEX IF NOT EXISTS "crypto_events_sub_idx" ON "crypto_payment_events" USING btree ("subscription_id");
      CREATE INDEX IF NOT EXISTS "crypto_events_chain_idx" ON "crypto_payment_events" USING btree ("chain");
      CREATE INDEX IF NOT EXISTS "hash_anchors_doc_hash_idx" ON "hash_anchors" USING btree ("document_hash");
      CREATE INDEX IF NOT EXISTS "hash_anchors_batch_idx" ON "hash_anchors" USING btree ("batch_id");
      CREATE INDEX IF NOT EXISTS "hash_anchors_chain_idx" ON "hash_anchors" USING btree ("chain");
      CREATE INDEX IF NOT EXISTS "ai_usage_billing_owner_idx" ON "ai_usage_billing" USING btree ("owner_address");
      CREATE INDEX IF NOT EXISTS "sub_nfts_address_idx" ON "subscription_nfts" USING btree ("subscriber_address", "chain");
    `,
  },
];

type SchemaHealthRow = {
  hasTwoFactorFlag: boolean;
  hasTwoFactorsTable: string | null;
  hasBillingPlansTable: string | null;
  hasSubscriptionsTable: string | null;
  hasInvoicesTable: string | null;
  hasCryptoPlansTable: string | null;
  hasCryptoSubscriptionsTable: string | null;
};

export async function syncProofmarkSchemaBaseline() {
  const sql = postgres(env.DATABASE_URL, {
    connection: { application_name: "proofmark-schema-sync" },
    max: 1,
    prepare: false,
  });

  let migrationsApplied = false;
  let migrationError: string | null = null;

  try {
    // Step 1: Run drizzle migrations (creates tables from drizzle/*.sql files)
    try {
      const migrationClient = drizzle(sql);
      const migrationsFolder = path.resolve(process.cwd(), "drizzle");
      await migrate(migrationClient, { migrationsFolder });
      migrationsApplied = true;
    } catch (err) {
      // Migrations may fail on already-provisioned DBs missing __drizzle_migrations;
      // fall through to idempotent patches below.
      migrationError = err instanceof Error ? err.message : String(err);
    }

    // Step 2: Apply idempotent patches (safety net for drifted DBs)
    for (const statement of schemaStatements) {
      await sql.unsafe(statement.sql);
    }

    const [health] = await sql<SchemaHealthRow[]>`
      select
        exists (
          select 1
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'users'
            and column_name = 'two_factor_enabled'
        ) as "hasTwoFactorFlag",
        to_regclass('public.two_factors')::text as "hasTwoFactorsTable",
        to_regclass('public.billing_plans')::text as "hasBillingPlansTable",
        to_regclass('public.subscriptions')::text as "hasSubscriptionsTable",
        to_regclass('public.invoices')::text as "hasInvoicesTable",
        to_regclass('public.crypto_plans')::text as "hasCryptoPlansTable",
        to_regclass('public.crypto_subscriptions')::text as "hasCryptoSubscriptionsTable"
    `;

    return {
      migrationsApplied,
      migrationError,
      appliedStatements: schemaStatements.map((statement) => statement.label),
      health,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
