import { type NextRequest, NextResponse } from "next/server";
import { analyzePdfFile, PdfUploadError } from "~/server/documents/pdf-analysis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
    }

    return NextResponse.json(await analyzePdfFile(file));
  } catch (err) {
    if (err instanceof PdfUploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("PDF analysis failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to parse PDF: ${message}` }, { status: 500 });
  }
}
