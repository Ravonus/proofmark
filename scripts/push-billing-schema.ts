/**
 * Push billing schema tables directly via SQL.
 * Run: tsx --env-file=.env scripts/push-billing-schema.ts
 *
 * This creates the billing enums and tables if they don't exist.
 * Safe to run multiple times (IF NOT EXISTS).
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false });

async function run() {
  console.log("Pushing billing schema...\n");

  // ── Enums ──
  await sql`DO $$ BEGIN
    CREATE TYPE billing_interval AS ENUM ('monthly', 'yearly', 'lifetime');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
  console.log("  + billing_interval enum");

  await sql`DO $$ BEGIN
    CREATE TYPE subscription_status AS ENUM ('active', 'past_due', 'canceled', 'trialing', 'paused', 'incomplete');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
  console.log("  + subscription_status enum");

  await sql`DO $$ BEGIN
    CREATE TYPE invoice_status AS ENUM ('draft', 'open', 'paid', 'void', 'uncollectible');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
  console.log("  + invoice_status enum");

  // ── OSS Tables ──
  await sql`CREATE TABLE IF NOT EXISTS billing_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    "interval" billing_interval NOT NULL,
    price_in_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    stripe_price_id TEXT,
    stripe_product_id TEXT,
    feature_limits JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`;
  console.log("  + billing_plans table");

  await sql`CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    wallet_address TEXT,
    wallet_chain wallet_chain,
    plan_id TEXT NOT NULL REFERENCES billing_plans(id),
    status subscription_status NOT NULL DEFAULT 'active',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`;
  console.log("  + subscriptions table");

  await sql`CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    stripe_invoice_id TEXT,
    status invoice_status NOT NULL DEFAULT 'draft',
    amount_in_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'usd',
    period_start TIMESTAMP,
    period_end TIMESTAMP,
    paid_at TIMESTAMP,
    invoice_url TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`;
  console.log("  + invoices table");

  await sql`CREATE TABLE IF NOT EXISTS usage_metrics (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    metric_key TEXT NOT NULL,
    period_start TIMESTAMP NOT NULL,
    period_end TIMESTAMP NOT NULL,
    current_value INTEGER NOT NULL DEFAULT 0,
    limit_value INTEGER,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(subscription_id, metric_key, period_start)
  )`;
  console.log("  + usage_metrics table");

  // ── Premium Tables ──
  await sql`CREATE TABLE IF NOT EXISTS crypto_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tier TEXT NOT NULL,
    "interval" billing_interval NOT NULL,
    price_usdc INTEGER NOT NULL,
    price_weth TEXT,
    price_btc_sats INTEGER,
    ai_tokens_included INTEGER NOT NULL DEFAULT 0,
    ai_overage_rate_cents INTEGER NOT NULL DEFAULT 0,
    features JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`;
  console.log("  + crypto_plans table");

  await sql`CREATE TABLE IF NOT EXISTS crypto_subscriptions (
    id TEXT PRIMARY KEY,
    subscriber_address TEXT NOT NULL,
    subscriber_chain wallet_chain NOT NULL,
    plan_id TEXT NOT NULL REFERENCES crypto_plans(id),
    payment_chain wallet_chain NOT NULL,
    payment_token TEXT NOT NULL,
    "interval" billing_interval NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    contract_address TEXT,
    on_chain_subscription_id TEXT,
    solana_account_address TEXT,
    btc_payment_txid TEXT,
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    last_payment_verified_at TIMESTAMP,
    allowance_checked_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    metadata JSONB
  )`;
  console.log("  + crypto_subscriptions table");

  await sql`CREATE TABLE IF NOT EXISTS crypto_payment_events (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL REFERENCES crypto_subscriptions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    chain wallet_chain NOT NULL,
    tx_hash TEXT,
    amount TEXT,
    token_symbol TEXT,
    block_number INTEGER,
    event_hash TEXT NOT NULL,
    prev_event_hash TEXT,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`;
  console.log("  + crypto_payment_events table");

  await sql`CREATE TABLE IF NOT EXISTS hash_anchors (
    id TEXT PRIMARY KEY,
    document_hash TEXT NOT NULL,
    anchor_tx_hash TEXT NOT NULL,
    chain wallet_chain NOT NULL DEFAULT 'BASE',
    block_number INTEGER,
    block_timestamp TIMESTAMP,
    batch_id TEXT,
    contract_address TEXT NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`;
  console.log("  + hash_anchors table");

  await sql`CREATE TABLE IF NOT EXISTS ai_usage_billing (
    id TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    subscription_id TEXT REFERENCES crypto_subscriptions(id) ON DELETE SET NULL,
    billing_month TEXT NOT NULL,
    input_tokens_used INTEGER NOT NULL DEFAULT 0,
    output_tokens_used INTEGER NOT NULL DEFAULT 0,
    bundled_tokens_limit INTEGER NOT NULL DEFAULT 0,
    overage_tokens INTEGER NOT NULL DEFAULT 0,
    overage_cost_cents INTEGER NOT NULL DEFAULT 0,
    settled BOOLEAN NOT NULL DEFAULT false,
    settled_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(owner_address, billing_month)
  )`;
  console.log("  + ai_usage_billing table");

  // ── Indexes ──
  const indexes = [
    `CREATE INDEX IF NOT EXISTS billing_plans_active_idx ON billing_plans(is_active)`,
    `CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id)`,
    `CREATE INDEX IF NOT EXISTS subscriptions_wallet_idx ON subscriptions(wallet_address, wallet_chain)`,
    `CREATE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx ON subscriptions(stripe_subscription_id)`,
    `CREATE INDEX IF NOT EXISTS subscriptions_stripe_cust_idx ON subscriptions(stripe_customer_id)`,
    `CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions(status)`,
    `CREATE INDEX IF NOT EXISTS invoices_subscription_idx ON invoices(subscription_id)`,
    `CREATE INDEX IF NOT EXISTS invoices_stripe_idx ON invoices(stripe_invoice_id)`,
    `CREATE INDEX IF NOT EXISTS usage_metrics_sub_idx ON usage_metrics(subscription_id)`,
    `CREATE INDEX IF NOT EXISTS crypto_plans_active_idx ON crypto_plans(is_active)`,
    `CREATE INDEX IF NOT EXISTS crypto_subs_address_idx ON crypto_subscriptions(subscriber_address, subscriber_chain)`,
    `CREATE INDEX IF NOT EXISTS crypto_subs_plan_idx ON crypto_subscriptions(plan_id)`,
    `CREATE INDEX IF NOT EXISTS crypto_subs_status_idx ON crypto_subscriptions(status)`,
    `CREATE INDEX IF NOT EXISTS crypto_events_sub_idx ON crypto_payment_events(subscription_id)`,
    `CREATE INDEX IF NOT EXISTS crypto_events_chain_idx ON crypto_payment_events(chain)`,
    `CREATE INDEX IF NOT EXISTS hash_anchors_doc_hash_idx ON hash_anchors(document_hash)`,
    `CREATE INDEX IF NOT EXISTS hash_anchors_batch_idx ON hash_anchors(batch_id)`,
    `CREATE INDEX IF NOT EXISTS hash_anchors_chain_idx ON hash_anchors(chain)`,
    `CREATE INDEX IF NOT EXISTS ai_usage_billing_owner_idx ON ai_usage_billing(owner_address)`,
  ];

  for (const idx of indexes) {
    await sql.unsafe(idx);
  }
  console.log(`  + ${indexes.length} indexes`);

  // ── Seed test plans ──
  const existingPlans = await sql`SELECT COUNT(*) as count FROM billing_plans`;
  if (Number(existingPlans[0].count) === 0) {
    console.log("\n  Seeding test billing plans...");

    const { randomBytes } = await import("crypto");
    const id = () => randomBytes(12).toString("base64url");

    await sql`INSERT INTO billing_plans (id, name, description, "interval", price_in_cents, currency, feature_limits, is_active, sort_order) VALUES
      (${id()}, 'Free', 'Get started with basic document signing', 'monthly', 0, 'usd', ${JSON.stringify({ documentsPerMonth: 2, aiCallsPerMonth: 3, signersPerDocument: 2 })}, true, 0),
      (${id()}, 'Pro', 'For individuals and small teams', 'monthly', 1999, 'usd', ${JSON.stringify({ documentsPerMonth: 50, aiCallsPerMonth: 100, signersPerDocument: 10, enabledFeatures: ["templates", "branding", "reminders"] })}, true, 1),
      (${id()}, 'Pro', 'For individuals and small teams (annual)', 'yearly', 19990, 'usd', ${JSON.stringify({ documentsPerMonth: 50, aiCallsPerMonth: 100, signersPerDocument: 10, enabledFeatures: ["templates", "branding", "reminders"] })}, true, 2),
      (${id()}, 'Business', 'Unlimited documents with premium features', 'monthly', 4999, 'usd', ${JSON.stringify({ documentsPerMonth: null, aiCallsPerMonth: 500, signersPerDocument: null, enabledFeatures: ["templates", "branding", "reminders", "webhooks", "bulk_send", "reporting", "blockchain_anchoring"] })}, true, 3),
      (${id()}, 'Lifetime', 'One-time purchase, unlimited forever', 'lifetime', 49900, 'usd', ${JSON.stringify({ documentsPerMonth: null, aiCallsPerMonth: null, signersPerDocument: null, enabledFeatures: ["templates", "branding", "reminders", "webhooks", "bulk_send", "reporting", "blockchain_anchoring", "teams"] })}, true, 4)
    `;
    console.log("  + 5 test plans seeded (Free, Pro Monthly, Pro Annual, Business, Lifetime)");
  } else {
    console.log(`\n  Skipping seed — ${existingPlans[0].count} plans already exist`);
  }

  console.log("\nDone! Billing schema is ready.");
  await sql.end();
}

run().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
