import { NextResponse, type NextRequest } from "next/server";
import { getOwnedDocumentProof } from "~/server/programmatic/documents";
import { programmaticErrorResponse, requireProgrammaticToken } from "../../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:read"]);
    const { id } = await params;
    const proof = await getOwnedDocumentProof(token.ownerAddress, id);
    return NextResponse.json(proof);
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
