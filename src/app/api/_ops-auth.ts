import { NextResponse } from "next/server";
import { env } from "~/env";

export function requireOpsAuthorization(request: Request) {
  if (!env.AUTOMATION_SECRET) {
    return env.NODE_ENV !== "production" ? null : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const header = request.headers.get("authorization");
  return header === `Bearer ${env.AUTOMATION_SECRET}`
    ? null
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
