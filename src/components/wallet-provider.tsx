"use client";

/**
 * Wallet provider — multi-chain wallet connection (BTC/ETH/SOL) + auth.
 *
 * State lives in Zustand (~/stores/wallet). This component only provides
 * the React context wrappers (LaserEyes, Wagmi, Solana) and syncs wallet
 * hook state into the store. Zero standalone useEffect for state management.
 */

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Wallet, ChevronLeft, LogOut, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import {
  LaserEyesProvider,
  useLaserEyes,
  UNISAT,
  XVERSE,
  OKX,
  MAGIC_EDEN,
  LEATHER,
  PHANTOM,
  WIZZ,
  type ProviderType,
} from "@omnisat/lasereyes";
import { useAccount, useConnect, useDisconnect, useSignMessage as useWagmiSignMessage, WagmiProvider } from "wagmi";
import {
  ConnectionProvider,
  WalletProvider as SolWalletProvider,
  useWallet as useSolWallet,
} from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { privateKeyToAccount } from "viem/accounts";

import type { WalletChain } from "~/lib/chains";
import { CHAIN_META, addressPreview } from "~/lib/chains";
import { wagmiConfig } from "~/lib/wagmi-config";
import { trpc } from "~/lib/trpc";
import {
  useWalletStore,
  getSessionCookie,
  setSessionCookie,
  clearSessionCookie,
  getWalletAuthErrorMessage,
  type WalletOption,
} from "~/stores/wallet";

type WalletRuntimeActions = {
  connect: (chain: WalletChain, connectorId?: string) => Promise<void>;
  authenticate: () => Promise<void>;
  disconnect: () => void | Promise<void>;
  signMessage: (message: string) => Promise<string>;
};

const unavailableWalletActions: WalletRuntimeActions = {
  connect: async () => {
    throw new Error("WalletProvider not mounted");
  },
  authenticate: async () => {
    throw new Error("WalletProvider not mounted");
  },
  disconnect: async () => {
    throw new Error("WalletProvider not mounted");
  },
  signMessage: async () => {
    throw new Error("WalletProvider not mounted");
  },
};

function getDevEthAccount() {
  if (process.env.NODE_ENV === "production") return null;
  const raw = process.env.NEXT_PUBLIC_DEV_WALLET_PK?.trim();
  if (!raw) return null;
  const privateKey = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  try {
    return privateKeyToAccount(privateKey);
  } catch {
    return null;
  }
}

// ── Public hook — reads from Zustand store, no context needed ────────────────

export function useWallet() {
  const store = useWalletStore();
  const actions = _walletActions ?? unavailableWalletActions;

  return useMemo(() => ({ ...store, ...actions }), [store, actions]);
}

// ── Inner runtime (syncs wallet hooks → Zustand store) ───────────────────────

