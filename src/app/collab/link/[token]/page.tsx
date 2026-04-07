"use client";

import dynamic from "next/dynamic";
import { isPremiumBuild } from "~/lib/auth/premium-client";

const PremiumPage = dynamic(() => import("../../../../../premium/pages/collab/link/[token]/page"), { ssr: false });

export default function CollabLinkPage() {
  if (!isPremiumBuild) return <p className="p-8 text-sm text-muted">Premium feature.</p>;
  return <PremiumPage />;
}
