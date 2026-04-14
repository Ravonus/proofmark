import { NextResponse, type NextRequest } from "next/server";
import { resendOwnedSignerInvite } from "~/server/programmatic/documents";
import { getProgrammaticClientIp, programmaticErrorResponse, requireProgrammaticToken } from "../../../../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; signerId: string }> }) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write", "documents:manage"]);
    const { id, signerId } = await params;
    return NextResponse.json(
      await resendOwnedSignerInvite({
        ownerAddress: token.ownerAddress,
        documentId: id,
        signerId,
        clientIp: getProgrammaticClientIp(request),
      }),
    );
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
