"use client";

import { use } from "react";
import { Nav } from "~/components/nav";
import { ReplayDocumentViewer } from "~/components/forensic/replay-document-viewer";

export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <>
      <Nav />
      <ReplayDocumentViewer documentId={id} />
    </>
  );
}
