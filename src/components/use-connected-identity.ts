"use client";

/**
 * useConnectedIdentity — unified signed-in check for email + wallet auth.
 *
 * Components gate on `isSignedIn` (email OR wallet authenticated) for
 * read access, then check `currentWallet` when wallet-specific data is
 * needed. This avoids duplicating auth checks across every page.
 */

import { useMemo } from "react";
import { useSession } from "~/lib/auth-client";
import { useWallet } from "~/components/wallet-provider";

export function useConnectedIdentity() {
  const wallet = useWallet();
  const sessionQuery = useSession();
  const session = sessionQuery.data;
  const sessionPending = "isPending" in sessionQuery ? Boolean(sessionQuery.isPending) : false;

  const currentWallet =
    wallet.address && wallet.chain ? { address: wallet.address, chain: wallet.chain } : null;
  const isSignedIn = wallet.authenticated || Boolean(session?.user);
  const isLoading = wallet.authenticating || sessionPending;

  return useMemo(
    () => ({
      wallet,
      session,
      currentWallet,
      isSignedIn,
      isLoading,
    }),
    [wallet, session, currentWallet, isSignedIn, isLoading],
  );
}
