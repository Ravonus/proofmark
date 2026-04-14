import { NextResponse, type NextRequest } from "next/server";
import { saveTemplateSchema } from "~/lib/schemas/document";
import { deleteOwnedTemplate, getOwnedTemplate, updateOwnedTemplate } from "~/server/programmatic/templates";
import { programmaticErrorResponse, requireProgrammaticToken } from "../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const updateTemplateSchema = saveTemplateSchema.omit({ id: true });

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:read", "documents:manage"]);
    const { id } = await params;
    return NextResponse.json(await getOwnedTemplate(token.ownerAddress, id));
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write", "documents:manage"]);
    const { id } = await params;
    const input = updateTemplateSchema.parse(await request.json());
    return NextResponse.json(await updateOwnedTemplate(token.ownerAddress, id, input));
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write", "documents:manage"]);
    const { id } = await params;
    return NextResponse.json(await deleteOwnedTemplate(token.ownerAddress, id));
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
