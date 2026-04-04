import { VerifyPageClient } from "./verify-page-client";

export default async function VerifyPage({ params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  return <VerifyPageClient hash={hash} />;
}
