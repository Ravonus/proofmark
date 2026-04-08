import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { connectorSessions } from "~/server/db/schema";
import { authenticateConnector } from "../_auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = await authenticateConnector(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    connectorVersion?: string;
    machineId?: string;
    label?: string;
    capabilities?: Record<string, unknown>;
  };

  if (!body.machineId) {
    return NextResponse.json({ error: "machineId required" }, { status: 400 });
  }

  const now = new Date();
  const [existing] = await db
    .select()
    .from(connectorSessions)
    .where(and(eq(connectorSessions.ownerAddress, token.ownerAddress), eq(connectorSessions.machineId, body.machineId)))
    .limit(1);

  if (existing) {
    await db
      .update(connectorSessions)
      .set({
        connectorVersion: body.connectorVersion ?? existing.connectorVersion,
        label: body.label ?? existing.label,
        status: "online",
        lastHeartbeatAt: now,
        capabilities: body.capabilities ?? existing.capabilities,
        updatedAt: now,
      })
      .where(eq(connectorSessions.id, existing.id));

    return NextResponse.json({ sessionId: existing.id });
  }

  const [created] = await db
    .insert(connectorSessions)
    .values({
      ownerAddress: token.ownerAddress,
      userId: token.userId ?? null,
      connectorVersion: body.connectorVersion ?? "local-dev",
      machineId: body.machineId,
      label: body.label,
      status: "online",
      lastHeartbeatAt: now,
      capabilities: body.capabilities ?? null,
    })
    .returning();

  return NextResponse.json({ sessionId: created!.id });
}
