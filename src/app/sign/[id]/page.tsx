import { SignPageClient } from "./sign-client";

export default async function SignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ claim?: string; token?: string; embed?: string }>;
}) {
  const { id } = await params;
  const { claim, token, embed } = await searchParams;

  return <SignPageClient id={id} claim={claim ?? token ?? null} embed={embed === "1"} />;
}
