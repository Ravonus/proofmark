"use client";

import { Nav } from "~/components/nav";
import { PostSignReveal } from "~/components/post-sign/post-sign-reveal";
import { FadeIn, PageTransition } from "~/components/ui/motion";

export function RevealPageClient({ id }: { id: string }) {
  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav badge={{ label: "Post-Signing", color: "success" }} />

        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
          <FadeIn>
            <PostSignReveal documentId={id} />
          </FadeIn>
        </div>
      </main>
    </PageTransition>
  );
}
