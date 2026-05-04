import { NextResponse, type NextRequest } from "next/server";
import { importProgrammaticSignature } from "~/server/programmatic/signing";
import { getProgrammaticClientIp, programmaticErrorResponse, requireProgrammaticToken } from "../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Hybrid signing — import a physically-signed PDF for a pending signer.
 *
 * Body (JSON):
 *  - documentId: string
 *  - claimToken: string                           (signer's claim token)
 *  - signatureImage: string                       (data URL, cropped from scan)
 *  - originalPdfBase64: string                    (full scan, base64-encoded)
 *  - fieldValues?: Record<string, string>         (transcribed from the scan)
 *  - signerEmail?: string                         (for post-sign receipts)
 *  - consentText?: string                         (ESIGN/UETA explicit consent)
 *
 * Result: signer marked SIGNED with signMethod=MANUAL_IMPORT and
 * signatureSource=MANUAL_PDF. NO forensics. The scan is stored and its
 * hash is recorded on the signer row for tamper detection.
 */
export async function POST(request: NextRequest) {
  try {
    const token = await requireProgrammaticToken(request, ["documents:write", "documents:manage"]);
    return NextResponse.json(
      await importProgrammaticSignature({
        ownerAddress: token.ownerAddress,
        clientIp: getProgrammaticClientIp(request),
        input: await request.json(),
      }),
    );
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
