"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Link2, Loader2, Mail, Sparkles, Wallet, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { addressPreview } from "~/lib/chains";
import { useSession } from "~/lib/auth-client";
import { useWallet } from "~/components/wallet-provider";
import { GlassCard, W3SButton } from "~/components/ui/motion";

type IdentityStatus = {
  status: "anonymous" | "wallet-only" | "email-only" | "linked" | "linked-now" | "merge-required" | "merge-dismissed";
  authUser: {
    id: string;
    email: string;
    walletCount: number;
  } | null;
  wallet: {
    address: string;
    chain: string;
  } | null;
  mergeRequest: {
    id: string;
    conflictingUser: {
      email: string;
    };
  } | null;
};

async function readIdentityStatus() {
  const response = await fetch("/api/account-identity", {
    credentials: "include",
    cache: "no-store",
  });

  const payload = (await response.json()) as IdentityStatus | { error?: string };
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? "Failed to load account identity");
  }

  return payload as IdentityStatus;
}

async function mergeAccountsRequest() {
  const response = await fetch("/api/account-identity", {
    method: "POST",
    credentials: "include",
  });

  const payload = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to combine accounts");
  }

  return payload;
}

async function dismissMergePromptRequest() {
  const response = await fetch("/api/account-identity", {
    method: "DELETE",
    credentials: "include",
  });

  const payload = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to dismiss merge prompt");
  }

  return payload;
}

export function AccountMergeModal() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const wallet = useWallet();
  const { data: session } = useSession();

  const shouldCheckIdentity = Boolean(session?.user || wallet.authenticated || wallet.address);
  const identityQuery = useQuery({
    queryKey: ["account-identity"],
    queryFn: readIdentityStatus,
    enabled: shouldCheckIdentity,
    retry: false,
    refetchOnWindowFocus: true,
  });

  const dismissMutation = useMutation({
    mutationFn: dismissMergePromptRequest,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["account-identity"] });
    },
  });

  const mergeMutation = useMutation({
    mutationFn: mergeAccountsRequest,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["account-identity"] });
      router.refresh();
    },
  });

  const identity = identityQuery.data;
  const isOpen = identity?.status === "merge-required" && !!identity.mergeRequest;
  const walletSummary = identity?.wallet ? addressPreview(identity.wallet.address) : null;

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center px-4 py-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        >
          <motion.div
            className="pointer-events-auto absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.12),_transparent_42%),linear-gradient(180deg,rgba(2,6,23,0.72),rgba(2,6,23,0.88))] backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          <GlassCard
            hover={false}
            className="pointer-events-auto relative w-full max-w-2xl overflow-hidden border border-white/10 bg-slate-950/90 p-0 shadow-[0_40px_120px_rgba(15,23,42,0.55)]"
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(135deg,rgba(249,115,22,0.24),rgba(236,72,153,0.08),transparent)]" />

            <div className="relative space-y-6 p-6 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100">
                    <Sparkles className="h-3.5 w-3.5" />
                    Account Merge Suggested
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold tracking-tight text-white">
                      These logins look like the same person
                    </h2>
                    <p className="max-w-xl text-sm leading-6 text-slate-300">
                      Your signed-in email account and wallet are currently attached to different records. Combine them
                      once and the dashboard, reveal access, uploads, and signed document history will resolve through
                      one identity.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => dismissMutation.mutate()}
                  disabled={dismissMutation.isPending || mergeMutation.isPending}
                  className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Keep accounts separate"
                >
                  {dismissMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
                <div className="bg-sky-400/8 rounded-2xl border border-sky-400/15 p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-sky-100/80">
                    <Mail className="h-3.5 w-3.5" />
                    Current Account
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-white">
                      {identity?.authUser?.email ?? session?.user?.email ?? "Signed-in email"}
                    </p>
                    <p className="text-xs text-slate-300">
                      {identity?.authUser?.walletCount ?? 0} linked wallet
                      {identity?.authUser?.walletCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>

                <div className="hidden items-center justify-center md:flex">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/5 text-amber-100 shadow-[0_0_0_8px_rgba(15,23,42,0.28)]">
                    <Link2 className="h-4 w-4" />
                  </div>
                </div>

                <div className="bg-amber-300/8 rounded-2xl border border-amber-300/15 p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-100/85">
                    <Wallet className="h-3.5 w-3.5" />
                    Wallet Account
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-white">{walletSummary ?? "Connected wallet"}</p>
                    <p className="text-xs text-slate-300">
                      Currently linked to {identity?.mergeRequest?.conflictingUser.email ?? "another account"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-white/8 rounded-2xl border bg-white/5 p-4 text-sm leading-6 text-slate-300">
                If you merge these accounts, your email login will keep its profile and the wallet-linked history will
                be folded into it. Nothing is shared publicly; this only changes how Proofmark resolves your private
                access.
              </div>

              {mergeMutation.error ? (
                <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {mergeMutation.error.message}
                </div>
              ) : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <W3SButton
                  variant="ghost"
                  size="md"
                  onClick={() => dismissMutation.mutate()}
                  disabled={dismissMutation.isPending || mergeMutation.isPending}
                >
                  Keep Separate
                </W3SButton>
                <W3SButton
                  variant="primary"
                  size="md"
                  onClick={() => mergeMutation.mutate()}
                  loading={mergeMutation.isPending}
                  disabled={dismissMutation.isPending}
                  className="justify-center"
                >
                  {mergeMutation.isPending ? "Combining Accounts" : "Combine Accounts"}
                </W3SButton>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
