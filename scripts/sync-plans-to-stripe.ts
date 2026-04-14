/**
 * Sync existing billing_plans to Stripe — creates Products + Prices in your Stripe account.
 * Run: tsx --env-file=.env scripts/sync-plans-to-stripe.ts
 *
 * Reads the Stripe API key from integration_configs (the one you saved in admin).
 * Only syncs plans that don't already have a stripe_price_id.
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { prepare: false });
const STRIPE_API = "https://api.stripe.com/v1";

async function getStripeKey(): Promise<string> {
  const rows = await sql`
    SELECT config FROM integration_configs
    WHERE kind = 'PAYMENT'
    AND config->>'provider' = 'stripe_billing'
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new Error("No stripe_billing integration found. Save your Stripe keys in admin first.");
  }

  const config = rows[0].config as { apiKey?: string };
  if (!config.apiKey) {
    throw new Error("Stripe API key is empty in the integration config.");
  }

  return config.apiKey;
}

async function stripePost(apiKey: string, endpoint: string, body: URLSearchParams): Promise<any> {
  const res = await fetch(`${STRIPE_API}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(`  Stripe error: ${JSON.stringify(data.error?.message || data)}`);
    throw new Error(`Stripe ${endpoint} failed: ${res.status}`);
  }

  return data;
}

async function run() {
  const apiKey = await getStripeKey();
  console.log(`Using Stripe key: ${apiKey.slice(0, 7)}...${apiKey.slice(-4)}\n`);

  const plans = await sql`
    SELECT id, name, description, "interval", price_in_cents, currency, stripe_price_id, stripe_product_id
    FROM billing_plans
    WHERE is_active = true
    ORDER BY sort_order
  `;

  console.log(`Found ${plans.length} active plans\n`);

  for (const plan of plans) {
    if (plan.stripe_price_id) {
      console.log(`  [skip] ${plan.name} (${plan.interval}) — already synced: ${plan.stripe_price_id}`);
      continue;
    }

    console.log(`  [sync] ${plan.name} (${plan.interval}) — $${(plan.price_in_cents / 100).toFixed(2)}...`);

    // Create Stripe Product
    const productBody = new URLSearchParams({ name: plan.name });
    if (plan.description) productBody.set("description", plan.description);
    productBody.set("metadata[proofmark_plan_id]", plan.id);

    const product = await stripePost(apiKey, "/products", productBody);
    console.log(`    Product: ${product.id}`);

    // Create Stripe Price
    const priceBody = new URLSearchParams({
      product: product.id,
      unit_amount: String(plan.price_in_cents),
      currency: plan.currency || "usd",
    });

    // For free plans, Stripe doesn't allow recurring with 0 amount — skip price creation
    if (plan.price_in_cents === 0) {
      console.log(`    Skipping price for free plan (Stripe doesn't support $0 recurring prices)`);
      await sql`UPDATE billing_plans SET stripe_product_id = ${product.id} WHERE id = ${plan.id}`;
      continue;
    }

    if (plan.interval !== "lifetime") {
      const intervalMap: Record<string, string> = { monthly: "month", yearly: "year" };
      priceBody.set("recurring[interval]", intervalMap[plan.interval] || "month");
    }

    const price = await stripePost(apiKey, "/prices", priceBody);
    console.log(`    Price: ${price.id}`);

    // Update DB with Stripe IDs
    await sql`
      UPDATE billing_plans
      SET stripe_product_id = ${product.id}, stripe_price_id = ${price.id}, updated_at = NOW()
      WHERE id = ${plan.id}
    `;
    console.log(`    DB updated`);
  }

  console.log("\nDone! Plans are synced to Stripe.");
  console.log("Check your Stripe Dashboard → Products to see them.");
  await sql.end();
}

run().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
