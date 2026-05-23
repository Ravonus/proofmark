// POST /api/system/sign — backend signer for the org's custodial wallet.
// Body: { message: string } — signed via personalSign so the resulting
// signature verifies through the existing recoverAddress paths without
// any verifier-side change.
//
// Auth: same Better Auth session machinery as the rest of the app.
// Today this is gated to the admin@agorix.io user. Future hardening
// can extend it to roles / permissions; for now ownership of the admin
// session IS the permission.
//
// Returned shape mirrors what a browser wallet would yield so callers
// (createDocumentPacket, finalize, etc.) can drop the response into
// signers.signature / signers.address without remapping.
import { NextResponse } from "next/server";
import { getBetterAuthSessionFromHeaders } from "~/server/auth/auth-identity";
import { signMessageAsAdmin } from "~/server/system-wallet/admin-signer";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@agorix.io";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const message = (body as { message?: unknown })?.message;
  if (typeof message !== "string" || message.length === 0) {
    return NextResponse.json({ error: "message (string) is required" }, { status: 400 });
  }

  const session = await getBetterAuthSessionFromHeaders(request as unknown as Request);
  const email = session?.user?.email;
  if (email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return NextResponse.json({ error: "admin session required" }, { status: 403 });
  }

  const signed = await signMessageAsAdmin(message);
  if (!signed) {
    return NextResponse.json({ error: "admin wallet not available" }, { status: 503 });
  }
  return NextResponse.json({
    address: signed.address,
    signature: signed.signature,
    chain: signed.chain,
  });
}
