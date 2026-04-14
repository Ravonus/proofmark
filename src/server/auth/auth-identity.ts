import { and, eq } from "drizzle-orm";
import { auth } from "~/server/auth/auth";
import { performAccountMerge } from "~/server/auth/auth-merge";
import { normalizeStoredWalletAddress, type StoredWalletChain } from "~/server/auth/wallet-identity";
import { getWalletSessionFromRequest } from "~/server/auth/wallet-session";
import { db } from "~/server/db";
import { accountMergeRequests, mergeRequestStatusEnum, users, userWallets, walletSessions } from "~/server/db/schema";

type RequestLike = Request | { headers?: Headers | null | undefined };
type BetterAuthSession = {
  session: {
    id: string;
    expiresAt: Date | string;
  };
  user: {
    id: string;
    email: string;
    name?: string | null;
    emailVerified?: boolean;
    image?: string | null;
  };
};

type UserSummary = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
  walletCount: number;
};

export type UnifiedRequestIdentity = {
  authSession: BetterAuthSession | null;
  walletSession: Awaited<ReturnType<typeof getWalletSessionFromRequest>> | null;
  userId: string | null;
  email: string | null;
  wallets: Array<{
    address: string;
    chain: StoredWalletChain;
    isPrimary: boolean;
  }>;
  walletAddressSet: Set<string>;
  currentUser: UserSummary | null;
};

export type IdentitySyncResult = {
  status: "anonymous" | "wallet-only" | "email-only" | "linked" | "linked-now" | "merge-required" | "merge-dismissed";
  authUser: UserSummary | null;
  wallet: { address: string; chain: StoredWalletChain } | null;
  linkedWallets: Array<{
    address: string;
    chain: StoredWalletChain;
    isPrimary: boolean;
  }>;
  mergeRequest: {
    id: string;
    reason: string | null;
    conflictingUser: UserSummary;
    wallet: { address: string; chain: StoredWalletChain };
  } | null;
};

function getHeaders(input: RequestLike | Headers | null | undefined): Headers | null {
  if (!input) return null;
  if (input instanceof Headers) return input;
  if (typeof Request !== "undefined" && input instanceof Request) return input.headers;
  return input.headers ?? null;
}

function buildSessionHeaders(input: RequestLike | Headers | null | undefined) {
  const headers = getHeaders(input);
  if (!headers) return null;

  const normalized = new Headers(headers);
  const requestUrl = typeof Request !== "undefined" && input instanceof Request ? new URL(input.url) : null;
  const host =
    headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    headers.get("host") ??
    requestUrl?.host ??
    null;
  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    requestUrl?.protocol.replace(":", "") ??
    (host?.includes("localhost") || host?.includes("127.0.0.1") ? "http" : "https");
  const origin = headers.get("origin") ?? (host ? `${proto}://${host}` : requestUrl?.origin ?? null);

  if (host && !normalized.has("host")) {
    normalized.set("host", host);
  }

  if (origin && !normalized.has("origin")) {
    normalized.set("origin", origin);
  }

  return normalized;
}

export async function getBetterAuthSessionFromHeaders(headersInput: RequestLike | Headers | null | undefined) {
  const headers = buildSessionHeaders(headersInput);
  if (!headers) return null;

  try {
    const session = (await auth.api.getSession({
      headers,
    })) as BetterAuthSession | null;
    if (!session?.user?.id || !session.user.email) return null;
    return session;
  } catch {
    return null;
  }
}

async function getUserWalletCount(userId: string) {
  const links = await db.select({ id: userWallets.id }).from(userWallets).where(eq(userWallets.userId, userId));
  if (links.length > 0) return links.length;

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user?.walletAddress ? 1 : 0;
}

async function toUserSummary(user: typeof users.$inferSelect): Promise<UserSummary> {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    emailVerified: user.emailVerified,
    image: user.image ?? null,
    walletCount: await getUserWalletCount(user.id),
  };
}

