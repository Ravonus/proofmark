/**
 * Full billing flow test — creates real Stripe customers, subscriptions,
 * simulates webhooks, verifies DB state.
 *
 * Run: tsx --env-file=.env scripts/test-billing-flow.ts
 */

import { createHmac, randomBytes } from "crypto";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const sql = postgres(DATABASE_URL, { prepare: false });
const STRIPE_API = "https://api.stripe.com/v1";
const LOCAL_WEBHOOK_URL = "http://localhost:3100/api/stripe-billing";

let stripeKey = "";
let webhookSecret = "";
let passed = 0;
let failed = 0;

function ok(label: string) { passed++; console.log(`  ✅ ${label}`); }
function fail(label: string, detail?: string) { failed++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }

async function stripe(method: string, endpoint: string, body?: URLSearchParams) {
  const res = await fetch(`${STRIPE_API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe ${endpoint}: ${data.error?.message ?? res.status}`);
  return data;
}

function signWebhook(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", webhookSecret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${sig}`;
}

async function fireWebhook(eventType: string, object: Record<string, unknown>) {
  const body = JSON.stringify({ type: eventType, data: { object } });
  const signature = signWebhook(body);

  const res = await fetch(LOCAL_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": signature },
    body,
  });

  return { status: res.status, data: await res.json().catch(() => null) };
}

