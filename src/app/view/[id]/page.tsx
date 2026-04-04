import type { Metadata } from "next";
import { ViewDocumentClient } from "./view-client";

export const metadata: Metadata = {
  title: "Document Viewer — Proofmark",
};

export default async function ViewDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ViewDocumentClient documentId={id} />;
}
