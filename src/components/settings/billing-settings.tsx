// @ts-nocheck -- tRPC hook types
"use client";

import { Check, ExternalLink, FileText, Package } from "lucide-react";
import { AnimatedButton, FadeIn, GlassCard } from "~/components/ui/motion";
import { trpc } from "~/lib/platform/trpc";

export function BillingSettings() {
	const currentPlanQuery = trpc.billing.currentPlan.useQuery();
	const availablePlansQuery = trpc.billing.availablePlans.useQuery();
	const invoicesQuery = trpc.billing.invoiceHistory.useQuery();
	const freeTierQuery = trpc.billing.freeTierStatus.useQuery();

	const current = currentPlanQuery.data;
	const plans = availablePlansQuery.data ?? [];
	const invoiceList = invoicesQuery.data ?? [];
	const freeTier = freeTierQuery.data;

	return (
		<FadeIn>
			<div className="space-y-4">
				{/* Current Plan */}
				<CurrentPlanCard current={current} />

				{/* Free Tier Usage (shown when no subscription) */}
				{!current && freeTier && <FreeTierCard freeTier={freeTier} />}

				{/* Usage */}
				{current?.usage && current.usage.length > 0 && (
					<UsageCard usage={current.usage} />
				)}

				{/* Available Plans */}
				{plans.length > 0 && (
					<PlansList plans={plans} currentPlanId={current?.plan?.id} />
				)}

				{/* Invoice History */}
				{invoiceList.length > 0 && <InvoiceHistory invoices={invoiceList} />}
			</div>
		</FadeIn>
	);
}

// ── Free Tier Card ──

function FreeTierCard({
	freeTier,
}: {
	freeTier: {
		limits: { documentsPerMonth: number; aiCallsPerMonth: number };
		usage: {
			documents: { current: number; limit: number | null; allowed: boolean };
			aiCalls: { current: number; limit: number | null; allowed: boolean };
		};
	};
}) {
	const metrics = [
		{
			label: "Documents",
			current: freeTier.usage.documents.current,
			limit: freeTier.limits.documentsPerMonth,
		},
		{
			label: "AI Calls",
			current: freeTier.usage.aiCalls.current,
			limit: freeTier.limits.aiCallsPerMonth,
		},
	];

	return (
		<GlassCard className="space-y-3">
			<div className="flex items-center gap-2">
				<Package className="h-4 w-4 text-muted" />
				<h3 className="text-sm font-semibold">Free Tier</h3>
			</div>
			<p className="text-xs text-muted">
				You&apos;re on the free plan. Upgrade for higher limits.
			</p>
			<div className="space-y-2">
				{metrics.map((m) => {
					const pct = m.limit ? Math.min((m.current / m.limit) * 100, 100) : 0;
					return (
						<div key={m.label}>
							<div className="flex items-center justify-between text-xs">
								<span className="text-muted">{m.label}</span>
								<span className="font-medium">
									{m.current} / {m.limit} per month
								</span>
							</div>
							<div className="mt-1 h-1.5 w-full rounded-full bg-surface/40">
								<div
									className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-amber-400" : "bg-accent"}`}
									style={{ width: `${pct}%` }}
								/>
							</div>
						</div>
					);
				})}
			</div>
		</GlassCard>
	);
}

// ── Current Plan Card ──

function CurrentPlanCard({
	current,
}: {
	current:
		| {
				subscription: {
					id: string;
					status: string;
					cancelAtPeriodEnd: boolean;
					currentPeriodEnd: Date | null;
				};
				plan:
					| { name: string; priceInCents: number; interval: string }
					| null
					| undefined;
				usage: Array<{
					metricKey: string;
					current: number;
					limit: number | null;
				}>;
		  }
		| null
		| undefined;
}) {
	const cancelMutation = trpc.billing.cancelSubscription.useMutation({
		onSuccess: () => window.location.reload(),
	});
	const portalMutation = trpc.billing.createPortalSession.useMutation({
		onSuccess: (data) => {
			window.location.href = data.url;
		},
	});

	if (!current?.plan) {
		return (
			<GlassCard className="space-y-2">
				<div className="flex items-center gap-2">
					<Package className="h-4 w-4 text-muted" />
					<h3 className="text-sm font-semibold">Current Plan</h3>
				</div>
				<p className="text-xs text-muted">
					No active subscription. Choose a plan below to get started.
				</p>
			</GlassCard>
		);
	}

	const plan = current.plan;
	const sub = current.subscription;

	return (
		<GlassCard className="space-y-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Package className="h-4 w-4 text-accent" />
					<h3 className="text-sm font-semibold">Current Plan</h3>
				</div>
				<span
					className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
						sub.status === "active"
							? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
							: sub.status === "past_due"
								? "border-amber-400/20 bg-amber-400/10 text-amber-200"
								: "border-border bg-surface/40 text-muted"
					}`}
				>
					{sub.status}
				</span>
			</div>

			<div>
				<p className="text-lg font-bold">{plan.name}</p>
				<p className="text-xs text-muted">
					${(plan.priceInCents / 100).toFixed(2)}
					{plan.interval === "lifetime"
						? " one-time"
						: ` / ${plan.interval === "monthly" ? "month" : "year"}`}
				</p>
				{sub.currentPeriodEnd && (
					<p className="mt-1 text-xs text-muted">
						{sub.cancelAtPeriodEnd ? "Cancels" : "Renews"} on{" "}
						{new Date(sub.currentPeriodEnd).toLocaleDateString()}
					</p>
				)}
			</div>

			<div className="flex gap-2">
				<AnimatedButton
					size="sm"
					variant="ghost"
					onClick={() =>
						portalMutation.mutate({ returnUrl: window.location.href })
					}
					disabled={portalMutation.isPending}
				>
					Manage Subscription
				</AnimatedButton>
				{!sub.cancelAtPeriodEnd && sub.status === "active" && (
					<AnimatedButton
						size="sm"
						variant="ghost"
						onClick={() => cancelMutation.mutate()}
						disabled={cancelMutation.isPending}
						className="text-red-400 hover:text-red-300"
					>
						Cancel
					</AnimatedButton>
				)}
			</div>
		</GlassCard>
	);
}

// ── Usage Card ──

function UsageCard({
	usage,
}: {
	usage: Array<{
		metricKey: string;
		current: number;
		limit: number | null;
		periodStart: Date;
		periodEnd: Date;
	}>;
}) {
	const labelMap: Record<string, string> = {
		documents_created: "Documents",
		signers_added: "Signers",
		storage_bytes: "Storage",
		templates_used: "Templates",
	};

	const metered = usage.filter((u) => u.limit != null);
	if (metered.length === 0) return null;

	return (
		<GlassCard className="space-y-3">
			<h3 className="text-sm font-semibold">Usage This Period</h3>
			<div className="space-y-2">
				{metered.map((u) => {
					const pct = u.limit ? Math.min((u.current / u.limit) * 100, 100) : 0;
					const label = labelMap[u.metricKey] ?? u.metricKey;
					return (
						<div key={u.metricKey}>
							<div className="flex items-center justify-between text-xs">
								<span className="text-muted">{label}</span>
								<span className="font-medium">
									{u.current} / {u.limit}
								</span>
							</div>
							<div className="mt-1 h-1.5 w-full rounded-full bg-surface/40">
								<div
									className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-red-400" : pct >= 70 ? "bg-amber-400" : "bg-accent"}`}
									style={{ width: `${pct}%` }}
								/>
							</div>
						</div>
					);
				})}
			</div>
		</GlassCard>
	);
}