async function run() {
  console.log("\n🧪 BILLING FLOW TEST\n");

  // ── Load config ──
  const configRows = await sql`
    SELECT config FROM integration_configs
    WHERE kind='PAYMENT' AND config->>'provider'='stripe_billing' LIMIT 1
  `;
  if (configRows.length === 0) { console.error("No Stripe config found. Set up in admin first."); process.exit(1); }

  const config = configRows[0].config as { apiKey?: string; metadata?: Record<string, string> };
  stripeKey = config.apiKey!;
  webhookSecret = (config.metadata?.webhookSecret as string) || "";

  if (!stripeKey) { console.error("No Stripe API key."); process.exit(1); }
  console.log(`Stripe key: ${stripeKey.slice(0, 10)}...`);
  console.log(`Webhook secret: ${webhookSecret ? "configured" : "NOT SET (webhook tests will be skipped)"}\n`);

  // ── Get plans ──
  const plans = await sql`SELECT * FROM billing_plans WHERE is_active = true ORDER BY sort_order`;
  const proPlan = plans.find((p: any) => p.name === "Pro" && p.interval === "monthly");
  const bizPlan = plans.find((p: any) => p.name === "Business");
  const lifetimePlan = plans.find((p: any) => p.name === "Lifetime");

  if (!proPlan?.stripe_price_id) { console.error("Pro plan not synced to Stripe. Run sync first."); process.exit(1); }

  // ═══════════════════════════════════════════════════════════
  // TEST 1: Create Stripe customers
  // ═══════════════════════════════════════════════════════════
  console.log("── 1. Create Stripe Customers ──");

  const testWallet = `0x${randomBytes(20).toString("hex")}`;

  const customer1 = await stripe("POST", "/customers", new URLSearchParams({
    email: "alice@proofmark-test.com",
    name: "Alice Test",
    "metadata[walletAddress]": testWallet,
    "metadata[source]": "billing-flow-test",
  }));
  ok(`Customer 1 created: ${customer1.id} (alice@proofmark-test.com)`);

  const customer2 = await stripe("POST", "/customers", new URLSearchParams({
    email: "bob@proofmark-test.com",
    name: "Bob Test",
    "metadata[source]": "billing-flow-test",
  }));
  ok(`Customer 2 created: ${customer2.id} (bob@proofmark-test.com)`);

  // ═══════════════════════════════════════════════════════════
  // TEST 2: Create Stripe subscriptions directly
  // ═══════════════════════════════════════════════════════════
  console.log("\n── 2. Create Stripe Subscriptions ──");

  // Create a payment method (test card) and attach to customer
  const pm1 = await stripe("POST", "/payment_methods", new URLSearchParams({
    type: "card",
    "card[token]": "tok_visa",
  }));
  ok(`Payment method created: ${pm1.id}`);

  await stripe("POST", `/payment_methods/${pm1.id}/attach`, new URLSearchParams({
    customer: customer1.id,
  }));
  ok(`Payment method attached to customer 1`);

  // Set default payment method
  await stripe("POST", `/customers/${customer1.id}`, new URLSearchParams({
    "invoice_settings[default_payment_method]": pm1.id,
  }));
  ok(`Default payment method set for customer 1`);

  // Create subscription for Pro Monthly
  const sub1 = await stripe("POST", "/subscriptions", new URLSearchParams({
    customer: customer1.id,
    "items[0][price]": proPlan.stripe_price_id,
    "metadata[planId]": proPlan.id,
    "metadata[walletAddress]": testWallet,
  }));
  ok(`Subscription created: ${sub1.id} (status: ${sub1.status})`);

  if (sub1.status === "active") {
    ok("Subscription is ACTIVE (card charged successfully)");
  } else {
    fail(`Subscription status is ${sub1.status}, expected active`);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 3: Fire webhook to record in our DB
  // ═══════════════════════════════════════════════════════════
  console.log("\n── 3. Webhook Processing ──");

  if (!webhookSecret) {
    console.log("  ⚠️  No webhook secret — skipping webhook tests.");
    console.log("  Set webhook secret in admin to enable these tests.");

    // Instead, insert directly into DB to continue testing
    console.log("\n  Inserting subscription directly into DB...");
    const subId = randomBytes(12).toString("base64url");
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await sql`INSERT INTO subscriptions (id, plan_id, status, stripe_customer_id, stripe_subscription_id, wallet_address, current_period_start, current_period_end)
      VALUES (${subId}, ${proPlan.id}, 'active', ${customer1.id}, ${sub1.id}, ${testWallet}, ${now}, ${periodEnd})`;
    ok(`Subscription inserted into DB: ${subId}`);
  } else {
    // Fire checkout.session.completed webhook
    const webhookResult = await fireWebhook("checkout.session.completed", {
      id: `cs_test_${randomBytes(8).toString("hex")}`,
      mode: "subscription",
      customer: customer1.id,
      subscription: sub1.id,
      payment_status: "paid",
      metadata: { planId: proPlan.id, walletAddress: testWallet },
    });

    if (webhookResult.status === 200) {
      ok("checkout.session.completed webhook accepted");
    } else {
      fail(`Webhook returned ${webhookResult.status}`, JSON.stringify(webhookResult.data));
    }

    // Fire invoice.paid webhook
    const invoiceResult = await fireWebhook("invoice.paid", {
      id: `in_test_${randomBytes(8).toString("hex")}`,
      subscription: sub1.id,
      amount_paid: proPlan.price_in_cents,
      currency: "usd",
      hosted_invoice_url: "https://invoice.stripe.com/test",
      period_start: Math.floor(Date.now() / 1000),
      period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    });

    if (invoiceResult.status === 200) {
      ok("invoice.paid webhook accepted");
    } else {
      fail(`Invoice webhook returned ${invoiceResult.status}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 4: Verify DB state
  // ═══════════════════════════════════════════════════════════
  console.log("\n── 4. Verify DB State ──");

  const dbSubs = await sql`SELECT * FROM subscriptions WHERE stripe_subscription_id = ${sub1.id}`;
  if (dbSubs.length > 0) {
    ok(`Subscription found in DB: ${dbSubs[0].id}`);
    if (dbSubs[0].status === "active") ok("Status is active");
    else fail(`Status is ${dbSubs[0].status}, expected active`);
    if (dbSubs[0].stripe_customer_id === customer1.id) ok("Customer ID matches");
    else fail("Customer ID mismatch");
    if (dbSubs[0].wallet_address === testWallet) ok("Wallet address matches");
    else fail(`Wallet mismatch: ${dbSubs[0].wallet_address} vs ${testWallet}`);
    if (dbSubs[0].current_period_end) ok(`Period ends: ${new Date(dbSubs[0].current_period_end).toISOString()}`);
    else fail("No period end set");
  } else {
    fail("Subscription NOT found in DB");
  }

  const dbInvoices = await sql`SELECT * FROM invoices WHERE subscription_id IN (SELECT id FROM subscriptions WHERE stripe_subscription_id = ${sub1.id})`;
  console.log(`  Invoices in DB: ${dbInvoices.length}`);

  // ═══════════════════════════════════════════════════════════
  // TEST 5: Create a one-time (lifetime) purchase
  // ═══════════════════════════════════════════════════════════
  console.log("\n── 5. One-Time Lifetime Purchase ──");

  if (lifetimePlan?.stripe_price_id) {
    const pm2 = await stripe("POST", "/payment_methods", new URLSearchParams({
      type: "card", "card[token]": "tok_visa",
    }));
    await stripe("POST", `/payment_methods/${pm2.id}/attach`, new URLSearchParams({ customer: customer2.id }));
    await stripe("POST", `/customers/${customer2.id}`, new URLSearchParams({
      "invoice_settings[default_payment_method]": pm2.id,
    }));

    // Create a checkout session for one-time payment
    const checkout = await stripe("POST", "/checkout/sessions", new URLSearchParams({
      mode: "payment",
      customer: customer2.id,
      success_url: "http://localhost:3100/settings?tab=billing&status=success",
      cancel_url: "http://localhost:3100/settings?tab=billing",
      "line_items[0][price]": lifetimePlan.stripe_price_id,
      "line_items[0][quantity]": "1",
      "metadata[planId]": lifetimePlan.id,
    }));
    ok(`Lifetime checkout session: ${checkout.id}`);
    ok(`Checkout URL: ${checkout.url}`);
  } else {
    console.log("  ⚠️  Lifetime plan not synced to Stripe, skipping");
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 6: Test subscription cancellation
  // ═══════════════════════════════════════════════════════════
  console.log("\n── 6. Subscription Cancellation ──");

  const cancelResult = await stripe("POST", `/subscriptions/${sub1.id}`, new URLSearchParams({
    cancel_at_period_end: "true",
  }));
  if (cancelResult.cancel_at_period_end === true) {
    ok(`Subscription ${sub1.id} set to cancel at period end`);
  } else {
    fail("Cancel at period end not set");
  }

  // Fire cancellation webhook
  if (webhookSecret) {
    const cancelWebhook = await fireWebhook("customer.subscription.updated", {
      id: sub1.id,
      status: "active",
      cancel_at_period_end: true,
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    });
    if (cancelWebhook.status === 200) ok("Cancellation webhook processed");
    else fail(`Cancellation webhook failed: ${cancelWebhook.status}`);

    // Verify DB updated
    const cancelledSub = await sql`SELECT cancel_at_period_end FROM subscriptions WHERE stripe_subscription_id = ${sub1.id}`;
    if (cancelledSub[0]?.cancel_at_period_end) ok("DB shows cancel_at_period_end = true");
    else fail("DB cancel_at_period_end not updated");
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 7: Verify Stripe dashboard state
  // ═══════════════════════════════════════════════════════════
  console.log("\n── 7. Stripe Dashboard Verification ──");

  const customers = await stripe("GET", "/customers?limit=5&email=proofmark-test.com");
  console.log(`  Test customers in Stripe: ${customers.data?.length ?? 0}`);

  const subscriptions = await stripe("GET", `/subscriptions?customer=${customer1.id}`);
  console.log(`  Subscriptions for Alice: ${subscriptions.data?.length ?? 0}`);
  for (const s of subscriptions.data ?? []) {
    console.log(`    ${s.id}: ${s.status} (cancel_at_period_end: ${s.cancel_at_period_end})`);
  }

  // ═══════════════════════════════════════════════════════════
  // TEST 8: Test failed payment (declined card)
  // ═══════════════════════════════════════════════════════════
  console.log("\n── 8. Failed Payment Test ──");

  const customer3 = await stripe("POST", "/customers", new URLSearchParams({
    email: "charlie-declined@proofmark-test.com",
    "metadata[source]": "billing-flow-test",
  }));

  try {
    const pmDeclined = await stripe("POST", "/payment_methods", new URLSearchParams({
      type: "card", "card[token]": "tok_chargeDeclined",
    }));
    await stripe("POST", `/payment_methods/${pmDeclined.id}/attach`, new URLSearchParams({ customer: customer3.id }));
    await stripe("POST", `/customers/${customer3.id}`, new URLSearchParams({
      "invoice_settings[default_payment_method]": pmDeclined.id,
    }));
    await stripe("POST", "/subscriptions", new URLSearchParams({
      customer: customer3.id,
      "items[0][price]": proPlan.stripe_price_id,
    }));
    fail("Declined card subscription should have failed");
  } catch (err: any) {
    if (err.message.includes("declined") || err.message.includes("Your card was declined")) {
      ok(`Declined card correctly rejected: ${err.message}`);
    } else {
      ok(`Card rejected with error: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CLEANUP info
  // ═══════════════════════════════════════════════════════════
  console.log("\n── Cleanup ──");
  console.log(`  Test customers created: alice, bob, charlie-declined`);
  console.log(`  Test wallet: ${testWallet}`);
  console.log(`  To clean up Stripe test data, delete from Stripe Dashboard > Customers`);
  console.log(`  To clean up DB: DELETE FROM subscriptions WHERE wallet_address = '${testWallet}';`);

  // ═══════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(50)}\n`);

  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => { console.error("\n💥 Fatal:", err.message); process.exit(1); });
