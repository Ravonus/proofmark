"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Wallet, Shield, ArrowRight, Loader2, Sparkles, Eye, EyeOff, Globe } from "lucide-react";
import { useRouter } from "next/navigation";
import { signIn, signUp, useSession } from "~/lib/auth-client";
import { useWallet } from "~/components/wallet-provider";
import { CHAIN_META, addressPreview } from "~/lib/chains";
import { trpc } from "~/lib/trpc";
import { FadeIn, GlassCard } from "~/components/ui/motion";

type AuthTab = "email" | "magic" | "wallet" | "sso";

const TAB_CONFIG: { id: AuthTab; label: string; icon: typeof Mail }[] = [
  { id: "email", label: "Email", icon: Mail },
  { id: "magic", label: "Magic Link", icon: Sparkles },
  { id: "wallet", label: "Wallet", icon: Wallet },
  { id: "sso", label: "SSO", icon: Globe },
];

const SSO_META: Record<string, { label: string; color: string }> = {
  google: { label: "Google", color: "#4285F4" },
  github: { label: "GitHub", color: "#8b5cf6" },
  microsoft: { label: "Microsoft", color: "#00a4ef" },
  okta: { label: "Okta", color: "#007dc1" },
};

export default function LoginPage() {
  const router = useRouter();
  const [tab, setTab] = useState<AuthTab>("email");
  const [isSignUp, setIsSignUp] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [needs2FA, setNeeds2FA] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  const providersQuery = trpc.auth.providers.useQuery();
  const ssoProviders = providersQuery.data?.sso ?? [];

  const wallet = useWallet();
  const { data: session } = useSession();

  useEffect(() => {
    if (wallet.authenticated || session?.user) {
      router.replace("/dashboard");
    }
  }, [wallet.authenticated, session?.user, router]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (isSignUp) {
        const res = await signUp.email({ email, password, name: name || (email.split("@")[0] ?? "") });
        if (res.error) throw new Error(res.error.message ?? "Sign up failed");
        setSuccess("Check your email for a verification link.");
      } else {
        const res = await signIn.email({ email, password });
        if (res.error) {
          if (res.error.message?.includes("two-factor")) {
            setNeeds2FA(true);
          } else {
            throw new Error(res.error.message ?? "Sign in failed");
          }
        } else {
          router.push("/dashboard");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const res = await signIn.magicLink({ email });
      if (res.error) throw new Error(res.error.message ?? "Failed to send magic link");
      setSuccess("Magic link sent! Check your email.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send magic link");
    } finally {
      setLoading(false);
    }
  };

  const handle2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await signIn.email({ email, password });
      if (res.error) throw new Error(res.error.message ?? "2FA verification failed");
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "2FA verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSSO = async (providerId: string) => {
    setError(null);
    try {
      await signIn.social({ provider: providerId, callbackURL: "/dashboard" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "SSO sign-in failed");
    }
  };

  const visibleTabs = TAB_CONFIG.filter((t) => {
    if (t.id === "sso" && ssoProviders.length === 0) return false;
    return true;
  });

  return (
    <FadeIn className="flex min-h-[80vh] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <motion.div className="mb-6 text-center" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="gradient-text mb-1 text-xl font-semibold">Welcome to Proofmark</h1>
          <p className="text-[12px] text-secondary">Sign in to create and manage your documents</p>
        </motion.div>

        <GlassCard className="rounded-lg p-5">
          {/* Tab selector */}
          <div className="mb-5 flex border-b border-[var(--border)]">
            {visibleTabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTab(t.id);
                    setError(null);
                    setSuccess(null);
                  }}
                  className={`relative flex flex-1 items-center justify-center gap-1 px-2 py-2 text-[10px] font-medium transition-colors ${
                    active ? "text-primary" : "text-muted hover:text-secondary"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  <span className="hidden sm:inline">{t.label}</span>
                  {active && (
                    <motion.span
                      layoutId="auth-tab"
                      className="absolute inset-x-0 -bottom-px h-px bg-[var(--accent)]"
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <AnimatePresence mode="wait">
            {/* Email/Password */}
            {tab === "email" && !needs2FA && (
              <motion.form
                key="email"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
                onSubmit={handleEmailAuth}
                className="space-y-3"
              >
                {isSignUp && (
                  <div>
                    <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-muted">
                      Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full rounded-sm border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-2 text-[12px] text-primary transition-colors placeholder:text-muted focus:border-[var(--accent)] focus:outline-none"
                      placeholder="Your name"
                    />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-muted">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-2 text-[12px] text-primary transition-colors placeholder:text-muted focus:border-[var(--accent)] focus:outline-none"
                    placeholder="you@example.com"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-muted">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      className="w-full rounded-sm border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-2 pr-8 text-[12px] text-primary transition-colors placeholder:text-muted focus:border-[var(--accent)] focus:outline-none"
                      placeholder="Min 8 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-secondary"
                    >
                      {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-1.5 rounded-sm bg-[var(--accent)] px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
                  {isSignUp ? "Create Account" : "Sign In"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(!isSignUp);
                    setError(null);
                    setSuccess(null);
                  }}
                  className="w-full text-center text-[10px] text-muted transition-colors hover:text-secondary"
                >
                  {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
                </button>
              </motion.form>
            )}

            {/* 2FA */}
            {tab === "email" && needs2FA && (
              <motion.form
                key="2fa"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
                onSubmit={handle2FA}
                className="space-y-3"
              >
                <div className="mb-2 flex items-center gap-1.5 text-accent">
                  <Shield className="h-4 w-4" />
                  <p className="text-[12px] font-medium">Two-Factor Authentication</p>
                </div>
                <p className="text-[10px] text-secondary">Enter the 6-digit code from your authenticator app.</p>
                <input
                  type="text"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  maxLength={6}
                  className="w-full rounded-sm border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-2.5 text-center font-mono text-base tracking-[0.4em] text-primary transition-colors placeholder:text-muted focus:border-[var(--accent)] focus:outline-none"
                  placeholder="000000"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={loading || totpCode.length !== 6}
                  className="flex w-full items-center justify-center gap-1.5 rounded-sm bg-[var(--accent)] px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                  Verify
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNeeds2FA(false);
                    setTotpCode("");
                  }}
                  className="w-full text-center text-[10px] text-muted transition-colors hover:text-secondary"
                >
                  Back to sign in
                </button>
              </motion.form>
            )}

            {/* Magic Link */}
            {tab === "magic" && (
              <motion.form
                key="magic"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
                onSubmit={handleMagicLink}
                className="space-y-3"
              >
                <p className="text-[10px] text-secondary">
                  Enter your email and we&apos;ll send you a sign-in link. No password needed.
                </p>
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-muted">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full rounded-sm border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-2 text-[12px] text-primary transition-colors placeholder:text-muted focus:border-[var(--accent)] focus:outline-none"
                    placeholder="you@example.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-1.5 rounded-sm bg-[var(--accent)] px-3 py-2 text-[11px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Send Magic Link
                </button>
              </motion.form>
            )}

            {/* Wallet */}
            {tab === "wallet" && (
              <motion.div
                key="wallet"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
                className="space-y-3"
              >
                <p className="text-[10px] text-secondary">
                  Connect your BTC, ETH, or SOL wallet to sign in with your private key.
                </p>
                <div className="flex justify-center py-3">
                  <WalletConnectInline />
                </div>
                {wallet.authenticated && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-center gap-1.5 text-[11px] text-secondary"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Redirecting...
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* SSO */}
            {tab === "sso" && (
              <motion.div
                key="sso"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.15 }}
                className="space-y-2"
              >
                <p className="mb-3 text-[10px] text-secondary">
                  Sign in with your organization&apos;s identity provider.
                </p>
                {ssoProviders.map((providerId) => {
                  const meta = SSO_META[providerId] ?? { label: providerId, color: "#6366f1" };
                  return (
                    <button
                      key={providerId}
                      onClick={() => handleSSO(providerId)}
                      className="flex w-full items-center gap-2.5 rounded-sm border border-[var(--border)] bg-[var(--bg-inset)] px-3 py-2 text-[11px] font-medium text-primary transition-colors hover:border-[var(--border-accent)] hover:bg-[var(--bg-hover)]"
                    >
                      <div
                        className="flex h-5 w-5 items-center justify-center rounded-xs text-[9px] font-bold text-white"
                        style={{ backgroundColor: meta.color }}
                      >
                        {meta.label[0]}
                      </div>
                      Continue with {meta.label}
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Error / Success */}
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="border-[var(--danger)]/15 mt-3 rounded-sm border bg-[var(--danger-subtle)] px-2.5 py-1.5 text-[10px] text-[var(--danger)]"
              >
                {error}
              </motion.p>
            )}
            {success && (
              <motion.p
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="border-[var(--success)]/15 mt-3 rounded-sm border bg-[var(--success-subtle)] px-2.5 py-1.5 text-[10px] text-[var(--success)]"
              >
                {success}
              </motion.p>
            )}
          </AnimatePresence>
        </GlassCard>
      </div>
    </FadeIn>
  );
}

function WalletConnectInline() {
  const {
    address,
    chain,
    connected,
    authenticated,
    authenticating,
    authError,
    connect,
    authenticate,
    disconnect,
    availableWallets,
  } = useWallet();
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  if (authenticated) return null;

  if (authenticating) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-secondary">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Verifying wallet...
      </div>
    );
  }

  if (connected && address && chain) {
    const meta = CHAIN_META[chain];

    return (
      <div className="w-full max-w-xs rounded-md border border-[var(--border)] bg-[var(--bg-inset)] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.15em] text-muted">Connected</p>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="text-sm font-semibold" style={{ color: meta.color }}>
                {meta.icon}
              </span>
              <span className="text-[12px] font-medium text-primary">{addressPreview(address)}</span>
            </div>
          </div>
          <span className="rounded-xs border border-[var(--border)] px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-secondary">
            {meta.label}
          </span>
        </div>

        <p className="text-[10px] text-secondary">
          {authError ? "Verification incomplete." : "Finish the signature request to sign in."}
        </p>

        {authError && (
          <p className="border-[var(--danger)]/15 mt-2 rounded-sm border bg-[var(--danger-subtle)] px-2 py-1 text-[10px] text-[var(--danger)]">
            {authError}
          </p>
        )}

        {walletError && (
          <p className="border-[var(--danger)]/15 mt-2 rounded-sm border bg-[var(--danger-subtle)] px-2 py-1 text-[10px] text-[var(--danger)]">
            {walletError}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => {
              setWalletError(null);
              void authenticate().catch((error: unknown) => {
                setWalletError(error instanceof Error ? error.message : "Verification failed");
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-sm bg-[var(--accent)] px-3 py-1.5 text-[10px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
          >
            <Shield className="h-3 w-3" />
            Retry
          </button>
          <button
            type="button"
            onClick={() => {
              setWalletError(null);
              void disconnect();
            }}
            className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-[10px] font-medium text-secondary transition-colors hover:text-primary"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  const grouped = {
    BTC: availableWallets.filter((w) => w.chain === "BTC" && w.available),
    ETH: availableWallets.filter((w) => w.chain === "ETH" && w.available),
    SOL: availableWallets.filter((w) => w.chain === "SOL" && w.available),
  };

  const handleConnect = async (wallet: { id: string; chain: "BTC" | "ETH" | "SOL" }) => {
    setConnecting(true);
    setWalletError(null);
    try {
      const connectorId = wallet.id.split(":")[1];
      await connect(wallet.chain, connectorId);
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="w-full space-y-2">
      {(["BTC", "ETH", "SOL"] as const).map((chain) => {
        const wallets = grouped[chain];
        if (wallets.length === 0) return null;
        return (
          <div key={chain}>
            <p className="mb-1 text-[9px] font-medium uppercase tracking-[0.15em] text-muted">{chain}</p>
            <div className="flex flex-wrap gap-1.5">
              {wallets.map((w) => (
                <button
                  key={w.id}
                  onClick={() => handleConnect(w)}
                  disabled={connecting}
                  className="flex items-center gap-1.5 rounded-sm border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-1.5 text-[10px] text-primary transition-colors hover:border-[var(--border-accent)] disabled:opacity-50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- wallet icon from injected provider, not optimizable */}
                  {w.iconUrl && <img src={w.iconUrl} alt="" className="h-3.5 w-3.5 rounded-xs" />}
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {walletError && <p className="text-[10px] text-[var(--danger)]">{walletError}</p>}
    </div>
  );
}
