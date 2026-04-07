import { TRPCError } from "@trpc/server";
import { resolveUnifiedRequestIdentity, type UnifiedRequestIdentity } from "~/server/auth/auth-identity";
import { isOwnerWallet, resolveWalletIdentity, type WalletIdentity } from "~/server/crypto/operator-access";
import { normalizeOwnerAddress } from "~/server/workspace/workspace";

type RequestLike = Request | Headers | { headers?: Headers | null | undefined } | null | undefined;

export type OwnedWalletContext = {
  identity: UnifiedRequestIdentity;
  wallets: WalletIdentity[];
  ownedAddresses: string[];
  primaryWallet: WalletIdentity | null;
  primaryOwnerAddress: string | null;
  activeWallet: WalletIdentity | null;
};

function dedupeWallets(wallets: WalletIdentity[]) {
  const seen = new Set<string>();
  return wallets.filter((wallet) => {
    const key = `${wallet.chain}:${wallet.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildOwnedWalletContext(identity: UnifiedRequestIdentity): OwnedWalletContext {
  const activeWallet = identity.walletSession
    ? resolveWalletIdentity(identity.walletSession.address, identity.walletSession.chain)
    : null;

  const wallets = dedupeWallets([
    ...(activeWallet ? [activeWallet] : []),
    ...identity.wallets.map((wallet) => resolveWalletIdentity(wallet.address, wallet.chain)),
  ]);

  return {
    identity,
    wallets,
    ownedAddresses: wallets.map((wallet) => normalizeOwnerAddress(wallet.address)),
    primaryWallet: wallets[0] ?? null,
    primaryOwnerAddress: wallets[0] ? normalizeOwnerAddress(wallets[0].address) : null,
    activeWallet,
  };
}

export async function getOwnedWalletContextFromRequest(request: RequestLike) {
  const identity = await resolveUnifiedRequestIdentity(request);
  if (!identity.authSession && !identity.walletSession) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Not signed in" });
  }

  return buildOwnedWalletContext(identity);
}

export function requireOwnedWalletActor(
  ownedWalletContext: OwnedWalletContext,
  message = "Link a wallet to this account before managing wallet-owned settings.",
) {
  const actor = ownedWalletContext.activeWallet ?? ownedWalletContext.primaryWallet;
  if (!actor) {
    throw new TRPCError({ code: "FORBIDDEN", message });
  }

  return actor;
}

export async function findOwnedOwnerWallet(ownedWalletContext: OwnedWalletContext) {
  for (const wallet of ownedWalletContext.wallets) {
    if (await isOwnerWallet(wallet)) {
      return wallet;
    }
  }

  return null;
}
