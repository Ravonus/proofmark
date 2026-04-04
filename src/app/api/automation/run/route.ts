import { NextResponse } from "next/server";
import { env } from "~/env";
import { runDocumentAutomationSweep } from "~/server/automation";

export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  if (!env.AUTOMATION_SECRET) {
    return env.NODE_ENV !== "production";
  }

  const header = request.headers.get("authorization");
  return header === `Bearer ${env.AUTOMATION_SECRET}`;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runDocumentAutomationSweep();
  return NextResponse.json(result);
}
