"use client";

import { Nav } from "~/components/nav";
import { EscrowCreate } from "~/components/escrow/escrow-create";
import { FadeIn, PageTransition } from "~/components/ui/motion";

export default function EscrowCreatePage() {
  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav />

        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
          <FadeIn className="mb-8">
            <h2 className="text-2xl font-bold">Create Escrow</h2>
            <p className="mt-1 text-sm text-muted">Set up a new bet, escrow, or agreement between parties</p>
          </FadeIn>

          <FadeIn delay={0.12}>
            <EscrowCreate />
          </FadeIn>
        </div>
      </main>
    </PageTransition>
  );
}
