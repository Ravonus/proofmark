import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { type AttachmentFieldValue, decodeStructuredFieldValue } from "~/lib/document/field-values";
import { db } from "~/server/db";
import { documents, signers } from "~/server/db/schema";
import { loadSignerAttachment } from "~/server/documents/attachments";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string; fieldId: string }> },
) {
  const { documentId, fieldId } = await params;
  const claimToken = request.nextUrl.searchParams.get("claim");
  const address = request.nextUrl.searchParams.get("address")?.toLowerCase();

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const docSigners = await db.query.signers.findMany({
    where: eq(signers.documentId, documentId),
  });

  const signer = claimToken
    ? docSigners.find((entry) => entry.claimToken === claimToken)
    : address
      ? docSigners.find((entry) => entry.address?.toLowerCase() === address && entry.status === "SIGNED")
      : null;

  if (!signer && !(address && doc.createdBy.toLowerCase() === address)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const sourceSigner =
    signer ??
    docSigners.find((entry) => {
      const attachment = decodeStructuredFieldValue<AttachmentFieldValue>(entry.fieldValues?.[fieldId]);
      return attachment?.fieldId === fieldId;
    });

  if (!sourceSigner) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  const attachment = decodeStructuredFieldValue<AttachmentFieldValue>(sourceSigner.fieldValues?.[fieldId]);
  if (attachment?.kind !== "attachment") {
    return NextResponse.json({ error: "Attachment metadata not found" }, { status: 404 });
  }

  const { buffer } = await loadSignerAttachment({
    documentId,
    signerId: sourceSigner.id,
    fieldId,
    storedName: attachment.storedName,
  });

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${attachment.originalName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
