import { and, eq, gt } from "drizzle-orm";
import { db } from "~/server/db";
import { walletSessions } from "~/server/db/schema";

const SESSION_COOKIE = "w3s_session";

export function getWalletSessionTokenFromCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  const match = new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]*)`).exec(cookieHeader);
  return match ? decodeURIComponent(match[1] ?? "") : null;
}

export async function getWalletSessionFromRequest(request: Request) {
  const token = getWalletSessionTokenFromCookie(request.headers.get("cookie"));
  if (!token) return null;

  const [session] = await db
    .select({
      id: walletSessions.id,
      address: walletSessions.address,
      chain: walletSessions.chain,
      token: walletSessions.token,
      userId: walletSessions.userId,
    })
    .from(walletSessions)
    .where(and(eq(walletSessions.token, token), gt(walletSessions.expiresAt, new Date())))
    .limit(1);

  return session ?? null;
}
