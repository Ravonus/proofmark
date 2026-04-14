/**
 * Stripe webhook handler for billing subscription lifecycle events.
 * Raw POST handler (not tRPC) because Stripe sends signed payloads.
 */

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
	constructWebhookEvent,
	getBillingStripeConfig,
} from "~/server/billing/stripe";
import { db } from "~/server/db";
import { billingPlans, invoices, subscriptions } from "~/server/db/schema";

export const dynamic = "force-dynamic";

async function getWebhookSecret(): Promise<{
	apiKey: string;
	webhookSecret: string;
} | null> {
	// Get the platform owner to look up billing config
	const platform = await db.query.platformConfig.findFirst();
	if (!platform?.ownerAddress) return null;

	const config = await getBillingStripeConfig(platform.ownerAddress);
	if (!config?.apiKey) return null;

	const webhookSecret = config.metadata?.webhookSecret;
	if (typeof webhookSecret !== "string" || !webhookSecret) return null;

	return { apiKey: config.apiKey, webhookSecret };
}

export async function POST(request: Request) {
	const secrets = await getWebhookSecret();
	if (!secrets) {
		return NextResponse.json(
			{ error: "Billing not configured" },
			{ status: 503 },
		);
	}

	const body = await request.text();
	const signature = request.headers.get("stripe-signature");
	if (!signature) {
		return NextResponse.json({ error: "Missing signature" }, { status: 400 });
	}

	let event: { type: string; data: { object: Record<string, unknown> } };
	try {
		event = await constructWebhookEvent(body, signature, secrets.webhookSecret);
	} catch (err) {
		console.error(
			"[stripe-billing] Webhook signature verification failed:",
			err,
		);
		return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
	}

	try {
		await handleEvent(event);
	} catch (err) {
		console.error("[stripe-billing] Event handling failed:", err);
		return NextResponse.json(
			{ error: "Event processing failed" },
			{ status: 500 },
		);
	}

	return NextResponse.json({ received: true });
}

async function handleEvent(event: {
	type: string;
	data: { object: Record<string, unknown> };
}) {
	const obj = event.data.object;

	switch (event.type) {
		case "checkout.session.completed":
			await handleCheckoutCompleted(obj);
			break;
		case "invoice.paid":
			await handleInvoicePaid(obj);
			break;
		case "invoice.payment_failed":
			await handlePaymentFailed(obj);
			break;
		case "customer.subscription.updated":
			await handleSubscriptionUpdated(obj);
			break;
		case "customer.subscription.deleted":
			await handleSubscriptionDeleted(obj);
			break;
	}
}

async function handleCheckoutCompleted(obj: Record<string, unknown>) {
	const customerId = obj.customer as string;
	const stripeSubId = obj.subscription as string | null;
	const metadata = (obj.metadata ?? {}) as Record<string, string>;
	const planId = metadata.planId;
	const walletAddress = metadata.walletAddress;

	if (!planId) return;

	const plan = await db.query.billingPlans.findFirst({
		where: eq(billingPlans.id, planId),
	});
	if (!plan) return;

	const now = new Date();
	const periodEnd =
		plan.interval === "lifetime"
			? null
			: plan.interval === "yearly"
				? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
				: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

	await db.insert(subscriptions).values({
		planId,
		status: "active",
		stripeCustomerId: customerId,
		stripeSubscriptionId: stripeSubId,
		walletAddress: walletAddress || null,
		currentPeriodStart: now,
		currentPeriodEnd: periodEnd,
	});
}

async function handleInvoicePaid(obj: Record<string, unknown>) {
	const stripeSubId = obj.subscription as string | null;
	const stripeInvoiceId = obj.id as string;
	const amountPaid = obj.amount_paid as number;
	const currency = obj.currency as string;
	const hostedUrl = obj.hosted_invoice_url as string | null;
	const periodStart = obj.period_start as number | undefined;
	const periodEnd = obj.period_end as number | undefined;

	if (!stripeSubId) return;

	const sub = await db.query.subscriptions.findFirst({
		where: eq(subscriptions.stripeSubscriptionId, stripeSubId),
	});
	if (!sub) return;

	// Record invoice
	await db.insert(invoices).values({
		subscriptionId: sub.id,
		stripeInvoiceId,
		status: "paid",
		amountInCents: amountPaid,
		currency,
		paidAt: new Date(),
		invoiceUrl: hostedUrl,
		periodStart: periodStart ? new Date(periodStart * 1000) : null,
		periodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
	});

	// Update subscription period
	if (periodStart && periodEnd) {
		await db
			.update(subscriptions)
			.set({
				status: "active",
				currentPeriodStart: new Date(periodStart * 1000),
				currentPeriodEnd: new Date(periodEnd * 1000),
				updatedAt: new Date(),
			})
			.where(eq(subscriptions.id, sub.id));
	}
}

async function handlePaymentFailed(obj: Record<string, unknown>) {
	const stripeSubId = obj.subscription as string | null;
	if (!stripeSubId) return;

	await db
		.update(subscriptions)
		.set({ status: "past_due", updatedAt: new Date() })
		.where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
}

async function handleSubscriptionUpdated(obj: Record<string, unknown>) {
	const stripeSubId = obj.id as string;
	const status = obj.status as string;
	const cancelAtPeriodEnd = obj.cancel_at_period_end as boolean;
	const periodStart = obj.current_period_start as number | undefined;
	const periodEnd = obj.current_period_end as number | undefined;

	const statusMap: Record<
		string,
		(typeof subscriptions.$inferSelect)["status"]
	> = {
		active: "active",
		past_due: "past_due",
		canceled: "canceled",
		trialing: "trialing",
		paused: "paused",
		incomplete: "incomplete",
	};

	const mappedStatus = statusMap[status];
	if (!mappedStatus) return;

	await db
		.update(subscriptions)
		.set({
			status: mappedStatus,
			cancelAtPeriodEnd: cancelAtPeriodEnd ?? false,
			...(periodStart
				? { currentPeriodStart: new Date(periodStart * 1000) }
				: {}),
			...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {}),
			updatedAt: new Date(),
		})
		.where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
}

async function handleSubscriptionDeleted(obj: Record<string, unknown>) {
	const stripeSubId = obj.id as string;
	await db
		.update(subscriptions)
		.set({ status: "canceled", updatedAt: new Date() })
		.where(eq(subscriptions.stripeSubscriptionId, stripeSubId));
}
