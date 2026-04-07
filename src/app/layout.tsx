import type { Metadata } from "next";
import { Providers } from "~/components/layout/providers";
import { AmbientBackground } from "~/components/layout/ambient-bg";
import "~/styles/globals.css";

export const metadata: Metadata = {
  title: "Proofmark",
  description: "Decentralized document signing with ETH, SOL & BTC wallets",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AmbientBackground />
          <div className="relative z-10">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
