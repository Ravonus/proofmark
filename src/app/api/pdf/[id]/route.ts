/* eslint-disable @typescript-eslint/consistent-type-imports */
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { resolveDocumentContent } from "~/server/api/routers/document-helpers";
import { resolveUnifiedRequestIdentity } from "~/server/auth/auth-identity";
import { generateSignedPDF } from "~/server/crypto/rust-engine";
import { db } from "~/server/db";
import { findSignersByDocumentId } from "~/server/db/compat";
import { documents, pdfStyleTemplates } from "~/server/db/schema";
import { resolveDocumentViewerAccess } from "~/server/documents/document-access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const address = request.nextUrl.searchParams.get("address");
    const claimToken = request.nextUrl.searchParams.get("claim");

    const doc = await db.query.documents.findFirst({
      where: eq(documents.id, id),
    });
    if (!doc) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const docSigners = await findSignersByDocumentId(db, id);
    const identity = await resolveUnifiedRequestIdentity(request);
    const viewerAccess = resolveDocumentViewerAccess({
      document: doc,
      signers: docSigners,
      identity,
    });

    // Access check: must be creator, a signed signer, or have a valid claim token
    let authorized = viewerAccess.isCreator || viewerAccess.matchingSigner?.status === "SIGNED";
    if (address) {
      const addr = address.toLowerCase();
      if (doc.createdBy.toLowerCase() === addr) authorized = true;
      if (docSigners.some((s) => s.address?.toLowerCase() === addr && s.status === "SIGNED")) authorized = true;
    }
    if (claimToken) {
      const claimSigner = docSigners.find((s) => s.claimToken === claimToken);
      if (claimSigner?.status === "SIGNED") authorized = true;
    }

    if (!authorized) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Resolve content (handles encrypted-at-rest documents)
    const resolvedContent = await resolveDocumentContent(doc);

    // Resolve PDF style template if one is assigned
    let styleSettings: import("~/server/db/schema").PdfStyleSettings | null = null;
    if (doc.pdfStyleTemplateId) {
      const template = await db.query.pdfStyleTemplates.findFirst({
        where: eq(pdfStyleTemplates.id, doc.pdfStyleTemplateId),
      });
      if (template) styleSettings = template.settings;
    }

    // Also check query param for theme override (e.g. ?theme=modern)
    const themeOverride = request.nextUrl.searchParams.get("theme");
    if (themeOverride && !styleSettings) {
      styleSettings = {
        themePreset: themeOverride,
      } as import("~/server/db/schema").PdfStyleSettings;
    }

    const baseUrl = process.env.NEXTAUTH_URL ?? "https://docu.technomancy.it";
    const pdfBytes = await generateSignedPDF({
      doc: { ...doc, content: resolvedContent },
      signers: docSigners,
      verifyUrl: `${baseUrl}/verify/${doc.contentHash}`,
      styleSettings,
    });

    const filename = doc.title
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}-signed.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("PDF generation failed:", err);
    return NextResponse.json(
      {
        error: `PDF generation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      },
      { status: 500 },
    );
  }
}
