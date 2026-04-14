import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { env } from "~/env";
import {
	detectChain,
	normalizeAddress,
	type WalletChain,
} from "~/lib/crypto/chains";
import {
	FEATURE_IDS,
	type FeatureDescriptor,
	type FeatureId,
	getFeatureCatalog,
	getFeatureDescriptor,
} from "~/lib/platform/feature-access";
import { isPremiumAvailable } from "~/lib/platform/premium";
import { getActiveSubscription } from "~/server/billing/usage";
import { db as defaultDb } from "~/server/db";
import { isSchemaDriftError } from "~/server/db/compat";
import {
	billingPlans,
	documents,
	featureOverrides,
	platformConfig,
	signers,
	users,
	walletSessions,
} from "~/server/db/schema";

type Db = typeof defaultDb;

// ── Cached DB owner (loaded once, refreshed on claim) ──
let _cachedDbOwner: WalletIdentity | null | undefined = undefined;

/** Load the owner from the platformConfig DB table (singleton row). */
async function loadDbOwner(): Promise<WalletIdentity | null> {
	try {
		const row = await defaultDb.query.platformConfig.findFirst({
			where: eq(platformConfig.id, "singleton"),
		});
		if (!row) return null;
		const chain = (
			row.ownerChain === "BASE" ? "ETH" : row.ownerChain
		) as WalletChain;
		return {
			address: normalizeAddress(chain, row.ownerAddress),
			chain,
		};
	} catch {
		// Table might not exist yet (pre-migration)
		return null;
	}
}

/** Get the DB-stored owner, with in-memory cache.
 *  Only caches successful lookups — null results are retried each time
 *  so that server startup before DB is ready doesn't permanently miss the owner. */
async function getDbOwner(): Promise<WalletIdentity | null> {
	if (_cachedDbOwner !== undefined && _cachedDbOwner !== null) {
		return _cachedDbOwner;
	}
	const result = await loadDbOwner();
	if (result) _cachedDbOwner = result;
	return result;
}

/** Clear the cached DB owner (call after claim). */
export function invalidateDbOwnerCache() {
	_cachedDbOwner = undefined;
}

export type WalletIdentity = {
	address: string;
	chain: WalletChain;
};

export type FeatureOverrideInput = {
	featureId: FeatureId;
	enabled: boolean | null;
};

export type FeatureAccessState = FeatureDescriptor & {
	deploymentEnabled: boolean;
	overrideEnabled: boolean | null;
	effectiveEnabled: boolean;
	source:
		| "oss"
		| "premium_runtime"
		| "override_on"
		| "override_off"
		| "runtime_unavailable";
};

export function getDeploymentMode() {
	return env.PROOFMARK_DEPLOYMENT_MODE;
}

export function canSelfManageFeatureAccess() {
	return env.NODE_ENV !== "production";
}

export function resolveWalletIdentity(
	address: string,
	chain?: string | null,
): WalletIdentity {
	const trimmed = address.trim();
	const resolvedChain = normalizeWalletChain(chain) ?? detectChain(trimmed);
	if (!resolvedChain) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Could not determine wallet chain for this address.",
		});
	}

	return {
		address: normalizeAddress(resolvedChain, trimmed),
		chain: resolvedChain,
	};
}

function normalizeWalletChain(chain?: string | null): WalletChain | null {
	if (!chain) return null;
	const upper = chain.trim().toUpperCase();
	if (upper === "ETH" || upper === "SOL" || upper === "BTC") {
		return upper;
	}
	// BASE uses ETH addresses/chain under the hood
	if (upper === "BASE") return "ETH";
	return null;
}

/** Sync version — checks env var only (used where async isn't possible). */
export function getOwnerWalletFromEnv(): WalletIdentity | null {
	const ownerAddress = env.OWNER_ADDRESS.trim();
	if (!ownerAddress) return null;
	const ownerChain =
		normalizeWalletChain(env.OWNER_CHAIN) ?? detectChain(ownerAddress);
	if (!ownerChain) return null;
	return {
		address: normalizeAddress(ownerChain, ownerAddress),
		chain: ownerChain,
	};
}

/** Full owner resolution: env var first, then DB platformConfig fallback. */
export async function getOwnerWallet(): Promise<WalletIdentity | null> {
	// Env var takes priority
	const envOwner = getOwnerWalletFromEnv();
	if (envOwner) return envOwner;
	// Fallback to DB (first-time setup claim)
	return getDbOwner();
}

export async function isOwnerWallet(
	identity: WalletIdentity,
): Promise<boolean> {
	const owner = await getOwnerWallet();
	if (!owner) return false;
	return (
		owner.chain === identity.chain &&
		owner.address === normalizeAddress(identity.chain, identity.address)
	);
}

/** In dev/test mode, treat any wallet as having full admin access. */
export function isDevAdmin(): boolean {
	return env.NODE_ENV !== "production";
}

