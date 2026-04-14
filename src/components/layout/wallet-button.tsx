"use client";

/**
 * WalletButton + WalletPicker — extracted from wallet-provider.tsx
 * for file-length compliance. Pure UI components that consume the wallet store.
 */

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ChevronLeft, ExternalLink, Loader2, LogOut, Wallet } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import type { WalletChain } from "~/lib/crypto/chains";
import { addressPreview, CHAIN_META } from "~/lib/crypto/chains";
import { useWalletStore, type WalletOption } from "~/stores/wallet";
import { getWalletActions, useWallet } from "./wallet-provider";

// ── Wallet Button (local UI state only) ──────────────────────────────────────

const INSTALL_LINKS: Record<WalletChain, { name: string; url: string }[]> = {
  BTC: [
    { name: "UniSat", url: "https://unisat.io" },
    { name: "Xverse", url: "https://www.xverse.app" },
  ],
  ETH: [
    { name: "MetaMask", url: "https://metamask.io" },
    { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet" },
  ],
  SOL: [
    { name: "Phantom", url: "https://phantom.app" },
    { name: "Solflare", url: "https://solflare.com" },
  ],
};

export function WalletButton() {
  const { connected, authenticated, authenticating, address, chain, availableWallets } = useWalletStore();

  let actions: ReturnType<typeof getWalletActions> | null = null;
  try {
    actions = getWalletActions();
  } catch {
    // Provider not mounted yet
  }

  // Local UI state
  const [showMenu, setShowMenu] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState<WalletChain | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setShowMenu(false);
      setSelectedChain(null);
    }
  }, []);

  const toggleMenu = useCallback(() => {
    setShowMenu((prev) => {
      const next = !prev;
      if (next) {
        document.addEventListener("mousedown", handleOutsideClick);
      } else {
        document.removeEventListener("mousedown", handleOutsideClick);
      }
      return next;
    });
    setSelectedChain(null);
    setError(null);
  }, [handleOutsideClick]);

  const chainsWithWallets = useMemo(() => {
    const chains: WalletChain[] = [];
    for (const c of ["BTC", "ETH", "SOL"] as const) {
      if (availableWallets.filter((w) => w.chain === c && w.available).length > 0) chains.push(c);
    }
    return chains;
  }, [availableWallets]);

  const effectiveChain = useMemo(() => {
    if (selectedChain) return selectedChain;
    if (chainsWithWallets.length === 1) return chainsWithWallets[0];
    return null;
  }, [selectedChain, chainsWithWallets]);

  const autoSkipped = !selectedChain && chainsWithWallets.length === 1;

  const handleConnect = async (wallet: WalletOption) => {
    if (!actions) return;
    setConnecting(true);
    setError(null);
    try {
      const connectorId = wallet.id.split(":")[1];
      await actions.connect(wallet.chain, connectorId);
      setShowMenu(false);
      setSelectedChain(null);
      document.removeEventListener("mousedown", handleOutsideClick);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setConnecting(false);
    }
  };

  if (connected && address && chain) {
    return (
      <ConnectedIndicator
        address={address}
        chain={chain}
        authenticated={authenticated}
        authenticating={authenticating}
        onDisconnect={() => actions?.disconnect()}
      />
    );
  }

  const chainWallets = effectiveChain ? availableWallets.filter((w) => w.chain === effectiveChain && w.available) : [];
  const noWalletsAnywhere = chainsWithWallets.length === 0;

  return (
    <div className="relative" ref={menuRef}>
      <motion.button
        onClick={toggleMenu}
        className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-[0_0_0_0_var(--accent)] transition-colors hover:bg-accent-hover hover:shadow-[0_0_16px_color-mix(in_srgb,var(--accent)_25%,transparent)]"
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <Wallet className="h-4 w-4" />
        <span>Connect Wallet</span>
      </motion.button>
      <AnimatePresence>
        {showMenu && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="glass-card absolute left-0 right-0 top-full z-50 mt-2 w-full rounded-xl border border-border p-2 shadow-xl sm:left-auto sm:right-0 sm:w-72"
          >
            <AnimatePresence mode="wait">
              {noWalletsAnywhere ? (
                <NoWalletsPanel />
              ) : !effectiveChain ? (
                <ChainSelectPanel availableWallets={availableWallets} onSelect={setSelectedChain} />
              ) : (
                <WalletListPanel
                  effectiveChain={effectiveChain}
                  chainWallets={chainWallets}
                  autoSkipped={autoSkipped}
                  connecting={connecting}
                  onConnect={handleConnect}
                  onBack={() => setSelectedChain(null)}
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-2 flex items-center gap-1.5 rounded-lg border border-red-500/15 bg-red-500/10 px-3 py-2 text-xs text-red-400"
                >
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>{error}</span>
                </motion.p>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sub-components (reduce WalletButton complexity / lines) ──

function ConnectedIndicator({
  address,
  chain,
  authenticated,
  authenticating,
  onDisconnect,
}: {
  address: string;
  chain: WalletChain;
  authenticated: boolean;
  authenticating: boolean;
  onDisconnect: () => void;
}) {
  const meta = CHAIN_META[chain];
  return (
    <motion.div
      className="flex items-center gap-2 sm:gap-3"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="glass-card flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
        <span className="font-semibold" style={{ color: meta.color }}>
          {meta.icon}
        </span>
        <span className="text-secondary">{addressPreview(address)}</span>
        {authenticating && (
          <motion.div
            className="h-2 w-2 rounded-full bg-amber-400"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
            title="Verifying wallet..."
          />
        )}
        {authenticated && !authenticating && <div className="h-2 w-2 rounded-full bg-green-400" title="Verified" />}
      </div>
      <motion.button
        onClick={onDisconnect}
        className="flex items-center gap-1.5 rounded-lg border border-red-500/10 bg-red-500/15 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/25"
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <LogOut className="h-3.5 w-3.5" />
        <span>Disconnect</span>
      </motion.button>
    </motion.div>
  );
}

function NoWalletsPanel() {
  return (
    <motion.div
      key="no-wallets"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.15 }}
      className="px-3 py-3"
    >
      <div className="mb-2 flex items-center gap-2 text-amber-400">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <p className="text-sm font-medium">No wallets detected</p>
      </div>
      <p className="mb-3 text-xs text-muted">Install a browser wallet extension to get started:</p>
      {(["BTC", "ETH", "SOL"] as const).map((c) => {
        const meta = CHAIN_META[c];
        return (
          <div key={c} className="mb-2 last:mb-0">
            <p className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted">
              <span className="font-semibold" style={{ color: meta.color }}>
                {meta.icon}
              </span>
              {meta.label}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {INSTALL_LINKS[c].map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-surface-hover/40 hover:bg-surface-hover/70 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-secondary transition-colors hover:text-primary"
                >
                  {link.name}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              ))}
            </div>
          </div>
        );
      })}
    </motion.div>
  );
}

