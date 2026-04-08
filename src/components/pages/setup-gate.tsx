"use client";

import { AlertTriangle, Check, Loader2, Shield } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useWallet, WalletButton } from "~/components/layout/wallet-provider";
import { AnimatedButton, GlassCard } from "~/components/ui/motion";
import { CHAIN_META } from "~/lib/crypto/chains";
import { trpc } from "~/lib/platform/trpc";

/**
 * Setup Gate — blocks the entire site until platform ownership is claimed.
 *
 * Flow:
 * 1. Checks setupStatus (public, no auth)
 * 2. If owner is configured → render children normally
 * 3. If no owner → show setup screen:
 *    a. Connect wallet
 *    b. Authenticate (sign challenge)
 *    c. Click "Claim Ownership" → signs a setup message → stores in DB
 *    d. Site unlocks
 */
export function SetupGate({ children }: { children: ReactNode }) {
  const setupQuery = trpc.account.setupStatus.useQuery(undefined, {
    retry: 2,
    staleTime: 30000,
  });

  // Still loading — show nothing (avoids flash)
  if (setupQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="border-accent/30 h-8 w-8 animate-spin rounded-full border-2 border-t-accent" />
      </div>
    );
  }

  // Error fetching status — let the site through (don't block on network issues)
  if (setupQuery.error) {
    return <>{children}</>;
  }

  // Owner is configured — site is unlocked
  if (setupQuery.data?.configured) {
    return <>{children}</>;
  }

  // No owner — show setup screen
  return <SetupScreen onComplete={() => setupQuery.refetch()} />;
}

function SetupScreen({ onComplete }: { onComplete: () => void }) {
  const { connected, authenticated, authenticating, address, chain } = useWallet();
  const claimMut = trpc.account.claimOwnership.useMutation({
    onSuccess: () => onComplete(),
  });
  const [step, setStep] = useState<"connect" | "claim" | "done">("connect");
  const [error, setError] = useState<string | null>(null);

  const handleClaim = async () => {
    if (!address || !chain) return;
    setError(null);
    setStep("claim");

    try {
      // The user already signed a challenge during authentication.
      // We use that session as proof of wallet ownership.
      // Store a claim signature string that includes the wallet + timestamp.
      const claimMessage = `proofmark-owner-claim:${address}:${chain}:${Date.now()}`;

      // For wallet-based signing, we need the wallet to sign.
      // Since the user is already authenticated (they signed the auth challenge),
      // we can use the auth session as proof. The signature field stores the claim context.
      await claimMut.mutateAsync({
        signature: claimMessage,
      });

      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to claim ownership");
      setStep("connect");
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="bg-accent/10 mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-accent">
            <Shield className="h-8 w-8" />
          </div>
          <h1 className="mt-4 text-2xl font-bold">Proofmark Setup</h1>
          <p className="mt-2 text-sm text-muted">
            Connect your wallet and sign to claim platform ownership. This wallet becomes the admin.
          </p>
        </div>

        {/* Steps */}
        <GlassCard className="space-y-6 p-6">
          {/* Step 1: Connect */}
          <div className="flex items-start gap-4">
            <StepIndicator number={1} active={!connected} done={connected} />
            <div className="flex-1">
              <p className="text-sm font-semibold">Connect Wallet</p>
              <p className="mt-0.5 text-xs text-muted">Connect the wallet that will be the platform owner.</p>
              {!connected && (
                <div className="mt-3">
                  <WalletButton />
                </div>
              )}
              {connected && address && chain && (
                <div className="mt-2 flex items-center gap-2 text-sm">
                  <span className="text-lg">{CHAIN_META[chain]?.icon ?? "?"}</span>
                  <span className="font-mono text-xs text-secondary">
                    {address.slice(0, 10)}...{address.slice(-6)}
                  </span>
                  <Check className="h-4 w-4 text-emerald-400" />
                </div>
              )}
            </div>
          </div>

          {/* Step 2: Authenticate */}
          <div className="flex items-start gap-4">
            <StepIndicator number={2} active={connected && !authenticated} done={authenticated} />
            <div className="flex-1">
              <p className="text-sm font-semibold">Authenticate</p>
              <p className="mt-0.5 text-xs text-muted">Sign a message to prove wallet ownership.</p>
              {connected && !authenticated && authenticating && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" /> Waiting for signature...
                </div>
              )}
              {authenticated && (
                <div className="mt-2 flex items-center gap-2 text-xs text-emerald-300">
                  <Check className="h-3 w-3" /> Wallet verified
                </div>
              )}
            </div>
          </div>

          {/* Step 3: Claim */}
          <div className="flex items-start gap-4">
            <StepIndicator number={3} active={authenticated && step !== "done"} done={step === "done"} />
            <div className="flex-1">
              <p className="text-sm font-semibold">Claim Ownership</p>
              <p className="mt-0.5 text-xs text-muted">This wallet will become the platform administrator.</p>
              {authenticated && step !== "done" && (
                <div className="mt-3">
                  <AnimatedButton className="px-4 py-2 text-sm" onClick={handleClaim} disabled={claimMut.isPending}>
                    {claimMut.isPending ? (
                      <>
                        <Loader2 className="mr-2 inline h-3 w-3 animate-spin" />
                        Claiming...
                      </>
                    ) : (
                      "Claim Platform Ownership"
                    )}
                  </AnimatedButton>
                </div>
              )}
              {step === "done" && (
                <div className="mt-2 flex items-center gap-2 text-xs text-emerald-300">
                  <Check className="h-3 w-3" /> Ownership claimed! Loading platform...
                </div>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
        </GlassCard>

        {/* Info */}
        <div className="text-center text-xs text-muted">
          <p>
            Ownership can also be set via the{" "}
            <code className="bg-surface/50 rounded px-1 py-0.5 font-mono text-[10px]">OWNER_ADDRESS</code> environment
            variable.
          </p>
          <p className="mt-1">The env var takes priority over DB claims if both are set.</p>
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ number, active, done }: { number: number; active: boolean; done: boolean }) {
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
        done
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
          : active
            ? "border-accent/30 bg-accent/10 text-accent"
            : "bg-surface/30 border-border text-muted"
      }`}
    >
      {done ? <Check className="h-4 w-4" /> : number}
    </div>
  );
}
