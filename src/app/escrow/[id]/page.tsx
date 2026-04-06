"use client";

import dynamic from "next/dynamic";
import { isPremiumBuild } from "~/lib/premium-client";

const PremiumPage = dynamic(() => import("../../../../premium/pages/escrow/[id]/page"), { ssr: false });

export default function EscrowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isPremiumBuild) return <p className="p-8 text-sm text-muted">Premium feature.</p>;
  return <PremiumPage params={params} />;
}
