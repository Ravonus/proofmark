import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

export const localhostDevLogin = {
  email: process.env.DEV_LOGIN_EMAIL ?? process.env.ADMIN_EMAIL ?? "dev@proofmark.local",
  password: process.env.DEV_LOGIN_PASSWORD ?? "ProofmarkDev!2026",
  name: process.env.DEV_LOGIN_NAME ?? "Proofmark Admin",
};

const localhostHosts = new Set(["localhost", "127.0.0.1"]);

export function isLocalhostHostname(hostname: string) {
  return localhostHosts.has(hostname);
}

export function isLocalhostDevRequest(request: NextRequest) {
  return isLocalhostHostname(request.nextUrl.hostname);
}

export function buildAuthHeaders(request: NextRequest) {
  const headers = new Headers(request.headers);
  if (!headers.has("origin")) headers.set("origin", request.nextUrl.origin);
  if (!headers.has("host")) headers.set("host", request.nextUrl.host);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return headers;
}

export async function ensureLocalhostDevUser(request: NextRequest) {
  const { db } = await import("~/server/db");
  const { users } = await import("~/server/db/schema");
  const [existingUser] = await db.select().from(users).where(eq(users.email, localhostDevLogin.email)).limit(1);

  if (existingUser) {
    if (!existingUser.emailVerified) {
      await db
        .update(users)
        .set({
          emailVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingUser.id));
    }

    return localhostDevLogin;
  }

  const { auth } = await import("~/server/auth/auth");
  await auth.api.signUpEmail({
    headers: buildAuthHeaders(request),
    body: {
      email: localhostDevLogin.email,
      password: localhostDevLogin.password,
      name: localhostDevLogin.name,
    },
  });

  await db
    .update(users)
    .set({
      emailVerified: true,
      updatedAt: new Date(),
    })
    .where(eq(users.email, localhostDevLogin.email));

  return localhostDevLogin;
}
