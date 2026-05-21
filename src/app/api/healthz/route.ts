// Cheap liveness probe — used by agorix-frontproxy's active health
// checks to decide whether this container is in the LB rotation. 200 +
// the BUILD_ID so curl probes can also tell which build is serving.
// No DB hit on purpose: if the app process is up enough to handle a
// route, that's what the LB needs to know.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    ok: true,
    buildId: process.env.NEXT_BUILD_ID ?? null,
    ts: Date.now(),
  });
}
