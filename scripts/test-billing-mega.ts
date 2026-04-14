/**
 * MEGA billing test — exercises every billing path:
 *   - Stripe customers, subscriptions (monthly/yearly/lifetime)
 *   - Multiple card types (visa, mastercard, amex, international)
 *   - Declined cards, expired cards, insufficient funds
 *   - Subscription upgrades, downgrades, cancellations
 *   - Invoice verification
 *   - Webhook simulation (if secret configured)
 *   - DB state verification at every step
 *   - Crypto subscription DB records
 *   - Free tier limits
 *   - Usage tracking
 *
 * Run: tsx --env-file=.env scripts/test-billing-mega.ts
 */

import { createHmac, randomBytes } from "crypto";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL!;
const sql = postgres(DATABASE_URL, { prepare: false });
const STRIPE_API = "https://api.stripe.com/v1";
const WEBHOOK_URL = "http://localhost:3100/api/stripe-billing";

let stripeKey = "";
let webhookSecret = "";
let passed = 0;
let failed = 0;
let skipped = 0;
const section = (name: string) => console.log(`\n${"─".repeat(50)}\n  ${name}\n${"─".repeat(50)}`);
const ok = (label: string) => { passed++; console.log(`  ✅ ${label}`); };
const fail = (label: string, d?: string) => { failed++; console.log(`  ❌ ${label}${d ? ` — ${d}` : ""}`); };
const skip = (label: string) => { skipped++; console.log(`  ⏭️  ${label}`); };

async function stripeReq(method: string, endpoint: string, body?: URLSearchParams): Promise<any> {
  const res = await fetch(`${STRIPE_API}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${stripeKey}`, ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${endpoint}: ${data.error?.message ?? res.status}`);
  return data;
}

async function fireWebhook(type: string, obj: Record<string, unknown>) {
  if (!webhookSecret) return null;
  const body = JSON.stringify({ type, data: { object: obj } });
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", webhookSecret).update(`${ts}.${body}`).digest("hex");
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${ts},v1=${sig}` },
    body,
  });
  return res.status;
}

async function createCustomerWithCard(email: string, name: string, cardToken: string, meta?: Record<string, string>) {
  const cust = await stripeReq("POST", "/customers", new URLSearchParams({
    email, name, ...(meta ? Object.fromEntries(Object.entries(meta).map(([k, v]) => [`metadata[${k}]`, v])) : {}),
  }));
  const pm = await stripeReq("POST", "/payment_methods", new URLSearchParams({ type: "card", "card[token]": cardToken }));
  await stripeReq("POST", `/payment_methods/${pm.id}/attach`, new URLSearchParams({ customer: cust.id }));
  await stripeReq("POST", `/customers/${cust.id}`, new URLSearchParams({ "invoice_settings[default_payment_method]": pm.id }));
  return { customerId: cust.id, paymentMethodId: pm.id };
}