export async function canManageFeatureTarget(
	actor: WalletIdentity,
	_target: WalletIdentity,
): Promise<boolean> {
	if (await isOwnerWallet(actor)) return true;
	// In dev mode, any authenticated wallet can manage any target
	if (isDevAdmin()) return true;
	return false;
}

async function getOverrideRows(db: Db, target: WalletIdentity) {
	try {
		return await db.query.featureOverrides.findMany({
			where: and(
				eq(featureOverrides.userAddress, target.address),
				eq(featureOverrides.userChain, target.chain),
			),
			orderBy: (t, { asc: orderAsc }) => [orderAsc(t.featureId)],
		});
	} catch (error) {
		if (!isSchemaDriftError(error)) throw error;
		return [];
	}
}

export async function getFeatureAccessStates(
	db: Db,
	target: WalletIdentity,
): Promise<FeatureAccessState[]> {
	const runtimePremium = isPremiumAvailable();
	const overrides = await getOverrideRows(db, target);
	const overrideMap = new Map<FeatureId, boolean>();

	for (const row of overrides) {
		if (FEATURE_IDS.includes(row.featureId as FeatureId)) {
			overrideMap.set(row.featureId as FeatureId, row.enabled);
		}
	}

	// Check subscription plan for enabled features
	const planFeatures = await getPlanEnabledFeatures(target);

	return getFeatureCatalog().map((feature) => {
		const deploymentEnabled = feature.oss || runtimePremium;
		const overrideEnabled = overrideMap.get(feature.id) ?? null;

		// Priority: 1. Override (explicit admin toggle) 2. Plan features 3. Deployment default
		let effectiveEnabled: boolean;
		if (overrideEnabled !== null) {
			effectiveEnabled = deploymentEnabled && overrideEnabled;
		} else if (planFeatures && planFeatures.size > 0) {
			// If billing is active, plan features gate non-OSS features
			effectiveEnabled =
				deploymentEnabled && (feature.oss || planFeatures.has(feature.id));
		} else {
			effectiveEnabled = deploymentEnabled;
		}

		let source: FeatureAccessState["source"];
		if (!deploymentEnabled) {
			source = "runtime_unavailable";
		} else if (overrideEnabled === false) {
			source = "override_off";
		} else if (overrideEnabled === true) {
			source = "override_on";
		} else if (feature.oss) {
			source = "oss";
		} else {
			source = "premium_runtime";
		}

		return {
			...feature,
			deploymentEnabled,
			overrideEnabled,
			effectiveEnabled,
			source,
		};
	});
}

/** Resolve plan-enabled features for a wallet (returns null if no billing active). */
async function getPlanEnabledFeatures(
	target: WalletIdentity,
): Promise<Set<string> | null> {
	try {
		const sub = await getActiveSubscription({ walletAddress: target.address });
		if (!sub) return null;

		const plan = await defaultDb.query.billingPlans.findFirst({
			where: eq(billingPlans.id, sub.planId),
		});
		if (!plan?.featureLimits?.enabledFeatures) return null;

		return new Set(plan.featureLimits.enabledFeatures);
	} catch {
		// Billing tables may not exist yet
		return null;
	}
}

export async function isFeatureEnabledForWallet(
	db: Db,
	target: WalletIdentity,
	featureId: FeatureId,
): Promise<boolean> {
	const feature = getFeatureDescriptor(featureId);
	const access = (await getFeatureAccessStates(db, target)).find(
		(entry) => entry.id === feature.id,
	);
	return access?.effectiveEnabled ?? false;
}

export async function requireFeatureForWallet(
	db: Db,
	target: WalletIdentity,
	featureId: FeatureId,
	message?: string,
): Promise<void> {
	const allowed = await isFeatureEnabledForWallet(db, target, featureId);
	if (allowed) return;

	throw new TRPCError({
		code: "FORBIDDEN",
		message:
			message ??
			`${getFeatureDescriptor(featureId).label} is disabled for this wallet.`,
	});
}

export async function saveFeatureOverrides(
	db: Db,
	actor: WalletIdentity,
	target: WalletIdentity,
	overrides: FeatureOverrideInput[],
): Promise<FeatureAccessState[]> {
	if (!(await canManageFeatureTarget(actor, target))) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message:
				"This wallet is not allowed to manage feature overrides for that user.",
		});
	}

	try {
		await db.transaction(async (tx) => {
			for (const override of overrides) {
				const scope = and(
					eq(featureOverrides.userAddress, target.address),
					eq(featureOverrides.userChain, target.chain),
					eq(featureOverrides.featureId, override.featureId),
				);

				if (override.enabled === null) {
					await tx.delete(featureOverrides).where(scope);
					continue;
				}

				await tx
					.insert(featureOverrides)
					.values({
						userAddress: target.address,
						userChain: target.chain,
						featureId: override.featureId,
						enabled: override.enabled,
						updatedBy: actor.address,
						updatedAt: new Date(),
					})
					.onConflictDoUpdate({
						target: [
							featureOverrides.userAddress,
							featureOverrides.userChain,
							featureOverrides.featureId,
						],
						set: {
							enabled: override.enabled,
							updatedBy: actor.address,
							updatedAt: new Date(),
						},
					});
			}
		});
	} catch (error) {
		if (isSchemaDriftError(error)) {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message:
					"Feature override tables are not ready yet. Run `npm run db:push` and refresh.",
			});
		}
		throw error;
	}

	return getFeatureAccessStates(db, target);
}

