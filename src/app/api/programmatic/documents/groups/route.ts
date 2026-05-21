import { NextResponse, type NextRequest } from "next/server";
import {
  addOwnedRecipientToGroup,
  addToGroupSchema,
  createDocumentGroupSchema,
  createOwnedDocumentGroup,
} from "~/server/programmatic/documents";
import {
  getProgrammaticClientIp,
  programmaticErrorResponse,
  requireProgrammaticToken,
} from "../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/programmatic/documents/groups
 *
 *   Create a multi-recipient document group. One discloser, N
 *   recipients — proofmark spins up N sibling docs sharing a `groupId`.
 *   When the discloser signs ONE sibling, propagateToSibling
 *   auto-copies the signature to every other sibling so the discloser
 *   never has to re-sign per recipient.
 *
 *   Body: { title, content, discloser, recipients[], ... }
 *   Returns: { groupId, documents: [{ documentId, signerLinks[] }, ...] }
 */
export async function POST(request: NextRequest) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write"]);
    const body = createDocumentGroupSchema.parse(await request.json());
    const result = await createOwnedDocumentGroup({
      ownerAddress: token.ownerAddress,
      userId: token.userId ?? null,
      clientIp: getProgrammaticClientIp(request),
      signingHostOverride:
        (token as { signingHostUrl?: string | null }).signingHostUrl ?? null,
      input: body,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}

/**
 * PATCH /api/programmatic/documents/groups
 *
 *   Append a single recipient to an existing group. Inherits content,
 *   branding, and discloser config from the first sibling so the caller
 *   only supplies the new recipient.
 *
 *   Body: { groupId, recipient, title?, content?, ... }
 *   Returns: { groupId, documentId, signerLinks[] }
 */
export async function PATCH(request: NextRequest) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write"]);
    const body = addToGroupSchema.parse(await request.json());
    const result = await addOwnedRecipientToGroup({
      ownerAddress: token.ownerAddress,
      userId: token.userId ?? null,
      clientIp: getProgrammaticClientIp(request),
      signingHostOverride:
        (token as { signingHostUrl?: string | null }).signingHostUrl ?? null,
      input: body,
    });
    return NextResponse.json(result);
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
