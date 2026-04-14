"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useWallet } from "~/components/layout/wallet-provider";
import { useSession } from "~/lib/auth/auth-client";

function isLocalhostWindow() {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="border-accent/30 h-8 w-8 animate-spin rounded-full border-2 border-t-accent" />
    </div>
  );
}

export function LocalhostAutoLogin({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const sessionQuery = useSession();
  const sessionPending = "isPending" in sessionQuery ? Boolean(sessionQuery.isPending) : false;
  const attemptedRef = useRef(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const enabled = isLocalhostWindow();

  useEffect(() => {
    if (!enabled || attemptedRef.current || sessionPending || sessionQuery.data?.user || wallet.authenticated) return;

    attemptedRef.current = true;
    setBootstrapping(true);

    const bootstrap = async () => {
      const response = await fetch("/api/dev/auto-login", {
        method: "POST",
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Auto-login failed with status ${response.status}`);
      }

      window.location.reload();
    };

    void bootstrap().catch(() => {
      setBootstrapping(false);
    });
  }, [enabled, sessionPending, sessionQuery.data?.user, wallet.authenticated]);

  useEffect(() => {
    if (sessionQuery.data?.user || wallet.authenticated) {
      setBootstrapping(false);
    }
  }, [sessionQuery.data?.user, wallet.authenticated]);

  const showBootScreen = enabled && !wallet.authenticated && !sessionQuery.data?.user && (sessionPending || bootstrapping || !attemptedRef.current);

  if (showBootScreen) {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
