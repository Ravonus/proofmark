"use client";

import { Nav } from "~/components/layout/nav";
import { VerifyDocument } from "~/components/pages/verify-document";
import { FadeIn, PageTransition } from "~/components/ui/motion";

export function VerifyPageClient({ hash }: { hash: string }) {
  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav badge={{ label: "Verification" }} />

        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
          <FadeIn>
            <VerifyDocument hash={hash} />
          </FadeIn>
        </div>
      </main>
    </PageTransition>
  );
}