function ChainSelectPanel({
  availableWallets,
  onSelect,
}: {
  availableWallets: WalletOption[];
  onSelect: (chain: WalletChain) => void;
}) {
  return (
    <motion.div
      key="chains"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.15 }}
    >
      <p className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted">Select Chain</p>
      {(["BTC", "ETH", "SOL"] as const).map((c, i) => {
        const meta = CHAIN_META[c];
        const count = availableWallets.filter((w) => w.chain === c && w.available).length;
        return (
          <motion.button
            key={c}
            onClick={() => onSelect(c)}
            className="hover:bg-surface-hover/60 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition-colors"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileHover={{ x: 3 }}
          >
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold" style={{ color: meta.color }}>
                {meta.icon}
              </span>
              <span>{meta.label}</span>
            </div>
            {count > 0 ? (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{ background: meta.color + "20", color: meta.color }}
              >
                {count}
              </span>
            ) : (
              <span className="text-[10px] text-muted">none</span>
            )}
          </motion.button>
        );
      })}
    </motion.div>
  );
}

function WalletListPanel({
  effectiveChain,
  chainWallets,
  autoSkipped,
  connecting,
  onConnect,
  onBack,
}: {
  effectiveChain: WalletChain;
  chainWallets: WalletOption[];
  autoSkipped: boolean;
  connecting: boolean;
  onConnect: (wallet: WalletOption) => void;
  onBack: () => void;
}) {
  return (
    <motion.div
      key="wallets"
      initial={{ opacity: 0, x: autoSkipped ? 0 : 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: autoSkipped ? 0 : 10 }}
      transition={{ duration: 0.15 }}
    >
      {!autoSkipped && (
        <motion.button
          onClick={onBack}
          className="flex items-center gap-1 px-3 py-1.5 text-[10px] text-muted transition-colors hover:text-secondary"
          whileHover={{ x: -3 }}
        >
          <ChevronLeft className="h-3 w-3" />
          <span>Back</span>
        </motion.button>
      )}
      {autoSkipped && (
        <p className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted">
          <span className="font-semibold" style={{ color: CHAIN_META[effectiveChain].color }}>
            {CHAIN_META[effectiveChain].icon}
          </span>
          {CHAIN_META[effectiveChain].label} Wallets
        </p>
      )}
      {chainWallets.length === 0 ? (
        <div className="px-3 py-4 text-center">
          <AlertCircle className="mx-auto mb-1 h-4 w-4 text-muted" />
          <p className="text-sm text-muted">No {CHAIN_META[effectiveChain].label} wallets detected</p>
        </div>
      ) : (
        chainWallets.map((w, i) => (
          <motion.button
            key={w.id}
            onClick={() => onConnect(w)}
            disabled={connecting}
            className="hover:bg-surface-hover/60 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-50"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            whileHover={{ x: 3 }}
          >
            {w.iconUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- wallet icon from dynamic provider URL */
              <img src={w.iconUrl} alt="" className="h-6 w-6 rounded-md" />
            ) : (
              <span
                className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold"
                style={{
                  background: CHAIN_META[w.chain].color + "22",
                  color: CHAIN_META[w.chain].color,
                }}
              >
                {CHAIN_META[w.chain].icon}
              </span>
            )}
            <span>{w.label}</span>
            {connecting && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted" />}
          </motion.button>
        ))
      )}
    </motion.div>
  );
}

