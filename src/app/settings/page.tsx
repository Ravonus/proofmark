"use client";

import { Nav } from "~/components/layout/nav";
import { UserSettings } from "~/components/settings/user-settings";
import { FadeIn, PageTransition } from "~/components/ui/motion";

export default function SettingsPage() {
  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav />

        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <FadeIn className="mb-6">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.15em] text-muted">Configuration</p>
            <h2 className="text-xl font-semibold tracking-tight">Settings</h2>
            <p className="mt-1 text-[12px] text-muted">
              Manage your account, branding, integrations, and feature access.
            </p>
          </FadeIn>

          <FadeIn delay={0.08}>
            <UserSettings />
          </FadeIn>
        </div>
      </main>
    </PageTransition>
  );
}
