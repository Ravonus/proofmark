"use client";

import dynamic from "next/dynamic";
import { isPremiumBuild } from "~/lib/auth/premium-client";

const PremiumPage = dynamic(() => import("~/generated/premium/pages/collab-link"), { ssr: false });

export default function CollabLinkPage() {
  if (!isPremiumBuild) return <p className="p-8 text-sm text-muted">Premium feature.</p>;
  return <PremiumPage />;
}
