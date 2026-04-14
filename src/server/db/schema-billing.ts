/**
 * Billing tables for subscription management, invoicing, and usage tracking.
 * Re-exported from schema.ts so existing imports continue to work.
 */

import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import { users } from "./schema";
import {
	billingIntervalEnum,
	invoiceStatusEnum,
	subscriptionStatusEnum,
	walletChainEnum,
} from "./schema-enums";
import { createId } from "./utils";

// ── Types ──

export type BillingFeatureLimits = {
	documentsPerMonth?: number | null;
	signersPerDocument?: number | null;
	storageByteLimit?: number | null;
	templatesLimit?: number | null;
	aiCallsPerMonth?: number | null;
	/** Feature IDs included in this plan (keys from FeatureId). */
	enabledFeatures?: string[];
};

/** Free tier defaults applied when no subscription is active. */
export type FreeTierLimits = {
	documentsPerMonth: number;
	aiCallsPerMonth: number;
};

export const DEFAULT_FREE_TIER: FreeTierLimits = {
	documentsPerMonth: 2,
	aiCallsPerMonth: 3,
};

// ── OSS billing tables ──

export const billingPlans = pgTable(
	"billing_plans",
	{
		id: text("id").primaryKey().$defaultFn(createId),
		name: text("name").notNull(),
		description: text("description"),
		interval: billingIntervalEnum("interval").notNull(),
		priceInCents: integer("price_in_cents").notNull(),
		currency: text("currency").default("usd").notNull(),
		stripePriceId: text("stripe_price_id"),
		stripeProductId: text("stripe_product_id"),
		featureLimits: jsonb("feature_limits").$type<BillingFeatureLimits>(),
		isActive: boolean("is_active").default(true).notNull(),
		sortOrder: integer("sort_order").default(0).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(t) => [index("billing_plans_active_idx").on(t.isActive)],
);

export const subscriptions = pgTable(
	"subscriptions",
	{
		id: text("id").primaryKey().$defaultFn(createId),
		userId: text("user_id").references(() => users.id, {
			onDelete: "set null",
		}),
		walletAddress: text("wallet_address"),
		walletChain: walletChainEnum("wallet_chain"),
		planId: text("plan_id")
			.notNull()
			.references(() => billingPlans.id),
		status: subscriptionStatusEnum("status").default("active").notNull(),
		stripeCustomerId: text("stripe_customer_id"),
		stripeSubscriptionId: text("stripe_subscription_id"),
		currentPeriodStart: timestamp("current_period_start"),
		currentPeriodEnd: timestamp("current_period_end"),
		cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(t) => [
		index("subscriptions_user_idx").on(t.userId),
		index("subscriptions_wallet_idx").on(t.walletAddress, t.walletChain),
		index("subscriptions_stripe_sub_idx").on(t.stripeSubscriptionId),
		index("subscriptions_stripe_cust_idx").on(t.stripeCustomerId),
		index("subscriptions_status_idx").on(t.status),
	],
);

export const invoices = pgTable(
	"invoices",
	{
		id: text("id").primaryKey().$defaultFn(createId),
		subscriptionId: text("subscription_id")
			.notNull()
			.references(() => subscriptions.id, { onDelete: "cascade" }),
		stripeInvoiceId: text("stripe_invoice_id"),
		status: invoiceStatusEnum("status").default("draft").notNull(),
		amountInCents: integer("amount_in_cents").notNull(),
		currency: text("currency").default("usd").notNull(),
		periodStart: timestamp("period_start"),
		periodEnd: timestamp("period_end"),
		paidAt: timestamp("paid_at"),
		invoiceUrl: text("invoice_url"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		index("invoices_subscription_idx").on(t.subscriptionId),
		index("invoices_stripe_idx").on(t.stripeInvoiceId),
	],
);

export const usageMetrics = pgTable(
	"usage_metrics",
	{
		id: text("id").primaryKey().$defaultFn(createId),
		subscriptionId: text("subscription_id")
			.notNull()
			.references(() => subscriptions.id, { onDelete: "cascade" }),
		metricKey: text("metric_key").notNull(),
		periodStart: timestamp("period_start").notNull(),
		periodEnd: timestamp("period_end").notNull(),
		currentValue: integer("current_value").default(0).notNull(),
		limitValue: integer("limit_value"),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(t) => [
		index("usage_metrics_sub_idx").on(t.subscriptionId),
		unique("usage_metrics_sub_key_period_uniq").on(
			t.subscriptionId,
			t.metricKey,
			t.periodStart,
		),
	],
);

// ── Premium crypto billing tables ──

/** Token pricing entry for flexible payment configuration. */
export type TokenPricingEntry = {
	token: string;
	chain: string;
	enabled: boolean;
	pricingMode: "usd_pegged" | "fixed_token";
	usdPriceCents?: number;
	fixedAmount?: string;
	tokenAddress: string;
	decimals: number;
};

export const cryptoPlans = pgTable(
	"crypto_plans",
	{
		id: text("id").primaryKey().$defaultFn(createId),
		name: text("name").notNull(),
		tier: text("tier").notNull(),
		interval: billingIntervalEnum("interval").notNull(),
		priceUsdc: integer("price_usdc").notNull(),
		priceWeth: text("price_weth"),
		priceBtcSats: integer("price_btc_sats"),
		aiTokensIncluded: integer("ai_tokens_included").default(0).notNull(),
		aiOverageRateCents: integer("ai_overage_rate_cents").default(0).notNull(),
		features: jsonb("features").$type<string[]>(),
		tokenPricing: jsonb("token_pricing").$type<TokenPricingEntry[]>(),
		isActive: boolean("is_active").default(true).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [index("crypto_plans_active_idx").on(t.isActive)],
);

export const cryptoSubscriptions = pgTable(
	"crypto_subscriptions",
	{
		id: text("id").primaryKey().$defaultFn(createId),
		subscriberAddress: text("subscriber_address").notNull(),
		subscriberChain: walletChainEnum("subscriber_chain").notNull(),
		planId: text("plan_id")
			.notNull()
			.references(() => cryptoPlans.id),
		paymentChain: walletChainEnum("payment_chain").notNull(),
		paymentToken: text("payment_token").notNull(), // "WETH" | "USDC" | "SOL_USDC" | "BTC"
		interval: billingIntervalEnum("interval").notNull(),
		status: text("status").notNull().default("active"), // active | past_due | cancelled | expired | lifetime
		contractAddress: text("contract_address"),
		onChainSubscriptionId: text("on_chain_subscription_id"),
		solanaAccountAddress: text("solana_account_address"),
		btcPaymentTxid: text("btc_payment_txid"),
		currentPeriodStart: timestamp("current_period_start"),
		currentPeriodEnd: timestamp("current_period_end"),
		lastPaymentVerifiedAt: timestamp("last_payment_verified_at"),
		allowanceCheckedAt: timestamp("allowance_checked_at"),
		cancelledAt: timestamp("cancelled_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
	},
	(t) => [
		index("crypto_subs_address_idx").on(t.subscriberAddress, t.subscriberChain),
		index("crypto_subs_plan_idx").on(t.planId),
		index("crypto_subs_status_idx").on(t.status),
	],
);

export const cryptoPaymentEvents = pgTable(
	"crypto_payment_events",
	{
		id: text("id").primaryKey().$defaultFn(createId),
		subscriptionId: text("subscription_id")
			.notNull()
			.references(() => cryptoSubscriptions.id, { onDelete: "cascade" }),
		eventType: text("event_type").notNull(), // payment_received | allowance_insufficient | etc.
		chain: walletChainEnum("chain").notNull(),
		txHash: text("tx_hash"),
		amount: text("amount"),
		tokenSymbol: text("token_symbol"),
		blockNumber: integer("block_number"),
		eventHash: text("event_hash").notNull(),
		prevEventHash: text("prev_event_hash"),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		index("crypto_events_sub_idx").on(t.subscriptionId),
		index("crypto_events_chain_idx").on(t.chain),
	],
);

export const hashAnchors = pgTable(
	"hash_anchors",
	{
		id: text("id").primaryKey().$defaultFn(createId),
		documentHash: text("document_hash").notNull(),
		anchorTxHash: text("anchor_tx_hash").notNull(),
		chain: walletChainEnum("chain").default("BASE").notNull(),
		blockNumber: integer("block_number"),
		blockTimestamp: timestamp("block_timestamp"),
		batchId: text("batch_id"),
		contractAddress: text("contract_address").notNull(),
		verified: boolean("verified").default(false).notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		index("hash_anchors_doc_hash_idx").on(t.documentHash),
		index("hash_anchors_batch_idx").on(t.batchId),
		index("hash_anchors_chain_idx").on(t.chain),
	],
);

export const aiUsageBilling = pgTable(
	"ai_usage_billing",
	{
		id: text("id").primaryKey().$defaultFn(createId),
		ownerAddress: text("owner_address").notNull(),
		subscriptionId: text("subscription_id").references(
			() => cryptoSubscriptions.id,
			{
				onDelete: "set null",
			},
		),
		billingMonth: text("billing_month").notNull(), // "2026-04"
		inputTokensUsed: integer("input_tokens_used").default(0).notNull(),
		outputTokensUsed: integer("output_tokens_used").default(0).notNull(),
		bundledTokensLimit: integer("bundled_tokens_limit").default(0).notNull(),
		overageTokens: integer("overage_tokens").default(0).notNull(),
		overageCostCents: integer("overage_cost_cents").default(0).notNull(),
		settled: boolean("settled").default(false).notNull(),
		settledAt: timestamp("settled_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(t) => [
		index("ai_usage_billing_owner_idx").on(t.ownerAddress),
		unique("ai_usage_billing_owner_month_uniq").on(
			t.ownerAddress,
			t.billingMonth,
		),
	],
);

// ── Subscription NFTs (soulbound badges) ──

export const subscriptionNfts = pgTable(
	"subscription_nfts",
	{
		id: text("id").primaryKey().$defaultFn(createId),
		subscriberAddress: text("subscriber_address").notNull(),
		chain: walletChainEnum("chain").notNull(),
		tokenId: text("token_id").notNull(),
		contractAddress: text("contract_address").notNull(),
		planId: text("plan_id"),
		planName: text("plan_name").notNull(),
		mintTxHash: text("mint_tx_hash"),
		burnTxHash: text("burn_tx_hash"),
		status: text("status").default("active").notNull(),
		mintedAt: timestamp("minted_at").defaultNow().notNull(),
		burnedAt: timestamp("burned_at"),
	},
	(t) => [
		index("sub_nfts_address_idx").on(t.subscriberAddress, t.chain),
		unique("sub_nfts_address_chain_uniq").on(t.subscriberAddress, t.chain),
	],
);

// ── Contract Deployments Registry ──

export const contractDeployments = pgTable(
	"contract_deployments",
	{
		id: text("id").primaryKey().$defaultFn(createId),
		contractName: text("contract_name").notNull(),
		chain: walletChainEnum("chain").notNull(),
		address: text("address").notNull(),
		deployTxHash: text("deploy_tx_hash"),
		deployedAt: timestamp("deployed_at").defaultNow().notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		metadata: jsonb("metadata").$type<Record<string, unknown>>(),
	},
	(t) => [
		unique("contract_deploy_name_chain_uniq").on(t.contractName, t.chain),
	],
);

// ── Type aliases ──

export type BillingPlan = typeof billingPlans.$inferSelect;
export type NewBillingPlan = typeof billingPlans.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type UsageMetric = typeof usageMetrics.$inferSelect;
export type CryptoPlan = typeof cryptoPlans.$inferSelect;
export type CryptoSubscription = typeof cryptoSubscriptions.$inferSelect;
export type CryptoPaymentEvent = typeof cryptoPaymentEvents.$inferSelect;
export type HashAnchor = typeof hashAnchors.$inferSelect;
export type AiUsageBillingRecord = typeof aiUsageBilling.$inferSelect;
export type SubscriptionNft = typeof subscriptionNfts.$inferSelect;
export type ContractDeployment = typeof contractDeployments.$inferSelect;
