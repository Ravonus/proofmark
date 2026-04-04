/**
 * Proof Packet download API route.
 *
 * GET /api/proof-packet/:documentId
 *
 * Returns a ZIP-like bundle containing:
 * - proof-manifest.json (complete evidence manifest)
 * - signed-document.pdf (the signed PDF)
 *
 * For simplicity, we return JSON with embedded base64 PDF.
 * A future version could return an actual ZIP.
 */

import { type NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { resolveUnifiedRequestIdentity } from "~/server/auth-identity";
import { db } from "~/server/db";
import { documents } from "~/server/db/schema";
import { findSignersByDocumentId } from "~/server/db/compat";
import { resolveDocumentViewerAccess } from "~/server/document-access";
import { generateProofPacket } from "~/server/proof-packet";
import { logAuditEvent } from "~/server/rust-engine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const url = new URL(req.url);
  const hashParam = url.searchParams.get("hash") ?? null;

  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const docSigners = await findSignersByDocumentId(db, documentId);
  const identity = await resolveUnifiedRequestIdentity(req);
  const viewerAccess = resolveDocumentViewerAccess({
    document: doc,
    signers: docSigners,
    identity,
  });
  let authorized = false;
  let actor = identity.walletSession?.address ?? identity.email ?? "anonymous";

  if (viewerAccess.canAccessDocument) {
    authorized = true;
  }

  // Content hash access: anyone with the hash can verify
  if (hashParam && doc.contentHash === hashParam) {
    authorized = true;
    actor = "hash-verifier";
  }

  // Completed documents: proof packets are public evidence
  if (doc.status === "COMPLETED") {
    authorized = true;
  }

  if (!authorized) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { manifest, pdf } = await generateProofPacket(documentId);

    // Audit log
    void logAuditEvent({
      documentId,
      eventType: "PROOF_PACKET_GENERATED",
      actor,
      actorType:
        actor === "anonymous" || actor === "hash-verifier" ? "system" : identity.walletSession ? "wallet" : "email",
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

    // Return as JSON with embedded PDF
    return NextResponse.json({
      manifest,
      pdf: pdf.toString("base64"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
