/* eslint-disable @typescript-eslint/consistent-type-imports */
import { createHash } from "crypto";
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
    // ── Hybrid signing: blank-for-printing mode ──
    // ?unsigned=true returns the contract with NO embedded signatures and all
    // signature blocks rendered as empty lines, suitable for printing and
    // physically signing offline. The blank PDF's hash is stored on the
    // document so an imported scan can be verified as a return of THIS print.
    const unsigned = request.nextUrl.searchParams.get("unsigned") === "true";

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

    // Access check:
    //  - signed PDF: must be creator, a signed signer, or have a valid claim token
    //  - unsigned PDF (for printing): creator OR any signer with valid claim token
    //    (a pending signer should be able to print and sign offline)
    let authorized = viewerAccess.isCreator;
    if (!unsigned) {
      authorized = authorized || viewerAccess.matchingSigner?.status === "SIGNED";
    }
    if (address) {
      const addr = address.toLowerCase();
      if (doc.createdBy.toLowerCase() === addr) authorized = true;
      if (!unsigned && docSigners.some((s) => s.address?.toLowerCase() === addr && s.status === "SIGNED")) {
        authorized = true;
      }
    }
    if (claimToken) {
      const claimSigner = docSigners.find((s) => s.claimToken === claimToken);
      if (claimSigner) {
        if (unsigned) {
          authorized = true; // any claim-token-bearing signer can print
        } else if (claimSigner.status === "SIGNED") {
          authorized = true;
        }
      }
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

    // For blank export, strip every signer's signature data so the PDF renders
    // empty signature lines and field placeholders (printable form).
    const signersForPdf = unsigned
      ? docSigners.map((s) => ({
          ...s,
          status: "PENDING" as const,
          signature: null,
          signedAt: null,
          handSignatureData: null,
          handSignatureHash: null,
          fieldValues: null,
          forensicEvidence: null,
          forensicHash: null,
          finalizationSignature: null,
          finalizationStateHash: null,
          finalizationSignedAt: null,
          finalizationMessage: null,
        }))
      : docSigners;

    const pdfBytes = await generateSignedPDF({
      doc: { ...doc, content: resolvedContent },
      signers: signersForPdf,
      verifyUrl: `${baseUrl}/verify/${doc.contentHash}`,
      styleSettings,
    });

    // Persist the blank PDF hash (idempotent — only on first export) so a
    // returned scan can be tied to this exact print.
    if (unsigned && !doc.blankPdfHash) {
      const blankHash = createHash("sha256").update(pdfBytes).digest("hex");
      await db.update(documents).set({ blankPdfHash: blankHash }).where(eq(documents.id, doc.id));
    }

    const filename = doc.title
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase();
    const suffix = unsigned ? "-blank" : "-signed";

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}${suffix}.pdf"`,
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
