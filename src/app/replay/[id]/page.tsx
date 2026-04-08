"use client";

import { use } from "react";
import { ReplayDocumentViewer } from "~/components/forensic/replay-document-viewer";
import { Nav } from "~/components/layout/nav";

export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <>
      <Nav />
      <ReplayDocumentViewer documentId={id} />
    </>
  );
}
