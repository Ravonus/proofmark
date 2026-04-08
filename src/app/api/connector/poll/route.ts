/**
 * OpenClaw Connector HTTP polling endpoint.
 *
 * GET  /api/connector/poll — Connector polls for pending tasks (long-poll, up to 30s)
 * POST /api/connector/poll — Connector submits task results
 *
 * Auth: Bearer token from connectorAccessTokens (SHA-256 hashed for lookup).
 */

import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";
import { connectorSessions, connectorTasks } from "~/server/db/schema";
import { authenticateConnector } from "../_auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/connector/poll
 * Long-poll for pending tasks. Waits up to 30 seconds for a task.
 */
export async function GET(req: NextRequest) {
  const token = await authenticateConnector(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  // Update heartbeat
  await db
    .update(connectorSessions)
    .set({
      status: "online",
      lastHeartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(connectorSessions.id, sessionId), eq(connectorSessions.ownerAddress, token.ownerAddress)));

  // Long-poll: check for tasks every 2 seconds for up to 30 seconds
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const tasks = await db
      .select()
      .from(connectorTasks)
      .where(and(eq(connectorTasks.connectorSessionId, sessionId), eq(connectorTasks.status, "pending")))
      .limit(5);

    if (tasks.length > 0) {
      // Mark as claimed
      for (const task of tasks) {
        await db
          .update(connectorTasks)
          .set({ status: "claimed", claimedAt: new Date() })
          .where(eq(connectorTasks.id, task.id));
      }
      return NextResponse.json({ tasks });
    }

    // Wait 2 seconds before checking again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // No tasks found within timeout
  return NextResponse.json({ tasks: [] });
}

/**
 * POST /api/connector/poll
 * Submit task results.
 */
export async function POST(req: NextRequest) {
  const token = await authenticateConnector(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    taskId: string;
    status: "completed" | "failed";
    result: Record<string, unknown>;
  };

  if (!body.taskId || !body.status) {
    return NextResponse.json({ error: "taskId and status required" }, { status: 400 });
  }

  const [task] = await db
    .select()
    .from(connectorTasks)
    .where(and(eq(connectorTasks.id, body.taskId), eq(connectorTasks.ownerAddress, token.ownerAddress)))
    .limit(1);

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  await db
    .update(connectorTasks)
    .set({
      status: body.status,
      result: body.result,
      completedAt: new Date(),
    })
    .where(eq(connectorTasks.id, body.taskId));

  return NextResponse.json({ ok: true });
}
