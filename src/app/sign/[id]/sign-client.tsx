"use client";

import { Nav } from "~/components/nav";
import { SignDocument } from "~/components/signing/sign-document";
import { FadeIn, PageTransition } from "~/components/ui/motion";

export function SignPageClient({ id, claim, embed = false }: { id: string; claim: string | null; embed?: boolean }) {
  return (
    <PageTransition>
      <main className="min-h-screen">
        {!embed && <Nav />}

        <div className={`mx-auto px-4 py-10 sm:px-6 ${embed ? "max-w-none" : "max-w-4xl"}`}>
          <FadeIn>
            <SignDocument documentId={id} claimToken={claim} />
          </FadeIn>
        </div>
      </main>
    </PageTransition>
  );
}
