/**
 * Stripe billing API wrapper — fetch-based (no SDK dependency).
 * Matches the existing pattern in workspace/payments.ts.
 */

import { and, eq } from "drizzle-orm";
import { db } from "~/server/db";
import {
	DEFAULT_FREE_TIER,
	type FreeTierLimits,
	type IntegrationConfig,
	integrationConfigs,
} from "~/server/db/schema";
import { normalizeOwnerAddress } from "~/server/workspace/workspace";

const STRIPE_API = "https://api.stripe.com/v1";

// ── Config resolution ──

export async function getBillingStripeConfig(
	ownerAddress: string,
): Promise<IntegrationConfig | null> {
	const rows = await db.query.integrationConfigs.findMany({
		where: and(
			eq(integrationConfigs.ownerAddress, normalizeOwnerAddress(ownerAddress)),
			eq(integrationConfigs.kind, "PAYMENT"),
		),
	});
	const billing = rows.find((r) => r.config.provider === "stripe_billing");
	return billing?.config ?? null;
}

export function isBillingEnabled(config: IntegrationConfig | null): boolean {
	return !!config?.enabled && !!config.apiKey;
}

/**
 * Get free tier limits from the billing config, falling back to defaults.
 * Stored in the stripe_billing integration's metadata as freeTier_documentsPerMonth, etc.
 */
export async function getFreeTierConfig(): Promise<FreeTierLimits> {
	try {
		const platform = await db.query.platformConfig.findFirst();
		if (!platform?.ownerAddress) return DEFAULT_FREE_TIER;

		const config = await getBillingStripeConfig(platform.ownerAddress);
		if (!config?.metadata) return DEFAULT_FREE_TIER;

		const docs = config.metadata.freeTier_documentsPerMonth;
		const ai = config.metadata.freeTier_aiCallsPerMonth;

		return {
			documentsPerMonth:
				typeof docs === "number" ? docs : DEFAULT_FREE_TIER.documentsPerMonth,
			aiCallsPerMonth:
				typeof ai === "number" ? ai : DEFAULT_FREE_TIER.aiCallsPerMonth,
		};
	} catch {
		return DEFAULT_FREE_TIER;
	}
}

/**
 * Save free tier limits into the billing integration config metadata.
 */
export async function saveFreeTierConfig(
	ownerAddress: string,
	freeTier: FreeTierLimits,
): Promise<void> {
	const rows = await db.query.integrationConfigs.findMany({
		where: and(
			eq(integrationConfigs.ownerAddress, normalizeOwnerAddress(ownerAddress)),
			eq(integrationConfigs.kind, "PAYMENT"),
		),
	});
	const billing = rows.find((r) => r.config.provider === "stripe_billing");
	if (!billing) return;

	const existingMeta = billing.config.metadata ?? {};
	await db
		.update(integrationConfigs)
		.set({
			config: {
				...billing.config,
				metadata: {
					...existingMeta,
					freeTier_documentsPerMonth: freeTier.documentsPerMonth,
					freeTier_aiCallsPerMonth: freeTier.aiCallsPerMonth,
				},
			},
			updatedAt: new Date(),
		})
		.where(eq(integrationConfigs.id, billing.id));
}

function requireKey(config: IntegrationConfig): string {
	if (!config.apiKey) throw new Error("Stripe billing requires an API key");
	return config.apiKey;
}

function stripeHeaders(apiKey: string) {
	return {
		Authorization: `Bearer ${apiKey}`,
		"Content-Type": "application/x-www-form-urlencoded",
	};
}

// ── Stripe API calls ──

export async function createStripeCustomer(
	config: IntegrationConfig,
	params: { email?: string; name?: string; metadata?: Record<string, string> },
): Promise<string> {
	const apiKey = requireKey(config);
	const body = new URLSearchParams();
	if (params.email) body.set("email", params.email);
	if (params.name) body.set("name", params.name);
	if (params.metadata) {
		for (const [k, v] of Object.entries(params.metadata)) {
			body.set(`metadata[${k}]`, v);
		}
	}

	const res = await fetch(`${STRIPE_API}/customers`, {
		method: "POST",
		headers: stripeHeaders(apiKey),
		body,
	});
	if (!res.ok) throw new Error(`Stripe create customer failed: ${res.status}`);
	const data = (await res.json()) as { id: string };
	return data.id;
}

export async function createStripeProduct(
	config: IntegrationConfig,
	params: { name: string; description?: string },
): Promise<string> {
	const apiKey = requireKey(config);
	const body = new URLSearchParams({ name: params.name });
	if (params.description) body.set("description", params.description);

	const res = await fetch(`${STRIPE_API}/products`, {
		method: "POST",
		headers: stripeHeaders(apiKey),
		body,
	});
	if (!res.ok) throw new Error(`Stripe create product failed: ${res.status}`);
	const data = (await res.json()) as { id: string };
	return data.id;
}

export async function createStripePrice(
	config: IntegrationConfig,
	params: {
		productId: string;
		amountCents: number;
		currency: string;
		interval?: "month" | "year";
	},
): Promise<string> {
	const apiKey = requireKey(config);
	const body = new URLSearchParams({
		product: params.productId,
		unit_amount: String(params.amountCents),
		currency: params.currency,
	});

	if (params.interval) {
		body.set("recurring[interval]", params.interval);
	}

	const res = await fetch(`${STRIPE_API}/prices`, {
		method: "POST",
		headers: stripeHeaders(apiKey),
		body,
	});
	if (!res.ok) throw new Error(`Stripe create price failed: ${res.status}`);
	const data = (await res.json()) as { id: string };
	return data.id;
}

