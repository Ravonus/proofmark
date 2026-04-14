"use client";

/**
 * Shared chart wrapper components for the analytics dashboard.
 * Built on Recharts + Framer Motion + existing design system.
 */

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ComposedChart,
	Legend,
	Line,
	LineChart,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { FadeIn, GlassCard } from "~/components/ui/motion";
import { StatCard } from "./admin-shared-ui";

// ── Chart Colors ──

export const CHART_COLORS = {
	primary: "#7c5cfc",
	secondary: "#a78bfa",
	success: "#34d399",
	danger: "#f87171",
	warning: "#fbbf24",
	info: "#38bdf8",
	stripe: "#635bff",
	crypto: "#f7931a",
	eth: "#627eea",
	sol: "#9945ff",
	btc: "#f7931a",
	base: "#0052ff",
	muted: "#4a4a56",
	usdc: "#2775ca",
	weth: "#627eea",
	usdt: "#26a17b",
	free: "#6b7280",
};

export const TOKEN_COLORS: Record<string, string> = {
	WETH: CHART_COLORS.weth,
	USDC: CHART_COLORS.usdc,
	USDT: CHART_COLORS.usdt,
	BTC: CHART_COLORS.btc,
	SOL_USDC: CHART_COLORS.sol,
	ETH: CHART_COLORS.eth,
};

export const CHAIN_COLORS: Record<string, string> = {
	ETH: CHART_COLORS.eth,
	BASE: CHART_COLORS.base,
	SOL: CHART_COLORS.sol,
	BTC: CHART_COLORS.btc,
};

// ── Shared Tooltip ──

function ChartTooltipContent({
	active,
	payload,
	label,
	formatter,
}: {
	active?: boolean;
	payload?: Array<{ name: string; value: number; color: string }>;
	label?: string;
	formatter?: (value: number, name: string) => string;
}) {
	if (!active || !payload?.length) return null;
	return (
		<div className="rounded-lg border border-border bg-[#0e0e12]/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
			{label && <p className="mb-1 text-muted">{label}</p>}
			{payload.map((entry) => (
				<div key={entry.name} className="flex items-center gap-2">
					<span
						className="h-2 w-2 rounded-full"
						style={{ background: entry.color }}
					/>
					<span className="text-secondary">{entry.name}:</span>
					<span className="font-medium text-primary">
						{formatter
							? formatter(entry.value, entry.name)
							: entry.value.toLocaleString()}
					</span>
				</div>
			))}
		</div>
	);
}

const AXIS_STYLE = { fontSize: 10, fill: "#4a4a56" };

// ── Chart Card Wrapper ──

export function ChartCard({
	title,
	subtitle,
	children,
	className = "",
}: {
	title: string;
	subtitle?: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<FadeIn delay={0.05}>
			<GlassCard className={`space-y-3 ${className}`}>
				<div>
					<h4 className="text-sm font-semibold">{title}</h4>
					{subtitle && (
						<p className="mt-0.5 text-[10px] text-muted">{subtitle}</p>
					)}
				</div>
				{children}
			</GlassCard>
		</FadeIn>
	);
}

export function ChartSkeleton({ height = 200 }: { height?: number }) {
	return (
		<div className="shimmer-skeleton w-full rounded-lg" style={{ height }} />
	);
}

// ── KPI Grid ──

export function KpiGrid({
	items,
}: {
	items: Array<{
		label: string;
		value: string;
		icon: ReactNode;
		tone: "success" | "warning" | "danger" | "info" | "muted";
	}>;
}) {
	return (
		<FadeIn>
			<div
				className={`grid gap-3 ${items.length <= 3 ? "sm:grid-cols-3" : items.length <= 5 ? "sm:grid-cols-2 lg:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-4"}`}
			>
				{items.map((item) => (
					<StatCard key={item.label} {...item} />
				))}
			</div>
		</FadeIn>
	);
}

// ── Area Chart ──