export async function listUserWallets(userId: string) {
  const linkedWallets = await db
    .select({
      address: userWallets.address,
      chain: userWallets.chain,
      isPrimary: userWallets.isPrimary,
    })
    .from(userWallets)
    .where(eq(userWallets.userId, userId));

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.walletAddress || !user.walletChain) {
    return linkedWallets;
  }

  const normalizedPrimary = normalizeStoredWalletAddress(user.walletChain, user.walletAddress);
  if (linkedWallets.some((wallet) => wallet.address === normalizedPrimary && wallet.chain === user.walletChain)) {
    return linkedWallets;
  }

  return [
    {
      address: normalizedPrimary,
      chain: user.walletChain,
      isPrimary: true,
    },
    ...linkedWallets,
  ];
}

export async function findUserByWallet(params: { address: string; chain: StoredWalletChain }) {
  const normalizedAddress = normalizeStoredWalletAddress(params.chain, params.address);

  const [walletLink] = await db
    .select()
    .from(userWallets)
    .where(and(eq(userWallets.address, normalizedAddress), eq(userWallets.chain, params.chain)))
    .limit(1);

  if (walletLink) {
    const [user] = await db.select().from(users).where(eq(users.id, walletLink.userId)).limit(1);
    if (user) {
      return { user, walletLink };
    }
  }

  const [legacyUser] = await db
    .select()
    .from(users)
    .where(and(eq(users.walletAddress, normalizedAddress), eq(users.walletChain, params.chain)))
    .limit(1);

  if (!legacyUser) return null;
  return { user: legacyUser, walletLink: null };
}

async function setUserPrimaryWallet(params: { userId: string; address: string; chain: StoredWalletChain }) {
  const normalizedAddress = normalizeStoredWalletAddress(params.chain, params.address);
  const [user] = await db.select().from(users).where(eq(users.id, params.userId)).limit(1);
  if (!user) throw new Error("User not found");

  const shouldUpdatePrimary = !user.walletAddress || !user.walletChain;
  if (!shouldUpdatePrimary) return;

  await db
    .update(users)
    .set({
      walletAddress: normalizedAddress,
      walletChain: params.chain,
      updatedAt: new Date(),
    })
    .where(eq(users.id, params.userId));
}

export async function linkWalletToUser(params: { userId: string; address: string; chain: StoredWalletChain }) {
  const normalizedAddress = normalizeStoredWalletAddress(params.chain, params.address);
  const existing = await findUserByWallet({
    address: normalizedAddress,
    chain: params.chain,
  });

  if (existing && existing.user.id !== params.userId) {
    return { linked: false as const, conflictingUser: existing.user };
  }

  const now = new Date();
  await db
    .insert(userWallets)
    .values({
      userId: params.userId,
      address: normalizedAddress,
      chain: params.chain,
      isPrimary: false,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [userWallets.chain, userWallets.address],
      set: {
        userId: params.userId,
        updatedAt: now,
        verifiedAt: now,
      },
    });

  await setUserPrimaryWallet({
    userId: params.userId,
    address: normalizedAddress,
    chain: params.chain,
  });

  return { linked: true as const, conflictingUser: null };
}

export async function createOrUpdateMergeRequest(params: {
  currentUserId: string;
  conflictingUserId: string;
  walletAddress: string;
  walletChain: StoredWalletChain;
  email?: string | null;
  reason?: string | null;
  reactivate?: boolean;
}) {
  const normalizedAddress = normalizeStoredWalletAddress(params.walletChain, params.walletAddress);
  const now = new Date();

  const [existingMergeRequest] = await db
    .select()
    .from(accountMergeRequests)
    .where(
      and(
        eq(accountMergeRequests.currentUserId, params.currentUserId),
        eq(accountMergeRequests.conflictingUserId, params.conflictingUserId),
        eq(accountMergeRequests.walletChain, params.walletChain),
        eq(accountMergeRequests.walletAddress, normalizedAddress),
      ),
    )
    .limit(1);

  if (existingMergeRequest?.status === "DISMISSED" && !params.reactivate) {
    return existingMergeRequest;
  }

  await db
    .insert(accountMergeRequests)
    .values({
      currentUserId: params.currentUserId,
      conflictingUserId: params.conflictingUserId,
      walletAddress: normalizedAddress,
      walletChain: params.walletChain,
      email: params.email ?? null,
      reason: params.reason ?? null,
      status: mergeRequestStatusEnum.enumValues[0],
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        accountMergeRequests.currentUserId,
        accountMergeRequests.conflictingUserId,
        accountMergeRequests.walletChain,
        accountMergeRequests.walletAddress,
      ],
      set: {
        email: params.email ?? null,
        reason: params.reason ?? null,
        status: "PENDING",
        updatedAt: now,
        resolvedAt: null,
      },
    });

  const [mergeRequest] = await db
    .select()
    .from(accountMergeRequests)
    .where(
      and(
        eq(accountMergeRequests.currentUserId, params.currentUserId),
        eq(accountMergeRequests.conflictingUserId, params.conflictingUserId),
        eq(accountMergeRequests.walletChain, params.walletChain),
        eq(accountMergeRequests.walletAddress, normalizedAddress),
      ),
    )
    .limit(1);

  if (!mergeRequest) {
    throw new Error("Failed to create merge request");
  }

  return mergeRequest;
}