// ── Plans List ──

function PlansList({
	plans,
	currentPlanId,
}: {
	plans: Array<{
		id: string;
		name: string;
		description: string | null;
		priceInCents: number;
		interval: string;
		featureLimits: Record<string, unknown> | null;
	}>;
	currentPlanId?: string;
}) {
	const checkoutMutation = trpc.billing.createCheckout.useMutation({
		onSuccess: (data) => {
			window.location.href = data.url;
		},
	});

	return (
		<GlassCard className="space-y-3">
			<h3 className="text-sm font-semibold">Available Plans</h3>
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{plans.map((plan) => {
					const isCurrent = plan.id === currentPlanId;
					return (
						<div
							key={plan.id}
							className={`rounded-lg border p-4 ${
								isCurrent
									? "border-accent/30 bg-accent/5"
									: "border-border bg-surface/20"
							}`}
						>
							<p className="font-semibold">{plan.name}</p>
							{plan.description && (
								<p className="mt-0.5 text-xs text-muted">{plan.description}</p>
							)}
							<div className="mt-2 flex items-baseline gap-1">
								<span className="text-xl font-bold">
									${(plan.priceInCents / 100).toFixed(2)}
								</span>
								<span className="text-xs text-muted">
									{plan.interval === "lifetime"
										? "one-time"
										: `/${plan.interval === "monthly" ? "mo" : "yr"}`}
								</span>
							</div>

							<div className="mt-3">
								{isCurrent ? (
									<span className="flex items-center gap-1 text-xs text-emerald-300">
										<Check className="h-3 w-3" /> Current Plan
									</span>
								) : (
									<AnimatedButton
										size="sm"
										onClick={() =>
											checkoutMutation.mutate({
												planId: plan.id,
												successUrl: `${window.location.origin}/settings?tab=billing&status=success`,
												cancelUrl: `${window.location.origin}/settings?tab=billing&status=canceled`,
											})
										}
										disabled={checkoutMutation.isPending}
									>
										{checkoutMutation.isPending
											? "..."
											: currentPlanId
												? "Switch"
												: "Subscribe"}
									</AnimatedButton>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</GlassCard>
	);
}

// ── Invoice History ──

function InvoiceHistory({
	invoices,
}: {
	invoices: Array<{
		id: string;
		amountInCents: number;
		currency: string;
		status: string;
		paidAt: Date | null;
		invoiceUrl: string | null;
		createdAt: Date;
	}>;
}) {
	return (
		<GlassCard className="space-y-3">
			<div className="flex items-center gap-2">
				<FileText className="h-4 w-4 text-muted" />
				<h3 className="text-sm font-semibold">Invoice History</h3>
			</div>
			<div className="space-y-1.5">
				{invoices.map((inv) => (
					<div
						key={inv.id}
						className="flex items-center justify-between rounded-lg border border-border bg-surface/20 px-3 py-2"
					>
						<div>
							<p className="text-xs font-medium">
								${(inv.amountInCents / 100).toFixed(2)}{" "}
								{inv.currency.toUpperCase()}
							</p>
							<p className="text-[10px] text-muted">
								{inv.paidAt
									? new Date(inv.paidAt).toLocaleDateString()
									: new Date(inv.createdAt).toLocaleDateString()}
							</p>
						</div>
						<div className="flex items-center gap-2">
							<span
								className={`rounded-full border px-1.5 py-0.5 text-[10px] ${
									inv.status === "paid"
										? "border-emerald-400/20 text-emerald-300"
										: "border-border text-muted"
								}`}
							>
								{inv.status}
							</span>
							{inv.invoiceUrl && (
								<a
									href={inv.invoiceUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="text-muted hover:text-secondary"
								>
									<ExternalLink className="h-3 w-3" />
								</a>
							)}
						</div>
					</div>
				))}
			</div>
		</GlassCard>
	);
}
