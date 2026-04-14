"use client";

import { Nav } from "~/components/layout/nav";
import { CreateDocument } from "~/components/pages/create-document";
import { FadeIn, PageTransition } from "~/components/ui/motion";

export default function NewDocumentPage() {
  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav />

        <div className="mx-auto max-w-3xl px-4 pb-20 pt-10 sm:px-6">
          <FadeIn className="mb-8">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.15em] text-muted">Create</p>
            <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-secondary">
              Create, sign, and verify agreements with cryptographic wallet signatures.
            </p>
          </FadeIn>

          <FadeIn delay={0.08}>
            <CreateDocument />
          </FadeIn>
        </div>
      </main>
    </PageTransition>
  );
}
