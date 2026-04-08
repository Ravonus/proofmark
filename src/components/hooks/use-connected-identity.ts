"use client";

/**
 * useConnectedIdentity — unified signed-in check for email + wallet auth.
 *
 * Components gate on `isSignedIn` (email OR wallet authenticated) for
 * read access, then check `currentWallet` when wallet-specific data is
 * needed. This avoids duplicating auth checks across every page.
 */

import { useMemo } from "react";
import { useWallet } from "~/components/layout/wallet-provider";
import { useSession } from "~/lib/auth/auth-client";

export function useConnectedIdentity() {
  const wallet = useWallet();
  const sessionQuery = useSession();
  const session = sessionQuery.data;
  const sessionPending = "isPending" in sessionQuery ? Boolean(sessionQuery.isPending) : false;

  const isSignedIn = wallet.authenticated || Boolean(session?.user);
  const isLoading = wallet.authenticating || sessionPending;

  return useMemo(
    () => ({
      wallet,
      session,
      currentWallet: wallet.address && wallet.chain ? { address: wallet.address, chain: wallet.chain } : null,
      isSignedIn,
      isLoading,
    }),
    [wallet, session, isSignedIn, isLoading],
  );
}
