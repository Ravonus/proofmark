import { NextResponse, type NextRequest } from "next/server";
import { auth } from "~/server/auth/auth";
import { getBetterAuthSessionFromHeaders } from "~/server/auth/auth-identity";
import {
  buildAuthHeaders,
  ensureLocalhostDevUser,
  isLocalhostDevRequest,
  localhostDevLogin,
} from "~/server/auth/dev-localhost";

export const dynamic = "force-dynamic";

function getSafeReturnPath(request: NextRequest) {
  const returnTo = request.nextUrl.searchParams.get("returnTo");
  if (!returnTo?.startsWith("/")) return "/dashboard";
  if (returnTo.startsWith("//")) return "/dashboard";
  return returnTo;
}

function applyResponseHeaders(source: Headers | undefined, target: NextResponse) {
  if (!source) return;

  source.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "location" || normalizedKey === "content-length") return;
    if (normalizedKey === "set-cookie") {
      target.headers.append(key, value);
      return;
    }

    target.headers.set(key, value);
  });
}

async function createAutoLoginResponse(request: NextRequest) {
  if (!isLocalhostDevRequest(request)) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  const existingSession = await getBetterAuthSessionFromHeaders(request);
  if (existingSession?.user?.id != null) {
    return {
      email: existingSession.user.email,
      reusedSession: true,
      headers: undefined,
      status: 200,
    };
  }

  await ensureLocalhostDevUser(request);

  const result = await auth.api.signInEmail({
    headers: buildAuthHeaders(request),
    body: {
      email: localhostDevLogin.email,
      password: localhostDevLogin.password,
    },
    returnHeaders: true,
    returnStatus: true,
  });

  return {
    email: localhostDevLogin.email,
    reusedSession: false,
    headers: result.headers ?? undefined,
    status: result.status,
  };
}

export async function GET(request: NextRequest) {
  const result = await createAutoLoginResponse(request);
  if ("error" in result) return result.error;

  const response = NextResponse.redirect(new URL(getSafeReturnPath(request), request.nextUrl.origin), {
    status: 307,
  });
  applyResponseHeaders(result.headers, response);
  return response;
}

export async function POST(request: NextRequest) {
  const result = await createAutoLoginResponse(request);
  if ("error" in result) return result.error;

  const response = NextResponse.json(
    {
      ok: true,
      email: result.email,
      reusedSession: result.reusedSession,
    },
    { status: result.status },
  );

  applyResponseHeaders(result.headers, response);
  return response;
}
