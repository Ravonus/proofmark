import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { documents, signers } from "~/server/db/schema";
import { tokenizeDocument } from "~/lib/document-tokens";
import { saveSignerAttachment } from "~/server/attachments";
import { decryptDocument as decryptContent } from "~/server/rust-engine";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const documentId = String(formData.get("documentId") || "");
  const claimToken = String(formData.get("claimToken") || "");
  const fieldId = String(formData.get("fieldId") || "");
  const file = formData.get("file");

  if (!documentId || !claimToken || !fieldId || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing attachment upload fields" }, { status: 400 });
  }

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, documentId),
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const docSigners = await db.query.signers.findMany({
    where: eq(signers.documentId, documentId),
  });
  const signer = docSigners.find((entry) => entry.claimToken === claimToken);
  if (!signer) {
    return NextResponse.json({ error: "Invalid signing link" }, { status: 403 });
  }
  if (signer.status !== "PENDING") {
    return NextResponse.json({ error: "Attachments can only be uploaded while signing is pending" }, { status: 400 });
  }

  const content =
    doc.encryptedAtRest && doc.encryptionKeyWrapped
      ? await decryptContent(doc.content, doc.encryptionKeyWrapped)
      : doc.content;
  const { fields } = tokenizeDocument(content, docSigners.length);
  const signerIdx = signer.signerOrder ?? docSigners.findIndex((entry) => entry.id === signer.id);
  const field = fields.find((entry) => entry.id === fieldId);

  if (field?.type !== "file-attachment") {
    return NextResponse.json({ error: "Attachment field not found" }, { status: 404 });
  }

  if (field.signerIdx !== -1 && field.signerIdx !== signerIdx) {
    return NextResponse.json({ error: "This attachment field belongs to another recipient" }, { status: 403 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const maxSizeMb = Number((field.settings as { maxSizeMb?: number } | undefined)?.maxSizeMb ?? 15);
  if (bytes.byteLength > maxSizeMb * 1024 * 1024) {
    return NextResponse.json({ error: `Attachment exceeds the ${maxSizeMb}MB limit for this field` }, { status: 400 });
  }

  const attachment = await saveSignerAttachment({
    documentId,
    signerId: signer.id,
    fieldId,
    originalName: file.name,
    mimeType: file.type,
    bytes,
  });

  return NextResponse.json({ attachment });
}
