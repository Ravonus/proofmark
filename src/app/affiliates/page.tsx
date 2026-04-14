"use client";

import { Nav } from "~/components/layout/nav";
import { ProofmarkAffiliatePage } from "~/components/pages/proofmark-affiliate-page";
import { PageTransition } from "~/components/ui/motion";

export default function AffiliatesPage() {
  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav badge={{ label: "Partner Program" }} />
        <ProofmarkAffiliatePage />
      </main>
    </PageTransition>
  );
}
