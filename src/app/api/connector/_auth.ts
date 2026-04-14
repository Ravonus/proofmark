import { createHash } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db } from "~/server/db";
import { connectorAccessTokens } from "~/server/db/schema";

export async function authenticateConnector(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const rawToken = authHeader.slice(7);
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");

  const [token] = await db
    .select()
    .from(connectorAccessTokens)
    .where(and(eq(connectorAccessTokens.tokenHash, tokenHash), isNull(connectorAccessTokens.revokedAt)))
    .limit(1);

  if (!token) return null;
  if (token.expiresAt && new Date() > token.expiresAt) return null;

  await db.update(connectorAccessTokens).set({ lastUsedAt: new Date() }).where(eq(connectorAccessTokens.id, token.id));

  return token;
}