// ── Shared wallet picker (used by login + sign pages) ───────────────────────

export function WalletPicker() {
  const { connect, availableWallets } = useWallet();
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  const grouped = {
    BTC: availableWallets.filter((w) => w.chain === "BTC" && w.available),
    ETH: availableWallets.filter((w) => w.chain === "ETH" && w.available),
    SOL: availableWallets.filter((w) => w.chain === "SOL" && w.available),
  };

  const handleConnect = async (wallet: { id: string; chain: WalletChain }) => {
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
    <div className="w-full space-y-3">
      {(["BTC", "ETH", "SOL"] as const).map((chain) => {
        const wallets = grouped[chain];
        if (wallets.length === 0) return null;
        const meta = CHAIN_META[chain];
        return (
          <div key={chain}>
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-muted">
              <span style={{ color: meta.color }}>{meta.icon}</span> {meta.label}
            </p>
            <div className="flex flex-wrap gap-2">
              {wallets.map((w) => (
                <button
                  key={w.id}
                  onClick={() => handleConnect(w)}
                  disabled={connecting}
                  className="bg-surface-hover/60 hover:border-accent/30 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-primary transition-colors disabled:opacity-50"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- wallet icon from dynamic provider URL */}
                  {w.iconUrl && <img src={w.iconUrl} alt="" className="h-4 w-4 rounded" />}
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {walletError && <p className="text-xs text-red-400">{walletError}</p>}
    </div>
  );
}
