/**
 * Better Auth catch-all API route.
 * Handles: /api/auth/sign-in, /api/auth/sign-up, /api/auth/magic-link, etc.
 *
 * Also dispatches social-verify OAuth callbacks. Both the login flow and the
 * signer-verification flow share a single callback URL per provider
 * (/api/auth/callback/{provider}) so only one redirect_uri needs to be
 * registered with each OAuth provider. The social-verify flow prefixes its
 * state parameter with "sv:" so we can tell the two apart.
 */

import { toNextJsHandler } from "better-auth/next-js";
import { type NextRequest, NextResponse } from "next/server";
import { auth } from "~/server/auth/auth";

export const dynamic = "force-dynamic";

const { GET: betterAuthGET, POST } = toNextJsHandler(auth);

export { POST };

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const state = url.searchParams.get("state");

  // If this is an OAuth callback with a social-verify state, forward it to
  // the social-verify handler which owns the token exchange + signer update.
  // We use a relative Location header so the browser resolves it against the
  // proxy's domain (not localhost, which is what req.url shows behind a proxy).
  if (url.pathname.startsWith("/api/auth/callback/") && state?.startsWith("sv:")) {
    const target = `/api/social-verify?${url.searchParams.toString()}`;
    return new NextResponse(null, {
      status: 302,
      headers: { Location: target },
    });
  }

  return betterAuthGET(req);
}
