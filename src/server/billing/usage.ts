/**
 * Usage tracking — metered limits against subscription plans.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "~/server/db";
import {
	type BillingFeatureLimits,
	billingPlans,
	type FreeTierLimits,
	subscriptions,
	usageMetrics,
} from "~/server/db/schema";
import { getFreeTierConfig } from "./stripe";

export type UsageCheckResult = {
	allowed: boolean;
	current: number;
	limit: number | null;
};

export type UsageSummary = {
	metricKey: string;
	current: number;
	limit: number | null;
	periodStart: Date;
	periodEnd: Date;
}[];

/** Map metric keys to their corresponding field in BillingFeatureLimits. */
const METRIC_LIMIT_KEY: Record<string, keyof BillingFeatureLimits> = {
	documents_created: "documentsPerMonth",
	signers_added: "signersPerDocument",
	storage_bytes: "storageByteLimit",
	templates_used: "templatesLimit",
	ai_calls: "aiCallsPerMonth",
};

/** Map metric keys to their corresponding free tier field. */
const FREE_TIER_METRIC_KEY: Record<string, keyof FreeTierLimits> = {
	documents_created: "documentsPerMonth",
	ai_calls: "aiCallsPerMonth",
};

/**
 * Increment a usage counter for the active subscription period.
 * No-op if the user has no active subscription.
 */
export async function incrementUsage(
	subscriptionId: string,
	metricKey: string,
	amount = 1,
): Promise<void> {
	const sub = await db.query.subscriptions.findFirst({
		where: eq(subscriptions.id, subscriptionId),
	});
	if (!sub?.currentPeriodStart || !sub.currentPeriodEnd) return;

	// Upsert the usage metric row for the current period
	await db
		.insert(usageMetrics)
		.values({
			subscriptionId,
			metricKey,
			periodStart: sub.currentPeriodStart,
			periodEnd: sub.currentPeriodEnd,
			currentValue: amount,
		})
		.onConflictDoUpdate({
			target: [
				usageMetrics.subscriptionId,
				usageMetrics.metricKey,
				usageMetrics.periodStart,
			],
			set: {
				currentValue: sql`${usageMetrics.currentValue} + ${amount}`,
				updatedAt: new Date(),
			},
		});
}

/**
 * Check whether a metric is within plan limits.
 * Returns allowed=true if no subscription, no limit, or under limit.
 */
export async function checkUsageLimit(
	subscriptionId: string,
	metricKey: string,
): Promise<UsageCheckResult> {
	const sub = await db.query.subscriptions.findFirst({
		where: eq(subscriptions.id, subscriptionId),
		with: { plan: true },
	});

	// No sub or no limits → unlimited
	if (!sub) return { allowed: true, current: 0, limit: null };

	const plan = await db.query.billingPlans.findFirst({
		where: eq(billingPlans.id, sub.planId),
	});

	const limits = plan?.featureLimits;
	const limitKey = METRIC_LIMIT_KEY[metricKey];
	const limitValue = limitKey
		? (limits?.[limitKey] as number | null | undefined)
		: null;

	// null/undefined = unlimited
	if (limitValue == null) return { allowed: true, current: 0, limit: null };

	// Get current usage
	const metric = sub.currentPeriodStart
		? await db.query.usageMetrics.findFirst({
				where: and(
					eq(usageMetrics.subscriptionId, subscriptionId),
					eq(usageMetrics.metricKey, metricKey),
					eq(usageMetrics.periodStart, sub.currentPeriodStart),
				),
			})
		: null;

	const current = metric?.currentValue ?? 0;
	return { allowed: current < limitValue, current, limit: limitValue };
}

/**
 * Reset all usage metrics for a subscription (called on period rollover).
 */
export async function resetPeriodUsage(
	subscriptionId: string,
	periodStart: Date,
	periodEnd: Date,
): Promise<void> {
	// New period rows will be created by incrementUsage; nothing to reset explicitly.
	// The unique constraint on (subscriptionId, metricKey, periodStart) ensures
	// each period gets its own counters.
	void subscriptionId;
	void periodStart;
	void periodEnd;
}