export async function dismissMergeRequest(params: {
  currentUserId: string;
  conflictingUserId: string;
  walletAddress: string;
  walletChain: StoredWalletChain;
}) {
  const normalizedAddress = normalizeStoredWalletAddress(params.walletChain, params.walletAddress);
  await db
    .update(accountMergeRequests)
    .set({
      status: "DISMISSED",
      updatedAt: new Date(),
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(accountMergeRequests.currentUserId, params.currentUserId),
        eq(accountMergeRequests.conflictingUserId, params.conflictingUserId),
        eq(accountMergeRequests.walletChain, params.walletChain),
        eq(accountMergeRequests.walletAddress, normalizedAddress),
      ),
    );
}

export async function resolveUnifiedRequestIdentity(
  request: RequestLike | Headers | null | undefined,
): Promise<UnifiedRequestIdentity> {
  const headers = getHeaders(request);
  const authSession = await getBetterAuthSessionFromHeaders(headers);
  const walletSession = headers
    ? await getWalletSessionFromRequest(new Request("http://localhost", { headers }))
    : null;

  const userId = authSession?.user.id ?? walletSession?.userId ?? null;
  const email = authSession?.user.email?.toLowerCase() ?? null;

  let currentUser: UserSummary | null = null;
  if (authSession?.user.id) {
    const [user] = await db.select().from(users).where(eq(users.id, authSession.user.id)).limit(1);
    if (user) currentUser = await toUserSummary(user);
  } else if (walletSession?.userId) {
    const [user] = await db.select().from(users).where(eq(users.id, walletSession.userId)).limit(1);
    if (user) currentUser = await toUserSummary(user);
  }

  let wallets = userId ? await listUserWallets(userId) : [];
  if (walletSession) {
    const normalizedWalletAddress = normalizeStoredWalletAddress(walletSession.chain, walletSession.address);
    if (!wallets.some((wallet) => wallet.address === normalizedWalletAddress && wallet.chain === walletSession.chain)) {
      wallets = [
        {
          address: normalizedWalletAddress,
          chain: walletSession.chain,
          isPrimary: wallets.length === 0,
        },
        ...wallets,
      ];
    }
  }

  return {
    authSession,
    walletSession,
    userId,
    email,
    wallets,
    walletAddressSet: new Set(wallets.map((wallet) => wallet.address.toLowerCase())),
    currentUser,
  };
}

