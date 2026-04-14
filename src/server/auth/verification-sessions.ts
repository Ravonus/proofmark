/**
 * Verification session management — stores and retrieves identity verifications
 * (social OAuth, wallet, email, IDV) with configurable expiry.
 */

import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "~/server/db";
import { signers, verificationSessions } from "~/server/db/schema";

/** Default session duration: 30 days */
const DEFAULT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

type Provider = "x" | "github" | "discord" | "google" | "email" | "wallet" | "idv";

export interface VerificationResult {
  identifier: string;
  provider: Provider;
  profileId?: string;
  displayName?: string;
  chain?: "ETH" | "SOL" | "BTC" | "BASE";
  metadata?: Record<string, unknown>;
}

/**
 * Store a verification session. Upserts — if an existing session for this
 * identifier+provider exists, it's updated with new timestamps.
 */
export async function storeVerificationSession(
  result: VerificationResult,
  expiryMs = DEFAULT_EXPIRY_MS,
): Promise<void> {
  const normalized = result.identifier.toLowerCase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryMs);

  try {
    // Try insert first
    await db
      .insert(verificationSessions)
      .values({
        identifier: normalized,
        provider: result.provider,
        profileId: result.profileId ?? null,
        displayName: result.displayName ?? null,
        verifiedAt: now,
        expiresAt,
        chain: result.chain ?? null,
        metadata: result.metadata ?? null,
      })
      .onConflictDoUpdate({
        target: [verificationSessions.identifier, verificationSessions.provider],
        set: {
          profileId: result.profileId ?? null,
          displayName: result.displayName ?? null,
          verifiedAt: now,
          expiresAt,
          chain: result.chain ?? null,
          metadata: result.metadata ?? null,
        },
      });
  } catch (e) {
    // Schema might not exist yet
    console.warn("[verification-sessions] Failed to store (run db:push?):", (e as Error).message);
  }
}

/**
 * Look up a valid (non-expired) verification session for an identifier.
 * Returns null if no valid session exists.
 */
export async function getVerificationSession(
  identifier: string,
  provider: Provider,
): Promise<typeof verificationSessions.$inferSelect | null> {
  try {
    const normalized = identifier.toLowerCase();
    const now = new Date();
    const [session] = await db
      .select()
      .from(verificationSessions)
      .where(
        and(
          eq(verificationSessions.identifier, normalized),
          eq(verificationSessions.provider, provider),
          gt(verificationSessions.expiresAt, now),
        ),
      )
      .limit(1);
    return session ?? null;
  } catch {
    return null;
  }
}

/**
 * Look up ALL valid verification sessions for an identifier (across all providers).
 */
export async function getVerificationSessionsForIdentifier(
  identifier: string,
): Promise<Array<typeof verificationSessions.$inferSelect>> {
  try {
    const normalized = identifier.toLowerCase();
    const now = new Date();
    return await db
      .select()
      .from(verificationSessions)
      .where(and(eq(verificationSessions.identifier, normalized), gt(verificationSessions.expiresAt, now)));
  } catch {
    return [];
  }
}

/**
 * Look up all valid sessions matching ANY of the given identifiers.
 * Useful for checking wallet address + email + social handle all at once.
 */
export async function getVerificationSessionsForIdentifiers(
  identifiers: string[],
): Promise<Array<typeof verificationSessions.$inferSelect>> {
  if (identifiers.length === 0) return [];
  try {
    const normalized = identifiers.map((id) => id.toLowerCase());
    const now = new Date();
    return await db
      .select()
      .from(verificationSessions)
      .where(and(inArray(verificationSessions.identifier, normalized), gt(verificationSessions.expiresAt, now)));
  } catch {
    return [];
  }
}

export async function getVerificationSessionsForActor(params: {
  userId?: string | null;
  walletAddresses?: string[] | null;
}): Promise<Array<typeof verificationSessions.$inferSelect>> {
  const walletAddresses = (params.walletAddresses ?? []).map((address) => address.trim().toLowerCase()).filter(Boolean);

  if (!params.userId && walletAddresses.length === 0) return [];

  try {
    const now = new Date();
    const actorClauses = [];

    if (params.userId) {
      actorClauses.push(sql`${verificationSessions.metadata}->>'userId' = ${params.userId}`);
    }

    for (const walletAddress of walletAddresses) {
      actorClauses.push(sql`${verificationSessions.metadata}->>'walletAddress' = ${walletAddress}`);
    }

    if (actorClauses.length === 0) return [];

    return await db
      .select()
      .from(verificationSessions)
      .where(and(or(...actorClauses), gt(verificationSessions.expiresAt, now)));
  } catch {
    return [];
  }
}

/**
 * Claim all signer records that match a user's verified identifiers.
 * Called when a user creates an account or logs in — retroactively links
 * their guest signing history to their account.
 *
 * Matches by: wallet address, email, or social verification username.
 */
export async function claimSignerDocuments(params: {
  userId: string;
  email?: string | null;
  walletAddress?: string | null;
  socialUsernames?: Array<{ provider: Provider; username: string }>;
}): Promise<{ claimedCount: number }> {
  const conditions: ReturnType<typeof eq>[] = [];

  if (params.email) {
    conditions.push(eq(signers.email, params.email.toLowerCase()));
  }
  if (params.walletAddress) {
    conditions.push(eq(signers.address, params.walletAddress.toLowerCase()));
  }

  if (conditions.length === 0 && (!params.socialUsernames || params.socialUsernames.length === 0)) {
    return { claimedCount: 0 };
  }

  try {
    let claimedCount = 0;

    // Claim by email / wallet address
    if (conditions.length > 0) {
      const result = await db
        .update(signers)
        .set({ userId: params.userId })
        .where(sql`${isNull(signers.userId)} AND (${conditions.reduce((a, b) => or(a, b)!)})`);
      claimedCount += (result as { rowCount?: number }).rowCount ?? 0;
    }

    // Claim by social verification username — find signers with matching
    // socialVerifications entries
    if (params.socialUsernames?.length) {
      for (const { username } of params.socialUsernames) {
        const normalized = username.toLowerCase();
        const result = await db
          .update(signers)
          .set({ userId: params.userId })
          .where(
            sql`${isNull(signers.userId)} AND ${signers.socialVerifications}::text ILIKE ${"%" + normalized + "%"}`,
          );
        claimedCount += (result as { rowCount?: number }).rowCount ?? 0;

        const requirementMatch = await db
          .update(signers)
          .set({ userId: params.userId })
          .where(sql`${isNull(signers.userId)} AND ${signers.fields}::text ILIKE ${"%" + normalized + "%"}`);
        claimedCount += (requirementMatch as { rowCount?: number }).rowCount ?? 0;
      }
    }

    if (claimedCount > 0) {
      console.warn(`[verification-sessions] Claimed ${claimedCount} signer(s) for user ${params.userId}`);
    }

    return { claimedCount };
  } catch (e) {
    console.warn("[verification-sessions] Failed to claim documents:", (e as Error).message);
    return { claimedCount: 0 };
  }
}
