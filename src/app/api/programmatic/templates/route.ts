import { NextResponse, type NextRequest } from "next/server";
import { saveTemplateSchema } from "~/lib/schemas/document";
import { createOwnedTemplate, listOwnedTemplates } from "~/server/programmatic/templates";
import { programmaticErrorResponse, requireProgrammaticToken } from "../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const createTemplateSchema = saveTemplateSchema.omit({ id: true });

export async function GET(request: NextRequest) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:read", "documents:manage"]);
    return NextResponse.json(await listOwnedTemplates(token.ownerAddress));
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write", "documents:manage"]);
    const input = createTemplateSchema.parse(await request.json());
    return NextResponse.json(await createOwnedTemplate(token.ownerAddress, input), { status: 201 });
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
