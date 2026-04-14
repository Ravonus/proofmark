import { NextResponse } from "next/server";
import { requireOpsAuthorization } from "~/app/api/_ops-auth";
import { runOpsTask } from "~/server/ops/tasks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = requireOpsAuthorization(request);
  if (unauthorized) {
    return unauthorized;
  }

  const outcome = await runOpsTask("automation.sweep");
  return NextResponse.json(outcome.result);
}