export function AnimatedAreaChart({
	data,
	areas,
	xKey = "month",
	height = 240,
	formatter,
	stacked = false,
}: {
	data: Array<Record<string, unknown>>;
	areas: Array<{ key: string; color: string; name: string }>;
	xKey?: string;
	height?: number;
	formatter?: (value: number, name: string) => string;
	stacked?: boolean;
}) {
	if (data.length === 0) return <EmptyChart height={height} />;

	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
		>
			<ResponsiveContainer width="100%" height={height}>
				<AreaChart
					data={data}
					margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
				>
					<defs>
						{areas.map((area) => (
							<linearGradient
								key={area.key}
								id={`grad-${area.key}`}
								x1="0"
								y1="0"
								x2="0"
								y2="1"
							>
								<stop offset="0%" stopColor={area.color} stopOpacity={0.3} />
								<stop offset="100%" stopColor={area.color} stopOpacity={0} />
							</linearGradient>
						))}
					</defs>
					<CartesianGrid
						strokeDasharray="3 3"
						stroke="#1e1e28"
						vertical={false}
					/>
					<XAxis
						dataKey={xKey}
						tick={AXIS_STYLE}
						axisLine={false}
						tickLine={false}
					/>
					<YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} />
					<Tooltip content={<ChartTooltipContent formatter={formatter} />} />
					{areas.map((area) => (
						<Area
							key={area.key}
							type="monotone"
							dataKey={area.key}
							name={area.name}
							stroke={area.color}
							strokeWidth={2}
							fill={`url(#grad-${area.key})`}
							stackId={stacked ? "stack" : undefined}
							animationDuration={800}
							animationEasing="ease-out"
						/>
					))}
				</AreaChart>
			</ResponsiveContainer>
		</motion.div>
	);
}

// ── Bar Chart ──

export function AnimatedBarChart({
	data,
	bars,
	xKey = "name",
	height = 240,
	layout = "vertical",
	formatter,
}: {
	data: Array<Record<string, unknown>>;
	bars: Array<{ key: string; color: string; name: string }>;
	xKey?: string;
	height?: number;
	layout?: "horizontal" | "vertical";
	formatter?: (value: number, name: string) => string;
}) {
	if (data.length === 0) return <EmptyChart height={height} />;

	const isHorizontal = layout === "horizontal";

	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
		>
			<ResponsiveContainer width="100%" height={height}>
				<BarChart
					data={data}
					layout={isHorizontal ? "vertical" : "horizontal"}
					margin={{
						top: 4,
						right: 4,
						bottom: 0,
						left: isHorizontal ? 80 : -20,
					}}
				>
					<CartesianGrid
						strokeDasharray="3 3"
						stroke="#1e1e28"
						horizontal={!isHorizontal}
						vertical={isHorizontal}
					/>
					{isHorizontal ? (
						<>
							<YAxis
								type="category"
								dataKey={xKey}
								tick={AXIS_STYLE}
								axisLine={false}
								tickLine={false}
								width={75}
							/>
							<XAxis
								type="number"
								tick={AXIS_STYLE}
								axisLine={false}
								tickLine={false}
							/>
						</>
					) : (
						<>
							<XAxis
								dataKey={xKey}
								tick={AXIS_STYLE}
								axisLine={false}
								tickLine={false}
							/>
							<YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} />
						</>
					)}
					<Tooltip content={<ChartTooltipContent formatter={formatter} />} />
					{bars.map((bar) => (
						<Bar
							key={bar.key}
							dataKey={bar.key}
							name={bar.name}
							fill={bar.color}
							radius={[4, 4, 4, 4]}
							animationDuration={800}
							animationEasing="ease-out"
						/>
					))}
				</BarChart>
			</ResponsiveContainer>
		</motion.div>
	);
}

// ── Composed Chart (bars + lines, dual Y-axis) ──

