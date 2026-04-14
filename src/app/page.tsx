"use client";

import { Nav } from "~/components/layout/nav";
import { ProofmarkLandingPage } from "~/components/pages/proofmark-landing-page";
import { PageTransition } from "~/components/ui/motion";

export default function Home() {
  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav />
        <ProofmarkLandingPage />
      </main>
    </PageTransition>
  );
}
