import { NextResponse, type NextRequest } from "next/server";
import { listOwnedSharedFiles, upsertOwnedSharedFile } from "~/server/programmatic/shared-files";
import { programmaticErrorResponse, requireProgrammaticToken } from "../../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getTrimmedFormDataValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:read", "documents:manage"]);
    const { id } = await params;
    return NextResponse.json(await listOwnedSharedFiles(token.ownerAddress, id));
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write", "documents:manage", "files:write"]);
    const { id } = await params;
    const formData = await request.formData();
    const file = formData.get("file");
    return NextResponse.json(
      await upsertOwnedSharedFile({
        ownerAddress: token.ownerAddress,
        documentId: id,
        existingFilenameRaw: getTrimmedFormDataValue(formData, "existingFilename"),
        label: getTrimmedFormDataValue(formData, "label"),
        description: getTrimmedFormDataValue(formData, "description"),
        icon: getTrimmedFormDataValue(formData, "icon"),
        uploadedByLabel: getTrimmedFormDataValue(formData, "uploadedByLabel") || undefined,
        file: file instanceof File ? file : null,
      }),
    );
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
