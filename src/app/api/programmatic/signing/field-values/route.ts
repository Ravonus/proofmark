import { NextResponse, type NextRequest } from "next/server";
import { saveProgrammaticFieldValues } from "~/server/programmatic/signing";
import { programmaticErrorResponse, requireProgrammaticToken } from "../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write", "documents:manage"]);
    return NextResponse.json(await saveProgrammaticFieldValues(token.ownerAddress, await request.json()));
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
