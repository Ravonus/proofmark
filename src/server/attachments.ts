import { randomBytes } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { AttachmentFieldValue } from "~/lib/field-values";

const ATTACHMENT_ROOT = path.resolve(process.cwd(), "private", "signer-attachments");

function sanitizeName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 120) || "attachment"
  );
}

export async function saveSignerAttachment(params: {
  documentId: string;
  signerId: string;
  fieldId: string;
  originalName: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<AttachmentFieldValue> {
  const safeOriginalName = sanitizeName(params.originalName);
  const storedName = `${Date.now()}-${randomBytes(6).toString("hex")}-${safeOriginalName}`;
  const targetDir = path.join(ATTACHMENT_ROOT, params.documentId, params.signerId, params.fieldId);
  const absolutePath = path.join(targetDir, storedName);

  await mkdir(targetDir, { recursive: true });
  await writeFile(absolutePath, params.bytes);

  return {
    kind: "attachment",
    fieldId: params.fieldId,
    originalName: safeOriginalName,
    storedName,
    mimeType: params.mimeType || "application/octet-stream",
    size: params.bytes.byteLength,
    uploadedAt: new Date().toISOString(),
  };
}

export async function loadSignerAttachment(params: {
  documentId: string;
  signerId: string;
  fieldId: string;
  storedName: string;
}) {
  const absolutePath = path.join(
    ATTACHMENT_ROOT,
    params.documentId,
    params.signerId,
    params.fieldId,
    sanitizeName(params.storedName),
  );
  const buffer = await readFile(absolutePath);
  return { buffer, absolutePath };
}
