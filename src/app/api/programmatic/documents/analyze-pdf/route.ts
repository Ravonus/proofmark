import { NextResponse, type NextRequest } from "next/server";
import { analyzePdfFile, PdfUploadError } from "~/server/documents/pdf-analysis";
import { programmaticErrorResponse, requireProgrammaticToken } from "../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    await requireProgrammaticToken(request, ["documents:write", "files:write"]);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new PdfUploadError("No PDF file provided");
    }

    return NextResponse.json(await analyzePdfFile(file));
  } catch (error) {
    if (error instanceof PdfUploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return programmaticErrorResponse(error);
  }
}