/**
 * Get usage summary for all tracked metrics in the current period.
 */
export async function getUsageSummary(
	subscriptionId: string,
): Promise<UsageSummary> {
	const sub = await db.query.subscriptions.findFirst({
		where: eq(subscriptions.id, subscriptionId),
	});
	if (!sub?.currentPeriodStart || !sub.currentPeriodEnd) return [];

	const plan = await db.query.billingPlans.findFirst({
		where: eq(billingPlans.id, sub.planId),
	});
	const limits = plan?.featureLimits;

	const metrics = await db.query.usageMetrics.findMany({
		where: and(
			eq(usageMetrics.subscriptionId, subscriptionId),
			eq(usageMetrics.periodStart, sub.currentPeriodStart),
		),
	});

	// Include all tracked metric keys, even if no usage yet
	const allKeys = new Set([
		...Object.keys(METRIC_LIMIT_KEY),
		...metrics.map((m) => m.metricKey),
	]);

	return [...allKeys].map((key) => {
		const metric = metrics.find((m) => m.metricKey === key);
		const limitKey = METRIC_LIMIT_KEY[key];
		const limitValue = limitKey
			? (limits?.[limitKey] as number | null | undefined)
			: null;

		return {
			metricKey: key,
			current: metric?.currentValue ?? 0,
			limit: limitValue ?? null,
			periodStart: sub.currentPeriodStart!,
			periodEnd: sub.currentPeriodEnd!,
		};
	});
}

/**
 * Check free tier usage limits for users without a subscription.
 * Uses a simple period based on the current calendar month.
 */
export async function checkFreeTierLimit(
	userId: string | undefined,
	walletAddress: string | undefined,
	metricKey: string,
): Promise<UsageCheckResult> {
	const freeTierKey = FREE_TIER_METRIC_KEY[metricKey];
	if (!freeTierKey) return { allowed: true, current: 0, limit: null };

	const freeTier = await getFreeTierConfig();
	const limitValue = freeTier[freeTierKey];
	if (limitValue == null) return { allowed: true, current: 0, limit: null };

	// Count usage for the current calendar month across all their activity
	// We look at usageMetrics for any subscription they had, or count directly
	const now = new Date();
	const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);

	// Find any subscription (active or not) to check usage metrics
	const sub = userId
		? await db.query.subscriptions.findFirst({
				where: eq(subscriptions.userId, userId),
			})
		: walletAddress
			? await db.query.subscriptions.findFirst({
					where: eq(subscriptions.walletAddress, walletAddress),
				})
			: null;

	if (sub) {
		const metric = await db.query.usageMetrics.findFirst({
			where: and(
				eq(usageMetrics.subscriptionId, sub.id),
				eq(usageMetrics.metricKey, metricKey),
				eq(usageMetrics.periodStart, periodStart),
			),
		});
		const current = metric?.currentValue ?? 0;
		return { allowed: current < limitValue, current, limit: limitValue };
	}

	// No subscription at all — they're on free tier with zero tracked usage
	return { allowed: true, current: 0, limit: limitValue };
}

/**
 * Resolve the active subscription for a user or wallet.
 */
export async function getActiveSubscription(params: {
	userId?: string;
	walletAddress?: string;
}): Promise<typeof subscriptions.$inferSelect | null> {
	if (params.userId) {
		const sub = await db.query.subscriptions.findFirst({
			where: and(
				eq(subscriptions.userId, params.userId),
				eq(subscriptions.status, "active"),
			),
		});
		if (sub) return sub;
	}
	if (params.walletAddress) {
		const sub = await db.query.subscriptions.findFirst({
			where: and(
				eq(subscriptions.walletAddress, params.walletAddress),
				eq(subscriptions.status, "active"),
			),
		});
		if (sub) return sub;
	}
	return null;
}
