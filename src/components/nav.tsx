"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";
import { useWallet, WalletButton } from "./wallet-provider";
import { useSession } from "~/lib/auth-client";
import { ThemeToggle } from "./theme-toggle";
import Link from "next/link";
import { W3SLink, W3SIconButton } from "./ui/motion";
import { Plus, LayoutDashboard, ShieldCheck, Settings, Shield, LogIn, User, Menu, X } from "lucide-react";

const navLinks = [
  { href: "/", label: "New", icon: Plus },
  { href: "/dashboard", label: "Documents", icon: LayoutDashboard },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/admin", label: "Admin", icon: Shield },
  { href: "/verify", label: "Verify", icon: ShieldCheck },
];

export function Nav({ badge }: { badge?: { label: string; color?: string } }) {
  const pathname = usePathname();
  const wallet = useWallet();
  const { data: session } = useSession();
  const isLoggedIn = wallet.authenticated || !!session?.user;
  const [mobileMenu, setMobileMenu] = useState(false);

  return (
    <>
      <nav className="glass-nav sticky top-0 z-40">
        <div className="mx-auto flex h-12 max-w-5xl items-center gap-1 px-4 sm:px-6">
          {/* Logo */}
          <Link href="/" className="mr-4 flex shrink-0 items-center gap-2">
            <span className="text-sm font-semibold tracking-tight text-primary">Proofmark</span>
            <span className="hidden rounded-xs border border-[var(--border)] px-1.5 py-px text-[9px] font-medium uppercase tracking-[0.15em] text-muted sm:inline">
              Beta
            </span>
          </Link>

          {badge && (
            <span
              className={`hidden rounded-xs px-1.5 py-px text-[9px] font-medium sm:inline ${
                badge.color === "success"
                  ? "bg-[var(--success-subtle)] text-[var(--success)]"
                  : "bg-[var(--accent-subtle)] text-[var(--accent)]"
              }`}
            >
              {badge.label}
            </span>
          )}

          {/* Desktop nav links */}
          <div className="hidden flex-1 items-center sm:flex">
            {navLinks.map((link) => {
              const active = pathname === link.href;
              const Icon = link.icon;
              return (
                <a
                  key={link.href}
                  href={link.href}
                  className="accent-line group relative inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium transition-colors"
                >
                  <Icon className={`h-3 w-3 transition-colors ${active ? "text-accent" : "text-muted group-hover:text-secondary"}`} />
                  <span className={active ? "text-primary" : "text-muted group-hover:text-secondary"}>
                    {link.label}
                  </span>
                  {active && (
                    <motion.span
                      layoutId="nav-indicator"
                      className="absolute inset-x-3 -bottom-[7px] h-px bg-[var(--accent)]"
                      transition={{ type: "spring", stiffness: 500, damping: 35 }}
                    />
                  )}
                </a>
              );
            })}
          </div>

          {/* Right side */}
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            {isLoggedIn ? (
              <>
                {wallet.authenticated && <WalletButton />}
                {!wallet.authenticated && session?.user && (
                  <div className="hidden items-center gap-2 rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1 text-[11px] sm:flex">
                    <User className="h-3 w-3 text-muted" />
                    <span className="text-secondary">{session.user.email}</span>
                    <span className="status-dot status-dot-success" />
                  </div>
                )}
              </>
            ) : (
              <W3SLink href="/login" variant="primary" size="xs" className="hidden sm:inline-flex">
                <LogIn className="h-3 w-3" />
                Sign in
              </W3SLink>
            )}

            <W3SIconButton onClick={() => setMobileMenu(!mobileMenu)} className="sm:hidden">
              {mobileMenu ? <X className="h-3.5 w-3.5" /> : <Menu className="h-3.5 w-3.5" />}
            </W3SIconButton>
          </div>
        </div>
      </nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileMenu && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="sticky top-12 z-30 overflow-hidden border-b border-[var(--border)] bg-[var(--bg-card)] sm:hidden"
          >
            <div className="space-y-px p-1.5">
              {navLinks.map((link, i) => {
                const active = pathname === link.href;
                const Icon = link.icon;
                return (
                  <motion.a
                    key={link.href}
                    href={link.href}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04, duration: 0.2 }}
                    className={`flex items-center gap-2.5 rounded-sm px-3 py-2 text-[12px] font-medium transition-colors ${
                      active ? "bg-[var(--bg-hover)] text-primary" : "text-secondary hover:bg-[var(--bg-hover)]"
                    }`}
                    onClick={() => setMobileMenu(false)}
                  >
                    <Icon className={`h-3.5 w-3.5 ${active ? "text-accent" : ""}`} />
                    {link.label}
                  </motion.a>
                );
              })}
              {!isLoggedIn && (
                <a
                  href="/login"
                  className="flex items-center gap-2.5 rounded-sm px-3 py-2 text-[12px] font-medium text-[var(--accent)]"
                  onClick={() => setMobileMenu(false)}
                >
                  <LogIn className="h-3.5 w-3.5" />
                  Sign in
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
