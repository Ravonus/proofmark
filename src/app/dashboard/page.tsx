"use client";

import { Nav } from "~/components/layout/nav";
import { Dashboard } from "~/components/pages/dashboard";
import { FadeIn, PageTransition } from "~/components/ui/motion";

export default function DashboardPage() {
  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav />

        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <FadeIn className="mb-6">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.15em] text-muted">Dashboard</p>
            <h2 className="text-xl font-semibold tracking-tight">Your Documents</h2>
            <p className="mt-1 text-[12px] text-muted">Track all your NDAs, agreements, and disclosures</p>
          </FadeIn>

          <FadeIn delay={0.08}>
            <Dashboard />
          </FadeIn>
        </div>
      </main>
    </PageTransition>
  );
}
