"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { type ReactNode, useState } from "react";
import superjson from "superjson";
import { AccountMergeModal } from "~/components/pages/account-merge-modal";
import { trpc } from "~/lib/platform/trpc";
import { SetupGate } from "../pages/setup-gate";
import { WalletProvider } from "./wallet-provider";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  return process.env.NEXTAUTH_URL ?? "http://localhost:3100";
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: `${getBaseUrl()}/api/trpc`,
          transformer: superjson,
          headers: () => ({
            // Cookie is automatically sent by the browser for same-origin requests
          }),
          fetch: (url, opts) => fetch(url, { ...opts, credentials: "include" }),
        }),
      ],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <SetupGate>
            <AccountMergeModal />
            {children}
          </SetupGate>
        </WalletProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
