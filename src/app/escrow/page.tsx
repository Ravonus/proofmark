"use client";

import dynamic from "next/dynamic";
import { isPremiumBuild } from "~/lib/auth/premium-client";

const PremiumEscrowPage = dynamic(() => import("../../../premium/pages/escrow/page"), { ssr: false });

export default function EscrowPage() {
  if (!isPremiumBuild) return <PremiumNotAvailable feature="Escrow" />;
  return <PremiumEscrowPage />;
}

function PremiumNotAvailable({ feature }: { feature: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted">{feature} is a premium feature.</p>
    </main>
  );
}
