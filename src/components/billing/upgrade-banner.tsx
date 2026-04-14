// @ts-nocheck -- tRPC hook types
"use client";

import { AlertTriangle, ArrowRight, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { trpc } from "~/lib/platform/trpc";

/**
 * Upgrade banner — shows when the user is on free tier or near their limits.
 * Renders inline wherever it's placed (create page, dashboard, nav area).
 */
export function UpgradeBanner() {
	const limitsQuery = trpc.billing.myLimits.useQuery(undefined, {
		staleTime: 60_000, // cache for 1 min so we don't spam the API
		retry: false,
	});

	const data = limitsQuery.data;
	if (!data || limitsQuery.isLoading) return null;

	const docsUsage = data.usage?.find(
		(u) => u.metricKey === "documents_created",
	);
	const aiUsage = data.usage?.find((u) => u.metricKey === "ai_calls");

	const docsExhausted =
		docsUsage?.limit != null && docsUsage.current >= docsUsage.limit;
	const docsNearLimit =
		docsUsage?.limit != null &&
		docsUsage.current >= docsUsage.limit * 0.8 &&
		!docsExhausted;
	const aiExhausted =
		aiUsage?.limit != null && aiUsage.current >= aiUsage.limit;

	// Nothing to show if they have unlimited or plenty remaining
	if (!data.isFree && !docsExhausted && !docsNearLimit && !aiExhausted)
		return null;

	// Hard block — out of documents
	if (docsExhausted) {
		return (
			<div className="rounded-lg border border-red-400/20 bg-red-400/5 px-4 py-3">
				<div className="flex items-start gap-3">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium text-red-300">
							Document limit reached
						</p>
						<p className="mt-0.5 text-xs text-red-300/70">
							You&apos;ve used {docsUsage.current}/{docsUsage.limit} documents
							this month.{" "}
							{data.isFree
								? "Upgrade to a paid plan to create more."
								: "Upgrade your plan for a higher limit."}
						</p>
						<Link
							href="/settings?tab=billing"
							className="mt-2 inline-flex items-center gap-1 rounded-md bg-accent/20 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/30"
						>
							<Sparkles className="h-3 w-3" />
							View Plans
							<ArrowRight className="h-3 w-3" />
						</Link>
					</div>
				</div>
			</div>
		);
	}

	// Warning — near limit
	if (docsNearLimit) {
		return (
			<div className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-3">
				<div className="flex items-start gap-3">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
					<div className="min-w-0 flex-1">
						<p className="text-sm font-medium text-amber-300">
							Running low on documents
						</p>
						<p className="mt-0.5 text-xs text-amber-300/70">
							{docsUsage.current}/{docsUsage.limit} used this month.
						</p>
						<Link
							href="/settings?tab=billing"
							className="mt-2 inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200"
						>
							<Sparkles className="h-3 w-3" />
							Upgrade for more
							<ArrowRight className="h-3 w-3" />
						</Link>
					</div>
				</div>
			</div>
		);
	}

	// Free tier nudge — always show a subtle prompt
	if (data.isFree) {
		return (
			<div className="rounded-lg border border-accent/10 bg-accent/5 px-4 py-3">
				<div className="flex items-center gap-3">
					<Sparkles className="h-4 w-4 shrink-0 text-accent/60" />
					<div className="min-w-0 flex-1">
						<p className="text-xs text-muted">
							<span className="font-medium text-secondary">Free plan</span>
							{" — "}
							{docsUsage?.limit != null && (
								<>
									{docsUsage.current}/{docsUsage.limit} docs
								</>
							)}
							{aiUsage?.limit != null && docsUsage?.limit != null && ", "}
							{aiUsage?.limit != null && (
								<>
									{aiUsage.current}/{aiUsage.limit} AI calls
								</>
							)}
							{" this month."}
						</p>
					</div>
					<Link
						href="/settings?tab=billing"
						className="shrink-0 rounded-md bg-accent/20 px-2.5 py-1 text-[10px] font-medium text-accent transition hover:bg-accent/30"
					>
						Upgrade
					</Link>
				</div>
			</div>
		);
	}

	return null;
}

/**
 * Compact upgrade pill for tight spaces (nav bar, inline).
 * Dismissable — hidden until next page load / refresh.
 */
export function UpgradePill() {
	const [dismissed, setDismissed] = useState(false);
	const limitsQuery = trpc.billing.myLimits.useQuery(undefined, {
		staleTime: 60_000,
		retry: false,
	});

	const data = limitsQuery.data;
	if (dismissed || !data?.isFree || limitsQuery.isLoading) return null;

	return (
		<span className="flex items-center gap-0.5">
			<Link
				href="/settings?tab=billing"
				className="flex items-center gap-1 rounded-full border border-accent/20 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent transition hover:bg-accent/20"
			>
				<Sparkles className="h-2.5 w-2.5" />
				Upgrade
			</Link>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setDismissed(true);
				}}
				className="rounded-full p-0.5 text-muted/40 transition hover:text-muted"
				aria-label="Dismiss"
			>
				<X className="h-2.5 w-2.5" />
			</button>
		</span>
	);
}
