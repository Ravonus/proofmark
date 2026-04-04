"use client";

import { Nav } from "~/components/nav";
import { AdminPanel } from "~/components/admin-panel";
import { FadeIn, PageTransition } from "~/components/ui/motion";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav />

        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          <FadeIn className="mb-8">
            <h2 className="text-2xl font-bold">Admin</h2>
            <p className="mt-1 text-sm text-muted">Manage users, subscriptions, features, and system configuration.</p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <AdminPanel />
          </FadeIn>
        </div>
      </main>
    </PageTransition>
  );
}
