import { type NextRequest, NextResponse } from "next/server";
import { env } from "~/env";
import { analyzePdf } from "~/server/rust-engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_FILE_SIZE_MB = env.PDF_UPLOAD_MAX_MB;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No PDF file provided" }, { status: 400 });
    }

    if (!file.type.includes("pdf")) {
      return NextResponse.json({ error: "File must be a PDF" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: `File too large (max ${MAX_FILE_SIZE_MB} MB)` }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const result = await analyzePdf(buffer);

    return NextResponse.json(result);
  } catch (err) {
    console.error("PDF analysis failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to parse PDF: ${message}` }, { status: 500 });
  }
}