export function AnimatedComposedChart({
	data,
	bars,
	lines,
	xKey = "month",
	height = 280,
	barFormatter,
	lineFormatter,
}: {
	data: Array<Record<string, unknown>>;
	bars: Array<{ key: string; color: string; name: string; stackId?: string }>;
	lines: Array<{
		key: string;
		color: string;
		name: string;
		dashed?: boolean;
	}>;
	xKey?: string;
	height?: number;
	barFormatter?: (v: number) => string;
	lineFormatter?: (v: number) => string;
}) {
	if (data.length === 0) return <EmptyChart height={height} />;

	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
		>
			<ResponsiveContainer width="100%" height={height}>
				<ComposedChart
					data={data}
					margin={{ top: 4, right: 40, bottom: 0, left: -20 }}
				>
					<CartesianGrid
						strokeDasharray="3 3"
						stroke="#1e1e28"
						vertical={false}
					/>
					<XAxis
						dataKey={xKey}
						tick={AXIS_STYLE}
						axisLine={false}
						tickLine={false}
					/>
					<YAxis
						yAxisId="left"
						tick={AXIS_STYLE}
						axisLine={false}
						tickLine={false}
					/>
					{lines.length > 0 && (
						<YAxis
							yAxisId="right"
							orientation="right"
							tick={AXIS_STYLE}
							axisLine={false}
							tickLine={false}
						/>
					)}
					<Tooltip
						content={
							<ChartTooltipContent
								formatter={(v, n) => {
									const isLine = lines.some((l) => l.name === n);
									if (isLine && lineFormatter) return lineFormatter(v);
									if (!isLine && barFormatter) return barFormatter(v);
									return v.toLocaleString();
								}}
							/>
						}
					/>
					<Legend
						verticalAlign="top"
						height={28}
						content={({ payload }) => (
							<div className="flex flex-wrap justify-end gap-3 pb-1">
								{(payload ?? []).map((p: any) => (
									<div
										key={p.value}
										className="flex items-center gap-1.5 text-[10px]"
									>
										<span
											className="h-2 w-2 rounded-full"
											style={{ background: p.color }}
										/>
										<span className="text-muted">{p.value}</span>
									</div>
								))}
							</div>
						)}
					/>
					{bars.map((bar) => (
						<Bar
							key={bar.key}
							yAxisId="left"
							dataKey={bar.key}
							name={bar.name}
							fill={bar.color}
							radius={[3, 3, 0, 0]}
							stackId={bar.stackId}
							animationDuration={800}
							animationEasing="ease-out"
						/>
					))}
					{lines.map((line) => (
						<Line
							key={line.key}
							yAxisId="right"
							type="monotone"
							dataKey={line.key}
							name={line.name}
							stroke={line.color}
							strokeWidth={2}
							strokeDasharray={line.dashed ? "6 3" : undefined}
							dot={{ r: 3, fill: line.color }}
							animationDuration={1000}
							animationEasing="ease-out"
						/>
					))}
				</ComposedChart>
			</ResponsiveContainer>
		</motion.div>
	);
}

// ── Line Chart ──

export function AnimatedLineChart({
	data,
	lines,
	xKey = "month",
	height = 240,
	formatter,
}: {
	data: Array<Record<string, unknown>>;
	lines: Array<{
		key: string;
		color: string;
		name: string;
		dashed?: boolean;
	}>;
	xKey?: string;
	height?: number;
	formatter?: (value: number, name: string) => string;
}) {
	if (data.length === 0) return <EmptyChart height={height} />;

	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}
		>
			<ResponsiveContainer width="100%" height={height}>
				<LineChart
					data={data}
					margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
				>
					<CartesianGrid
						strokeDasharray="3 3"
						stroke="#1e1e28"
						vertical={false}
					/>
					<XAxis
						dataKey={xKey}
						tick={AXIS_STYLE}
						axisLine={false}
						tickLine={false}
					/>
					<YAxis tick={AXIS_STYLE} axisLine={false} tickLine={false} />
					<Tooltip content={<ChartTooltipContent formatter={formatter} />} />
					{lines.map((line) => (
						<Line
							key={line.key}
							type="monotone"
							dataKey={line.key}
							name={line.name}
							stroke={line.color}
							strokeWidth={2}
							strokeDasharray={line.dashed ? "6 3" : undefined}
							dot={false}
							animationDuration={1000}
							animationEasing="ease-out"
						/>
					))}
				</LineChart>
			</ResponsiveContainer>
		</motion.div>
	);
}

// ── Donut / Pie Chart (with optional center label) ──

