import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { resolveUnifiedRequestIdentity } from "~/server/auth/auth-identity";
import { db } from "~/server/db";
import { findDocumentById, findSignersByDocumentId } from "~/server/db/compat";
import { documents } from "~/server/db/schema";
import { resolveDocumentViewerAccess } from "~/server/documents/document-access";
import {
  deriveDownloadLabel,
  MAX_POST_SIGN_DOWNLOAD_BYTES,
  type PostSignDownload,
  removePostSignDownloadFile,
  removePostSignRevealDownload,
  sanitizeDownloadName,
  savePostSignDownloadFile,
  upsertPostSignRevealDownload,
} from "~/server/documents/post-sign-downloads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_POST_SIGN_DOWNLOAD_MB = Math.floor(MAX_POST_SIGN_DOWNLOAD_BYTES / (1024 * 1024));

async function loadAuthorizedDocument(request: NextRequest, documentId: string) {
  const identity = await resolveUnifiedRequestIdentity(request);
  if (!identity.authSession && !identity.walletSession) {
    return {
      error: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }

  const doc = await findDocumentById(db, documentId);
  if (!doc) {
    return {
      error: NextResponse.json({ error: "Document not found" }, { status: 404 }),
    };
  }

  const signers = await findSignersByDocumentId(db, documentId);
  const viewerAccess = resolveDocumentViewerAccess({
    document: doc,
    signers,
    identity,
  });
  const signer = viewerAccess.matchingSigner;
  const hasSignedAccess = signer?.status === "SIGNED";

  if (!viewerAccess.isCreator && !hasSignedAccess) {
    return {
      error: NextResponse.json({ error: "You must sign the contract before uploading documents" }, { status: 403 }),
    };
  }

  return {
    doc,
    identity,
    signer,
    isCreator: viewerAccess.isCreator,
  };
}

function getRequestErrorStatus(message: string): number {
  if (/not found/i.test(message)) return 404;
  if (/required|invalid|missing|large/i.test(message)) return 400;
  return 500;
}

function getFormString(formData: FormData, key: string): string {
  const val = formData.get(key);
  return (typeof val === "string" ? val : "").trim();
}

function validateExistingFile(
  existingFilenameRaw: string,
  doc: Awaited<ReturnType<typeof findDocumentById>> & object,
  isCreator: boolean,
): {
  existingFilename: string | null;
  existingDownload: { filename: string; label?: string; icon?: string } | undefined;
  error?: NextResponse;
} {
  const existingFilename = existingFilenameRaw ? sanitizeDownloadName(existingFilenameRaw) : null;
  const existingDownloads = doc.postSignReveal?.downloads ?? [];
  const existingDownload = existingFilename
    ? existingDownloads.find((download) => download.filename === existingFilename)
    : undefined;

  if (existingFilename && !existingDownload) {
    return {
      existingFilename,
      existingDownload,
      error: NextResponse.json({ error: "Shared file not found on this contract" }, { status: 404 }),
    };
  }

  if (existingFilename && !isCreator) {
    return {
      existingFilename,
      existingDownload,
      error: NextResponse.json(
        {
          error: "Only the contract creator can replace or edit an existing shared document",
        },
        { status: 403 },
      ),
    };
  }

  return { existingFilename, existingDownload };
}

async function processUploadedFile(file: File, documentId: string): Promise<{ storedName: string } | NextResponse> {
  if (file.size > MAX_POST_SIGN_DOWNLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `Shared file exceeds the ${MAX_POST_SIGN_DOWNLOAD_MB}MB limit`,
      },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploaded = await savePostSignDownloadFile({
    documentId,
    originalName: file.name,
    mimeType: file.type,
    bytes,
  });
  return { storedName: uploaded.storedName };
}

function buildNextDownload(opts: {
  label: string;
  nextFilename: string | undefined;
  file: FormDataEntryValue | null;
  existingFilename: string | null;
  existingDownload: { filename: string; label?: string; icon?: string } | undefined;
  description: string;
  icon: string;
  uploadedByAddress: string | undefined;
  uploadedByLabel: string;
  uploadedAt: string;
}) {
  const filename = opts.nextFilename ?? sanitizeDownloadName(opts.file instanceof File ? opts.file.name : "download");

  const download: PostSignDownload = { label: opts.label, filename };
  if (opts.description) download.description = opts.description;

  const resolvedIcon = opts.icon || opts.existingDownload?.icon;
  if (resolvedIcon) download.icon = resolvedIcon;

  if (opts.file instanceof File) {
    download.uploadedByAddress = opts.uploadedByAddress;
    download.uploadedByLabel = opts.uploadedByLabel;
    download.uploadedAt = opts.uploadedAt;
  }

  return {
    ...(opts.existingFilename ? { previousFilename: opts.existingFilename } : {}),
    nextDownload: download,
  };
}

async function handlePostUpload(request: NextRequest, formData: FormData): Promise<NextResponse> {
  const documentId = getFormString(formData, "documentId");
  const existingFilenameRaw = getFormString(formData, "existingFilename");
  const label = getFormString(formData, "label");
  const description = getFormString(formData, "description");
  const icon = getFormString(formData, "icon");
  const file = formData.get("file");

  if (!documentId) {
    return NextResponse.json({ error: "Document id is required" }, { status: 400 });
  }

  const result = await loadAuthorizedDocument(request, documentId);
  if (result.error) return result.error;
  const { doc, identity, isCreator, signer } = result;

  if (!isCreator && !doc.postSignReveal?.enabled) {
    return NextResponse.json(
      {
        error: "This contract is not accepting participant document uploads yet",
      },
      { status: 403 },
    );
  }

  const validated = validateExistingFile(existingFilenameRaw, doc, isCreator);
  if (validated.error) return validated.error;
  const { existingFilename, existingDownload } = validated;

  if (!existingFilename && !(file instanceof File)) {
    return NextResponse.json({ error: "Choose a file to add" }, { status: 400 });
  }

  let nextFilename = existingDownload?.filename;
  let uploadedFilename: string | null = null;

  if (file instanceof File) {
    const uploadResult = await processUploadedFile(file, documentId);
    if (uploadResult instanceof NextResponse) return uploadResult;
    uploadedFilename = uploadResult.storedName;
    nextFilename = uploadResult.storedName;
  }

  const uploadedByLabel = isCreator
    ? "Contract owner"
    : (signer?.label ?? identity.currentUser?.name ?? identity.email ?? "Signed participant");

  const nextLabel =
    label ||
    existingDownload?.label ||
    deriveDownloadLabel(file instanceof File ? file.name : (nextFilename ?? "download"));

  const revealInput = buildNextDownload({
    label: nextLabel,
    nextFilename,
    file,
    existingFilename,
    existingDownload,
    description,
    icon,
    uploadedByAddress: identity.walletSession?.address,
    uploadedByLabel,
    uploadedAt: new Date().toISOString(),
  });

  const nextReveal = upsertPostSignRevealDownload(doc.postSignReveal, revealInput);

  await db.update(documents).set({ postSignReveal: nextReveal }).where(eq(documents.id, doc.id));

  if (existingFilename && uploadedFilename && existingFilename !== uploadedFilename) {
    await removePostSignDownloadFile(existingFilename);
  }

  return NextResponse.json({
    reveal: nextReveal,
    download: nextReveal.downloads?.find((download) => download.filename === nextFilename) ?? null,
  });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    return await handlePostUpload(request, formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update shared file";
    console.error("[document-downloads] POST failed:", message);
    return NextResponse.json({ error: message }, { status: getRequestErrorStatus(message) });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      documentId?: string;
      filename?: string;
    } | null;
    const documentId = body?.documentId?.trim() ?? "";
    const filename = body?.filename?.trim() ?? "";

    if (!documentId || !filename) {
      return NextResponse.json({ error: "Document id and filename are required" }, { status: 400 });
    }

    const result = await loadAuthorizedDocument(request, documentId);
    if (result.error) return result.error;
    const { doc, isCreator } = result;

    if (!isCreator) {
      return NextResponse.json({ error: "Only the contract creator can remove shared documents" }, { status: 403 });
    }

    const safeFilename = sanitizeDownloadName(filename);
    const nextReveal = removePostSignRevealDownload(doc.postSignReveal, safeFilename);

    await db.update(documents).set({ postSignReveal: nextReveal }).where(eq(documents.id, doc.id));
    await removePostSignDownloadFile(safeFilename);

    return NextResponse.json({ reveal: nextReveal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove shared file";
    console.error("[document-downloads] DELETE failed:", message);
    return NextResponse.json({ error: message }, { status: getRequestErrorStatus(message) });
  }
}
