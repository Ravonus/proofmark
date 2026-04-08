import { createConfig, http } from "wagmi";
import { base, mainnet, sepolia } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";

const chains = [mainnet, sepolia, base] as const;

export const wagmiConfig = createConfig({
  chains,
  multiInjectedProviderDiscovery: true,
  connectors: [injected({ shimDisconnect: true }), coinbaseWallet({ appName: "Proofmark" })],
  transports: Object.fromEntries(chains.map((c) => [c.id, http()])) as Record<
    (typeof chains)[number]["id"],
    ReturnType<typeof http>
  >,
  ssr: true,
});
