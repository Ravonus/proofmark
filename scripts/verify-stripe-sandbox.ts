/**
 * Verify Stripe sandbox has products/prices synced from our DB.
 * Run: tsx --env-file=.env scripts/verify-stripe-sandbox.ts
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const sql = postgres(DATABASE_URL, { prepare: false });

async function run() {
  // Get Stripe key from DB
  const rows = await sql`
    SELECT config->>'apiKey' as key FROM integration_configs
    WHERE kind='PAYMENT' AND config->>'provider'='stripe_billing' LIMIT 1
  `;
  const key = rows[0]?.key as string | undefined;
  if (!key) { console.log("No Stripe key configured. Save keys in /admin -> Billing first."); await sql.end(); return; }
  console.log(`Stripe key: ${key.slice(0, 10)}...${key.slice(-4)}\n`);

  // Check products in Stripe
  const prodRes = await fetch("https://api.stripe.com/v1/products?limit=20", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const prodData = await prodRes.json() as { data?: Array<{ id: string; name: string; active: boolean }> };

  console.log(`=== Stripe Products (${prodData.data?.length ?? 0}) ===`);
  for (const p of prodData.data ?? []) {
    console.log(`  ${p.id}: ${p.name}${p.active ? "" : " [INACTIVE]"}`);
  }

  // Check prices in Stripe
  const priceRes = await fetch("https://api.stripe.com/v1/prices?limit=20", {
    headers: { Authorization: `Bearer ${key}` },
  });
  const priceData = await priceRes.json() as { data?: Array<{ id: string; unit_amount: number; currency: string; recurring?: { interval: string } | null }> };

  console.log(`\n=== Stripe Prices (${priceData.data?.length ?? 0}) ===`);
  for (const p of priceData.data ?? []) {
    const interval = p.recurring?.interval ?? "one-time";
    console.log(`  ${p.id}: $${(p.unit_amount / 100).toFixed(2)} ${p.currency} / ${interval}`);
  }

  // Check our DB plans
  const plans = await sql`
    SELECT id, name, "interval", price_in_cents, stripe_price_id, stripe_product_id
    FROM billing_plans WHERE is_active = true ORDER BY sort_order
  `;

  console.log(`\n=== DB Plans (${plans.length}) ===`);
  const stripeProducts = new Set((prodData.data ?? []).map(p => p.id));
  const stripePrices = new Set((priceData.data ?? []).map(p => p.id));

  for (const p of plans) {
    const prodOk = p.stripe_product_id ? stripeProducts.has(p.stripe_product_id) : false;
    const priceOk = p.stripe_price_id ? stripePrices.has(p.stripe_price_id) : false;
    const status = !p.stripe_product_id ? "NOT SYNCED"
      : !p.stripe_price_id && p.price_in_cents === 0 ? "OK (free, no price)"
      : prodOk && priceOk ? "OK"
      : `MISMATCH (prod=${prodOk} price=${priceOk})`;

    console.log(`  ${p.name} (${p.interval}) $${(p.price_in_cents / 100).toFixed(2)} → ${status}`);
  }

  // Test creating a checkout session for a paid plan
  const testPlan = plans.find((p: any) => p.stripe_price_id && p.price_in_cents > 0);
  if (testPlan) {
    console.log(`\n=== Test Checkout Session ===`);
    console.log(`Creating checkout for "${testPlan.name}" (${testPlan.stripe_price_id})...`);

    const checkoutRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        mode: testPlan.interval === "lifetime" ? "payment" : "subscription",
        success_url: "http://localhost:3100/settings?tab=billing&status=success",
        cancel_url: "http://localhost:3100/settings?tab=billing&status=canceled",
        "line_items[0][price]": testPlan.stripe_price_id,
        "line_items[0][quantity]": "1",
      }),
    });

    const checkoutData = await checkoutRes.json() as { url?: string; id?: string; error?: { message: string } };

    if (checkoutData.url) {
      console.log(`  Session: ${checkoutData.id}`);
      console.log(`  Checkout URL: ${checkoutData.url}`);
      console.log(`\n  Open that URL to test the full Stripe checkout flow!`);
    } else {
      console.log(`  FAILED: ${checkoutData.error?.message ?? JSON.stringify(checkoutData)}`);
    }
  }

  console.log("\nDone.");
  await sql.end();
}

run().catch((err) => { console.error(err); process.exit(1); });
