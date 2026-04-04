import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "~/server/db";

export const dynamic = "force-dynamic";

// Replay share token route: serves replay data for a signed token
// GET /api/replay/:token — returns replay payload for a valid share token

type ReplayShareTokenRow = {
  token: string;
  document_id: string;
  signer_id: string | null;
  created_at: Date;
  expires_at: Date;
  replay_mode: string;
  replay_data: string | null;
  pointer_data: string | null;
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (request.signal.aborted) {
    return NextResponse.json({ error: "request aborted" }, { status: 499 });
  }

  const { token } = await params;

  if (!token || token.length < 16) {
    return NextResponse.json({ error: "invalid token" }, { status: 400 });
  }

  try {
    // Look up the share token in the database
    // Expected table: replay_share_tokens (token, document_id, signer_id, created_at, expires_at, replay_data)
    const result = await db.execute<ReplayShareTokenRow>(sql`
      SELECT token, document_id, signer_id, created_at, expires_at, replay_mode, replay_data, pointer_data
      FROM replay_share_tokens
      WHERE token = ${token}
      LIMIT 1
    `);

    const row = (result as unknown as ReplayShareTokenRow[])[0];
    if (!row) {
      return NextResponse.json({ error: "token not found" }, { status: 404 });
    }

    const expiresAt = new Date(row.expires_at);
    if (expiresAt < new Date()) {
      return NextResponse.json({ error: "token expired" }, { status: 410 });
    }

    // For embedded mode, return the full replay tape
    if (row.replay_mode === "embedded" && row.replay_data) {
      return NextResponse.json({
        mode: "embedded",
        documentId: row.document_id,
        signerId: row.signer_id,
        replay: JSON.parse(row.replay_data),
      });
    }

    // For external mode, return the pointer
    if (row.replay_mode === "external" && row.pointer_data) {
      return NextResponse.json({
        mode: "external",
        documentId: row.document_id,
        signerId: row.signer_id,
        pointer: JSON.parse(row.pointer_data),
      });
    }

    return NextResponse.json({ error: "no replay data" }, { status: 404 });
  } catch (err) {
    console.error("Replay token lookup error:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
