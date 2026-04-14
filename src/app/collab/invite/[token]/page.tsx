"use client";

import dynamic from "next/dynamic";
import { isPremiumBuild } from "~/lib/auth/premium-client";

const PremiumPage = dynamic(() => import("~/generated/premium/pages/collab-invite"), { ssr: false });

export default function CollabInvitePage() {
  if (!isPremiumBuild) return <p className="p-8 text-sm text-muted">Premium feature.</p>;
  return <PremiumPage />;
}
