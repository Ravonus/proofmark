"use client";

/**
 * Wallet provider — multi-chain wallet connection (BTC/ETH/SOL) + auth.
 *
 * State lives in Zustand (~/stores/wallet). This component only provides
 * the React context wrappers (LaserEyes, Wagmi, Solana) and syncs wallet
 * hook state into the store. Zero standalone useEffect for state management.
 */

import {
  LaserEyesProvider,
  LEATHER,
  MAGIC_EDEN,
  OKX,
  PHANTOM,
  type ProviderType,
  UNISAT,
  useLaserEyes,
  WIZZ,
  XVERSE,
} from "@omnisat/lasereyes";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import {
  ConnectionProvider,
  WalletProvider as SolWalletProvider,
  useWallet as useSolWallet,
} from "@solana/wallet-adapter-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { privateKeyToAccount } from "viem/accounts";
import { useAccount, useConnect, useDisconnect, useSignMessage as useWagmiSignMessage, WagmiProvider } from "wagmi";

import type { WalletChain } from "~/lib/crypto/chains";
import { wagmiConfig } from "~/lib/crypto/wagmi-config";
import { trpc } from "~/lib/platform/trpc";
import {
  clearSessionCookie,
  getSessionCookie,
  getWalletAuthErrorMessage,
  setSessionCookie,
  useWalletStore,
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

// ── Wallet state sync (available wallets + connection state → store) ──────────

function WalletStateSync({ children }: { children: ReactNode }) {
  const store = useWalletStore();
  const storeSetState = store.setState;
  const storeSetAvailableWallets = store.setAvailableWallets;
  const storeReset = store.reset;
  const devEthAccount = useMemo(() => getDevEthAccount(), []);

  const laserEyes = useLaserEyes();
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { connectors: evmConnectors } = useConnect();
  const solWallet = useSolWallet();

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
    const btcProviders: Array<{
      provider: ProviderType;
      label: string;
      check: boolean;
    }> = [
      { provider: UNISAT, label: "UniSat", check: hasUnisat },
      { provider: XVERSE, label: "Xverse", check: hasXverse },
      { provider: OKX, label: "OKX", check: hasOkx },
      { provider: MAGIC_EDEN, label: "Magic Eden", check: hasMagicEden },
      { provider: LEATHER, label: "Leather", check: hasLeather },
      { provider: PHANTOM, label: "Phantom", check: hasPhantom },
      { provider: WIZZ, label: "Wizz", check: hasWizz },
    ];
    for (const p of btcProviders) {
      wallets.push({
        id: `BTC:${p.provider}`,
        chain: "BTC",
        label: p.label,
        available: p.check,
      });
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
      storeSetState({
        address: solPubkey.toBase58(),
        chain: "SOL",
        connected: true,
      });
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

  return <>{children}</>;
}

// ── Auth hooks (extracted from WalletRuntime to reduce function size) ────────

function useSessionRestore(authTriggeredRef: React.MutableRefObject<string | null>) {
  const storeSetState = useWalletStore().setState;
  const storeAuthSuccess = useWalletStore().authSuccess;
  const sessionQuery = trpc.auth.me.useQuery({ token: getSessionCookie() ?? "" }, { enabled: false, retry: false });
  const sessionRestoredRef = useRef(false);

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
}

function useChainConnectors() {
  const store = useWalletStore();
  const devEthAccount = useMemo(() => getDevEthAccount(), []);
  const laserEyes = useLaserEyes();
  const { connectors: evmConnectors, connectAsync: evmConnectAsync } = useConnect();
  const solWallet = useSolWallet();

  const connectBTC = useCallback(
    async (connectorId?: string) => {
      await laserEyes.connect((connectorId as ProviderType) || UNISAT);
    },
    [laserEyes],
  );

  const connectETH = useCallback(
    async (connectorId?: string) => {
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
    },
    [devEthAccount, evmConnectors, evmConnectAsync, store],
  );

  const connectSOL = useCallback(
    async (connectorId?: string) => {
      if (connectorId) {
        const match = solWallet.wallets.find((w) => String(w.adapter.name) === connectorId);
        if (match) solWallet.select(match.adapter.name);
      }
      await solWallet.connect();
    },
    [solWallet],
  );

  return useMemo(() => ({ BTC: connectBTC, ETH: connectETH, SOL: connectSOL }), [connectBTC, connectETH, connectSOL]);
}

function useWalletSignMessage() {
  const store = useWalletStore();
  const devEthAccount = useMemo(() => getDevEthAccount(), []);
  const laserEyes = useLaserEyes();
  const { isConnected: evmConnected } = useAccount();
  const { signMessageAsync: evmSignMessageAsync } = useWagmiSignMessage();
  const solWallet = useSolWallet();

  return useCallback(
    async (message: string): Promise<string> => {
      if (!store.address || !store.chain) throw new Error("Wallet not connected");
      if (store.chain === "ETH") {
        if (devEthAccount?.address.toLowerCase() === store.address.toLowerCase() && !evmConnected)
          return devEthAccount.signMessage({ message });
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
}

/** Sign a message using the appropriate chain wallet. */
async function signChainMessage(
  chain: WalletChain,
  address: string,
  message: string,
  refs: {
    devEthAccount: ReturnType<typeof getDevEthAccount>;
    evmConnected: boolean;
    evmSignRef: React.MutableRefObject<(args: { message: string }) => Promise<string>>;
    solWalletRef: React.MutableRefObject<{
      signMessage?: (msg: Uint8Array) => Promise<Uint8Array>;
    }>;
    laserEyesRef: React.MutableRefObject<{
      signMessage: (msg: string, opts: { toSignAddress: string; protocol: "bip322" | "ecdsa" }) => Promise<string>;
    }>;
  },
): Promise<string> {
  if (chain === "ETH") {
    return refs.devEthAccount?.address.toLowerCase() === address.toLowerCase() && !refs.evmConnected
      ? refs.devEthAccount.signMessage({ message })
      : refs.evmSignRef.current({ message });
  }
  if (chain === "SOL") {
    const sw = refs.solWalletRef.current;
    if (!sw.signMessage) throw new Error("Solana wallet does not support signing.");
    return Buffer.from(await sw.signMessage(new TextEncoder().encode(message))).toString("base64");
  }
  const isTaproot = address.toLowerCase().startsWith("bc1p") || address.toLowerCase().startsWith("tb1p");
  return refs.laserEyesRef.current.signMessage(message, {
    toSignAddress: address,
    protocol: isTaproot ? "bip322" : "ecdsa",
  });
}

// ── Inner runtime (auth flow + action bridge) ───────────────────────────────

function WalletRuntime({ children }: { children: ReactNode }) {
  const store = useWalletStore();
  const devEthAccount = useMemo(() => getDevEthAccount(), []);
  const challengeMut = trpc.auth.challenge.useMutation();
  const verifyMut = trpc.auth.verify.useMutation();
  const logoutMut = trpc.auth.logout.useMutation();
  const claimDocsMutation = trpc.document.claimDocuments.useMutation();
  const authTriggeredRef = useRef<string | null>(null);
  const laserEyes = useLaserEyes();
  const { isConnected: evmConnected } = useAccount();
  const { disconnectAsync: evmDisconnectAsync } = useDisconnect();
  const solWallet = useSolWallet();
  const challengeRef = useRef(challengeMut);
  challengeRef.current = challengeMut;
  const claimDocsMut = useRef(claimDocsMutation);
  claimDocsMut.current = claimDocsMutation;
  const verifyRef = useRef(verifyMut);
  verifyRef.current = verifyMut;
  const { signMessageAsync: evmSignMessageAsync } = useWagmiSignMessage();
  const evmSignRef = useRef(evmSignMessageAsync);
  evmSignRef.current = evmSignMessageAsync;
  const solWalletRef = useRef(solWallet);
  solWalletRef.current = solWallet;
  const laserEyesRef = useRef(laserEyes) as React.MutableRefObject<typeof laserEyes>;
  laserEyesRef.current = laserEyes;

  useSessionRestore(authTriggeredRef);
  const chainConnectors = useChainConnectors();
  const signMessage = useWalletSignMessage();

  // ── Sign-in flow ──
  const doSignIn = useCallback(async (address: string, chain: WalletChain) => {
    store.startAuth();
    try {
      const { nonce, message } = await challengeRef.current.mutateAsync({
        address,
        chain,
      });
      const signature = await signChainMessage(chain, address, message, {
        devEthAccount,
        evmConnected,
        evmSignRef,
        solWalletRef,
        laserEyesRef,
      });
      const { token, expiresAt } = await verifyRef.current.mutateAsync({
        nonce,
        address,
        chain,
        signature,
      });
      setSessionCookie(token, expiresAt);
      authTriggeredRef.current = address;
      store.authSuccess(address, chain);
      void claimDocsMut.current.mutateAsync().catch(() => {
        /* noop */
      });
    } catch (err) {
      authTriggeredRef.current = address;
      store.authFail(getWalletAuthErrorMessage(err));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  const connect = useCallback(
    async (chain: WalletChain, connectorId?: string) => {
      authTriggeredRef.current = null;
      store.setState({
        authenticated: false,
        authenticating: false,
        authError: null,
      });
      await chainConnectors[chain](connectorId);
    },
    [chainConnectors, store],
  );

  const authenticate = useCallback(async () => {
    if (!store.connected || !store.address || !store.chain) throw new Error("Connect a wallet first.");
    authTriggeredRef.current = null;
    await doSignIn(store.address, store.chain);
  }, [store.connected, store.address, store.chain, doSignIn]);

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
  }, [store, laserEyes, evmDisconnectAsync, solWallet, logoutMut, devEthAccount, evmConnected]);

  const actionsRef = useRef({ connect, authenticate, disconnect, signMessage });
  actionsRef.current = { connect, authenticate, disconnect, signMessage };
  _walletActions = actionsRef.current;

  return <WalletStateSync>{children}</WalletStateSync>;
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

// ── WalletButton + WalletPicker (extracted to wallet-button.tsx) ──
export { WalletButton, WalletPicker } from "./wallet-button";