export async function createCheckoutSession(
	config: IntegrationConfig,
	params: {
		priceId: string;
		customerId?: string;
		customerEmail?: string;
		successUrl: string;
		cancelUrl: string;
		metadata?: Record<string, string>;
		mode?: "subscription" | "payment";
	},
): Promise<{ url: string; sessionId: string }> {
	const apiKey = requireKey(config);
	const body = new URLSearchParams({
		mode: params.mode ?? "subscription",
		success_url: params.successUrl,
		cancel_url: params.cancelUrl,
		"line_items[0][price]": params.priceId,
		"line_items[0][quantity]": "1",
	});

	if (params.customerId) body.set("customer", params.customerId);
	if (params.customerEmail && !params.customerId)
		body.set("customer_email", params.customerEmail);
	if (params.metadata) {
		for (const [k, v] of Object.entries(params.metadata)) {
			body.set(`metadata[${k}]`, v);
		}
	}

	const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
		method: "POST",
		headers: stripeHeaders(apiKey),
		body,
	});
	if (!res.ok) throw new Error(`Stripe checkout session failed: ${res.status}`);
	const data = (await res.json()) as { url?: string; id: string };
	if (!data.url) throw new Error("Stripe checkout did not return a URL");
	return { url: data.url, sessionId: data.id };
}

export async function createPortalSession(
	config: IntegrationConfig,
	params: { customerId: string; returnUrl: string },
): Promise<string> {
	const apiKey = requireKey(config);
	const body = new URLSearchParams({
		customer: params.customerId,
		return_url: params.returnUrl,
	});

	const res = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
		method: "POST",
		headers: stripeHeaders(apiKey),
		body,
	});
	if (!res.ok) throw new Error(`Stripe portal session failed: ${res.status}`);
	const data = (await res.json()) as { url: string };
	return data.url;
}

export async function getCheckoutSession(
	config: IntegrationConfig,
	sessionId: string,
): Promise<{
	id: string;
	customer: string;
	subscription: string | null;
	mode: string;
	payment_status: string;
	metadata: Record<string, string>;
}> {
	const apiKey = requireKey(config);
	const res = await fetch(`${STRIPE_API}/checkout/sessions/${sessionId}`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	if (!res.ok) throw new Error(`Stripe get session failed: ${res.status}`);
	return res.json() as Promise<{
		id: string;
		customer: string;
		subscription: string | null;
		mode: string;
		payment_status: string;
		metadata: Record<string, string>;
	}>;
}

export async function getStripeSubscription(
	config: IntegrationConfig,
	subscriptionId: string,
): Promise<{
	id: string;
	status: string;
	current_period_start: number;
	current_period_end: number;
	cancel_at_period_end: boolean;
	items: { data: Array<{ price: { id: string } }> };
}> {
	const apiKey = requireKey(config);
	const res = await fetch(`${STRIPE_API}/subscriptions/${subscriptionId}`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	if (!res.ok) throw new Error(`Stripe get subscription failed: ${res.status}`);
	return res.json() as Promise<{
		id: string;
		status: string;
		current_period_start: number;
		current_period_end: number;
		cancel_at_period_end: boolean;
		items: { data: Array<{ price: { id: string } }> };
	}>;
}

export async function cancelStripeSubscription(
	config: IntegrationConfig,
	subscriptionId: string,
): Promise<void> {
	const apiKey = requireKey(config);
	const res = await fetch(`${STRIPE_API}/subscriptions/${subscriptionId}`, {
		method: "PATCH",
		headers: stripeHeaders(apiKey),
		body: new URLSearchParams({ cancel_at_period_end: "true" }),
	});
	if (!res.ok)
		throw new Error(`Stripe cancel subscription failed: ${res.status}`);
}

// ── Webhook verification ──

export async function constructWebhookEvent(
	body: string,
	signature: string,
	webhookSecret: string,
): Promise<{ type: string; data: { object: Record<string, unknown> } }> {
	// Stripe webhook signature verification using HMAC-SHA256
	const crypto = await import("crypto");

	const parts = signature.split(",").reduce(
		(acc, part) => {
			const [k, v] = part.split("=");
			if (k === "t") acc.timestamp = v!;
			if (k === "v1") acc.signatures.push(v!);
			return acc;
		},
		{ timestamp: "", signatures: [] as string[] },
	);

	if (!parts.timestamp || parts.signatures.length === 0) {
		throw new Error("Invalid Stripe webhook signature format");
	}

	const payload = `${parts.timestamp}.${body}`;
	const expectedSig = crypto
		.createHmac("sha256", webhookSecret)
		.update(payload)
		.digest("hex");

	const valid = parts.signatures.some((sig) => {
		try {
			return crypto.timingSafeEqual(
				Buffer.from(sig, "hex"),
				Buffer.from(expectedSig, "hex"),
			);
		} catch {
			return false;
		}
	});

	if (!valid) throw new Error("Invalid Stripe webhook signature");

	// Check timestamp freshness (5 minute tolerance)
	const age = Math.abs(Date.now() / 1000 - Number(parts.timestamp));
	if (age > 300) throw new Error("Stripe webhook timestamp too old");

	return JSON.parse(body) as {
		type: string;
		data: { object: Record<string, unknown> };
	};
}
