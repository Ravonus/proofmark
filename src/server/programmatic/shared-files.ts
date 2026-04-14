import { existsSync, readFileSync } from "fs";
import { extname } from "path";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { findDocumentById } from "~/server/db/compat";
import { documents } from "~/server/db/schema";
import {
  deriveDownloadLabel,
  getPostSignDownloadPath,
  MAX_POST_SIGN_DOWNLOAD_BYTES,
  type PostSignDownload,
  removePostSignDownloadFile,
  removePostSignRevealDownload,
  sanitizeDownloadName,
  savePostSignDownloadFile,
  upsertPostSignRevealDownload,
} from "~/server/documents/post-sign-downloads";
import { normalizeOwnerAddress } from "~/server/workspace/workspace";
import { ProgrammaticApiError } from "./errors";

const MAX_POST_SIGN_DOWNLOAD_MB = Math.floor(MAX_POST_SIGN_DOWNLOAD_BYTES / (1024 * 1024));

async function assertOwnedDocument(ownerAddress: string, documentId: string) {
  const normalizedOwner = normalizeOwnerAddress(ownerAddress);
  const doc = await findDocumentById(db, documentId);
  if (!doc || normalizeOwnerAddress(doc.createdBy) !== normalizedOwner) {
    throw new ProgrammaticApiError(404, "Document not found");
  }
  return doc;
}

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

function validateExistingFile(
  existingFilenameRaw: string,
  doc: Awaited<ReturnType<typeof findDocumentById>> & object,
): {
  existingFilename: string | null;
  existingDownload: { filename: string; label?: string; icon?: string } | undefined;
} {
  const existingFilename = existingFilenameRaw ? sanitizeDownloadName(existingFilenameRaw) : null;
  const existingDownloads = doc.postSignReveal?.downloads ?? [];
  const existingDownload = existingFilename
    ? existingDownloads.find((download) => download.filename === existingFilename)
    : undefined;

  if (existingFilename && !existingDownload) {
    throw new ProgrammaticApiError(404, "Shared file not found on this contract");
  }

  return { existingFilename, existingDownload };
}

async function processUploadedFile(file: File, documentId: string) {
  if (file.size > MAX_POST_SIGN_DOWNLOAD_BYTES) {
    throw new ProgrammaticApiError(400, `Shared file exceeds the ${MAX_POST_SIGN_DOWNLOAD_MB}MB limit`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return savePostSignDownloadFile({
    documentId,
    originalName: file.name,
    mimeType: file.type,
    bytes,
  });
}

function buildNextDownload(opts: {
  label: string;
  nextFilename: string | undefined;
  file: File | null;
  existingFilename: string | null;
  existingDownload: { filename: string; label?: string; icon?: string } | undefined;
  description: string;
  icon: string;
  uploadedByAddress: string | undefined;
  uploadedByLabel: string;
  uploadedAt: string;
}) {
  const filename = opts.nextFilename ?? sanitizeDownloadName(opts.file ? opts.file.name : "download");

  const download: PostSignDownload = { label: opts.label, filename };
  if (opts.description) download.description = opts.description;

  const resolvedIcon = opts.icon || opts.existingDownload?.icon;
  if (resolvedIcon) download.icon = resolvedIcon;

  if (opts.file) {
    download.uploadedByAddress = opts.uploadedByAddress;
    download.uploadedByLabel = opts.uploadedByLabel;
    download.uploadedAt = opts.uploadedAt;
  }

  return {
    ...(opts.existingFilename ? { previousFilename: opts.existingFilename } : {}),
    nextDownload: download,
  };
}

export async function listOwnedSharedFiles(ownerAddress: string, documentId: string) {
  const doc = await assertOwnedDocument(ownerAddress, documentId);
  return {
    documentId: doc.id,
    reveal: doc.postSignReveal ?? null,
    downloads: doc.postSignReveal?.downloads ?? [],
  };
}

export async function upsertOwnedSharedFile(params: {
  ownerAddress: string;
  documentId: string;
  existingFilenameRaw: string;
  label: string;
  description: string;
  icon: string;
  uploadedByLabel?: string;
  file: File | null;
}) {
  const normalizedOwner = normalizeOwnerAddress(params.ownerAddress);
  const doc = await assertOwnedDocument(normalizedOwner, params.documentId);
  const { existingFilename, existingDownload } = validateExistingFile(params.existingFilenameRaw, doc);

  if (!existingFilename && !params.file) {
    throw new ProgrammaticApiError(400, "Choose a file to add");
  }

  let nextFilename = existingDownload?.filename;
  let uploadedFilename: string | null = null;

  if (params.file) {
    const uploadResult = await processUploadedFile(params.file, params.documentId);
    uploadedFilename = uploadResult.storedName;
    nextFilename = uploadResult.storedName;
  }

  const nextLabel =
    params.label ||
    existingDownload?.label ||
    deriveDownloadLabel(params.file ? params.file.name : (nextFilename ?? "download"));

  const revealInput = buildNextDownload({
    label: nextLabel,
    nextFilename,
    file: params.file,
    existingFilename,
    existingDownload,
    description: params.description,
    icon: params.icon,
    uploadedByAddress: normalizedOwner,
    uploadedByLabel: params.uploadedByLabel?.trim() || "Contract owner",
    uploadedAt: new Date().toISOString(),
  });

  const nextReveal = upsertPostSignRevealDownload(doc.postSignReveal, revealInput);
  await db.update(documents).set({ postSignReveal: nextReveal }).where(eq(documents.id, doc.id));

  if (existingFilename && uploadedFilename && existingFilename !== uploadedFilename) {
    await removePostSignDownloadFile(existingFilename);
  }

  return {
    reveal: nextReveal,
    download: nextReveal.downloads?.find((download) => download.filename === nextFilename) ?? null,
  };
}

export async function deleteOwnedSharedFile(ownerAddress: string, documentId: string, filename: string) {
  const doc = await assertOwnedDocument(ownerAddress, documentId);
  const safeFilename = sanitizeDownloadName(filename);
  const nextReveal = removePostSignRevealDownload(doc.postSignReveal, safeFilename);

  await db.update(documents).set({ postSignReveal: nextReveal }).where(eq(documents.id, doc.id));
  await removePostSignDownloadFile(safeFilename);

  return { reveal: nextReveal };
}

export async function readOwnedSharedFile(ownerAddress: string, documentId: string, filename: string) {
  const doc = await assertOwnedDocument(ownerAddress, documentId);
  const safeFilename = sanitizeDownloadName(filename);
  const matchingDownload = doc.postSignReveal?.downloads?.find((download) => download.filename === safeFilename);

  if (!matchingDownload) {
    throw new ProgrammaticApiError(404, "Shared file not found on this contract");
  }

  const filePath = getPostSignDownloadPath(safeFilename);
  if (!existsSync(filePath)) {
    throw new ProgrammaticApiError(404, "File not found");
  }

  const fileBuffer = readFileSync(filePath);
  const extension = extname(safeFilename);
  const safeLabel = sanitizeDownloadName(matchingDownload.label).replace(/\.[^.]+$/, "") || "download";
  const responseName = `${safeLabel}${extension}`;

  return {
    buffer: fileBuffer,
    contentType: getContentType(safeFilename),
    responseName,
  };
}
