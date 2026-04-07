"use client";

import { use } from "react";
import { Nav } from "~/components/layout/nav";
import { EscrowDetail } from "../../../components/escrow/escrow-detail";
import { PageTransition } from "~/components/ui/motion";

export default function EscrowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav />

        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
          <EscrowDetail escrowId={id} />
        </div>
      </main>
    </PageTransition>
  );
}
