import { NextResponse, type NextRequest } from "next/server";

const localhostHosts = new Set(["localhost", "127.0.0.1"]);
const betterAuthCookieNames = ["better-auth.session_token", "__Secure-better-auth.session_token"];

function isLocalhostRequest(request: NextRequest) {
  // Hard-stop in production: the auto-login dev shortcut should NEVER
  // run against a hosted deployment. Caddy/reverse-proxies sometimes
  // forward with `Host: localhost:3100`, which fooled the previous
  // hostname-only check into redirecting prod traffic to the dev login.
  if (process.env.NODE_ENV === "production") return false;
  // Prefer X-Forwarded-Host when present (proxy-aware) — falls back to
  // the request's own hostname for direct hits.
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || request.nextUrl.hostname;
  const bareHost = host.split(":")[0] ?? host;
  return localhostHosts.has(bareHost);
}

function hasBetterAuthSession(request: NextRequest) {
  return betterAuthCookieNames.some((cookieName) => Boolean(request.cookies.get(cookieName)?.value));
}

function isExcludedPath(pathname: string) {
  return pathname.startsWith("/api/dev/auto-login") || pathname.startsWith("/api/auth");
}

export function middleware(request: NextRequest) {
  if (!isLocalhostRequest(request)) return NextResponse.next();
  if (isExcludedPath(request.nextUrl.pathname)) return NextResponse.next();
  if (hasBetterAuthSession(request)) return NextResponse.next();

  const autoLoginUrl = new URL("/api/dev/auto-login", request.url);
  autoLoginUrl.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(autoLoginUrl, { status: 307 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