function WalletRuntime({ children }: { children: ReactNode }) {
  const store = useWalletStore();
  // Stable action refs (Zustand actions don't change between renders)
  const storeSetState = store.setState;
  const storeSetAvailableWallets = store.setAvailableWallets;
  const storeReset = store.reset;
  const storeAuthSuccess = store.authSuccess;
  const devEthAccount = useMemo(() => getDevEthAccount(), []);

  // ── tRPC auth mutations ──
  const challengeMut = trpc.auth.challenge.useMutation();
  const verifyMut = trpc.auth.verify.useMutation();
  const logoutMut = trpc.auth.logout.useMutation();
  const claimDocsMutation = trpc.document.claimDocuments.useMutation();
  const sessionQuery = trpc.auth.me.useQuery({ token: getSessionCookie() ?? "" }, { enabled: false, retry: false });

  const authTriggeredRef = useRef<string | null>(null);
  const sessionRestoredRef = useRef(false);

  // ── Wallet hooks ──
  const laserEyes = useLaserEyes();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { connectors: evmConnectors, connectAsync: evmConnectAsync } = useConnect();
  const { disconnectAsync: evmDisconnectAsync } = useDisconnect();
  const { signMessageAsync: evmSignMessageAsync } = useWagmiSignMessage();
  const solWallet = useSolWallet();

  // ── Refs for stable callbacks ──
  const challengeRef = useRef(challengeMut);
  const claimDocsMut = useRef(claimDocsMutation);
  challengeRef.current = challengeMut;
  claimDocsMut.current = claimDocsMutation;
  const verifyRef = useRef(verifyMut);
  verifyRef.current = verifyMut;
  const evmSignRef = useRef(evmSignMessageAsync);
  evmSignRef.current = evmSignMessageAsync;
  const solWalletRef = useRef(solWallet);
  solWalletRef.current = solWallet;
  const laserEyesRef = useRef(laserEyes);
  laserEyesRef.current = laserEyes;

  // ── Build available wallets ──
  const hasUnisat = laserEyes.hasUnisat,
    hasXverse = laserEyes.hasXverse,
    hasOkx = laserEyes.hasOkx;
  const hasMagicEden = laserEyes.hasMagicEden,
    hasLeather = laserEyes.hasLeather;
  const hasPhantom = laserEyes.hasPhantom,
    hasWizz = laserEyes.hasWizz;
  const solWallets = solWallet.wallets;

  useEffect(() => {
    const wallets: WalletOption[] = [];

    const btcProviders: Array<{ provider: ProviderType; label: string; check: boolean }> = [
      { provider: UNISAT, label: "UniSat", check: hasUnisat },
      { provider: XVERSE, label: "Xverse", check: hasXverse },
      { provider: OKX, label: "OKX", check: hasOkx },
      { provider: MAGIC_EDEN, label: "Magic Eden", check: hasMagicEden },
      { provider: LEATHER, label: "Leather", check: hasLeather },
      { provider: PHANTOM, label: "Phantom", check: hasPhantom },
      { provider: WIZZ, label: "Wizz", check: hasWizz },
    ];
    for (const p of btcProviders) {
      wallets.push({ id: `BTC:${p.provider}`, chain: "BTC", label: p.label, available: p.check });
    }

    if (devEthAccount) {
      wallets.push({
        id: "ETH:dev",
        chain: "ETH",
        label: "Dev Wallet",
        available: true,
      });
    }

    for (const connector of evmConnectors) {
      wallets.push({
        id: `ETH:${connector.id}`,
        chain: "ETH",
        label: connector.name || "EVM Wallet",
        available: true,
        iconUrl: (connector as { icon?: string }).icon ?? null,
      });
    }

    for (const w of solWallets) {
      const ready = String(w.readyState);
      wallets.push({
        id: `SOL:${String(w.adapter.name)}`,
        chain: "SOL",
        label: String(w.adapter.name),
        available: ready === "Installed" || ready === "Loadable",
        iconUrl: (w.adapter as { icon?: string }).icon ?? null,
      });
    }

    storeSetAvailableWallets(wallets);
  }, [
    hasUnisat,
    hasXverse,
    hasOkx,
    hasMagicEden,
    hasLeather,
    hasPhantom,
    hasWizz,
    devEthAccount,
    evmConnectors,
    solWallets,
    storeSetAvailableWallets,
  ]);

  // ── Sync wallet connection state → store ──
  const leConnected = laserEyes.connected,
    leAddress = laserEyes.address;
  const solConnected = solWallet.connected,
    solPubkey = solWallet.publicKey;

  useEffect(() => {
    if (leConnected && leAddress) {
      storeSetState({ address: leAddress, chain: "BTC", connected: true });
    } else if (evmConnected && evmAddress) {
      storeSetState({ address: evmAddress, chain: "ETH", connected: true });
    } else if (solConnected && solPubkey) {
      storeSetState({ address: solPubkey.toBase58(), chain: "SOL", connected: true });
    } else if (store.connected && !store.authenticated && !getSessionCookie()) {
      storeReset();
    }
  }, [
    leConnected,
    leAddress,
    evmConnected,
    evmAddress,
    solConnected,
    solPubkey,
    storeSetState,
    storeReset,
    store.connected,
    store.authenticated,
  ]);

  // ── Restore session from cookie (runs once) ──
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;

    const token = getSessionCookie();
    if (!token) return;

    sessionQuery
      .refetch()
      .then(({ data }) => {
        if (data) {
          authTriggeredRef.current = data.address;
          storeAuthSuccess(data.address, data.chain as WalletChain);
        } else {
          clearSessionCookie();
          storeSetState({ authenticating: false, authError: null });
        }
      })
      .catch(() => {
        clearSessionCookie();
        storeSetState({ authenticating: false, authError: null });
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sign-in flow ──
  const doSignIn = useCallback(async (address: string, chain: WalletChain) => {
    store.startAuth();
    try {
      const { nonce, message } = await challengeRef.current.mutateAsync({ address, chain });

      let signature: string;
      if (chain === "ETH") {
        if (devEthAccount?.address.toLowerCase() === address.toLowerCase() && !evmConnected) {
          signature = await devEthAccount.signMessage({ message });
        } else {
          signature = await evmSignRef.current({ message });
        }
      } else if (chain === "SOL") {
        const sw = solWalletRef.current;
        if (!sw.signMessage) throw new Error("Solana wallet does not support signing.");
        signature = Buffer.from(await sw.signMessage(new TextEncoder().encode(message))).toString("base64");
      } else {
        const isTaproot = address.toLowerCase().startsWith("bc1p") || address.toLowerCase().startsWith("tb1p");
        signature = await laserEyesRef.current.signMessage(message, {
          toSignAddress: address,
          protocol: isTaproot ? "bip322" : "ecdsa",
        });
      }

      const { token, expiresAt } = await verifyRef.current.mutateAsync({ nonce, address, chain, signature });
      setSessionCookie(token, expiresAt);
      authTriggeredRef.current = address;
      store.authSuccess(address, chain);

      // Claim any documents signed as a guest with this wallet/email/social
      void claimDocsMut.current.mutateAsync().catch(() => {});
    } catch (err) {
      authTriggeredRef.current = address;
      store.authFail(getWalletAuthErrorMessage(err));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto sign-in after wallet connects ──
  const storeConnected = store.connected,
    storeAddress = store.address;
  const storeChain = store.chain,
    storeAuthenticated = store.authenticated;
  const storeAuthenticating = store.authenticating;

  useEffect(() => {
    if (!storeConnected || !storeAddress || !storeChain) return;
    if (storeAuthenticated || storeAuthenticating) return;
    if (authTriggeredRef.current === storeAddress) return;
    if (getSessionCookie()) return;
    void doSignIn(storeAddress, storeChain);
  }, [storeConnected, storeAddress, storeChain, storeAuthenticated, storeAuthenticating, doSignIn]);

  // ── Connect ──
  const connect = useCallback(
    async (chain: WalletChain, connectorId?: string) => {
      authTriggeredRef.current = null;
      store.setState({ authenticated: false, authenticating: false, authError: null });

      if (chain === "BTC") {
        await laserEyes.connect((connectorId as ProviderType) || UNISAT);
      } else if (chain === "ETH") {
        if (connectorId === "dev") {
          if (!devEthAccount) throw new Error("Dev wallet not configured");
          store.setState({
            address: devEthAccount.address,
            chain: "ETH",
            connected: true,
          });
          return;
        }
        const connector = connectorId ? evmConnectors.find((c) => c.id === connectorId) : evmConnectors[0];
        if (!connector) throw new Error("No EVM wallet available");
        await evmConnectAsync({ connector });
      } else if (chain === "SOL") {
        if (connectorId) {
          const match = solWallet.wallets.find((w) => String(w.adapter.name) === connectorId);
          if (match) solWallet.select(match.adapter.name);
        }
        await solWallet.connect();
      }
    },
    [devEthAccount, laserEyes, evmConnectors, evmConnectAsync, solWallet, store],
  );

  // ── Authenticate (manual retry) ──
  const authenticate = useCallback(async () => {
    if (!store.connected || !store.address || !store.chain) throw new Error("Connect a wallet first.");
    authTriggeredRef.current = null;
    await doSignIn(store.address, store.chain);
  }, [store.connected, store.address, store.chain, doSignIn]);

  // ── Disconnect ──
  const disconnect = useCallback(async () => {
    const token = getSessionCookie();
    if (token) {
      logoutMut.mutate({ token });
      clearSessionCookie();
    }
    authTriggeredRef.current = null;

    if (store.chain === "BTC") laserEyes.disconnect();
    else if (
      store.chain === "ETH" &&
      devEthAccount &&
      store.address?.toLowerCase() === devEthAccount.address.toLowerCase() &&
      !evmConnected
    ) {
      store.reset();
      return;
    } else if (store.chain === "ETH") await evmDisconnectAsync();
    else if (store.chain === "SOL") await solWallet.disconnect();

    store.reset();
  }, [
    store,
    store.chain,
    store.address,
    laserEyes,
    evmDisconnectAsync,
    solWallet,
    logoutMut,
    devEthAccount,
    evmConnected,
  ]);

  // ── Sign message ──
  const signMessage = useCallback(
    async (message: string): Promise<string> => {
      if (!store.address || !store.chain) throw new Error("Wallet not connected");

      if (store.chain === "ETH") {
        if (devEthAccount?.address.toLowerCase() === store.address.toLowerCase() && !evmConnected) {
          return devEthAccount.signMessage({ message });
        }
        return evmSignMessageAsync({ message });
      }
      if (store.chain === "SOL") {
        if (!solWallet.signMessage) throw new Error("Solana wallet does not support signMessage.");
        return Buffer.from(await solWallet.signMessage(new TextEncoder().encode(message))).toString("base64");
      }

      const isTaproot =
        store.address.toLowerCase().startsWith("bc1p") || store.address.toLowerCase().startsWith("tb1p");
      return laserEyes.signMessage(message, {
        toSignAddress: store.address,
        protocol: isTaproot ? "bip322" : "ecdsa",
      });
    },
    [store.address, store.chain, evmSignMessageAsync, solWallet, laserEyes, devEthAccount, evmConnected],
  );

  // ── Expose actions on the store for WalletButton to consume ──
  // We use a ref-stable object since these callbacks depend on wallet hooks
  const actionsRef = useRef({ connect, authenticate, disconnect, signMessage });
  actionsRef.current = { connect, authenticate, disconnect, signMessage };

  // Make actions available globally via a module-level variable
  _walletActions = actionsRef.current;

  return <>{children}</>;
}

// ── Module-level action bridge (avoids Context, accessed via getWalletActions) ──

let _walletActions: WalletRuntimeActions | null = null;

export function getWalletActions() {
  if (!_walletActions) throw new Error("WalletProvider not mounted");
  return _walletActions;
}

// ── Outer provider shell ─────────────────────────────────────────────────────

const solanaEndpoint =
  typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_SOL_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com"
    : "https://api.mainnet-beta.solana.com";

const solAdapters = [new PhantomWalletAdapter()];

export function WalletProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <LaserEyesProvider config={{ network: "mainnet" as never }}>
        <ConnectionProvider endpoint={solanaEndpoint}>
          <SolWalletProvider wallets={solAdapters} autoConnect={false}>
            <WalletRuntime>{children}</WalletRuntime>
          </SolWalletProvider>
        </ConnectionProvider>
      </LaserEyesProvider>
    </WagmiProvider>
  );
}

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
  const actions = _walletActions;

  // Local UI state — rightly stays local (not global)
  const [showMenu, setShowMenu] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedChain, setSelectedChain] = useState<WalletChain | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click — uses event handler, not useEffect
  const handleOutsideClick = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setShowMenu(false);
      setSelectedChain(null);
    }
  }, []);

  // Attach/detach listener based on menu state
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
          onClick={() => actions?.disconnect()}
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
              ) : !effectiveChain ? (
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
                        onClick={() => setSelectedChain(c)}
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
              ) : (
                <motion.div
                  key="wallets"
                  initial={{ opacity: 0, x: autoSkipped ? 0 : 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: autoSkipped ? 0 : 10 }}
                  transition={{ duration: 0.15 }}
                >
                  {!autoSkipped && (
                    <motion.button
                      onClick={() => setSelectedChain(null)}
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
                        onClick={() => handleConnect(w)}
                        disabled={connecting}
                        className="hover:bg-surface-hover/60 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-50"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        whileHover={{ x: 3 }}
                      >
                        {w.iconUrl ? (
                          <img src={w.iconUrl} alt="" className="h-6 w-6 rounded-md" />
                        ) : (
                          <span
                            className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold"
                            style={{ background: CHAIN_META[w.chain].color + "22", color: CHAIN_META[w.chain].color }}
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