export function AnimatedDonutChart({
	data,
	height = 220,
	innerRadius = 55,
	outerRadius = 85,
	centerLabel,
	formatter,
}: {
	data: Array<{ name: string; value: number; color: string }>;
	height?: number;
	innerRadius?: number;
	outerRadius?: number;
	centerLabel?: { value: string; label: string };
	formatter?: (value: number) => string;
}) {
	if (data.length === 0 || data.every((d) => d.value === 0))
		return <EmptyChart height={height} />;

	const total = data.reduce((s, d) => s + d.value, 0);

	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.9 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
			className="relative"
		>
			{centerLabel && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div className="text-center" style={{ marginBottom: 18 }}>
						<p className="text-lg font-bold text-primary">
							{centerLabel.value}
						</p>
						<p className="text-[9px] text-muted">{centerLabel.label}</p>
					</div>
				</div>
			)}
			<ResponsiveContainer width="100%" height={height}>
				<PieChart>
					<Pie
						data={data}
						cx="50%"
						cy="50%"
						innerRadius={innerRadius}
						outerRadius={outerRadius}
						dataKey="value"
						animationDuration={800}
						animationEasing="ease-out"
						stroke="none"
					>
						{data.map((entry) => (
							<Cell key={entry.name} fill={entry.color} />
						))}
					</Pie>
					<Tooltip
						content={({ active, payload }) => {
							if (!active || !payload?.length) return null;
							const d = payload[0];
							return (
								<div className="rounded-lg border border-border bg-[#0e0e12]/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
									<div className="flex items-center gap-2">
										<span
											className="h-2 w-2 rounded-full"
											style={{
												background: d?.payload?.color ?? CHART_COLORS.primary,
											}}
										/>
										<span className="text-secondary">{d?.name}:</span>
										<span className="font-medium text-primary">
											{formatter
												? formatter(d?.value as number)
												: (d?.value as number)?.toLocaleString()}
										</span>
										<span className="text-muted">
											(
											{((((d?.value as number) ?? 0) / total) * 100).toFixed(0)}
											%)
										</span>
									</div>
								</div>
							);
						}}
					/>
					<Legend
						verticalAlign="bottom"
						height={36}
						content={() => (
							<div className="flex flex-wrap justify-center gap-3 pt-2">
								{data.map((d) => (
									<div
										key={d.name}
										className="flex items-center gap-1.5 text-[10px]"
									>
										<span
											className="h-2 w-2 rounded-full"
											style={{ background: d.color }}
										/>
										<span className="text-muted">{d.name}</span>
									</div>
								))}
							</div>
						)}
					/>
				</PieChart>
			</ResponsiveContainer>
		</motion.div>
	);
}

// ── Funnel Chart (CSS-based, animated) ──

export function FunnelChart({
	steps,
	height = 200,
}: {
	steps: Array<{ label: string; value: number; color: string }>;
	height?: number;
}) {
	if (steps.length === 0 || !steps[0] || steps[0].value === 0)
		return <EmptyChart height={height} />;

	const maxVal = steps[0]!.value;

	return (
		<div className="space-y-2" style={{ minHeight: height }}>
			{steps.map((step, i) => {
				const widthPct = Math.max(8, (step.value / maxVal) * 100);
				return (
					<motion.div
						key={step.label}
						initial={{ opacity: 0, scaleX: 0 }}
						animate={{ opacity: 1, scaleX: 1 }}
						transition={{
							duration: 0.5,
							delay: i * 0.1,
							ease: [0.23, 1, 0.32, 1],
						}}
						style={{ originX: 0 }}
					>
						<div className="flex items-center gap-3">
							<div
								className="flex h-8 items-center rounded-md px-3"
								style={{
									width: `${widthPct}%`,
									background: `${step.color}20`,
									borderLeft: `3px solid ${step.color}`,
								}}
							>
								<span
									className="text-xs font-medium"
									style={{ color: step.color }}
								>
									{step.value.toLocaleString()}
								</span>
							</div>
							<span className="shrink-0 text-[10px] text-muted">
								{step.label}
								{i > 0 && maxVal > 0 && (
									<span className="ml-1 text-[9px]">
										({((step.value / maxVal) * 100).toFixed(0)}%)
									</span>
								)}
							</span>
						</div>
					</motion.div>
				);
			})}
		</div>
	);
}

// ── Staggered List Wrapper ──

export function StaggeredList({ children }: { children: ReactNode[] }) {
	return (
		<motion.div
			initial="hidden"
			animate="visible"
			variants={{
				hidden: {},
				visible: { transition: { staggerChildren: 0.04 } },
			}}
			className="space-y-1.5"
		>
			{children.map((child, i) => (
				<motion.div
					key={i}
					variants={{
						hidden: { opacity: 0, y: 6 },
						visible: {
							opacity: 1,
							y: 0,
							transition: { duration: 0.3, ease: [0.23, 1, 0.32, 1] },
						},
					}}
				>
					{child}
				</motion.div>
			))}
		</motion.div>
	);
}

// ── Empty State ──

function EmptyChart({ height = 200 }: { height?: number }) {
	return (
		<div
			className="flex items-center justify-center rounded-lg border border-border/50 bg-surface/20 text-xs text-muted"
			style={{ height }}
		>
			No data yet
		</div>
	);
}

// ── Format Helpers ──

export function formatUsd(cents: number): string {
	return `$${(cents / 100).toLocaleString(undefined, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

export function formatCompact(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toLocaleString();
}

export function relativeTime(date: string | Date): string {
	const ms = Date.now() - new Date(date).getTime();
	const mins = Math.floor(ms / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 30) return `${days}d ago`;
	return `${Math.floor(days / 30)}mo ago`;
}
