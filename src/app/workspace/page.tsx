"use client";

import { Nav } from "~/components/layout/nav";
import { WorkspaceSettings } from "~/components/settings/workspace-settings";
import { FadeIn, PageTransition } from "~/components/ui/motion";

export default function WorkspacePage() {
  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav />

        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
          <FadeIn className="mb-8">
            <h2 className="text-2xl font-bold">Workspace</h2>
            <p className="mt-1 text-sm text-muted">
              Manage operator controls, templates, branding, webhooks, and bring-your-own provider integrations.
            </p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <WorkspaceSettings />
          </FadeIn>
        </div>
      </main>
    </PageTransition>
  );
}
