// @ts-nocheck -- tRPC hook types
"use client";

import { CreditCard, Trash2, TrendingUp, Users, X } from "lucide-react";
import { useState } from "react";
import { AnimatedButton, FadeIn, GlassCard } from "~/components/ui/motion";
import { trpc } from "~/lib/platform/trpc";
import {
	SelectField,
	StatCard,
	StatusPill,
	TextField,
} from "./admin-shared-ui";

// ── Main Section ──

export function BillingSection() {
	const [subTab, setSubTab] = useState<"config" | "plans" | "subscribers">(
		"config",
	);

	const tabs = [
		{ id: "config" as const, label: "Configuration" },
		{ id: "plans" as const, label: "Plans" },
		{ id: "subscribers" as const, label: "Subscribers" },
	];

	return (
		<FadeIn>
			<div className="space-y-6">
				<GlassCard className="space-y-4">
					<div>
						<h3 className="text-lg font-semibold">Billing Management</h3>
						<p className="mt-1 text-sm text-muted">
							Configure Stripe billing, manage subscription plans, and view
							subscribers.
						</p>
					</div>
					<div className="bg-surface/30 flex gap-1 rounded-lg border border-border p-1">
						{tabs.map((tab) => (
							<button
								key={tab.id}
								type="button"
								onClick={() => setSubTab(tab.id)}
								className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
									subTab === tab.id
										? "bg-accent/20 text-accent"
										: "text-muted hover:text-secondary"
								}`}
							>
								{tab.label}
							</button>
						))}
					</div>
				</GlassCard>

				{subTab === "config" && (
					<>
						<FreeTierPanel />
						<ConfigPanel />
					</>
				)}
				{subTab === "plans" && <PlansPanel />}
				{subTab === "subscribers" && <SubscribersPanel />}
			</div>
		</FadeIn>
	);
}

// ── Free Tier Panel ──

function FreeTierPanel() {
	const utils = trpc.useUtils();
	const freeTierQuery = trpc.billing.adminGetFreeTier.useQuery();
	const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
		"idle",
	);
	const [errorMessage, setErrorMessage] = useState("");
	const updateFreeTier = trpc.billing.adminUpdateFreeTier.useMutation({
		onSuccess: () => {
			utils.billing.adminGetFreeTier.invalidate();
			setSaveStatus("success");
		},
		onError: (err) => {
			setSaveStatus("error");
			setErrorMessage(err.message || "Failed to save free tier limits");
		},
	});

	const current = freeTierQuery.data;
	const [docsPerMonth, setDocsPerMonth] = useState("");
	const [aiCallsPerMonth, setAiCallsPerMonth] = useState("");

	// Sync initial values when data loads
	const initialized = useState(false);
	if (current && !initialized[0]) {
		setDocsPerMonth(String(current.documentsPerMonth));
		setAiCallsPerMonth(String(current.aiCallsPerMonth));
		initialized[1](true);
	}

	const handleSave = () => {
		setSaveStatus("idle");
		updateFreeTier.mutate({
			documentsPerMonth: Number(docsPerMonth) || 0,
			aiCallsPerMonth: Number(aiCallsPerMonth) || 0,
		});
	};

	return (
		<GlassCard className="space-y-4">
			<div>
				<h4 className="text-sm font-semibold">Free Tier Limits</h4>
				<p className="text-xs text-muted">
					Default monthly limits for users without a subscription. Set to 0 to
					block free usage.
				</p>
			</div>

			{saveStatus === "error" && (
				<div className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-300">
					{errorMessage}
				</div>
			)}
			{saveStatus === "success" && (
				<div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-300">
					Free tier limits saved.
				</div>
			)}

			<div className="grid grid-cols-2 gap-3">
				<TextField
					label="Documents / Month"
					value={docsPerMonth || String(current?.documentsPerMonth ?? 2)}
					onChange={setDocsPerMonth}
				/>
				<TextField
					label="AI Calls / Month"
					value={aiCallsPerMonth || String(current?.aiCallsPerMonth ?? 3)}
					onChange={setAiCallsPerMonth}
				/>
			</div>

			<AnimatedButton onClick={handleSave} disabled={updateFreeTier.isPending}>
				{updateFreeTier.isPending ? "Saving..." : "Save Free Tier"}
			</AnimatedButton>
		</GlassCard>
	);
}

// ── Configuration Panel ──

function ConfigPanel() {
	const utils = trpc.useUtils();
	const workspaceQuery = trpc.account.workspace.useQuery();
	const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
		"idle",
	);
	const [errorMessage, setErrorMessage] = useState("");

	const upsertIntegration = trpc.account.upsertIntegration.useMutation({
		onSuccess: () => {
			utils.account.workspace.invalidate();
			utils.billing.billingStatus.invalidate();
			setSaveStatus("success");
			setErrorMessage("");
			// Reset fields after save so placeholders show the masked values
			setSecretKey("");
			setPublishableKey("");
			setWebhookSecret("");
		},
		onError: (err) => {
			setSaveStatus("error");
			setErrorMessage(err.message || "Failed to save configuration");
		},
	});

	const integrations = workspaceQuery.data?.integrations ?? [];
	const billingIntegration = integrations.find(
		(i) => i.kind === "PAYMENT" && i.config.provider === "stripe_billing",
	);
	const existingConfig = billingIntegration?.config;

	const [secretKey, setSecretKey] = useState("");
	const [publishableKey, setPublishableKey] = useState("");
	const [webhookSecret, setWebhookSecret] = useState("");
	const [enabled, setEnabled] = useState(existingConfig?.enabled ?? false);

	const isFirstSave = !billingIntegration;
	const hasNewKeys = !!secretKey || !!publishableKey || !!webhookSecret;
	const hasExistingKeys = !!existingConfig?.apiKey;

	const handleSave = () => {
		// Validate: first save requires at least the secret key
		if (isFirstSave && !secretKey) {
			setSaveStatus("error");
			setErrorMessage("Stripe Secret Key is required for initial setup");
			return;
		}

		setSaveStatus("idle");
		setErrorMessage("");

		upsertIntegration.mutate({
			id: billingIntegration?.id,
			kind: "PAYMENT",
			provider: "stripe_billing",
			label: "Stripe Billing",
			config: {
				provider: "stripe_billing",
				enabled,
				apiKey: secretKey || existingConfig?.apiKey || "",
				metadata: {
					publishableKey:
						publishableKey ||
						(existingConfig?.metadata?.publishableKey as string) ||
						"",
					webhookSecret:
						webhookSecret ||
						(existingConfig?.metadata?.webhookSecret as string) ||
						"",
					// Preserve free tier settings if they exist
					...(existingConfig?.metadata?.freeTier_documentsPerMonth != null
						? {
								freeTier_documentsPerMonth:
									existingConfig.metadata.freeTier_documentsPerMonth,
							}
						: {}),
					...(existingConfig?.metadata?.freeTier_aiCallsPerMonth != null
						? {
								freeTier_aiCallsPerMonth:
									existingConfig.metadata.freeTier_aiCallsPerMonth,
							}
						: {}),
				},
			},
			isDefault: false,
		});
	};

	return (
		<GlassCard className="space-y-4">
			<h4 className="text-sm font-semibold">Stripe Configuration</h4>
			<p className="text-xs text-muted">
				{isFirstSave
					? "Enter your Stripe Sandbox or Live API keys to enable billing."
					: "Update your Stripe API keys. Leave fields empty to keep existing values."}
			</p>

			{saveStatus === "error" && (
				<div className="rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-300">
					{errorMessage}
				</div>
			)}
			{saveStatus === "success" && (
				<div className="rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-300">
					Configuration saved successfully.
				</div>
			)}

			<div className="flex items-center gap-3">
				<button
					type="button"
					onClick={() => setEnabled(!enabled)}
					className={`relative h-5 w-9 rounded-full transition ${enabled ? "bg-accent" : "bg-surface/60 border border-border"}`}
				>
					<span
						className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${enabled ? "translate-x-4" : ""}`}
					/>
				</button>
				<span className="text-sm">
					{enabled ? "Billing Enabled" : "Billing Disabled"}
				</span>
			</div>

			<TextField
				label="Stripe Secret Key"
				value={secretKey}
				onChange={(v) => {
					setSecretKey(v);
					setSaveStatus("idle");
				}}
				placeholder={hasExistingKeys ? "sk_****** (configured)" : "sk_test_..."}
			/>
			<TextField
				label="Stripe Publishable Key"
				value={publishableKey}
				onChange={(v) => {
					setPublishableKey(v);
					setSaveStatus("idle");
				}}
				placeholder={
					existingConfig?.metadata?.publishableKey
						? "pk_****** (configured)"
						: "pk_test_..."
				}
			/>
			<TextField
				label="Webhook Secret"
				value={webhookSecret}
				onChange={(v) => {
					setWebhookSecret(v);
					setSaveStatus("idle");
				}}
				placeholder={
					existingConfig?.metadata?.webhookSecret
						? "whsec_****** (configured)"
						: "whsec_..."
				}
			/>

			<AnimatedButton
				onClick={handleSave}
				disabled={upsertIntegration.isPending}
			>
				{upsertIntegration.isPending ? "Saving..." : "Save Configuration"}
			</AnimatedButton>
		</GlassCard>
	);
}

// ── Plans Panel ──

function PlansPanel() {
	const utils = trpc.useUtils();
	const plansQuery = trpc.billing.adminListPlans.useQuery();
	const createPlan = trpc.billing.adminCreatePlan.useMutation({
		onSuccess: () => {
			utils.billing.adminListPlans.invalidate();
			resetForm();
		},
	});
	const updatePlan = trpc.billing.adminUpdatePlan.useMutation({
		onSuccess: () => utils.billing.adminListPlans.invalidate(),
	});
	const deletePlan = trpc.billing.adminDeletePlan.useMutation({
		onSuccess: () => utils.billing.adminListPlans.invalidate(),
	});

	const [showForm, setShowForm] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [interval, setInterval] = useState<"monthly" | "yearly" | "lifetime">(
		"monthly",
	);
	const [price, setPrice] = useState("");
	const [docsLimit, setDocsLimit] = useState("");
	const [signersLimit, setSignersLimit] = useState("");

	const resetForm = () => {
		setShowForm(false);
		setName("");
		setDescription("");
		setInterval("monthly");
		setPrice("");
		setDocsLimit("");
		setSignersLimit("");
	};

	const handleCreate = () => {
		const priceInCents = Math.round(Number.parseFloat(price || "0") * 100);
		createPlan.mutate({
			name,
			description: description || undefined,
			interval,
			priceInCents,
			featureLimits: {
				documentsPerMonth: docsLimit ? Number(docsLimit) : null,
				signersPerDocument: signersLimit ? Number(signersLimit) : null,
			},
		});
	};

	const plans = plansQuery.data ?? [];

	return (
		<div className="space-y-4">
			<GlassCard className="space-y-4">
				<div className="flex items-center justify-between">
					<h4 className="text-sm font-semibold">Subscription Plans</h4>
					<AnimatedButton size="sm" onClick={() => setShowForm(!showForm)}>
						{showForm ? "Cancel" : "+ Add Plan"}
					</AnimatedButton>
				</div>

				{showForm && (
					<div className="space-y-3 rounded-lg border border-border bg-surface/20 p-4">
						<TextField
							label="Plan Name"
							value={name}
							onChange={setName}
							placeholder="Pro"
						/>
						<TextField
							label="Description"
							value={description}
							onChange={setDescription}
							placeholder="Best for growing teams"
						/>
						<div className="grid grid-cols-2 gap-3">
							<SelectField
								label="Billing Interval"
								value={interval}
								onChange={(v) =>
									setInterval(v as "monthly" | "yearly" | "lifetime")
								}
								options={[
									{ value: "monthly", label: "Monthly" },
									{ value: "yearly", label: "Yearly" },
									{ value: "lifetime", label: "One-time (Lifetime)" },
								]}
							/>
							<TextField
								label="Price (USD)"
								value={price}
								onChange={setPrice}
								placeholder="29.99"
							/>
						</div>
						<div className="grid grid-cols-2 gap-3">
							<TextField
								label="Docs/Month Limit"
								value={docsLimit}
								onChange={setDocsLimit}
								placeholder="Unlimited"
							/>
							<TextField
								label="Signers/Doc Limit"
								value={signersLimit}
								onChange={setSignersLimit}
								placeholder="Unlimited"
							/>
						</div>
						<AnimatedButton
							onClick={handleCreate}
							disabled={!name || createPlan.isPending}
						>
							{createPlan.isPending ? "Creating..." : "Create Plan"}
						</AnimatedButton>
					</div>
				)}
			</GlassCard>

			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{plans.map((plan) => (
					<GlassCard key={plan.id} className="space-y-3">
						<div className="flex items-start justify-between">
							<div>
								<p className="font-semibold">{plan.name}</p>
								{plan.description && (
									<p className="mt-0.5 text-xs text-muted">
										{plan.description}
									</p>
								)}
							</div>
							<StatusPill
								label={plan.isActive ? "Active" : "Inactive"}
								tone={plan.isActive ? "success" : "muted"}
							/>
						</div>
						<div className="flex items-baseline gap-1">
							<span className="text-2xl font-bold">
								${(plan.priceInCents / 100).toFixed(2)}
							</span>
							<span className="text-xs text-muted">
								{plan.interval === "lifetime"
									? "one-time"
									: `/${plan.interval === "monthly" ? "mo" : "yr"}`}
							</span>
						</div>
						{plan.featureLimits && (
							<div className="space-y-1 text-xs text-muted">
								{plan.featureLimits.documentsPerMonth != null && (
									<p>{plan.featureLimits.documentsPerMonth} docs/month</p>
								)}
								{plan.featureLimits.signersPerDocument != null && (
									<p>{plan.featureLimits.signersPerDocument} signers/doc</p>
								)}
							</div>
						)}
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() =>
									updatePlan.mutate({ id: plan.id, isActive: !plan.isActive })
								}
								className="text-xs text-muted hover:text-secondary"
							>
								{plan.isActive ? "Deactivate" : "Activate"}
							</button>
							<button
								type="button"
								onClick={() => deletePlan.mutate({ id: plan.id })}
								className="text-xs text-red-400 hover:text-red-300"
							>
								<Trash2 className="inline h-3 w-3" /> Remove
							</button>
						</div>
					</GlassCard>
				))}
				{plans.length === 0 && (
					<GlassCard className="col-span-full py-8 text-center text-sm text-muted">
						No plans created yet. Add your first plan above.
					</GlassCard>
				)}
			</div>
		</div>
	);
}