export async function listKnownWallets(db: Db) {
	const [recentSessions, linkedUsers, recentCreators, signerWallets] =
		await Promise.all([
			db
				.select({
					address: walletSessions.address,
					chain: walletSessions.chain,
					seenAt: walletSessions.createdAt,
				})
				.from(walletSessions)
				.orderBy(desc(walletSessions.createdAt))
				.limit(30),
			db
				.select({
					address: users.walletAddress,
					chain: users.walletChain,
					seenAt: users.updatedAt,
				})
				.from(users)
				.where(isNotNull(users.walletAddress))
				.orderBy(desc(users.updatedAt))
				.limit(30),
			db
				.select({ address: documents.createdBy, seenAt: documents.createdAt })
				.from(documents)
				.orderBy(desc(documents.createdAt))
				.limit(30),
			db
				.select({ address: signers.address, chain: signers.chain })
				.from(signers)
				.where(isNotNull(signers.address))
				.limit(30),
		]);

	const seen = new Map<
		string,
		WalletIdentity & { lastSeenAt: string | null }
	>();

	const upsert = (
		address: string | null,
		chain?: string | null,
		seenAt?: Date | null,
	) => {
		if (!address) return;
		let wallet: WalletIdentity;
		try {
			wallet = resolveWalletIdentity(address, chain);
		} catch {
			return;
		}

		const key = `${wallet.chain}:${wallet.address}`;
		const timestamp = seenAt?.toISOString() ?? null;
		const existing = seen.get(key);
		if (
			!existing ||
			(timestamp && (!existing.lastSeenAt || existing.lastSeenAt < timestamp))
		) {
			seen.set(key, { ...wallet, lastSeenAt: timestamp });
		}
	};

	for (const row of recentSessions) upsert(row.address, row.chain, row.seenAt);
	for (const row of linkedUsers) upsert(row.address, row.chain, row.seenAt);
	for (const row of recentCreators) upsert(row.address, null, row.seenAt);
	for (const row of signerWallets) upsert(row.address, row.chain, null);

	return Array.from(seen.values()).sort((a, b) => {
		if (!a.lastSeenAt && !b.lastSeenAt)
			return a.address.localeCompare(b.address);
		if (!a.lastSeenAt) return 1;
		if (!b.lastSeenAt) return -1;
		return b.lastSeenAt.localeCompare(a.lastSeenAt);
	});
}

export async function getOperatorStatus(db: Db, actor: WalletIdentity) {
	const owner = await getOwnerWallet();
	const featureStates = await getFeatureAccessStates(db, actor);
	const premiumEnabledCount = featureStates.filter(
		(feature) => !feature.oss && feature.effectiveEnabled,
	).length;

	return {
		deploymentMode: getDeploymentMode(),
		pdfUploadMaxMb: env.PDF_UPLOAD_MAX_MB,
		premiumRuntimeAvailable: isPremiumAvailable(),
		ownerWallet: owner,
		ownerConfigured: !!owner,
		isOwner: await isOwnerWallet(actor),
		canManageSelf: await canManageFeatureTarget(actor, actor),
		canManageOthers: (await isOwnerWallet(actor)) || isDevAdmin(),
		currentWallet: actor,
		enabledPremiumCount: premiumEnabledCount,
		featureStates,
	};
}

export async function getFeatureAccessForInput(
	db: Db,
	actor: WalletIdentity,
	targetAddress?: string,
	targetChain?: string | null,
) {
	const target = targetAddress
		? resolveWalletIdentity(targetAddress, targetChain)
		: actor;
	if (!(await canManageFeatureTarget(actor, target))) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "This wallet cannot inspect feature overrides for that user.",
		});
	}

	return {
		target,
		featureStates: await getFeatureAccessStates(db, target),
	};
}

export async function getFeatureAccessMap(
	db: Db,
	target: WalletIdentity,
	featureIds: FeatureId[],
): Promise<Map<FeatureId, FeatureAccessState>> {
	const states = await getFeatureAccessStates(db, target);
	const subset = states.filter((state) => inArraySafe(featureIds, state.id));
	return new Map(subset.map((state) => [state.id, state]));
}

function inArraySafe(values: readonly FeatureId[], value: FeatureId): boolean {
	return values.includes(value);
}
