import { MobileSignClient } from "./mobile-sign-page-client";

export default async function MobileSignPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ mode?: string }>;
}) {
  const { token } = await params;
  const { mode } = await searchParams;
  const signMode = mode === "initials" ? "initials" : "signature";
  return <MobileSignClient token={token} mode={signMode} />;
}