// ── Subscribers Panel ──

function SubscribersPanel() {
	const statsQuery = trpc.billing.adminBillingStats.useQuery();
	const subsQuery = trpc.billing.adminListSubscriptions.useQuery();

	const stats = statsQuery.data;
	const subs = subsQuery.data?.rows ?? [];

	const statusTone = (status: string) => {
		switch (status) {
			case "active":
				return "success" as const;
			case "past_due":
				return "warning" as const;
			case "canceled":
				return "danger" as const;
			default:
				return "muted" as const;
		}
	};

	return (
		<div className="space-y-4">
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard
					label="Active"
					value={String(stats?.activeSubs ?? 0)}
					icon={<Users className="h-4 w-4" />}
					tone="success"
				/>
				<StatCard
					label="Past Due"
					value={String(stats?.pastDueSubs ?? 0)}
					icon={<CreditCard className="h-4 w-4" />}
					tone="warning"
				/>
				<StatCard
					label="Canceled"
					value={String(stats?.canceledSubs ?? 0)}
					icon={<X className="h-4 w-4" />}
					tone="danger"
				/>
				<StatCard
					label="MRR"
					value={`$${((stats?.mrrCents ?? 0) / 100).toFixed(2)}`}
					icon={<TrendingUp className="h-4 w-4" />}
					tone="info"
				/>
			</div>

			<GlassCard className="space-y-3">
				<h4 className="text-sm font-semibold">Subscriptions</h4>
				{subs.length === 0 ? (
					<p className="py-4 text-center text-sm text-muted">
						No subscriptions yet.
					</p>
				) : (
					<div className="space-y-2">
						{subs.map((sub) => (
							<div
								key={sub.id}
								className="flex items-center justify-between rounded-lg border border-border bg-surface/20 px-3 py-2"
							>
								<div className="min-w-0">
									<p className="truncate text-sm font-medium">
										{sub.walletAddress
											? `${sub.walletAddress.slice(0, 6)}...${sub.walletAddress.slice(-4)}`
											: (sub.userId ?? "Unknown")}
									</p>
									<p className="text-xs text-muted">
										Plan: {sub.planId.slice(0, 8)}...
										{sub.currentPeriodEnd && (
											<>
												{" "}
												&middot; Renews{" "}
												{new Date(sub.currentPeriodEnd).toLocaleDateString()}
											</>
										)}
									</p>
								</div>
								<StatusPill label={sub.status} tone={statusTone(sub.status)} />
							</div>
						))}
					</div>
				)}
			</GlassCard>
		</div>
	);
}
