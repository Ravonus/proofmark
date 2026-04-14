import { NextResponse, type NextRequest } from "next/server";
import { createDocumentSchema } from "~/lib/schemas/document";
import {
  createOwnedDocument,
  listOwnedDocuments,
  listProgrammaticDocumentsQuerySchema,
} from "~/server/programmatic/documents";
import { getProgrammaticClientIp, programmaticErrorResponse, requireProgrammaticToken } from "../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:read"]);
    const input = listProgrammaticDocumentsQuerySchema.parse({
      status: request.nextUrl.searchParams.get("status") ?? undefined,
      limit: request.nextUrl.searchParams.get("limit") ?? undefined,
    });

    return NextResponse.json(await listOwnedDocuments(token.ownerAddress, input));
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write"]);
    const body = createDocumentSchema.parse(await request.json());
    const document = await createOwnedDocument({
      ownerAddress: token.ownerAddress,
      userId: token.userId ?? null,
      clientIp: getProgrammaticClientIp(request),
      input: body,
    });

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
