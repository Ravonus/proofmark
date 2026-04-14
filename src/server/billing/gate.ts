/**
 * Billing gates — enforce plan limits before allowing resource creation.
 */

import { TRPCError } from "@trpc/server";
import {
	checkFreeTierLimit,
	checkUsageLimit,
	getActiveSubscription,
	incrementUsage,
} from "./usage";

/**
 * Check if a user/wallet can create another document this period.
 * Throws FORBIDDEN with upgrade message if limit is exceeded.
 * Increments usage counter on success.
 */
export async function checkDocumentCreationLimit(
	userId: string | undefined,
	walletAddress: string,
): Promise<void> {
	try {
		const sub = await getActiveSubscription({
			userId,
			walletAddress,
		});

		if (sub) {
			// Paid plan — check plan limits
			const result = await checkUsageLimit(sub.id, "documents_created");
			if (!result.allowed) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: `Document limit reached (${result.current}/${result.limit} this period). Upgrade your plan for more.`,
				});
			}
			// Increment usage
			await incrementUsage(sub.id, "documents_created");
			return;
		}

		// Free tier — check free limits
		const freeResult = await checkFreeTierLimit(
			userId,
			walletAddress,
			"documents_created",
		);
		if (!freeResult.allowed) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: `Free tier limit reached (${freeResult.current}/${freeResult.limit} documents per month). Upgrade to a paid plan to continue.`,
			});
		}
	} catch (error) {
		// Re-throw TRPCErrors (our limit errors)
		if (error instanceof TRPCError) throw error;
		// Swallow billing system errors — don't block document creation if billing is broken
	}
}

/**
 * Check if a user/wallet can make another AI call this period.
 */
export async function checkAiCallLimit(
	userId: string | undefined,
	walletAddress: string,
): Promise<void> {
	try {
		const sub = await getActiveSubscription({ userId, walletAddress });

		if (sub) {
			const result = await checkUsageLimit(sub.id, "ai_calls");
			if (!result.allowed) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message: `AI call limit reached (${result.current}/${result.limit} this period). Upgrade your plan for more.`,
				});
			}
			await incrementUsage(sub.id, "ai_calls");
			return;
		}

		const freeResult = await checkFreeTierLimit(
			userId,
			walletAddress,
			"ai_calls",
		);
		if (!freeResult.allowed) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: `Free tier AI limit reached (${freeResult.current}/${freeResult.limit} calls per month). Upgrade to continue.`,
			});
		}
	} catch (error) {
		if (error instanceof TRPCError) throw error;
	}
}
