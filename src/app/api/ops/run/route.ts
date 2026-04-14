import { NextResponse } from "next/server";
import { requireOpsAuthorization } from "~/app/api/_ops-auth";
import { opsTaskNames, runOpsTask, type OpsTaskName } from "~/server/ops/tasks";

export const dynamic = "force-dynamic";

function isOpsTaskName(value: unknown): value is OpsTaskName {
  return typeof value === "string" && opsTaskNames.includes(value as OpsTaskName);
}

export async function POST(request: Request) {
  const unauthorized = requireOpsAuthorization(request);
  if (unauthorized) {
    return unauthorized;
  }

  let payload: { task?: unknown };

  try {
    payload = (await request.json()) as { task?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isOpsTaskName(payload.task)) {
    return NextResponse.json(
      {
        error: "Invalid task",
        supportedTasks: [...opsTaskNames],
      },
      { status: 400 },
    );
  }

  const outcome = await runOpsTask(payload.task);
  return NextResponse.json(outcome);
}
