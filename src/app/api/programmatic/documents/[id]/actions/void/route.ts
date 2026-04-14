import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import { voidOwnedDocument } from "~/server/programmatic/documents";
import { getProgrammaticClientIp, programmaticErrorResponse, requireProgrammaticToken } from "../../../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const voidSchema = z.object({
  reason: z.string().max(500).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write", "documents:manage"]);
    const { id } = await params;
    const input = voidSchema.parse(await request.json().catch(() => ({})));
    return NextResponse.json(
      await voidOwnedDocument({
        ownerAddress: token.ownerAddress,
        documentId: id,
        clientIp: getProgrammaticClientIp(request),
        reason: input.reason,
      }),
    );
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
