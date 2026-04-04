"use client";

import { use } from "react";
import { Nav } from "~/components/nav";
import { ReplayDocumentViewer } from "~/components/forensic/replay-document-viewer";

export default function ReplaySharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return (
    <>
      <Nav />
      <ReplayDocumentViewer shareToken={token} />
    </>
  );
}
