import { RevealPageClient } from "./reveal-page-client";

export default async function RevealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RevealPageClient id={id} />;
}
