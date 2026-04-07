import { createConfig, http } from "wagmi";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { mainnet, sepolia, base } from "wagmi/chains";

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
