"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { ReplayDocumentViewer } from "~/components/forensic/replay-document-viewer";
import { Nav } from "~/components/layout/nav";

export default function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  // ?embed=1 strips the global Nav so this page can be iframed cleanly
  // by host apps. Mirrors /sign/[id]?embed=1 — same query, same shape.
  const embed = searchParams?.get("embed") === "1";
  return (
    <>
      {!embed && <Nav />}
      <ReplayDocumentViewer documentId={id} />
    </>
  );
}
