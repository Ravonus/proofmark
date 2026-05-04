/**
 * Imported PDF storage — for hybrid signing where a signer prints,
 * physically signs, and uploads the scanned PDF back into the system.
 *
 * Backend abstraction lets PR 1 ship with the existing filesystem pattern
 * (matches src/server/documents/attachments.ts) while leaving room for
 * a future S3 backend swap. The schema column `imported_pdf_url` is a
 * URL string regardless of backend, so callers don't care which one ran.
 *
 * URL formats:
 *   - filesystem: `file:///<absolute-path>` (resolved by loadImportedPdf)
 *   - s3 (later): `s3://<bucket>/<key>`
 */

import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const STORAGE_ROOT = path.resolve(
  process.env.PROOFMARK_IMPORTED_PDFS_ROOT ?? path.resolve(process.cwd(), "private", "imported-pdfs"),
);

export type ImportedPdfRecord = {
  /** Backend-agnostic URL (file:// or s3://) for the schema column */
  url: string;
  /** SHA-256 of the bytes — stored on the signer row for tamper detection */
  hash: string;
  /** Byte size — stored on the signer row */
  size: number;
};

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "x";
}

/**
 * Persist an imported scanned PDF for a signer.
 * Returns the URL/hash/size to write to the signers row.
 */
export async function saveImportedPdf(params: {
  documentId: string;
  signerId: string;
  bytes: Uint8Array;
}): Promise<ImportedPdfRecord> {
  const hash = createHash("sha256").update(params.bytes).digest("hex");
  const fileName = `${hash.slice(0, 16)}.pdf`;
  const targetDir = path.join(STORAGE_ROOT, sanitizeId(params.documentId), sanitizeId(params.signerId));
  const absolutePath = path.join(targetDir, fileName);

  await mkdir(targetDir, { recursive: true });
  await writeFile(absolutePath, params.bytes);

  return {
    url: `file://${absolutePath}`,
    hash,
    size: params.bytes.byteLength,
  };
}

/**
 * Load an imported PDF for download/verification. Resolves the URL back to
 * bytes regardless of backend.
 */
export async function loadImportedPdf(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  if (url.startsWith("file://")) {
    const filePath = url.slice("file://".length);
    const buffer = await readFile(filePath);
    return { buffer, contentType: "application/pdf" };
  }
  // Future: s3:// resolution
  throw new Error(`Unsupported imported-pdf URL scheme: ${url.slice(0, 8)}`);
}

/** Verify bytes match the recorded hash. Use before serving cached imports. */
export function verifyImportedPdfIntegrity(bytes: Uint8Array, expectedHash: string): boolean {
  const actual = createHash("sha256").update(bytes).digest("hex");
  return actual === expectedHash;
}