export async function syncCurrentIdentityFromRequest(
  request: RequestLike | Headers | null | undefined,
): Promise<IdentitySyncResult> {
  const headers = getHeaders(request);
  const identity = await resolveUnifiedRequestIdentity(headers);
  const wallet = identity.walletSession
    ? {
        address: normalizeStoredWalletAddress(identity.walletSession.chain, identity.walletSession.address),
        chain: identity.walletSession.chain,
      }
    : null;

  if (!identity.authSession && !wallet) {
    return {
      status: "anonymous",
      authUser: null,
      wallet: null,
      linkedWallets: [],
      mergeRequest: null,
    };
  }

  if (!identity.authSession && wallet) {
    return {
      status: "wallet-only",
      authUser: identity.currentUser,
      wallet,
      linkedWallets: identity.wallets,
      mergeRequest: null,
    };
  }

  if (!identity.authSession) {
    return {
      status: "anonymous",
      authUser: null,
      wallet: null,
      linkedWallets: [],
      mergeRequest: null,
    };
  }

  if (!wallet) {
    return {
      status: "email-only",
      authUser: identity.currentUser,
      wallet: null,
      linkedWallets: identity.wallets,
      mergeRequest: null,
    };
  }

  const walletOwner = await findUserByWallet(wallet);
  if (!walletOwner) {
    await linkWalletToUser({
      userId: identity.authSession.user.id,
      address: wallet.address,
      chain: wallet.chain,
    });
    if (identity.walletSession) {
      await db
        .update(walletSessions)
        .set({ userId: identity.authSession.user.id })
        .where(eq(walletSessions.id, identity.walletSession.id));
    }

    const refreshed = await resolveUnifiedRequestIdentity(headers);
    return {
      status: "linked-now",
      authUser: refreshed.currentUser,
      wallet,
      linkedWallets: refreshed.wallets,
      mergeRequest: null,
    };
  }

  if (walletOwner.user.id === identity.authSession.user.id) {
    if (identity.walletSession && identity.walletSession.userId !== identity.authSession.user.id) {
      await db
        .update(walletSessions)
        .set({ userId: identity.authSession.user.id })
        .where(eq(walletSessions.id, identity.walletSession.id));
    }

    const refreshed = await resolveUnifiedRequestIdentity(headers);
    return {
      status: "linked",
      authUser: refreshed.currentUser,
      wallet,
      linkedWallets: refreshed.wallets,
      mergeRequest: null,
    };
  }

  const mergeRequest = await createOrUpdateMergeRequest({
    currentUserId: identity.authSession.user.id,
    conflictingUserId: walletOwner.user.id,
    walletAddress: wallet.address,
    walletChain: wallet.chain,
    email: identity.authSession.user.email,
    reason: "This wallet is already attached to a different account.",
  });

  const mergeStatus = mergeRequest.status === "DISMISSED" ? "merge-dismissed" : "merge-required";

  return {
    status: mergeStatus,
    authUser: identity.currentUser,
    wallet,
    linkedWallets: identity.wallets,
    mergeRequest: {
      id: mergeRequest.id,
      reason: mergeRequest.reason ?? null,
      conflictingUser: await toUserSummary(walletOwner.user),
      wallet,
    },
  };
}

export async function mergeCurrentIdentityAccounts(request: RequestLike | Headers | null | undefined) {
  const headers = getHeaders(request);
  if (!headers) throw new Error("Missing request headers");

  const identity = await resolveUnifiedRequestIdentity(headers);
  if (!identity.authSession || !identity.walletSession) {
    throw new Error("Both an email session and a wallet session are required to combine accounts");
  }

  const wallet = {
    address: normalizeStoredWalletAddress(identity.walletSession.chain, identity.walletSession.address),
    chain: identity.walletSession.chain,
  };

  const walletOwner = await findUserByWallet(wallet);
  if (!walletOwner) {
    await linkWalletToUser({
      userId: identity.authSession.user.id,
      address: wallet.address,
      chain: wallet.chain,
    });
    await db
      .update(walletSessions)
      .set({ userId: identity.authSession.user.id })
      .where(eq(walletSessions.id, identity.walletSession.id));
    return { merged: false, linked: true };
  }

  if (walletOwner.user.id === identity.authSession.user.id) {
    await db
      .update(walletSessions)
      .set({ userId: identity.authSession.user.id })
      .where(eq(walletSessions.id, identity.walletSession.id));
    return { merged: false, linked: true };
  }

  const primaryUserId = identity.authSession.user.id;
  const secondaryUserId = walletOwner.user.id;

  await performAccountMerge({
    primaryUserId,
    secondaryUserId,
    wallet,
    walletSessionId: identity.walletSession.id,
  });

  await linkWalletToUser({
    userId: primaryUserId,
    address: wallet.address,
    chain: wallet.chain,
  });

  return { merged: true, linked: true };
}
