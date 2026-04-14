// @ts-nocheck -- tRPC context types break type inference
/**
 * Billing router — OSS Stripe billing + premium crypto billing stub.
 */

import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { billingPremiumRouter as premiumBillingRouter } from "~/generated/premium/server/routers/billing";
import {
	type createTRPCContext,
	createTRPCRouter,
	publicProcedure,
} from "~/server/api/trpc";
import {
	cancelStripeSubscription,
	createCheckoutSession,
	createPortalSession,
	createStripePrice,
	createStripeProduct,
	getBillingStripeConfig,
	getFreeTierConfig,
	isBillingEnabled,
	saveFreeTierConfig,
} from "~/server/billing/stripe";
import {
	checkFreeTierLimit,
	getActiveSubscription,
	getUsageSummary,
} from "~/server/billing/usage";
import { isDevAdmin } from "~/server/crypto/operator-access";
import {
	findOwnedOwnerWallet,
	getOwnedWalletContextFromRequest,
	resolveOwnedAdminAccess,
} from "~/server/crypto/owned-wallet-context";
import { billingPlans, invoices, subscriptions } from "~/server/db/schema";

// ── Helpers ──

async function requireAdminAccess(
	ctx: Awaited<ReturnType<typeof createTRPCContext>>,
) {
	const ownedWalletContext = await getOwnedWalletContextFromRequest(
		ctx.req ?? null,
	);
	const adminAccess = await resolveOwnedAdminAccess(ownedWalletContext);

	if (!adminAccess.adminWallet && !isDevAdmin()) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Admin access required",
		});
	}
	return {
		ownedWalletContext,
		linkedOwnerWallet: adminAccess.adminWallet,
	};
}

function requireOwnerAddress(address: string | null): string {
	if (!address) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Wallet required for billing operations",
		});
	}
	return address;
}

const billingFeatureLimitsSchema = z
	.object({
		documentsPerMonth: z.number().int().nullable().optional(),
		signersPerDocument: z.number().int().nullable().optional(),
		storageByteLimit: z.number().int().nullable().optional(),
		templatesLimit: z.number().int().nullable().optional(),
		enabledFeatures: z.array(z.string()).optional(),
	})
	.optional();

// ── OSS billing router ──

