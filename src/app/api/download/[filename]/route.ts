import { type NextRequest, NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { extname } from "path";
import { resolveUnifiedRequestIdentity } from "~/server/auth/auth-identity";
import { db } from "~/server/db";
import { findDocumentById, findSignersByDocumentId } from "~/server/db/compat";
import { resolveDocumentViewerAccess } from "~/server/documents/document-access";
import { getPostSignDownloadPath, sanitizeDownloadName } from "~/server/documents/post-sign-downloads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getContentType(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".json":
      return "application/json";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

/**
 * Auth-gated file download.
 *
 * Requires a valid account session and ?documentId=<contract>.
 * The caller must be the contract creator or a signer who has SIGNED that specific contract.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ filename: string }> }) {
  const { filename: rawFilename } = await params;
  const documentId = request.nextUrl.searchParams.get("documentId");

  if (!documentId) {
    return NextResponse.json({ error: "Document id is required" }, { status: 400 });
  }

  const identity = await resolveUnifiedRequestIdentity(request);
  if (!identity.authSession && !identity.walletSession) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const safe = sanitizeDownloadName(rawFilename);
  if (!safe || safe.includes("..")) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const doc = await findDocumentById(db, documentId);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const matchingDownload = doc.postSignReveal?.downloads?.find((download) => download.filename === safe);
  if (!matchingDownload) {
    return NextResponse.json({ error: "Shared file not found on this contract" }, { status: 404 });
  }

  const docSigners = await findSignersByDocumentId(db, documentId);
  const viewerAccess = resolveDocumentViewerAccess({
    document: doc,
    signers: docSigners,
    identity,
  });
  const isSignedSigner = viewerAccess.matchingSigner?.status === "SIGNED";

  if (!viewerAccess.isCreator && !isSignedSigner) {
    return NextResponse.json({ error: "Access denied for this contract file" }, { status: 403 });
  }

  const filePath = getPostSignDownloadPath(safe);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const fileBuffer = readFileSync(filePath);
  const extension = extname(safe);
  const safeLabel = sanitizeDownloadName(matchingDownload.label).replace(/\.[^.]+$/, "") || "download";
  const responseName = `${safeLabel}${extension}`;

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": getContentType(safe),
      "Content-Disposition": `attachment; filename="${responseName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
