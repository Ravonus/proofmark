import { NextResponse, type NextRequest } from "next/server";
import {
  getOwnedDocument,
  updateOwnedDocument,
  updateProgrammaticDocumentSchema,
} from "~/server/programmatic/documents";
import { getProgrammaticClientIp, programmaticErrorResponse, requireProgrammaticToken } from "../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:read"]);
    const { id } = await params;
    const document = await getOwnedDocument(token.ownerAddress, id);
    return NextResponse.json({ document });
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write", "documents:manage"]);
    const { id } = await params;
    const input = updateProgrammaticDocumentSchema.parse(await request.json());
    const document = await updateOwnedDocument({
      ownerAddress: token.ownerAddress,
      documentId: id,
      clientIp: getProgrammaticClientIp(request),
      input,
    });

    return NextResponse.json({ document });
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
