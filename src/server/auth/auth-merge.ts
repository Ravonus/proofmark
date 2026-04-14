/**
 * Account merge logic extracted from auth-identity.ts
 * to keep file length under the 650-line Biome threshold.
 */

import { and, eq, or } from "drizzle-orm";
import { type StoredWalletChain } from "~/server/auth/wallet-identity";
import { db } from "~/server/db";
import {
  accountMergeRequests,
  accounts,
  aiRateLimits,
  aiUsageLogs,
  connectorAccessTokens,
  connectorSessions,
  managedWallets,
  signers,
  users,
  userVaults,
  userWallets,
  walletSessions,
} from "~/server/db/schema";

type TxClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function validateMergePreConditions(tx: TxClient, primaryUserId: string, secondaryUserId: string) {
  const [primaryUser] = await tx.select().from(users).where(eq(users.id, primaryUserId)).limit(1);
  const [secondaryUser] = await tx.select().from(users).where(eq(users.id, secondaryUserId)).limit(1);

  if (!primaryUser || !secondaryUser) {
    throw new Error("One of the accounts could not be found");
  }

  const primaryVaults = await tx.select().from(userVaults).where(eq(userVaults.userId, primaryUserId));
  const secondaryVaults = await tx.select().from(userVaults).where(eq(userVaults.userId, secondaryUserId));
  if (secondaryVaults.some((vault) => primaryVaults.some((existing) => existing.unlockMethod === vault.unlockMethod))) {
    throw new Error("Merge blocked because both accounts already have vault credentials configured");
  }

  const primaryManagedWallets = await tx.select().from(managedWallets).where(eq(managedWallets.userId, primaryUserId));
  const secondaryManagedWallets = await tx
    .select()
    .from(managedWallets)
    .where(eq(managedWallets.userId, secondaryUserId));
  if (
    secondaryManagedWallets.some((managed) =>
      primaryManagedWallets.some((existing) => existing.chain === managed.chain),
    )
  ) {
    throw new Error("Merge blocked because both accounts already have managed wallets on the same chain");
  }

  return { primaryUser, secondaryUser };
}

async function reassignOwnership(tx: TxClient, primaryUserId: string, secondaryUserId: string) {
  await tx
    .update(accounts)
    .set({ userId: primaryUserId, updatedAt: new Date() })
    .where(eq(accounts.userId, secondaryUserId));
  await tx.update(userVaults).set({ userId: primaryUserId }).where(eq(userVaults.userId, secondaryUserId));
  await tx.update(managedWallets).set({ userId: primaryUserId }).where(eq(managedWallets.userId, secondaryUserId));
  await tx.update(signers).set({ userId: primaryUserId }).where(eq(signers.userId, secondaryUserId));
  await tx
    .update(aiRateLimits)
    .set({ userId: primaryUserId, updatedAt: new Date() })
    .where(eq(aiRateLimits.userId, secondaryUserId));
  await tx.update(aiUsageLogs).set({ userId: primaryUserId }).where(eq(aiUsageLogs.userId, secondaryUserId));
  await tx
    .update(connectorSessions)
    .set({ userId: primaryUserId, updatedAt: new Date() })
    .where(eq(connectorSessions.userId, secondaryUserId));
  await tx
    .update(connectorAccessTokens)
    .set({ userId: primaryUserId })
    .where(eq(connectorAccessTokens.userId, secondaryUserId));
  await tx.update(walletSessions).set({ userId: primaryUserId }).where(eq(walletSessions.userId, secondaryUserId));
}

async function mergeWalletLinks(tx: TxClient, primaryUserId: string, secondaryUserId: string) {
  const secondaryWalletLinks = await tx.select().from(userWallets).where(eq(userWallets.userId, secondaryUserId));
  const primaryWalletLinks = await tx.select().from(userWallets).where(eq(userWallets.userId, primaryUserId));

  for (const link of secondaryWalletLinks) {
    const duplicate = primaryWalletLinks.some(
      (existing) => existing.address === link.address && existing.chain === link.chain,
    );
    if (duplicate) {
      await tx.delete(userWallets).where(eq(userWallets.id, link.id));
      continue;
    }
    await tx
      .update(userWallets)
      .set({ userId: primaryUserId, updatedAt: new Date(), isPrimary: false })
      .where(eq(userWallets.id, link.id));
  }
}

async function executeMergeTransaction(
  tx: TxClient,
  primaryUserId: string,
  secondaryUserId: string,
  wallet: { address: string; chain: StoredWalletChain },
) {
  const { primaryUser, secondaryUser } = await validateMergePreConditions(tx, primaryUserId, secondaryUserId);

  await reassignOwnership(tx, primaryUserId, secondaryUserId);
  await mergeWalletLinks(tx, primaryUserId, secondaryUserId);

  const nextPrimaryWalletAddress = primaryUser.walletAddress ?? secondaryUser.walletAddress ?? wallet.address;
  const nextPrimaryWalletChain = primaryUser.walletChain ?? secondaryUser.walletChain ?? wallet.chain;

  await tx
    .update(users)
    .set({
      name: primaryUser.name ?? secondaryUser.name ?? null,
      image: primaryUser.image ?? secondaryUser.image ?? null,
      walletAddress: nextPrimaryWalletAddress,
      walletChain: nextPrimaryWalletChain,
      updatedAt: new Date(),
    })
    .where(eq(users.id, primaryUserId));

  await tx
    .update(accountMergeRequests)
    .set({
      status: "MERGED",
      updatedAt: new Date(),
      resolvedAt: new Date(),
    })
    .where(
      or(
        and(
          eq(accountMergeRequests.currentUserId, primaryUserId),
          eq(accountMergeRequests.conflictingUserId, secondaryUserId),
        ),
        and(
          eq(accountMergeRequests.currentUserId, secondaryUserId),
          eq(accountMergeRequests.conflictingUserId, primaryUserId),
        ),
      ),
    );

  await tx.delete(users).where(eq(users.id, secondaryUserId));
}

// Re-uses types and helpers from auth-identity via parameters
export async function performAccountMerge(params: {
  primaryUserId: string;
  secondaryUserId: string;
  wallet: { address: string; chain: StoredWalletChain };
  walletSessionId: string;
}) {
  await db.transaction(async (tx) => {
    await executeMergeTransaction(tx, params.primaryUserId, params.secondaryUserId, params.wallet);
  });

  await db
    .update(walletSessions)
    .set({ userId: params.primaryUserId })
    .where(eq(walletSessions.id, params.walletSessionId));
}
