// @ts-nocheck -- tRPC hook types
"use client";

/**
 * Billing analytics dashboard v2 — merged Stripe + Crypto.
 * 5 sub-tabs: Revenue, Customers, Subscriptions, On-Chain, Usage
 */

import {
	Activity,
	ArrowDownRight,
	ArrowUpRight,
	Bot,
	Coins,
	CreditCard,
	DollarSign,
	Hash,
	Link2,
	Search,
	TrendingUp,
	Users,
	Wallet,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { FadeIn, GlassCard } from "~/components/ui/motion";
import { ResolvedAddress } from "~/lib/crypto/address-resolution";
import { CHAIN_META } from "~/lib/crypto/chains";
import { trpc } from "~/lib/platform/trpc";
import {
	AnimatedAreaChart,
	AnimatedBarChart,
	AnimatedComposedChart,
	AnimatedDonutChart,
	CHAIN_COLORS,
	CHART_COLORS,
	ChartCard,
	ChartSkeleton,
	FunnelChart,
	formatCompact,
	formatUsd,
	KpiGrid,
	relativeTime,
	StaggeredList,
	TOKEN_COLORS,
} from "./admin-chart-components";
import { StatusPill } from "./admin-shared-ui";

type SubTab = "revenue" | "customers" | "subscriptions" | "onchain" | "usage";

const SUB_TABS: { id: SubTab; label: string }[] = [
	{ id: "revenue", label: "Revenue" },
	{ id: "customers", label: "Customers" },
	{ id: "subscriptions", label: "Subscriptions" },
	{ id: "onchain", label: "On-Chain" },
	{ id: "usage", label: "Usage" },
];

export function AnalyticsSection() {
	const [tab, setTab] = useState<SubTab>("revenue");

	return (
		<div className="space-y-6">
			<GlassCard className="space-y-4">
				<div>
					<h3 className="text-lg font-semibold">Analytics</h3>
					<p className="mt-1 text-sm text-muted">
						Revenue, customers, subscriptions, on-chain activity, and usage
						across Stripe and crypto.
					</p>
				</div>
				<div className="bg-surface/30 flex gap-1 rounded-lg border border-border p-1">
					{SUB_TABS.map((t) => (
						<button
							key={t.id}
							type="button"
							onClick={() => setTab(t.id)}
							className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
								tab === t.id
									? "bg-accent/20 text-accent"
									: "text-muted hover:text-secondary"
							}`}
						>
							{t.label}
						</button>
					))}
				</div>
			</GlassCard>

			{tab === "revenue" && <RevenueTab />}
			{tab === "customers" && <CustomersTab />}
			{tab === "subscriptions" && <SubscriptionsTab />}
			{tab === "onchain" && <OnChainTab />}
			{tab === "usage" && <UsageTab />}
		</div>
	);
}

// ════════════════════════════════════════════════════════════
// REVENUE
// ════════════════════════════════════════════════════════════

function RevenueTab() {
	const kpis = trpc.billing.adminRevenueKpis.useQuery();
	const trend = trpc.billing.adminRevenueTimeSeries.useQuery();
	const byPlan = trpc.billing.adminRevenueByPlan.useQuery();
	const byToken = trpc.billing.adminRevenueByToken.useQuery();
	const byChain = trpc.billing.adminRevenueByChain.useQuery();

	const k = kpis.data;

	return (
		<div className="space-y-4">
			<KpiGrid
				items={[
					{
						label: "Total Revenue",
						value: k ? formatUsd(k.totalRevenueCents) : "—",
						icon: <DollarSign className="h-4 w-4" />,
						tone: "success",
					},
					{
						label: "MRR",
						value: k ? formatUsd(k.mrrCents) : "—",
						icon: <TrendingUp className="h-4 w-4" />,
						tone: "info",
					},
					{
						label: "Stripe MRR",
						value: k ? formatUsd(k.stripeMrrCents) : "—",
						icon: <CreditCard className="h-4 w-4" />,
						tone: "info",
					},
					{
						label: "Crypto MRR",
						value: k ? formatUsd(k.cryptoMrrCents) : "—",
						icon: <Coins className="h-4 w-4" />,
						tone: "warning",
					},
					{
						label: "ARPU",
						value: k ? formatUsd(k.arpu) : "—",
						icon: <Users className="h-4 w-4" />,
						tone: "muted",
					},
				]}
			/>

			<ChartCard
				title="MRR Trend"
				subtitle="Stripe + Crypto monthly recurring revenue"
			>
				{trend.isLoading ? (
					<ChartSkeleton height={280} />
				) : (
					<AnimatedComposedChart
						data={(trend.data ?? []).map((d) => ({
							month: d.month.slice(5),
							"Stripe MRR": (d.mrr_cents ?? 0) / 100,
							Customers: d.active_count ?? 0,
						}))}
						bars={[
							{
								key: "Stripe MRR",
								color: CHART_COLORS.stripe,
								name: "Stripe MRR",
							},
						]}
						lines={[
							{
								key: "Customers",
								color: CHART_COLORS.success,
								name: "Customers",
							},
						]}
						barFormatter={(v) => `$${v.toLocaleString()}`}
						lineFormatter={(v) => `${v} users`}
					/>
				)}
			</ChartCard>

			<div className="grid gap-4 lg:grid-cols-2">
				<ChartCard
					title="Revenue by Plan"
					subtitle="All plans (Stripe + Crypto)"
				>
					{byPlan.isLoading ? (
						<ChartSkeleton height={180} />
					) : (
						<AnimatedBarChart
							data={(byPlan.data ?? []).map((d) => ({
								name: `${d.planName} ${d.source === "crypto" ? "⬡" : ""}`,
								MRR: d.mrrCents / 100,
							}))}
							bars={[{ key: "MRR", color: CHART_COLORS.primary, name: "MRR" }]}
							layout="horizontal"
							height={Math.max(140, (byPlan.data?.length ?? 0) * 40)}
							formatter={(v) => `$${v.toFixed(2)}`}
						/>
					)}
				</ChartCard>

				<ChartCard
					title="Payment Methods"
					subtitle="Stripe vs Crypto customers"
				>
					<AnimatedDonutChart
						data={[
							{
								name: "Stripe",
								value: k?.stripeCustomers ?? 0,
								color: CHART_COLORS.stripe,
							},
							{
								name: "Crypto",
								value: k?.cryptoCustomers ?? 0,
								color: CHART_COLORS.crypto,
							},
						]}
						centerLabel={{
							value: String(k?.totalCustomers ?? 0),
							label: "customers",
						}}
						height={200}
					/>
				</ChartCard>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				<ChartCard title="Revenue by Token" subtitle="Crypto payment tokens">
					{byToken.isLoading ? (
						<ChartSkeleton height={200} />
					) : (
						<AnimatedDonutChart
							data={(byToken.data ?? []).map((d) => ({
								name: d.token,
								value: d.mrr_cents / 100,
								color: TOKEN_COLORS[d.token] ?? CHART_COLORS.muted,
							}))}
							centerLabel={{
								value: `$${((byToken.data ?? []).reduce((s, d) => s + d.mrr_cents, 0) / 100).toFixed(0)}`,
								label: "crypto MRR",
							}}
						/>
					)}
				</ChartCard>

				<ChartCard title="Revenue by Chain" subtitle="Network distribution">
					{byChain.isLoading ? (
						<ChartSkeleton height={200} />
					) : (
						<AnimatedDonutChart
							data={(byChain.data ?? []).map((d) => ({
								name: d.chain,
								value: d.sub_count,
								color: CHAIN_COLORS[d.chain] ?? CHART_COLORS.muted,
							}))}
						/>
					)}
				</ChartCard>
			</div>
		</div>
	);
}

// ════════════════════════════════════════════════════════════
// CUSTOMERS
// ════════════════════════════════════════════════════════════

function CustomersTab() {
	const trend = trpc.billing.adminCustomerCountTrend.useQuery();
	const customers = trpc.billing.adminCustomerList.useQuery();
	const [search, setSearch] = useState("");
	const [typeFilter, setTypeFilter] = useState<"all" | "stripe" | "crypto">(
		"all",
	);

	const rows = customers.data?.rows ?? [];
	const filtered = rows.filter((c) => {
		if (typeFilter !== "all" && c.type !== typeFilter) return false;
		if (search) {
			const q = search.toLowerCase();
			return (
				c.identifier.toLowerCase().includes(q) ||
				c.plan.toLowerCase().includes(q)
			);
		}
		return true;
	});

	const stripeCount = rows.filter((c) => c.type === "stripe").length;
	const cryptoCount = rows.filter((c) => c.type === "crypto").length;

	return (
		<div className="space-y-4">
			<KpiGrid
				items={[
					{
						label: "Total Customers",
						value: String(customers.data?.total ?? 0),
						icon: <Users className="h-4 w-4" />,
						tone: "info",
					},
					{
						label: "Stripe",
						value: String(stripeCount),
						icon: <CreditCard className="h-4 w-4" />,
						tone: "success",
					},
					{
						label: "Crypto",
						value: String(cryptoCount),
						icon: <Wallet className="h-4 w-4" />,
						tone: "warning",
					},
				]}
			/>

			<ChartCard title="Customer Growth" subtitle="Monthly trend">
				{trend.isLoading ? (
					<ChartSkeleton />
				) : (
					<AnimatedAreaChart
						data={(trend.data ?? []).map((d) => ({
							month: d.month.slice(5),
							Stripe: d.stripe,
							Crypto: d.crypto,
						}))}
						areas={[
							{ key: "Stripe", color: CHART_COLORS.stripe, name: "Stripe" },
							{ key: "Crypto", color: CHART_COLORS.crypto, name: "Crypto" },
						]}
						stacked
					/>
				)}
			</ChartCard>

			<FadeIn delay={0.1}>
				<GlassCard className="space-y-3">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
						<h4 className="text-sm font-semibold">All Customers</h4>
						<div className="flex flex-1 items-center gap-2">
							<div className="relative flex-1">
								<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
								<input
									type="text"
									placeholder="Search address, ENS, plan..."
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									className="w-full rounded-md border border-border bg-surface/30 py-1 pl-8 pr-3 text-[11px] outline-none focus:border-accent"
								/>
							</div>
							<div className="flex gap-1">
								{(["all", "stripe", "crypto"] as const).map((t) => (
									<button
										key={t}
										type="button"
										onClick={() => setTypeFilter(t)}
										className={`rounded-md px-2 py-1 text-[10px] font-medium transition ${typeFilter === t ? "bg-accent/20 text-accent" : "text-muted hover:text-secondary"}`}
									>
										{t === "all" ? "All" : t === "stripe" ? "Stripe" : "Crypto"}
									</button>
								))}
							</div>
						</div>
					</div>

					{filtered.length === 0 ? (
						<p className="py-4 text-center text-xs text-muted">
							No customers found.
						</p>
					) : (
						<StaggeredList>
							{filtered.map((c) => (
								<div
									key={c.id}
									className="flex items-center justify-between rounded-lg border border-border bg-surface/20 px-3 py-2"
								>
									<div className="flex items-center gap-2 min-w-0">
										{c.type === "stripe" ? (
											<CreditCard className="h-3.5 w-3.5 shrink-0 text-[#635bff]" />
										) : (
											<span
												className="shrink-0 text-sm"
												style={{
													color:
														CHAIN_COLORS[c.chain ?? ""] ?? CHART_COLORS.crypto,
												}}
											>
												{CHAIN_META[c.chain as keyof typeof CHAIN_META]?.icon ??
													"⬡"}
											</span>
										)}
										<div className="min-w-0">
											<p className="truncate text-xs font-medium">
												<ResolvedAddress
													address={c.identifier}
													chain={c.chain}
												/>
											</p>
											<p className="text-[10px] text-muted">
												{c.plan}
												{c.paymentToken && (
													<span className="ml-1 rounded bg-surface/40 px-1 py-px text-[9px]">
														{c.paymentToken}
													</span>
												)}
												{c.lastPayment && (
													<> &middot; {relativeTime(c.lastPayment)}</>
												)}
											</p>
										</div>
									</div>
									<StatusPill
										label={c.status}
										tone={
											c.status === "active"
												? "success"
												: c.status === "past_due"
													? "warning"
													: c.status === "canceled"
														? "danger"
														: "muted"
										}
									/>
								</div>
							))}
						</StaggeredList>
					)}
				</GlassCard>
			</FadeIn>
		</div>
	);
}

// ════════════════════════════════════════════════════════════
// SUBSCRIPTIONS
// ════════════════════════════════════════════════════════════

function SubscriptionsTab() {
	const breakdown = trpc.billing.adminSubscriptionBreakdown.useQuery();
	const events = trpc.billing.adminRecentEvents.useQuery();
	const stats = trpc.billing.adminBillingStats.useQuery();
	const freeTier = trpc.billing.adminFreeTierAnalytics.useQuery();

	const statusData = (breakdown.data?.byStatus ?? []).map((d) => ({
		name: d.status,
		value: d.count,
		color:
			d.status === "active"
				? CHART_COLORS.success
				: d.status === "past_due"
					? CHART_COLORS.warning
					: d.status === "canceled"
						? CHART_COLORS.danger
						: d.status === "lifetime"
							? CHART_COLORS.primary
							: CHART_COLORS.muted,
	}));

	const planData = (breakdown.data?.byPlan ?? []).map((d) => ({
		name: d.planName,
		count: d.count,
	}));

	const s = stats.data;
	const totalSubs =
		(s?.activeSubs ?? 0) + (s?.pastDueSubs ?? 0) + (s?.canceledSubs ?? 0);
	const churn =
		totalSubs > 0
			? (((s?.canceledSubs ?? 0) / totalSubs) * 100).toFixed(1)
			: "0";
	const ft = freeTier.data;

	return (
		<div className="space-y-4">
			<KpiGrid
				items={[
					{
						label: "Active",
						value: String(s?.activeSubs ?? 0),
						icon: <Zap className="h-4 w-4" />,
						tone: "success",
					},
					{
						label: "Past Due",
						value: String(s?.pastDueSubs ?? 0),
						icon: <Activity className="h-4 w-4" />,
						tone: "warning",
					},
					{
						label: "Canceled",
						value: String(s?.canceledSubs ?? 0),
						icon: <ArrowDownRight className="h-4 w-4" />,
						tone: "danger",
					},
					{
						label: "Churn Rate",
						value: `${churn}%`,
						icon: <TrendingUp className="h-4 w-4" />,
						tone: Number(churn) > 10 ? "danger" : "muted",
					},
					{
						label: "Conversion",
						value: `${ft?.conversionRate ?? 0}%`,
						icon: <ArrowUpRight className="h-4 w-4" />,
						tone: "info",
					},
				]}
			/>

			<div className="grid gap-4 lg:grid-cols-2">
				<ChartCard
					title="Status Breakdown"
					subtitle="All subscriptions (Stripe + Crypto)"
				>
					{breakdown.isLoading ? (
						<ChartSkeleton height={200} />
					) : (
						<AnimatedDonutChart
							data={statusData}
							centerLabel={{ value: String(totalSubs), label: "total" }}
						/>
					)}
				</ChartCard>

				<ChartCard title="Plan Distribution" subtitle="Subscriptions per plan">
					{breakdown.isLoading ? (
						<ChartSkeleton height={200} />
					) : (
						<AnimatedBarChart
							data={planData}
							bars={[
								{
									key: "count",
									color: CHART_COLORS.primary,
									name: "Subscriptions",
								},
							]}
							height={200}
						/>
					)}
				</ChartCard>
			</div>

			<ChartCard title="Conversion Funnel" subtitle="Free → Paying → Churned">
				<FunnelChart
					steps={[
						{
							label: "Free Users",
							value: ft?.freeUsers ?? 0,
							color: CHART_COLORS.free,
						},
						{
							label: "Paying",
							value: ft?.payingUsers ?? 0,
							color: CHART_COLORS.success,
						},
						{
							label: "Past Due",
							value: s?.pastDueSubs ?? 0,
							color: CHART_COLORS.warning,
						},
						{
							label: "Churned",
							value: s?.canceledSubs ?? 0,
							color: CHART_COLORS.danger,
						},
					]}
				/>
			</ChartCard>

			<FadeIn delay={0.1}>
				<GlassCard className="space-y-3">
					<h4 className="text-sm font-semibold">Recent Events</h4>
					{(events.data ?? []).length === 0 ? (
						<p className="py-4 text-center text-xs text-muted">
							No events yet.
						</p>
					) : (
						<StaggeredList>
							{(events.data ?? []).map((e) => (
								<div
									key={e.id}
									className="flex items-center justify-between rounded-lg border border-border bg-surface/20 px-3 py-2"
								>
									<div className="flex items-center gap-2">
										{e.event === "active" ? (
											<ArrowUpRight className="h-3 w-3 text-emerald-400" />
										) : e.event === "canceled" ? (
											<ArrowDownRight className="h-3 w-3 text-red-400" />
										) : (
											<Activity className="h-3 w-3 text-amber-400" />
										)}
										<div>
											<p className="text-xs font-medium">{e.identifier}</p>
											<p className="text-[10px] text-muted">
												{e.event} &middot; {relativeTime(e.timestamp)}
											</p>
										</div>
									</div>
									<StatusPill
										label={e.event}
										tone={
											e.event === "active"
												? "success"
												: e.event === "canceled"
													? "danger"
													: "warning"
										}
									/>
								</div>
							))}
						</StaggeredList>
					)}
				</GlassCard>
			</FadeIn>
		</div>
	);
}

// ════════════════════════════════════════════════════════════
// ON-CHAIN
// ════════════════════════════════════════════════════════════

function OnChainTab() {
	const stats = trpc.billing.adminOnChainStats.useQuery();
	const timeSeries = trpc.billing.adminOnChainTimeSeries.useQuery();
	const tokenBreakdown = trpc.billing.adminOnChainTokenBreakdown.useQuery();
	const d = stats.data;

	const totalEvents = (tokenBreakdown.data ?? []).reduce(
		(s, t) => s + t.event_count,
		0,
	);

	return (
		<div className="space-y-4">
			<KpiGrid
				items={[
					{
						label: "Hashes Anchored",
						value: formatCompact(d?.totalAnchored ?? 0),
						icon: <Hash className="h-4 w-4" />,
						tone: "info",
					},
					{
						label: "Batches",
						value: String(d?.batchCount ?? 0),
						icon: <Link2 className="h-4 w-4" />,
						tone: "muted",
					},
					{
						label: "Crypto Subs",
						value: String(d?.activeCryptoSubs ?? 0),
						icon: <Coins className="h-4 w-4" />,
						tone: "success",
					},
					{
						label: "Payment Events",
						value: String(d?.recentEvents?.length ?? 0),
						icon: <Activity className="h-4 w-4" />,
						tone: "info",
					},
				]}
			/>

			<ChartCard
				title="On-Chain Activity"
				subtitle="Payment events + hash anchors over time"
			>
				{timeSeries.isLoading ? (
					<ChartSkeleton height={280} />
				) : (
					<AnimatedComposedChart
						data={(timeSeries.data ?? []).map((d) => ({
							month: d.month.slice(5),
							"Payment Events": d.events,
							"Hash Anchors": d.anchors,
						}))}
						bars={[
							{
								key: "Payment Events",
								color: CHART_COLORS.crypto,
								name: "Payment Events",
							},
						]}
						lines={[
							{
								key: "Hash Anchors",
								color: CHART_COLORS.info,
								name: "Hash Anchors",
							},
						]}
					/>
				)}
			</ChartCard>

			<div className="grid gap-4 lg:grid-cols-2">
				<ChartCard title="Subscriptions by Chain">
					{stats.isLoading ? (
						<ChartSkeleton height={200} />
					) : (
						<AnimatedDonutChart
							data={(d?.cryptoByChain ?? []).map((c) => ({
								name: c.chain,
								value: c.count,
								color: CHAIN_COLORS[c.chain] ?? CHART_COLORS.muted,
							}))}
						/>
					)}
				</ChartCard>

				<ChartCard title="Token Volume" subtitle="Payment events by token">
					{tokenBreakdown.isLoading ? (
						<ChartSkeleton height={200} />
					) : (
						<AnimatedDonutChart
							data={(tokenBreakdown.data ?? []).map((t) => ({
								name: `${t.token} (${t.chain})`,
								value: t.event_count,
								color: TOKEN_COLORS[t.token] ?? CHART_COLORS.muted,
							}))}
							centerLabel={{ value: String(totalEvents), label: "events" }}
						/>
					)}
				</ChartCard>
			</div>

			<FadeIn delay={0.1}>
				<GlassCard className="space-y-3">
					<h4 className="text-sm font-semibold">Recent Payment Events</h4>
					{(d?.recentEvents ?? []).length === 0 ? (
						<p className="py-4 text-center text-xs text-muted">
							No events yet.
						</p>
					) : (
						<StaggeredList>
							{(d?.recentEvents ?? []).map((e) => (
								<div
									key={e.id}
									className="flex items-center justify-between rounded-lg border border-border bg-surface/20 px-3 py-2"
								>
									<div className="flex items-center gap-2 min-w-0">
										<span
											className="h-2 w-2 shrink-0 rounded-full"
											style={{
												background: CHAIN_COLORS[e.chain] ?? CHART_COLORS.muted,
											}}
										/>
										<div className="min-w-0">
											<p className="truncate text-xs font-medium">
												{e.event_type}
											</p>
											<p className="text-[10px] text-muted">
												{e.chain}
												{e.amount &&
													e.token_symbol &&
													` · ${e.amount} ${e.token_symbol}`}
												{e.created_at && ` · ${relativeTime(e.created_at)}`}
											</p>
										</div>
									</div>
									{e.tx_hash && (
										<span className="shrink-0 font-mono text-[10px] text-muted">
											{e.tx_hash.slice(0, 10)}...
										</span>
									)}
								</div>
							))}
						</StaggeredList>
					)}
				</GlassCard>
			</FadeIn>
		</div>
	);
}

// ════════════════════════════════════════════════════════════
// USAGE
// ════════════════════════════════════════════════════════════

function UsageTab() {
	const trends = trpc.billing.adminUsageTrends.useQuery();
	const topUsers = trpc.billing.adminTopUsers.useQuery();
	const aiUsage = trpc.billing.adminAiUsageAnalytics.useQuery();
	const aiTopUsers = trpc.billing.adminAiTopUsers.useQuery();
	const freeTier = trpc.billing.adminFreeTierAnalytics.useQuery();

	const currentMonth = trends.data?.at(-1);
	const aiData = aiUsage.data ?? [];
	const latestAi = aiData.at(-1);
	const totalOverageRevenue = aiData.reduce(
		(s, d) => s + (d.overage_revenue ?? 0),
		0,
	);
	const ft = freeTier.data;

	return (
		<div className="space-y-4">
			{/* Free Tier Section */}
			<ChartCard title="Free Tier" subtitle="Users without paid subscription">
				<KpiGrid
					items={[
						{
							label: "Free Users",
							value: String(ft?.freeUsers ?? 0),
							icon: <Users className="h-4 w-4" />,
							tone: "muted",
						},
						{
							label: "Free Docs",
							value: formatCompact(ft?.freeDocs ?? 0),
							icon: <Activity className="h-4 w-4" />,
							tone: "info",
						},
						{
							label: "Conversion",
							value: `${ft?.conversionRate ?? 0}%`,
							icon: <ArrowUpRight className="h-4 w-4" />,
							tone: "success",
						},
					]}
				/>
			</ChartCard>

			{/* Document & AI Usage */}
			<ChartCard
				title="Usage Trends"
				subtitle="Documents and AI calls over time"
			>
				{trends.isLoading ? (
					<ChartSkeleton />
				) : (
					<AnimatedAreaChart
						data={(trends.data ?? []).map((d) => ({
							month: d.month.slice(5),
							Documents: d.documents,
							"AI Calls": d.ai_calls,
						}))}
						areas={[
							{
								key: "Documents",
								color: CHART_COLORS.primary,
								name: "Documents",
							},
							{ key: "AI Calls", color: CHART_COLORS.info, name: "AI Calls" },
						]}
					/>
				)}
			</ChartCard>

			{/* AI Usage Analytics */}
			<ChartCard
				title="AI Token Usage"
				subtitle="Bundled vs consumed vs overage"
			>
				<KpiGrid
					items={[
						{
							label: "Tokens This Month",
							value: formatCompact(
								(latestAi?.total_input ?? 0) + (latestAi?.total_output ?? 0),
							),
							icon: <Bot className="h-4 w-4" />,
							tone: "info",
						},
						{
							label: "Overage Revenue",
							value: formatUsd(totalOverageRevenue),
							icon: <DollarSign className="h-4 w-4" />,
							tone: "success",
						},
						{
							label: "Overage Users",
							value: String(latestAi?.users_with_overage ?? 0),
							icon: <Zap className="h-4 w-4" />,
							tone: "warning",
						},
					]}
				/>
				{aiUsage.isLoading ? (
					<ChartSkeleton height={240} />
				) : (
					<AnimatedComposedChart
						data={aiData.map((d) => ({
							month: (d.billing_month ?? "").slice(5),
							Used: (d.total_input ?? 0) + (d.total_output ?? 0),
							Bundled: d.total_bundled ?? 0,
							Overage: d.total_overage ?? 0,
						}))}
						bars={[
							{ key: "Used", color: CHART_COLORS.info, name: "Tokens Used" },
							{
								key: "Bundled",
								color: CHART_COLORS.muted,
								name: "Bundle Limit",
							},
						]}
						lines={[
							{
								key: "Overage",
								color: CHART_COLORS.danger,
								name: "Overage",
								dashed: true,
							},
						]}
						barFormatter={(v) => formatCompact(v)}
					/>
				)}
			</ChartCard>

			<div className="grid gap-4 lg:grid-cols-2">
				{/* Top Users by Docs/AI */}
				<FadeIn delay={0.1}>
					<GlassCard className="space-y-3">
						<h4 className="text-sm font-semibold">Top Users (Documents)</h4>
						{(topUsers.data ?? []).length === 0 ? (
							<p className="py-4 text-center text-xs text-muted">
								No usage data.
							</p>
						) : (
							<div className="space-y-2">
								{(topUsers.data ?? []).map((u, i) => {
									const max = topUsers.data?.[0]?.usage ?? 1;
									const pct = (u.usage / max) * 100;
									return (
										<div key={u.identifier} className="space-y-1">
											<div className="flex items-center justify-between text-xs">
												<div className="flex items-center gap-2">
													<span className="w-4 text-right text-[10px] font-medium text-muted">
														{i + 1}
													</span>
													<span className="font-medium">
														<ResolvedAddress address={u.identifier} />
													</span>
													<span className="text-[10px] text-muted">
														{u.plan}
													</span>
												</div>
												<span className="font-medium">
													{u.usage.toLocaleString()}
												</span>
											</div>
											<div className="h-1 w-full rounded-full bg-surface/40">
												<div
													className="h-full rounded-full bg-accent transition-all"
													style={{ width: `${pct}%` }}
												/>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</GlassCard>
				</FadeIn>

				{/* Top AI Users */}
				<FadeIn delay={0.15}>
					<GlassCard className="space-y-3">
						<h4 className="text-sm font-semibold">Top AI Users</h4>
						{(aiTopUsers.data ?? []).length === 0 ? (
							<p className="py-4 text-center text-xs text-muted">
								No AI usage data.
							</p>
						) : (
							<div className="space-y-2">
								{(aiTopUsers.data ?? []).map((u, i) => {
									const max = aiTopUsers.data?.[0]?.total_tokens ?? 1;
									const pct = (u.total_tokens / max) * 100;
									return (
										<div key={u.identifier} className="space-y-1">
											<div className="flex items-center justify-between text-xs">
												<div className="flex items-center gap-2">
													<span className="w-4 text-right text-[10px] font-medium text-muted">
														{i + 1}
													</span>
													<span className="font-medium">
														<ResolvedAddress address={u.identifier} />
													</span>
													{u.overage_cents > 0 && (
														<span className="rounded bg-red-400/10 px-1 py-px text-[9px] text-red-300">
															{formatUsd(u.overage_cents)} overage
														</span>
													)}
												</div>
												<span className="font-medium">
													{formatCompact(u.total_tokens)} tokens
												</span>
											</div>
											<div className="h-1 w-full rounded-full bg-surface/40">
												<div
													className="h-full rounded-full bg-sky-400 transition-all"
													style={{ width: `${pct}%` }}
												/>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</GlassCard>
				</FadeIn>
			</div>
		</div>
	);
}
