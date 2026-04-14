import { NextResponse, type NextRequest } from "next/server";

const localhostHosts = new Set(["localhost", "127.0.0.1"]);
const betterAuthCookieNames = ["better-auth.session_token", "__Secure-better-auth.session_token"];

function isLocalhostRequest(request: NextRequest) {
  return localhostHosts.has(request.nextUrl.hostname);
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
