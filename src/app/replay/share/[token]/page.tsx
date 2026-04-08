"use client";

import { use } from "react";
import { ReplayDocumentViewer } from "~/components/forensic/replay-document-viewer";
import { Nav } from "~/components/layout/nav";

export default function ReplaySharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <>
      <Nav />
      <ReplayDocumentViewer shareToken={token} />
    </>
  );
}
