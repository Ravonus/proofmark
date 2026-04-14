import { NextResponse, type NextRequest } from "next/server";
import { deleteOwnedSharedFile, readOwnedSharedFile } from "~/server/programmatic/shared-files";
import { programmaticErrorResponse, requireProgrammaticToken } from "../../../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; filename: string }> }) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:read", "documents:manage"]);
    const { id, filename } = await params;
    const file = await readOwnedSharedFile(token.ownerAddress, id, filename);

    return new NextResponse(file.buffer, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.responseName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; filename: string }> }) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write", "documents:manage"]);
    const { id, filename } = await params;
    return NextResponse.json(await deleteOwnedSharedFile(token.ownerAddress, id, filename));
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
