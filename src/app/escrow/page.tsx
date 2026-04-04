"use client";

import { Nav } from "~/components/nav";
import { EscrowDashboard } from "~/components/escrow/escrow-dashboard";
import { FadeIn, PageTransition } from "~/components/ui/motion";

export default function EscrowPage() {
  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav />

        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          <FadeIn className="mb-8">
            <h2 className="text-2xl font-bold">Escrow &amp; Bets</h2>
            <p className="mt-1 text-sm text-muted">
              Create trustless escrows, bets, and agreements — backed by crypto signatures and on-chain settlement
            </p>
          </FadeIn>

          <FadeIn delay={0.12}>
            <EscrowDashboard />
          </FadeIn>
        </div>
      </main>
    </PageTransition>
  );
}
