import { NextResponse, type NextRequest } from "next/server";
import { ProgrammaticApiError } from "~/server/programmatic/errors";
import { uploadProgrammaticSignerAttachment } from "~/server/programmatic/signing";
import { programmaticErrorResponse, requireProgrammaticToken } from "../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getTrimmedFormDataValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write", "documents:manage", "files:write"]);
    const formData = await request.formData();
    const documentId = getTrimmedFormDataValue(formData, "documentId");
    const claimToken = getTrimmedFormDataValue(formData, "claimToken");
    const fieldId = getTrimmedFormDataValue(formData, "fieldId");
    const file = formData.get("file");

    if (!documentId || !claimToken || !fieldId || !(file instanceof File)) {
      throw new ProgrammaticApiError(400, "Missing attachment upload fields");
    }

    return NextResponse.json(
      await uploadProgrammaticSignerAttachment({
        ownerAddress: token.ownerAddress,
        documentId,
        claimToken,
        fieldId,
        file,
      }),
    );
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