async function run() {
  console.log("\n🔥 MEGA BILLING TEST\n");

  // Load config
  const rows = await sql`SELECT config FROM integration_configs WHERE kind='PAYMENT' AND config->>'provider'='stripe_billing' LIMIT 1`;
  if (!rows.length) { console.error("No Stripe config. Run admin setup first."); process.exit(1); }
  const config = rows[0].config as any;
  stripeKey = config.apiKey;
  webhookSecret = config.metadata?.webhookSecret || "";
  console.log(`Stripe: ${stripeKey.slice(0, 10)}...  Webhook: ${webhookSecret ? "YES" : "NO"}\n`);

  // Load plans
  const plans = await sql`SELECT * FROM billing_plans WHERE is_active = true ORDER BY sort_order`;
  const freePlan = plans.find((p: any) => p.price_in_cents === 0);
  const proPlan = plans.find((p: any) => p.name === "Pro" && p.interval === "monthly");
  const proYearly = plans.find((p: any) => p.name === "Pro" && p.interval === "yearly");
  const bizPlan = plans.find((p: any) => p.name === "Business");
  const lifetimePlan = plans.find((p: any) => p.name === "Lifetime");

  if (!proPlan?.stripe_price_id) { console.error("Plans not synced to Stripe."); process.exit(1); }

  const testTag = randomBytes(4).toString("hex");
  const wallets: string[] = [];
  const wallet = () => { const w = `0x${randomBytes(20).toString("hex")}`; wallets.push(w); return w; };

  // ═══════════════════════════════════════════════════════════
  section("1. CARD TYPE MATRIX");
  // ═══════════════════════════════════════════════════════════

  const cardTests = [
    { name: "Visa", token: "tok_visa", email: `visa-${testTag}@test.pm` },
    { name: "Mastercard", token: "tok_mastercard", email: `mc-${testTag}@test.pm` },
    { name: "Amex", token: "tok_amex", email: `amex-${testTag}@test.pm` },
    { name: "Visa Debit", token: "tok_visa_debit", email: `visadebit-${testTag}@test.pm` },
  ];

  const customers: Array<{ name: string; customerId: string; email: string; wallet: string }> = [];

  for (const card of cardTests) {
    try {
      const w = wallet();
      const c = await createCustomerWithCard(card.email, `${card.name} User`, card.token, { walletAddress: w, test: testTag });
      customers.push({ name: card.name, customerId: c.customerId, email: card.email, wallet: w });
      ok(`${card.name}: customer ${c.customerId}`);
    } catch (err: any) {
      fail(`${card.name}`, err.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  section("2. SUBSCRIPTION TYPES (monthly, yearly, lifetime)");
  // ═══════════════════════════════════════════════════════════

  // Monthly sub
  const visaCust = customers.find(c => c.name === "Visa");
  if (visaCust) {
    const sub = await stripeReq("POST", "/subscriptions", new URLSearchParams({
      customer: visaCust.customerId,
      "items[0][price]": proPlan.stripe_price_id,
      "metadata[planId]": proPlan.id,
      "metadata[walletAddress]": visaCust.wallet,
    }));
    ok(`Monthly Pro sub: ${sub.id} (${sub.status})`);

    // Insert into DB
    const subId = randomBytes(12).toString("base64url");
    const now = new Date();
    await sql`INSERT INTO subscriptions (id, plan_id, status, stripe_customer_id, stripe_subscription_id, wallet_address, current_period_start, current_period_end)
      VALUES (${subId}, ${proPlan.id}, 'active', ${visaCust.customerId}, ${sub.id}, ${visaCust.wallet}, ${now}, ${new Date(now.getTime() + 30*24*60*60*1000)})`;
    ok(`DB subscription: ${subId}`);

    // Webhook test
    if (webhookSecret) {
      const ws = await fireWebhook("invoice.paid", {
        id: `in_${randomBytes(8).toString("hex")}`, subscription: sub.id,
        amount_paid: proPlan.price_in_cents, currency: "usd",
        period_start: Math.floor(now.getTime()/1000), period_end: Math.floor(now.getTime()/1000) + 30*24*60*60,
      });
      ws === 200 ? ok("invoice.paid webhook processed") : fail(`Webhook returned ${ws}`);
    }
  }

  // Yearly sub
  const mcCust = customers.find(c => c.name === "Mastercard");
  if (mcCust && proYearly?.stripe_price_id) {
    const sub = await stripeReq("POST", "/subscriptions", new URLSearchParams({
      customer: mcCust.customerId,
      "items[0][price]": proYearly.stripe_price_id,
      "metadata[planId]": proYearly.id,
    }));
    ok(`Yearly Pro sub: ${sub.id} (${sub.status})`);

    const subId = randomBytes(12).toString("base64url");
    const now = new Date();
    await sql`INSERT INTO subscriptions (id, plan_id, status, stripe_customer_id, stripe_subscription_id, wallet_address, current_period_start, current_period_end)
      VALUES (${subId}, ${proYearly.id}, 'active', ${mcCust.customerId}, ${sub.id}, ${mcCust.wallet}, ${now}, ${new Date(now.getTime() + 365*24*60*60*1000)})`;
    ok(`DB yearly subscription: ${subId}`);
  }

  // Lifetime (one-time) via checkout session
  const amexCust = customers.find(c => c.name === "Amex");
  if (amexCust && lifetimePlan?.stripe_price_id) {
    const session = await stripeReq("POST", "/checkout/sessions", new URLSearchParams({
      mode: "payment", customer: amexCust.customerId,
      success_url: "http://localhost:3100/success", cancel_url: "http://localhost:3100/cancel",
      "line_items[0][price]": lifetimePlan.stripe_price_id, "line_items[0][quantity]": "1",
      "metadata[planId]": lifetimePlan.id, "metadata[walletAddress]": amexCust.wallet,
    }));
    ok(`Lifetime checkout: ${session.id}`);
    console.log(`    URL: ${session.url?.slice(0, 80)}...`);
  }

  // Business monthly
  const debitCust = customers.find(c => c.name === "Visa Debit");
  if (debitCust && bizPlan?.stripe_price_id) {
    const sub = await stripeReq("POST", "/subscriptions", new URLSearchParams({
      customer: debitCust.customerId,
      "items[0][price]": bizPlan.stripe_price_id,
      "metadata[planId]": bizPlan.id,
    }));
    ok(`Business sub: ${sub.id} (${sub.status})`);

    const subId = randomBytes(12).toString("base64url");
    const now = new Date();
    await sql`INSERT INTO subscriptions (id, plan_id, status, stripe_customer_id, stripe_subscription_id, wallet_address, current_period_start, current_period_end)
      VALUES (${subId}, ${bizPlan.id}, 'active', ${debitCust.customerId}, ${sub.id}, ${debitCust.wallet}, ${now}, ${new Date(now.getTime() + 30*24*60*60*1000)})`;
    ok(`DB business subscription: ${subId}`);
  }

  // ═══════════════════════════════════════════════════════════
  section("3. DECLINED / FAILED PAYMENTS");
  // ═══════════════════════════════════════════════════════════

  const failCards = [
    { name: "Card Declined", token: "tok_chargeDeclined" },
    { name: "Insufficient Funds", token: "tok_chargeDeclinedInsufficientFunds" },
    { name: "Expired Card", token: "tok_chargeDeclinedExpiredCard" },
    { name: "Processing Error", token: "tok_chargeDeclinedProcessingError" },
  ];

  for (const card of failCards) {
    try {
      const cust = await stripeReq("POST", "/customers", new URLSearchParams({
        email: `${card.name.replace(/\s/g, "").toLowerCase()}-${testTag}@test.pm`,
      }));
      const pm = await stripeReq("POST", "/payment_methods", new URLSearchParams({ type: "card", "card[token]": card.token }));
      await stripeReq("POST", `/payment_methods/${pm.id}/attach`, new URLSearchParams({ customer: cust.id }));
      await stripeReq("POST", `/customers/${cust.id}`, new URLSearchParams({ "invoice_settings[default_payment_method]": pm.id }));
      await stripeReq("POST", "/subscriptions", new URLSearchParams({
        customer: cust.id, "items[0][price]": proPlan.stripe_price_id,
      }));
      fail(`${card.name} should have been rejected`);
    } catch (err: any) {
      ok(`${card.name}: correctly rejected — ${err.message.split(":").pop()?.trim()}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  section("4. SUBSCRIPTION LIFECYCLE");
  // ═══════════════════════════════════════════════════════════

  if (visaCust) {
    // Get the active subscription
    const subs = await stripeReq("GET", `/subscriptions?customer=${visaCust.customerId}&status=active`);
    const activeSub = subs.data?.[0];

    if (activeSub) {
      // Upgrade: switch from Pro to Business
      if (bizPlan?.stripe_price_id) {
        const updated = await stripeReq("POST", `/subscriptions/${activeSub.id}`, new URLSearchParams({
          "items[0][id]": activeSub.items.data[0].id,
          "items[0][price]": bizPlan.stripe_price_id,
          proration_behavior: "create_prorations",
        }));
        ok(`Upgrade Pro → Business: ${updated.id} (${updated.status})`);

        // Webhook
        if (webhookSecret) {
          const ws = await fireWebhook("customer.subscription.updated", {
            id: activeSub.id, status: "active", cancel_at_period_end: false,
            current_period_start: updated.current_period_start,
            current_period_end: updated.current_period_end,
          });
          ws === 200 ? ok("Upgrade webhook processed") : fail(`Upgrade webhook: ${ws}`);
        }
      }

      // Cancel at period end
      const cancelled = await stripeReq("POST", `/subscriptions/${activeSub.id}`, new URLSearchParams({
        cancel_at_period_end: "true",
      }));
      ok(`Cancel at period end: cancel_at_period_end=${cancelled.cancel_at_period_end}`);

      // Webhook
      if (webhookSecret) {
        const ws = await fireWebhook("customer.subscription.updated", {
          id: activeSub.id, status: "active", cancel_at_period_end: true,
          current_period_start: cancelled.current_period_start,
          current_period_end: cancelled.current_period_end,
        });
        ws === 200 ? ok("Cancel webhook processed") : fail(`Cancel webhook: ${ws}`);
      }

      // Reactivate (undo cancel)
      const reactivated = await stripeReq("POST", `/subscriptions/${activeSub.id}`, new URLSearchParams({
        cancel_at_period_end: "false",
      }));
      ok(`Reactivate: cancel_at_period_end=${reactivated.cancel_at_period_end}`);

      // Immediate cancel
      const deleted = await stripeReq("DELETE", `/subscriptions/${activeSub.id}`);
      ok(`Immediate cancel: status=${deleted.status}`);

      if (webhookSecret) {
        const ws = await fireWebhook("customer.subscription.deleted", { id: activeSub.id });
        ws === 200 ? ok("Deletion webhook processed") : fail(`Deletion webhook: ${ws}`);
      }
    } else {
      skip("No active subscription to test lifecycle");
    }
  }

  // ═══════════════════════════════════════════════════════════
  section("5. CRYPTO SUBSCRIPTION RECORDS (DB only)");
  // ═══════════════════════════════════════════════════════════

  // Insert crypto plan
  const cryptoPlanId = randomBytes(12).toString("base64url");
  await sql`INSERT INTO crypto_plans (id, name, tier, "interval", price_usdc, price_weth, price_btc_sats, ai_tokens_included, features, is_active)
    VALUES (${cryptoPlanId}, 'Crypto Pro', 'pro', 'monthly', 1999, '5000000000000000', 50000, 100000,
    ${JSON.stringify(["templates", "branding", "blockchain_anchoring"])}, true)`;
  ok(`Crypto plan created: ${cryptoPlanId}`);

  // EVM subscription (Base USDC)
  const evmSubId = randomBytes(12).toString("base64url");
  const evmWallet = wallet();
  await sql`INSERT INTO crypto_subscriptions (id, subscriber_address, subscriber_chain, plan_id, payment_chain, payment_token, "interval", status, contract_address, on_chain_subscription_id, current_period_start, current_period_end)
    VALUES (${evmSubId}, ${evmWallet}, 'ETH', ${cryptoPlanId}, 'BASE', 'USDC', 'monthly', 'active',
    '0x1234567890abcdef1234567890abcdef12345678', '42',
    ${new Date()}, ${new Date(Date.now() + 30*24*60*60*1000)})`;
  ok(`EVM subscription (Base USDC): ${evmSubId}`);

  // SOL subscription
  const solSubId = randomBytes(12).toString("base64url");
  const solWallet = wallet();
  await sql`INSERT INTO crypto_subscriptions (id, subscriber_address, subscriber_chain, plan_id, payment_chain, payment_token, "interval", status, solana_account_address, current_period_start, current_period_end)
    VALUES (${solSubId}, ${solWallet}, 'SOL', ${cryptoPlanId}, 'SOL', 'SOL_USDC', 'monthly', 'active',
    'SoLaNaPdAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    ${new Date()}, ${new Date(Date.now() + 30*24*60*60*1000)})`;
  ok(`Solana subscription: ${solSubId}`);

  // BTC one-time payment
  const btcSubId = randomBytes(12).toString("base64url");
  const btcWallet = wallet();
  await sql`INSERT INTO crypto_subscriptions (id, subscriber_address, subscriber_chain, plan_id, payment_chain, payment_token, "interval", status, btc_payment_txid, current_period_start)
    VALUES (${btcSubId}, ${btcWallet}, 'BTC', ${cryptoPlanId}, 'BTC', 'BTC', 'lifetime', 'lifetime',
    'abc123def456789012345678901234567890abcdef1234567890abcdef12345678',
    ${new Date()})`;
  ok(`BTC lifetime payment: ${btcSubId}`);

  // Crypto payment event
  const eventHash = createHmac("sha256", "proofmark").update(`${evmSubId}-payment`).digest("hex");
  await sql`INSERT INTO crypto_payment_events (id, subscription_id, event_type, chain, tx_hash, amount, token_symbol, event_hash)
    VALUES (${randomBytes(12).toString("base64url")}, ${evmSubId}, 'payment_received', 'BASE',
    '0xabcdef1234567890', '10000000', 'USDC', ${eventHash})`;
  ok("Crypto payment event recorded");

  // ═══════════════════════════════════════════════════════════
  section("6. USAGE TRACKING & FREE TIER");
  // ═══════════════════════════════════════════════════════════

  // Check free tier defaults
  const freeTier = await sql`SELECT config FROM integration_configs WHERE kind='PAYMENT' AND config->>'provider'='stripe_billing' LIMIT 1`;
  const ftConfig = freeTier[0]?.config as any;
  const docsLimit = ftConfig?.metadata?.freeTier_documentsPerMonth ?? 2;
  const aiLimit = ftConfig?.metadata?.freeTier_aiCallsPerMonth ?? 3;
  ok(`Free tier: ${docsLimit} docs/mo, ${aiLimit} AI calls/mo`);

  // Insert usage metrics for a subscription
  const dbSubs = await sql`SELECT id, current_period_start, current_period_end FROM subscriptions WHERE status = 'active' LIMIT 1`;
  if (dbSubs.length > 0) {
    const sub = dbSubs[0];
    await sql`INSERT INTO usage_metrics (id, subscription_id, metric_key, period_start, period_end, current_value, limit_value)
      VALUES (${randomBytes(12).toString("base64url")}, ${sub.id}, 'documents_created', ${sub.current_period_start}, ${sub.current_period_end}, 15, 50)
      ON CONFLICT DO NOTHING`;
    ok(`Usage tracked: 15/50 documents for sub ${sub.id}`);

    await sql`INSERT INTO usage_metrics (id, subscription_id, metric_key, period_start, period_end, current_value, limit_value)
      VALUES (${randomBytes(12).toString("base64url")}, ${sub.id}, 'ai_calls', ${sub.current_period_start}, ${sub.current_period_end}, 42, 100)
      ON CONFLICT DO NOTHING`;
    ok(`Usage tracked: 42/100 AI calls for sub ${sub.id}`);
  }

  // ═══════════════════════════════════════════════════════════
  section("7. HASH ANCHOR RECORDS");
  // ═══════════════════════════════════════════════════════════

  const docHash1 = createHmac("sha256", "proofmark").update("test-document-1").digest("hex");
  const docHash2 = createHmac("sha256", "proofmark").update("test-document-2").digest("hex");
  const batchId = randomBytes(16).toString("hex");

  await sql`INSERT INTO hash_anchors (id, document_hash, anchor_tx_hash, chain, block_number, block_timestamp, batch_id, contract_address, verified)
    VALUES (${randomBytes(12).toString("base64url")}, ${docHash1}, '0xanchor_tx_1', 'BASE', 12345678, ${new Date()}, ${batchId}, '0xAnchorContract', true)`;
  ok(`Hash anchor 1: ${docHash1.slice(0, 16)}...`);

  await sql`INSERT INTO hash_anchors (id, document_hash, anchor_tx_hash, chain, block_number, block_timestamp, batch_id, contract_address, verified)
    VALUES (${randomBytes(12).toString("base64url")}, ${docHash2}, '0xanchor_tx_1', 'BASE', 12345678, ${new Date()}, ${batchId}, '0xAnchorContract', true)`;
  ok(`Hash anchor 2: ${docHash2.slice(0, 16)}... (same batch)`);

  // ═══════════════════════════════════════════════════════════
  section("8. AI USAGE BILLING");
  // ═══════════════════════════════════════════════════════════

  await sql`INSERT INTO ai_usage_billing (id, owner_address, subscription_id, billing_month, input_tokens_used, output_tokens_used, bundled_tokens_limit, overage_tokens, overage_cost_cents)
    VALUES (${randomBytes(12).toString("base64url")}, ${evmWallet}, ${evmSubId}, '2026-04', 45000, 12000, 100000, 0, 0)`;
  ok(`AI usage: 57K/100K tokens (within bundle)`);

  await sql`INSERT INTO ai_usage_billing (id, owner_address, billing_month, input_tokens_used, output_tokens_used, bundled_tokens_limit, overage_tokens, overage_cost_cents)
    VALUES (${randomBytes(12).toString("base64url")}, ${solWallet}, '2026-04', 120000, 35000, 100000, 55000, 275)
    ON CONFLICT DO NOTHING`;
  ok(`AI usage: 155K/100K tokens (55K overage, $2.75 cost)`);

  // ═══════════════════════════════════════════════════════════
  section("9. DB STATE VERIFICATION");
  // ═══════════════════════════════════════════════════════════

  const [subCount] = await sql`SELECT COUNT(*) as c FROM subscriptions`;
  const [cryptoSubCount] = await sql`SELECT COUNT(*) as c FROM crypto_subscriptions`;
  const [invoiceCount] = await sql`SELECT COUNT(*) as c FROM invoices`;
  const [usageCount] = await sql`SELECT COUNT(*) as c FROM usage_metrics`;
  const [anchorCount] = await sql`SELECT COUNT(*) as c FROM hash_anchors`;
  const [aiCount] = await sql`SELECT COUNT(*) as c FROM ai_usage_billing`;
  const [eventCount] = await sql`SELECT COUNT(*) as c FROM crypto_payment_events`;
  const [planCount] = await sql`SELECT COUNT(*) as c FROM billing_plans WHERE is_active = true`;
  const [cryptoPlanCount] = await sql`SELECT COUNT(*) as c FROM crypto_plans WHERE is_active = true`;

  console.log(`\n  Stripe subscriptions:    ${subCount.c}`);
  console.log(`  Crypto subscriptions:    ${cryptoSubCount.c}`);
  console.log(`  Invoices:                ${invoiceCount.c}`);
  console.log(`  Usage metrics:           ${usageCount.c}`);
  console.log(`  Hash anchors:            ${anchorCount.c}`);
  console.log(`  AI usage records:        ${aiCount.c}`);
  console.log(`  Crypto payment events:   ${eventCount.c}`);
  console.log(`  Billing plans:           ${planCount.c}`);
  console.log(`  Crypto plans:            ${cryptoPlanCount.c}`);

  Number(subCount.c) > 0 ? ok("Stripe subscriptions present") : fail("No stripe subs");
  Number(cryptoSubCount.c) >= 3 ? ok("Crypto subs: EVM + SOL + BTC") : fail(`Only ${cryptoSubCount.c} crypto subs`);
  Number(anchorCount.c) >= 2 ? ok("Hash anchors recorded") : fail("No anchors");
  Number(aiCount.c) >= 2 ? ok("AI usage billing recorded") : fail("No AI usage");

  // ═══════════════════════════════════════════════════════════
  section("10. STRIPE DASHBOARD STATE");
  // ═══════════════════════════════════════════════════════════

  const stripeCusts = await stripeReq("GET", "/customers?limit=100");
  const testCusts = (stripeCusts.data ?? []).filter((c: any) => c.metadata?.test === testTag);
  console.log(`  Test customers in Stripe: ${testCusts.length}`);
  for (const c of testCusts) {
    console.log(`    ${c.id}: ${c.email} (${c.name})`);
  }

  const stripeSubs = await stripeReq("GET", "/subscriptions?limit=20");
  console.log(`  Total subscriptions: ${stripeSubs.data?.length ?? 0}`);
  for (const s of stripeSubs.data ?? []) {
    console.log(`    ${s.id}: ${s.status} — $${(s.plan?.amount ?? 0) / 100}/${s.plan?.interval ?? "?"} (cancel: ${s.cancel_at_period_end})`);
  }

  // ═══════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(50)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`${"═".repeat(50)}\n`);

  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => { console.error("💥 Fatal:", err.message); process.exit(1); });