const ossRouter = createTRPCRouter({
	// ── Public ──

	/** List active plans (for pricing page). */
	availablePlans: publicProcedure.query(async ({ ctx }) => {
		return ctx.db.query.billingPlans.findMany({
			where: eq(billingPlans.isActive, true),
			orderBy: [billingPlans.sortOrder, billingPlans.priceInCents],
		});
	}),

	/** Check if billing is enabled on this instance. */
	billingStatus: publicProcedure.query(async ({ ctx }) => {
		const ownedCtx = await getOwnedWalletContextFromRequest(ctx.req ?? null);
		const owner = await findOwnedOwnerWallet(ownedCtx);
		if (!owner?.address) return { enabled: false };
		const config = await getBillingStripeConfig(owner.address);
		return { enabled: isBillingEnabled(config) };
	}),

	// ── User procedures ──

	/** Get current user's active subscription + plan + usage. */
	currentPlan: publicProcedure.query(async ({ ctx }) => {
		const ownedCtx = await getOwnedWalletContextFromRequest(ctx.req ?? null);
		const wallet = ownedCtx?.walletAddress;
		const userId = ownedCtx?.userId;

		const sub = await getActiveSubscription({
			userId: userId ?? undefined,
			walletAddress: wallet ?? undefined,
		});
		if (!sub) return null;

		const plan = await ctx.db.query.billingPlans.findFirst({
			where: eq(billingPlans.id, sub.planId),
		});

		const usage = await getUsageSummary(sub.id);

		return { subscription: sub, plan, usage };
	}),

	/** Create a Stripe Checkout session. */
	createCheckout: publicProcedure
		.input(
			z.object({
				planId: z.string(),
				successUrl: z.string().url(),
				cancelUrl: z.string().url(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const ownedCtx = await getOwnedWalletContextFromRequest(ctx.req ?? null);
			const owner = await findOwnedOwnerWallet(ownedCtx);
			const ownerAddress = requireOwnerAddress(owner?.address ?? null);

			const config = await getBillingStripeConfig(ownerAddress);
			if (!config || !isBillingEnabled(config)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Billing is not configured",
				});
			}

			const plan = await ctx.db.query.billingPlans.findFirst({
				where: and(
					eq(billingPlans.id, input.planId),
					eq(billingPlans.isActive, true),
				),
			});
			if (!plan?.stripePriceId) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Plan not found or not synced to Stripe",
				});
			}

			const wallet = ownedCtx?.walletAddress;
			const session = await createCheckoutSession(config, {
				priceId: plan.stripePriceId,
				successUrl: input.successUrl,
				cancelUrl: input.cancelUrl,
				mode: plan.interval === "lifetime" ? "payment" : "subscription",
				metadata: {
					planId: plan.id,
					...(wallet ? { walletAddress: wallet } : {}),
				},
			});

			return { url: session.url, sessionId: session.sessionId };
		}),

	/** Create a Stripe Customer Portal session. */
	createPortalSession: publicProcedure
		.input(z.object({ returnUrl: z.string().url() }))
		.mutation(async ({ ctx, input }) => {
			const ownedCtx = await getOwnedWalletContextFromRequest(ctx.req ?? null);
			const owner = await findOwnedOwnerWallet(ownedCtx);
			const ownerAddress = requireOwnerAddress(owner?.address ?? null);

			const config = await getBillingStripeConfig(ownerAddress);
			if (!config || !isBillingEnabled(config)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Billing is not configured",
				});
			}

			const wallet = ownedCtx?.walletAddress;
			const userId = ownedCtx?.userId;

			const sub = await getActiveSubscription({
				userId: userId ?? undefined,
				walletAddress: wallet ?? undefined,
			});
			if (!sub?.stripeCustomerId) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "No active subscription found",
				});
			}

			const url = await createPortalSession(config, {
				customerId: sub.stripeCustomerId,
				returnUrl: input.returnUrl,
			});

			return { url };
		}),

	/** Cancel subscription at period end. */
	cancelSubscription: publicProcedure.mutation(async ({ ctx }) => {
		const ownedCtx = await getOwnedWalletContextFromRequest(ctx.req ?? null);
		const owner = await findOwnedOwnerWallet(ownedCtx);
		const ownerAddress = requireOwnerAddress(owner?.address ?? null);

		const config = await getBillingStripeConfig(ownerAddress);
		if (!config)
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Billing not configured",
			});

		const wallet = ownedCtx?.walletAddress;
		const userId = ownedCtx?.userId;

		const sub = await getActiveSubscription({
			userId: userId ?? undefined,
			walletAddress: wallet ?? undefined,
		});
		if (!sub?.stripeSubscriptionId) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "No active subscription to cancel",
			});
		}

		await cancelStripeSubscription(config, sub.stripeSubscriptionId);
		await ctx.db
			.update(subscriptions)
			.set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
			.where(eq(subscriptions.id, sub.id));

		return { success: true };
	}),

	/** Invoice history for current user. */
	invoiceHistory: publicProcedure.query(async ({ ctx }) => {
		const ownedCtx = await getOwnedWalletContextFromRequest(ctx.req ?? null);
		const wallet = ownedCtx?.walletAddress;
		const userId = ownedCtx?.userId;

		const sub = await getActiveSubscription({
			userId: userId ?? undefined,
			walletAddress: wallet ?? undefined,
		});
		if (!sub) return [];

		return ctx.db.query.invoices.findMany({
			where: eq(invoices.subscriptionId, sub.id),
			orderBy: [desc(invoices.createdAt)],
			limit: 50,
		});
	}),

	// ── Admin procedures ──

	/** List all plans (including inactive). */
	adminListPlans: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);
		return ctx.db.query.billingPlans.findMany({
			orderBy: [billingPlans.sortOrder, billingPlans.priceInCents],
		});
	}),

	/** Create a new plan + sync to Stripe. */
	adminCreatePlan: publicProcedure
		.input(
			z.object({
				name: z.string().min(1).max(100),
				description: z.string().max(500).optional(),
				interval: z.enum(["monthly", "yearly", "lifetime"]),
				priceInCents: z.number().int().min(0),
				currency: z.string().default("usd"),
				featureLimits: billingFeatureLimitsSchema,
				sortOrder: z.number().int().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { linkedOwnerWallet } = await requireAdminAccess(ctx);
			const ownerAddress = requireOwnerAddress(
				linkedOwnerWallet?.address ?? null,
			);

			// Sync to Stripe if billing is configured
			let stripePriceId: string | undefined;
			let stripeProductId: string | undefined;

			const config = await getBillingStripeConfig(ownerAddress);
			if (config && isBillingEnabled(config)) {
				stripeProductId = await createStripeProduct(config, {
					name: input.name,
					description: input.description,
				});

				const intervalMap = { monthly: "month", yearly: "year" } as const;
				stripePriceId = await createStripePrice(config, {
					productId: stripeProductId,
					amountCents: input.priceInCents,
					currency: input.currency,
					interval:
						input.interval !== "lifetime"
							? intervalMap[input.interval]
							: undefined,
				});
			}

			const [plan] = await ctx.db
				.insert(billingPlans)
				.values({
					name: input.name,
					description: input.description,
					interval: input.interval,
					priceInCents: input.priceInCents,
					currency: input.currency,
					featureLimits: input.featureLimits,
					sortOrder: input.sortOrder ?? 0,
					stripePriceId,
					stripeProductId,
				})
				.returning();

			return plan;
		}),

	/** Update an existing plan. */
	adminUpdatePlan: publicProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).max(100).optional(),
				description: z.string().max(500).optional(),
				featureLimits: billingFeatureLimitsSchema,
				isActive: z.boolean().optional(),
				sortOrder: z.number().int().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await requireAdminAccess(ctx);
			const { id, ...updates } = input;

			const [updated] = await ctx.db
				.update(billingPlans)
				.set({ ...updates, updatedAt: new Date() })
				.where(eq(billingPlans.id, id))
				.returning();

			if (!updated)
				throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
			return updated;
		}),

	/** Soft-delete a plan (set inactive). */
	adminDeletePlan: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await requireAdminAccess(ctx);
			await ctx.db
				.update(billingPlans)
				.set({ isActive: false, updatedAt: new Date() })
				.where(eq(billingPlans.id, input.id));
			return { success: true };
		}),

	/** List all subscriptions (admin). */
	adminListSubscriptions: publicProcedure
		.input(
			z
				.object({
					status: z
						.enum([
							"active",
							"past_due",
							"canceled",
							"trialing",
							"paused",
							"incomplete",
						])
						.optional(),
					limit: z.number().int().min(1).max(100).default(50),
					offset: z.number().int().min(0).default(0),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			await requireAdminAccess(ctx);
			const filters = input?.status
				? eq(subscriptions.status, input.status)
				: undefined;

			const rows = await ctx.db.query.subscriptions.findMany({
				where: filters,
				orderBy: [desc(subscriptions.createdAt)],
				limit: input?.limit ?? 50,
				offset: input?.offset ?? 0,
			});

			const [{ total }] = await ctx.db
				.select({ total: count() })
				.from(subscriptions)
				.where(filters);

			return { rows, total };
		}),

	/** Get free tier limits. */
	adminGetFreeTier: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);
		return getFreeTierConfig();
	}),

	/** Update free tier limits. */
	adminUpdateFreeTier: publicProcedure
		.input(
			z.object({
				documentsPerMonth: z.number().int().min(0).max(1000),
				aiCallsPerMonth: z.number().int().min(0).max(1000),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { linkedOwnerWallet } = await requireAdminAccess(ctx);
			const ownerAddress = requireOwnerAddress(
				linkedOwnerWallet?.address ?? null,
			);
			await saveFreeTierConfig(ownerAddress, input);
			return input;
		}),

	/** Get free tier usage for the current user (when no subscription). */
	freeTierStatus: publicProcedure.query(async ({ ctx }) => {
		const ownedCtx = await getOwnedWalletContextFromRequest(ctx.req ?? null);
		const wallet = ownedCtx?.walletAddress;
		const userId = ownedCtx?.userId;

		// If they have an active subscription, they're not on free tier
		const sub = await getActiveSubscription({
			userId: userId ?? undefined,
			walletAddress: wallet ?? undefined,
		});
		if (sub) return null;

		const freeTier = await getFreeTierConfig();
		const docsUsage = await checkFreeTierLimit(
			userId ?? undefined,
			wallet ?? undefined,
			"documents_created",
		);
		const aiUsage = await checkFreeTierLimit(
			userId ?? undefined,
			wallet ?? undefined,
			"ai_calls",
		);

		return {
			limits: freeTier,
			usage: {
				documents: docsUsage,
				aiCalls: aiUsage,
			},
		};
	}),

	/** Sync a plan to Stripe (create Product + Price if not already synced). */
	adminSyncPlanToStripe: publicProcedure
		.input(z.object({ planId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { linkedOwnerWallet } = await requireAdminAccess(ctx);
			const ownerAddress = requireOwnerAddress(
				linkedOwnerWallet?.address ?? null,
			);
			const config = await getBillingStripeConfig(ownerAddress);
			if (!config || !isBillingEnabled(config)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Stripe billing is not configured",
				});
			}

			const plan = await ctx.db.query.billingPlans.findFirst({
				where: eq(billingPlans.id, input.planId),
			});
			if (!plan)
				throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
			if (plan.stripePriceId)
				return { already: true, stripePriceId: plan.stripePriceId };

			if (plan.priceInCents === 0) {
				const productId = await createStripeProduct(config, {
					name: plan.name,
					description: plan.description ?? undefined,
				});
				await ctx.db
					.update(billingPlans)
					.set({ stripeProductId: productId, updatedAt: new Date() })
					.where(eq(billingPlans.id, plan.id));
				return {
					already: false,
					stripeProductId: productId,
					note: "Free plan — no Stripe price created",
				};
			}

			const productId = await createStripeProduct(config, {
				name: plan.name,
				description: plan.description ?? undefined,
			});

			const intervalMap = { monthly: "month", yearly: "year" } as const;
			const priceId = await createStripePrice(config, {
				productId,
				amountCents: plan.priceInCents,
				currency: plan.currency,
				interval:
					plan.interval !== "lifetime" ? intervalMap[plan.interval] : undefined,
			});

			await ctx.db
				.update(billingPlans)
				.set({
					stripeProductId: productId,
					stripePriceId: priceId,
					updatedAt: new Date(),
				})
				.where(eq(billingPlans.id, plan.id));

			return {
				already: false,
				stripeProductId: productId,
				stripePriceId: priceId,
			};
		}),

	/** Sync ALL unsynced plans to Stripe in one call. */
	adminSyncAllPlansToStripe: publicProcedure.mutation(async ({ ctx }) => {
		const { linkedOwnerWallet } = await requireAdminAccess(ctx);
		const ownerAddress = requireOwnerAddress(
			linkedOwnerWallet?.address ?? null,
		);
		const config = await getBillingStripeConfig(ownerAddress);
		if (!config || !isBillingEnabled(config)) {
			throw new TRPCError({
				code: "BAD_REQUEST",
				message: "Stripe not configured",
			});
		}

		const plans = await ctx.db.query.billingPlans.findMany({
			where: eq(billingPlans.isActive, true),
		});

		const results = [];
		for (const plan of plans) {
			if (plan.stripePriceId) {
				results.push({
					id: plan.id,
					name: plan.name,
					status: "already_synced",
				});
				continue;
			}

			try {
				const productId = await createStripeProduct(config, {
					name: plan.name,
					description: plan.description ?? undefined,
				});

				if (plan.priceInCents === 0) {
					await ctx.db
						.update(billingPlans)
						.set({ stripeProductId: productId, updatedAt: new Date() })
						.where(eq(billingPlans.id, plan.id));
					results.push({
						id: plan.id,
						name: plan.name,
						status: "synced_no_price",
					});
					continue;
				}

				const intervalMap = { monthly: "month", yearly: "year" } as const;
				const priceId = await createStripePrice(config, {
					productId,
					amountCents: plan.priceInCents,
					currency: plan.currency,
					interval:
						plan.interval !== "lifetime"
							? intervalMap[plan.interval]
							: undefined,
				});

				await ctx.db
					.update(billingPlans)
					.set({
						stripeProductId: productId,
						stripePriceId: priceId,
						updatedAt: new Date(),
					})
					.where(eq(billingPlans.id, plan.id));
				results.push({
					id: plan.id,
					name: plan.name,
					status: "synced",
					stripePriceId: priceId,
				});
			} catch (err) {
				results.push({
					id: plan.id,
					name: plan.name,
					status: "error",
					error: err instanceof Error ? err.message : "unknown",
				});
			}
		}

		return results;
	}),

	/** Admin: manually assign a plan to a user/wallet (for testing). */
	adminAssignPlan: publicProcedure
		.input(
			z.object({
				planId: z.string(),
				walletAddress: z.string().optional(),
				userId: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await requireAdminAccess(ctx);
			const plan = await ctx.db.query.billingPlans.findFirst({
				where: eq(billingPlans.id, input.planId),
			});
			if (!plan)
				throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });

			const now = new Date();
			const periodEnd =
				plan.interval === "lifetime"
					? null
					: plan.interval === "yearly"
						? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)
						: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

			const [sub] = await ctx.db
				.insert(subscriptions)
				.values({
					planId: plan.id,
					userId: input.userId ?? null,
					walletAddress: input.walletAddress ?? null,
					status: "active",
					currentPeriodStart: now,
					currentPeriodEnd: periodEnd,
				})
				.returning();

			return sub;
		}),

	/** Admin: create a Stripe customer (for testing / API-driven onboarding). */
	adminCreateCustomer: publicProcedure
		.input(
			z.object({
				email: z.string().email(),
				name: z.string().optional(),
				walletAddress: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { linkedOwnerWallet } = await requireAdminAccess(ctx);
			const ownerAddress = requireOwnerAddress(
				linkedOwnerWallet?.address ?? null,
			);
			const config = await getBillingStripeConfig(ownerAddress);
			if (!config || !isBillingEnabled(config)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Stripe not configured",
				});
			}

			const { createStripeCustomer } = await import("~/server/billing/stripe");
			const customerId = await createStripeCustomer(config, {
				email: input.email,
				name: input.name,
				metadata: input.walletAddress
					? { walletAddress: input.walletAddress }
					: undefined,
			});

			return { customerId };
		}),

	/** Admin: create a full Stripe checkout session for a plan (returns URL). */
	adminCreateTestCheckout: publicProcedure
		.input(
			z.object({
				planId: z.string(),
				customerEmail: z.string().email().optional(),
				customerId: z.string().optional(),
				walletAddress: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { linkedOwnerWallet } = await requireAdminAccess(ctx);
			const ownerAddress = requireOwnerAddress(
				linkedOwnerWallet?.address ?? null,
			);
			const config = await getBillingStripeConfig(ownerAddress);
			if (!config || !isBillingEnabled(config)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Stripe not configured",
				});
			}

			const plan = await ctx.db.query.billingPlans.findFirst({
				where: and(
					eq(billingPlans.id, input.planId),
					eq(billingPlans.isActive, true),
				),
			});
			if (!plan?.stripePriceId) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Plan not found or not synced to Stripe",
				});
			}

			const baseUrl = "http://localhost:3100";
			const result = await createCheckoutSession(config, {
				priceId: plan.stripePriceId,
				customerId: input.customerId,
				customerEmail: input.customerEmail,
				successUrl: `${baseUrl}/settings?tab=billing&status=success`,
				cancelUrl: `${baseUrl}/settings?tab=billing&status=canceled`,
				mode: plan.interval === "lifetime" ? "payment" : "subscription",
				metadata: {
					planId: plan.id,
					...(input.walletAddress
						? { walletAddress: input.walletAddress }
						: {}),
				},
			});

			return {
				url: result.url,
				sessionId: result.sessionId,
				planName: plan.name,
			};
		}),

	/** Admin: get a Stripe subscription status (verify it exists in Stripe). */
	adminVerifyStripeSubscription: publicProcedure
		.input(z.object({ stripeSubscriptionId: z.string() }))
		.query(async ({ ctx, input }) => {
			const { linkedOwnerWallet } = await requireAdminAccess(ctx);
			const ownerAddress = requireOwnerAddress(
				linkedOwnerWallet?.address ?? null,
			);
			const config = await getBillingStripeConfig(ownerAddress);
			if (!config || !isBillingEnabled(config)) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Stripe not configured",
				});
			}

			const { getStripeSubscription } = await import("~/server/billing/stripe");
			const stripeSub = await getStripeSubscription(
				config,
				input.stripeSubscriptionId,
			);

			return {
				id: stripeSub.id,
				status: stripeSub.status,
				cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
				currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
				currentPeriodEnd: new Date(stripeSub.current_period_end * 1000),
			};
		}),

	/** Admin: cancel a subscription in Stripe immediately or at period end. */
	adminCancelSubscription: publicProcedure
		.input(
			z.object({
				subscriptionId: z.string(),
				immediate: z.boolean().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await requireAdminAccess(ctx);

			const sub = await ctx.db.query.subscriptions.findFirst({
				where: eq(subscriptions.id, input.subscriptionId),
			});
			if (!sub)
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Subscription not found",
				});

			// Update DB
			await ctx.db
				.update(subscriptions)
				.set({
					status: input.immediate ? "canceled" : sub.status,
					cancelAtPeriodEnd: !input.immediate,
					updatedAt: new Date(),
				})
				.where(eq(subscriptions.id, sub.id));

			// Cancel in Stripe if applicable
			if (sub.stripeSubscriptionId) {
				const { linkedOwnerWallet } = await requireAdminAccess(ctx);
				const config = await getBillingStripeConfig(
					linkedOwnerWallet?.address ?? "",
				);
				if (config) {
					await cancelStripeSubscription(config, sub.stripeSubscriptionId);
				}
			}

			return { success: true };
		}),

	/** Admin: list Stripe customers (for testing/debug). */
	adminListStripeCustomers: publicProcedure
		.input(
			z
				.object({
					email: z.string().optional(),
					limit: z.number().int().min(1).max(100).default(10),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const { linkedOwnerWallet } = await requireAdminAccess(ctx);
			const ownerAddress = requireOwnerAddress(
				linkedOwnerWallet?.address ?? null,
			);
			const config = await getBillingStripeConfig(ownerAddress);
			if (!config || !isBillingEnabled(config)) {
				return { customers: [] };
			}

			const params = new URLSearchParams({
				limit: String(input?.limit ?? 10),
			});
			if (input?.email) params.set("email", input.email);

			const res = await fetch(`https://api.stripe.com/v1/customers?${params}`, {
				headers: { Authorization: `Bearer ${config.apiKey}` },
			});
			const data = (await res.json()) as {
				data: Array<{
					id: string;
					email: string;
					name: string;
					metadata: Record<string, string>;
					created: number;
				}>;
			};

			return {
				customers: (data.data ?? []).map((c) => ({
					id: c.id,
					email: c.email,
					name: c.name,
					walletAddress: c.metadata?.walletAddress,
					createdAt: new Date(c.created * 1000).toISOString(),
				})),
			};
		}),

	/** Check current billing limits for the caller (used by frontend to show nudges). */
	myLimits: publicProcedure.query(async ({ ctx }) => {
		const ownedCtx = await getOwnedWalletContextFromRequest(ctx.req ?? null);
		const wallet = ownedCtx?.walletAddress;
		const userId = ownedCtx?.userId;

		const sub = await getActiveSubscription({
			userId: userId ?? undefined,
			walletAddress: wallet ?? undefined,
		});

		if (sub) {
			const plan = await ctx.db.query.billingPlans.findFirst({
				where: eq(billingPlans.id, sub.planId),
			});
			const usage = await getUsageSummary(sub.id);
			return {
				tier: plan?.name ?? "Paid",
				planId: sub.planId,
				isFree: plan?.priceInCents === 0,
				limits: plan?.featureLimits ?? null,
				usage,
				subscription: {
					status: sub.status,
					currentPeriodEnd: sub.currentPeriodEnd,
				},
			};
		}

		// Free tier
		const freeTier = await getFreeTierConfig();
		const docsUsage = await checkFreeTierLimit(
			userId ?? undefined,
			wallet ?? undefined,
			"documents_created",
		);
		const aiUsage = await checkFreeTierLimit(
			userId ?? undefined,
			wallet ?? undefined,
			"ai_calls",
		);

		return {
			tier: "Free",
			planId: null,
			isFree: true,
			limits: {
				documentsPerMonth: freeTier.documentsPerMonth,
				aiCallsPerMonth: freeTier.aiCallsPerMonth,
			},
			usage: [
				{
					metricKey: "documents_created",
					current: docsUsage.current,
					limit: docsUsage.limit,
					periodStart: new Date(),
					periodEnd: new Date(),
				},
				{
					metricKey: "ai_calls",
					current: aiUsage.current,
					limit: aiUsage.limit,
					periodStart: new Date(),
					periodEnd: new Date(),
				},
			],
			subscription: null,
		};
	}),

	/** Billing stats: MRR, active count, etc. */
	adminBillingStats: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);

		const [activeCount] = await ctx.db
			.select({ count: count() })
			.from(subscriptions)
			.where(eq(subscriptions.status, "active"));

		const [pastDueCount] = await ctx.db
			.select({ count: count() })
			.from(subscriptions)
			.where(eq(subscriptions.status, "past_due"));

		const [canceledCount] = await ctx.db
			.select({ count: count() })
			.from(subscriptions)
			.where(eq(subscriptions.status, "canceled"));

		// Approximate MRR from active subscriptions
		const mrrResult = await ctx.db
			.select({
				mrr: sql<number>`COALESCE(SUM(
          CASE
            WHEN ${billingPlans.interval} = 'monthly' THEN ${billingPlans.priceInCents}
            WHEN ${billingPlans.interval} = 'yearly' THEN ${billingPlans.priceInCents} / 12
            ELSE 0
          END
        ), 0)`,
			})
			.from(subscriptions)
			.innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
			.where(eq(subscriptions.status, "active"));

		return {
			activeSubs: activeCount?.count ?? 0,
			pastDueSubs: pastDueCount?.count ?? 0,
			canceledSubs: canceledCount?.count ?? 0,
			mrrCents: mrrResult[0]?.mrr ?? 0,
		};
	}),

	// ═══════════════════════════════════════════════════════════
	// ANALYTICS ENDPOINTS (v2 — merged Stripe + Crypto)
	// ═══════════════════════════════════════════════════════════

	/** Revenue KPIs — merged Stripe + Crypto. */
	adminRevenueKpis: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);

		// Stripe MRR
		const [stripeMrr] = await ctx.db
			.select({
				mrr: sql<number>`COALESCE(SUM(CASE
					WHEN ${billingPlans.interval} = 'monthly' THEN ${billingPlans.priceInCents}
					WHEN ${billingPlans.interval} = 'yearly' THEN ${billingPlans.priceInCents} / 12
					ELSE 0 END), 0)`,
				count: count(),
			})
			.from(subscriptions)
			.innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
			.where(eq(subscriptions.status, "active"));

		// Crypto MRR (normalized to cents via price_usdc)
		const [cryptoMrr] = await ctx.db.execute(sql`
			SELECT COALESCE(SUM(CASE
				WHEN cp.interval = 'monthly' THEN cp.price_usdc
				WHEN cp.interval = 'yearly' THEN cp.price_usdc / 12
				ELSE 0 END), 0)::int AS mrr,
			COUNT(*)::int AS count
			FROM crypto_subscriptions cs
			JOIN crypto_plans cp ON cp.id = cs.plan_id
			WHERE cs.status = 'active'
		`);

		// Total paid invoices
		const [totalPaid] = await ctx.db
			.select({ total: sql<number>`COALESCE(SUM(amount_in_cents), 0)` })
			.from(invoices)
			.where(eq(invoices.status, "paid"));

		// Crypto payment volume
		const [cryptoVol] = await ctx.db.execute(sql`
			SELECT COALESCE(SUM(amount::numeric), 0)::int AS vol
			FROM crypto_payment_events WHERE event_type = 'payment_received'
		`);

		const sMrr = stripeMrr?.mrr ?? 0;
		const cMrr = (cryptoMrr as any)?.mrr ?? 0;
		const sCount = stripeMrr?.count ?? 0;
		const cCount = (cryptoMrr as any)?.count ?? 0;
		const totalMrr = sMrr + cMrr;
		const totalCustomers = sCount + cCount;

		return {
			totalRevenueCents:
				(totalPaid?.total ?? 0) + ((cryptoVol as any)?.vol ?? 0),
			mrrCents: totalMrr,
			arrCents: totalMrr * 12,
			stripeMrrCents: sMrr,
			cryptoMrrCents: cMrr,
			stripeCustomers: sCount,
			cryptoCustomers: cCount,
			totalCustomers,
			arpu: totalCustomers > 0 ? Math.round(totalMrr / totalCustomers) : 0,
		};
	}),

	/** MRR time series — Stripe + Crypto per month. */
	adminRevenueTimeSeries: publicProcedure
		.input(
			z
				.object({ months: z.number().int().min(1).max(36).default(12) })
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			await requireAdminAccess(ctx);
			const months = input?.months ?? 12;
			const rows = await ctx.db.execute(sql`
				WITH months AS (
					SELECT generate_series(
						date_trunc('month', NOW()) - (${months - 1} || ' months')::interval,
						date_trunc('month', NOW()),
						'1 month'
					)::date AS month
				)
				SELECT
					to_char(m.month, 'YYYY-MM') AS month,
					COALESCE(SUM(CASE
						WHEN bp.interval = 'monthly' THEN bp.price_in_cents
						WHEN bp.interval = 'yearly' THEN bp.price_in_cents / 12
						ELSE 0
					END), 0)::int AS mrr_cents,
					COALESCE(SUM(CASE
						WHEN bp.interval = 'monthly' THEN bp.price_in_cents * 12
						WHEN bp.interval = 'yearly' THEN bp.price_in_cents
						ELSE 0
					END), 0)::int AS arr_cents,
					COUNT(s.id)::int AS active_count
				FROM months m
				LEFT JOIN subscriptions s ON s.status = 'active'
					AND s.created_at <= (m.month + '1 month'::interval)
					AND (s.current_period_end IS NULL OR s.current_period_end >= m.month)
				LEFT JOIN billing_plans bp ON bp.id = s.plan_id
				GROUP BY m.month
				ORDER BY m.month
			`);
			return rows as Array<{
				month: string;
				mrr_cents: number;
				arr_cents: number;
				active_count: number;
			}>;
		}),

	/** Revenue by plan — merged Stripe + Crypto. */
	adminRevenueByPlan: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);

		const stripeRows = await ctx.db
			.select({
				planName: billingPlans.name,
				planId: billingPlans.id,
				interval: billingPlans.interval,
				activeCount: count(),
				mrrCents: sql<number>`COALESCE(SUM(CASE
					WHEN ${billingPlans.interval} = 'monthly' THEN ${billingPlans.priceInCents}
					WHEN ${billingPlans.interval} = 'yearly' THEN ${billingPlans.priceInCents} / 12
					ELSE 0 END), 0)`,
			})
			.from(subscriptions)
			.innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
			.where(eq(subscriptions.status, "active"))
			.groupBy(billingPlans.id, billingPlans.name, billingPlans.interval);

		const cryptoRows = await ctx.db.execute(sql`
			SELECT cp.name AS plan_name, cp.id AS plan_id, cp.interval,
				COUNT(*)::int AS active_count,
				COALESCE(SUM(CASE
					WHEN cp.interval = 'monthly' THEN cp.price_usdc
					WHEN cp.interval = 'yearly' THEN cp.price_usdc / 12
					ELSE 0 END), 0)::int AS mrr_cents
			FROM crypto_subscriptions cs
			JOIN crypto_plans cp ON cp.id = cs.plan_id
			WHERE cs.status = 'active'
			GROUP BY cp.id, cp.name, cp.interval
		`);

		return [
			...stripeRows.map((r) => ({ ...r, source: "stripe" as const })),
			...(cryptoRows as any[]).map((r: any) => ({
				planName: r.plan_name,
				planId: r.plan_id,
				interval: r.interval,
				activeCount: r.active_count,
				mrrCents: r.mrr_cents,
				source: "crypto" as const,
			})),
		];
	}),

	/** Subscription breakdown — merged Stripe + Crypto statuses/plans. */
	adminSubscriptionBreakdown: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);

		const stripeByStatus = await ctx.db
			.select({ status: subscriptions.status, count: count() })
			.from(subscriptions)
			.groupBy(subscriptions.status);

		const cryptoByStatus = await ctx.db.execute(sql`
			SELECT status, COUNT(*)::int AS count FROM crypto_subscriptions GROUP BY status
		`);

		// Merge status counts
		const statusMap = new Map<string, number>();
		for (const r of stripeByStatus)
			statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + r.count);
		for (const r of cryptoByStatus as any[])
			statusMap.set(r.status, (statusMap.get(r.status) ?? 0) + r.count);
		const byStatus = [...statusMap.entries()].map(([status, ct]) => ({
			status,
			count: ct,
		}));

		const stripeByPlan = await ctx.db
			.select({
				planName: billingPlans.name,
				planId: billingPlans.id,
				count: count(),
			})
			.from(subscriptions)
			.innerJoin(billingPlans, eq(subscriptions.planId, billingPlans.id))
			.groupBy(billingPlans.id, billingPlans.name);

		const cryptoByPlan = await ctx.db.execute(sql`
			SELECT cp.name AS plan_name, cp.id AS plan_id, COUNT(*)::int AS count
			FROM crypto_subscriptions cs JOIN crypto_plans cp ON cp.id = cs.plan_id
			GROUP BY cp.id, cp.name
		`);

		const byPlan = [
			...stripeByPlan,
			...(cryptoByPlan as any[]).map((r: any) => ({
				planName: r.plan_name,
				planId: r.plan_id,
				count: r.count,
			})),
		];

		return { byStatus, byPlan };
	}),

	/** Recent subscription events (created/canceled). */
	adminRecentEvents: publicProcedure
		.input(
			z
				.object({ limit: z.number().int().min(1).max(50).default(20) })
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			await requireAdminAccess(ctx);
			const rows = await ctx.db.query.subscriptions.findMany({
				orderBy: [desc(subscriptions.updatedAt)],
				limit: input?.limit ?? 20,
			});
			return rows.map((s) => ({
				id: s.id,
				event:
					s.status === "canceled"
						? "canceled"
						: s.cancelAtPeriodEnd
							? "canceling"
							: "active",
				identifier: s.walletAddress
					? `${s.walletAddress.slice(0, 6)}...${s.walletAddress.slice(-4)}`
					: (s.userId ?? "unknown"),
				planId: s.planId,
				timestamp: s.updatedAt?.toISOString() ?? s.createdAt.toISOString(),
			}));
		}),

	/** Customer count trend over months. */
	adminCustomerCountTrend: publicProcedure
		.input(
			z
				.object({ months: z.number().int().min(1).max(36).default(12) })
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			await requireAdminAccess(ctx);
			const months = input?.months ?? 12;
			const rows = await ctx.db.execute(sql`
				WITH months AS (
					SELECT generate_series(
						date_trunc('month', NOW()) - (${months - 1} || ' months')::interval,
						date_trunc('month', NOW()),
						'1 month'
					)::date AS month
				)
				SELECT
					to_char(m.month, 'YYYY-MM') AS month,
					COUNT(DISTINCT CASE WHEN s.stripe_customer_id IS NOT NULL THEN s.id END)::int AS stripe,
					COUNT(DISTINCT CASE WHEN s.wallet_address IS NOT NULL AND s.stripe_customer_id IS NULL THEN s.id END)::int AS crypto,
					COUNT(DISTINCT s.id)::int AS total
				FROM months m
				LEFT JOIN subscriptions s ON s.created_at <= (m.month + '1 month'::interval)
					AND (s.status = 'active' OR s.current_period_end >= m.month)
				GROUP BY m.month ORDER BY m.month
			`);
			return rows as Array<{
				month: string;
				stripe: number;
				crypto: number;
				total: number;
			}>;
		}),

	/** Combined customer list — Stripe + Crypto with full details. */
	adminCustomerList: publicProcedure
		.input(
			z
				.object({
					search: z.string().optional(),
					type: z.enum(["all", "stripe", "crypto"]).default("all"),
					limit: z.number().int().min(1).max(100).default(25),
					offset: z.number().int().min(0).default(0),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			await requireAdminAccess(ctx);

			type CustomerRow = {
				id: string;
				identifier: string;
				type: "stripe" | "crypto";
				plan: string;
				status: string;
				chain: string | null;
				paymentToken: string | null;
				lastPayment: string | null;
				createdAt: string;
			};

			const allRows: CustomerRow[] = [];

			// Stripe customers
			if (input?.type !== "crypto") {
				const stripeSubs = await ctx.db.query.subscriptions.findMany({
					orderBy: [desc(subscriptions.createdAt)],
					limit: 100,
				});
				const plans = await ctx.db.query.billingPlans.findMany();
				const planMap = new Map(plans.map((p) => [p.id, p]));

				for (const s of stripeSubs) {
					allRows.push({
						id: s.id,
						identifier:
							s.walletAddress ?? s.userId ?? s.stripeCustomerId ?? "unknown",
						type: "stripe",
						plan: planMap.get(s.planId)?.name ?? "Unknown",
						status: s.status,
						chain: s.walletChain ?? null,
						paymentToken: null,
						lastPayment: s.currentPeriodStart?.toISOString() ?? null,
						createdAt: s.createdAt.toISOString(),
					});
				}
			}

			// Crypto customers
			if (input?.type !== "stripe") {
				const cryptoSubs = await ctx.db.execute(sql`
					SELECT cs.id, cs.subscriber_address, cs.subscriber_chain,
						cs.payment_chain, cs.payment_token, cs.status,
						cs.last_payment_verified_at, cs.created_at,
						cp.name AS plan_name
					FROM crypto_subscriptions cs
					JOIN crypto_plans cp ON cp.id = cs.plan_id
					ORDER BY cs.created_at DESC LIMIT 100
				`);

				for (const s of cryptoSubs as any[]) {
					allRows.push({
						id: s.id,
						identifier: s.subscriber_address,
						type: "crypto",
						plan: s.plan_name,
						status: s.status,
						chain: s.subscriber_chain,
						paymentToken: s.payment_token,
						lastPayment: s.last_payment_verified_at?.toISOString?.() ?? null,
						createdAt:
							s.created_at?.toISOString?.() ?? new Date().toISOString(),
					});
				}
			}

			// Sort by creation date, apply search/limit
			let filtered = allRows.sort(
				(a, b) =>
					new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
			);
			if (input?.search) {
				const q = input.search.toLowerCase();
				filtered = filtered.filter(
					(r) =>
						r.identifier.toLowerCase().includes(q) ||
						r.plan.toLowerCase().includes(q),
				);
			}
			const paged = filtered.slice(
				input?.offset ?? 0,
				(input?.offset ?? 0) + (input?.limit ?? 25),
			);

			return { rows: paged, total: filtered.length };
		}),

	/** Usage trends over months. */
	adminUsageTrends: publicProcedure
		.input(
			z
				.object({ months: z.number().int().min(1).max(36).default(12) })
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			await requireAdminAccess(ctx);
			const months = input?.months ?? 12;
			const rows = await ctx.db.execute(sql`
				WITH months AS (
					SELECT generate_series(
						date_trunc('month', NOW()) - (${months - 1} || ' months')::interval,
						date_trunc('month', NOW()),
						'1 month'
					)::date AS month
				)
				SELECT
					to_char(m.month, 'YYYY-MM') AS month,
					COALESCE(SUM(CASE WHEN um.metric_key = 'documents_created' THEN um.current_value END), 0)::int AS documents,
					COALESCE(SUM(CASE WHEN um.metric_key = 'ai_calls' THEN um.current_value END), 0)::int AS ai_calls
				FROM months m
				LEFT JOIN usage_metrics um ON date_trunc('month', um.period_start) = m.month
				GROUP BY m.month ORDER BY m.month
			`);
			return rows as Array<{
				month: string;
				documents: number;
				ai_calls: number;
			}>;
		}),

	/** Top users by usage metric. */
	adminTopUsers: publicProcedure
		.input(
			z
				.object({
					metric: z
						.enum(["documents_created", "ai_calls"])
						.default("documents_created"),
					limit: z.number().int().min(1).max(20).default(10),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			await requireAdminAccess(ctx);
			const metric = input?.metric ?? "documents_created";
			const rows = await ctx.db.execute(sql`
				SELECT
					COALESCE(s.wallet_address, s.user_id, 'unknown') AS identifier,
					bp.name AS plan,
					SUM(um.current_value)::int AS usage
				FROM usage_metrics um
				JOIN subscriptions s ON s.id = um.subscription_id
				LEFT JOIN billing_plans bp ON bp.id = s.plan_id
				WHERE um.metric_key = ${metric}
				GROUP BY identifier, bp.name
				ORDER BY usage DESC
				LIMIT ${input?.limit ?? 10}
			`);
			return rows as Array<{ identifier: string; plan: string; usage: number }>;
		}),

	/** On-chain stats (hash anchors + crypto subs). */
	adminOnChainStats: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);

		const [anchorCount] = await ctx.db.execute(
			sql`SELECT COUNT(*)::int AS total, COUNT(DISTINCT batch_id)::int AS batches FROM hash_anchors`,
		);

		const cryptoByChain = await ctx.db.execute(
			sql`SELECT subscriber_chain AS chain, COUNT(*)::int AS count FROM crypto_subscriptions GROUP BY subscriber_chain`,
		);

		const [cryptoTotal] = await ctx.db.execute(
			sql`SELECT COUNT(*)::int AS total FROM crypto_subscriptions WHERE status = 'active'`,
		);

		const recentEvents = await ctx.db.execute(
			sql`SELECT id, event_type, chain, tx_hash, amount, token_symbol, created_at
				FROM crypto_payment_events ORDER BY created_at DESC LIMIT 10`,
		);

		return {
			totalAnchored: (anchorCount as any)?.total ?? 0,
			batchCount: (anchorCount as any)?.batches ?? 0,
			activeCryptoSubs: (cryptoTotal as any)?.total ?? 0,
			cryptoByChain: cryptoByChain as Array<{ chain: string; count: number }>,
			recentEvents: recentEvents as Array<{
				id: string;
				event_type: string;
				chain: string;
				tx_hash: string | null;
				amount: string | null;
				token_symbol: string | null;
				created_at: string;
			}>,
		};
	}),

	/** Revenue by payment token (WETH/USDC/BTC/SOL_USDC). */
	adminRevenueByToken: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);
		const rows = await ctx.db.execute(sql`
			SELECT cs.payment_token AS token,
				COUNT(*)::int AS sub_count,
				COALESCE(SUM(CASE
					WHEN cp.interval = 'monthly' THEN cp.price_usdc
					WHEN cp.interval = 'yearly' THEN cp.price_usdc / 12
					ELSE 0 END), 0)::int AS mrr_cents
			FROM crypto_subscriptions cs
			JOIN crypto_plans cp ON cp.id = cs.plan_id
			WHERE cs.status = 'active'
			GROUP BY cs.payment_token ORDER BY mrr_cents DESC
		`);
		return rows as Array<{
			token: string;
			sub_count: number;
			mrr_cents: number;
		}>;
	}),

	/** Revenue by chain (ETH/BASE/SOL/BTC). */
	adminRevenueByChain: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);
		const rows = await ctx.db.execute(sql`
			SELECT cs.payment_chain AS chain,
				COUNT(*)::int AS sub_count,
				COALESCE(SUM(CASE
					WHEN cp.interval = 'monthly' THEN cp.price_usdc
					WHEN cp.interval = 'yearly' THEN cp.price_usdc / 12
					ELSE 0 END), 0)::int AS mrr_cents
			FROM crypto_subscriptions cs
			JOIN crypto_plans cp ON cp.id = cs.plan_id
			WHERE cs.status = 'active'
			GROUP BY cs.payment_chain ORDER BY mrr_cents DESC
		`);
		return rows as Array<{
			chain: string;
			sub_count: number;
			mrr_cents: number;
		}>;
	}),

	/** Free tier analytics — users, docs, conversions. */
	adminFreeTierAnalytics: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);
		const rows = await ctx.db.execute(sql`
			WITH paying AS (
				SELECT DISTINCT COALESCE(wallet_address, user_id) AS uid FROM subscriptions WHERE status = 'active'
				UNION
				SELECT DISTINCT subscriber_address AS uid FROM crypto_subscriptions WHERE status = 'active'
			),
			creators AS (
				SELECT created_by AS uid, COUNT(*)::int AS docs, MIN(created_at) AS first_doc FROM documents GROUP BY created_by
			),
			free AS (
				SELECT c.uid, c.docs FROM creators c LEFT JOIN paying p ON p.uid = c.uid WHERE p.uid IS NULL
			)
			SELECT
				(SELECT COUNT(*)::int FROM free) AS free_users,
				(SELECT COALESCE(SUM(docs), 0)::int FROM free) AS free_docs,
				(SELECT COUNT(*)::int FROM paying) AS paying_users,
				(SELECT COUNT(*)::int FROM creators) AS total_creators
		`);
		const r = (rows as any[])[0] ?? {};
		const freeUsers = r.free_users ?? 0;
		const totalCreators = r.total_creators ?? 0;
		const payingUsers = r.paying_users ?? 0;
		return {
			freeUsers,
			freeDocs: r.free_docs ?? 0,
			payingUsers,
			totalCreators,
			conversionRate:
				totalCreators > 0 ? Math.round((payingUsers / totalCreators) * 100) : 0,
		};
	}),

	/** AI usage analytics — monthly token usage, overage, bundle utilization. */
	adminAiUsageAnalytics: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);
		const rows = await ctx.db.execute(sql`
			SELECT billing_month,
				SUM(input_tokens_used)::int AS total_input,
				SUM(output_tokens_used)::int AS total_output,
				SUM(bundled_tokens_limit)::int AS total_bundled,
				SUM(overage_tokens)::int AS total_overage,
				SUM(overage_cost_cents)::int AS overage_revenue,
				COUNT(CASE WHEN overage_tokens > 0 THEN 1 END)::int AS users_with_overage
			FROM ai_usage_billing
			GROUP BY billing_month ORDER BY billing_month DESC LIMIT 12
		`);
		return (rows as any[]).reverse();
	}),

	/** AI top users by token consumption. */
	adminAiTopUsers: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);
		const rows = await ctx.db.execute(sql`
			SELECT owner_address AS identifier,
				SUM(input_tokens_used + output_tokens_used)::int AS total_tokens,
				SUM(overage_cost_cents)::int AS overage_cents
			FROM ai_usage_billing
			GROUP BY owner_address ORDER BY total_tokens DESC LIMIT 10
		`);
		return rows as Array<{
			identifier: string;
			total_tokens: number;
			overage_cents: number;
		}>;
	}),

	/** On-chain time series — payment events + anchors per month. */
	adminOnChainTimeSeries: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);
		const rows = await ctx.db.execute(sql`
			WITH months AS (
				SELECT generate_series(date_trunc('month', NOW()) - '11 months'::interval, date_trunc('month', NOW()), '1 month')::date AS month
			)
			SELECT to_char(m.month, 'YYYY-MM') AS month,
				(SELECT COUNT(*)::int FROM crypto_payment_events WHERE date_trunc('month', created_at) = m.month) AS events,
				(SELECT COUNT(*)::int FROM hash_anchors WHERE date_trunc('month', created_at) = m.month) AS anchors
			FROM months m ORDER BY m.month
		`);
		return rows as Array<{ month: string; events: number; anchors: number }>;
	}),

	/** On-chain token breakdown — payment volume by token. */
	adminOnChainTokenBreakdown: publicProcedure.query(async ({ ctx }) => {
		await requireAdminAccess(ctx);
		const rows = await ctx.db.execute(sql`
			SELECT token_symbol AS token, chain,
				COUNT(*)::int AS event_count,
				COALESCE(SUM(amount::numeric), 0)::text AS total_volume
			FROM crypto_payment_events
			WHERE event_type = 'payment_received'
			GROUP BY token_symbol, chain ORDER BY event_count DESC
		`);
		return rows as Array<{
			token: string;
			chain: string;
			event_count: number;
			total_volume: string;
		}>;
	}),
});

// ── Premium crypto billing bridge ──

const cryptoStub = createTRPCRouter({
	cryptoCapabilities: publicProcedure.query(() => ({ available: false })),
});

// Merge OSS + premium routers
export const billingRouter: ReturnType<typeof createTRPCRouter> = ossRouter;

// Export premium separately for merging when available
export const billingCryptoRouter: any = premiumBillingRouter ?? cryptoStub;
