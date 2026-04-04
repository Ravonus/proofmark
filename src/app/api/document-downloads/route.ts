import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { resolveUnifiedRequestIdentity } from "~/server/auth-identity";
import { db } from "~/server/db";
import { documents } from "~/server/db/schema";
import { resolveDocumentViewerAccess } from "~/server/document-access";
import { findDocumentById, findSignersByDocumentId } from "~/server/db/compat";
import {
  MAX_POST_SIGN_DOWNLOAD_BYTES,
  deriveDownloadLabel,
  removePostSignDownloadFile,
  sanitizeDownloadName,
  savePostSignDownloadFile,
  removePostSignRevealDownload,
  upsertPostSignRevealDownload,
} from "~/server/post-sign-downloads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_POST_SIGN_DOWNLOAD_MB = Math.floor(MAX_POST_SIGN_DOWNLOAD_BYTES / (1024 * 1024));

async function loadAuthorizedDocument(request: NextRequest, documentId: string) {
  const identity = await resolveUnifiedRequestIdentity(request);
  if (!identity.authSession && !identity.walletSession) {
    return { error: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }

  const doc = await findDocumentById(db, documentId);
  if (!doc) {
    return { error: NextResponse.json({ error: "Document not found" }, { status: 404 }) };
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

export async function POST(request: NextRequest) {
  let uploadedFilename: string | null = null;

  try {
    const formData = await request.formData();
    const documentId = String(formData.get("documentId") || "").trim();
    const existingFilenameRaw = String(formData.get("existingFilename") || "").trim();
    const label = String(formData.get("label") || "").trim();
    const description = String(formData.get("description") || "").trim();
    const icon = String(formData.get("icon") || "").trim();
    const file = formData.get("file");

    if (!documentId) {
      return NextResponse.json({ error: "Document id is required" }, { status: 400 });
    }

    const result = await loadAuthorizedDocument(request, documentId);
    if (result.error) return result.error;
    const { doc, identity, isCreator, signer } = result;

    if (!isCreator && !doc.postSignReveal?.enabled) {
      return NextResponse.json(
        { error: "This contract is not accepting participant document uploads yet" },
        { status: 403 },
      );
    }

    const existingFilename = existingFilenameRaw ? sanitizeDownloadName(existingFilenameRaw) : null;
    const existingDownloads = doc.postSignReveal?.downloads ?? [];
    const existingDownload = existingFilename
      ? existingDownloads.find((download) => download.filename === existingFilename)
      : undefined;

    if (existingFilename && !existingDownload) {
      return NextResponse.json({ error: "Shared file not found on this contract" }, { status: 404 });
    }

    if (existingFilename && !isCreator) {
      return NextResponse.json(
        { error: "Only the contract creator can replace or edit an existing shared document" },
        { status: 403 },
      );
    }

    if (!existingFilename && !(file instanceof File)) {
      return NextResponse.json({ error: "Choose a file to add" }, { status: 400 });
    }

    let nextFilename = existingDownload?.filename;

    if (file instanceof File) {
      if (file.size > MAX_POST_SIGN_DOWNLOAD_BYTES) {
        return NextResponse.json(
          { error: `Shared file exceeds the ${MAX_POST_SIGN_DOWNLOAD_MB}MB limit` },
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

      uploadedFilename = uploaded.storedName;
      nextFilename = uploaded.storedName;
    }

    const uploadedByLabel = isCreator
      ? "Contract owner"
      : (signer?.label ?? identity.currentUser?.name ?? identity.email ?? "Signed participant");
    const uploadedByAddress = identity.walletSession?.address;
    const uploadedAt = new Date().toISOString();

    const nextLabel =
      label ||
      existingDownload?.label ||
      deriveDownloadLabel(file instanceof File ? file.name : (nextFilename ?? "download"));
    const nextReveal = upsertPostSignRevealDownload(doc.postSignReveal, {
      ...(existingFilename ? { previousFilename: existingFilename } : {}),
      nextDownload: {
        label: nextLabel,
        filename: nextFilename ?? sanitizeDownloadName(file instanceof File ? file.name : "download"),
        ...(description ? { description } : {}),
        ...(icon || existingDownload?.icon ? { icon: icon || existingDownload?.icon } : {}),
        ...(file instanceof File
          ? {
              uploadedByAddress,
              uploadedByLabel,
              uploadedAt,
            }
          : {}),
      },
    });

    await db.update(documents).set({ postSignReveal: nextReveal }).where(eq(documents.id, doc.id));

    if (existingFilename && uploadedFilename && existingFilename !== uploadedFilename) {
      await removePostSignDownloadFile(existingFilename);
    }

    return NextResponse.json({
      reveal: nextReveal,
      download: nextReveal.downloads?.find((download) => download.filename === nextFilename) ?? null,
    });
  } catch (error) {
    if (uploadedFilename) {
      await removePostSignDownloadFile(uploadedFilename);
    }

    const message = error instanceof Error ? error.message : "Failed to update shared file";
    console.error("[document-downloads] POST failed:", message);
    return NextResponse.json({ error: message }, { status: getRequestErrorStatus(message) });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { documentId?: string; filename?: string } | null;
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
