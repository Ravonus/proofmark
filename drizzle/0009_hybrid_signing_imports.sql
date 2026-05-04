-- Hybrid signing: support importing physically-signed PDFs as a signer's signature.
-- Imported signatures carry NO forensic evidence (printed/signed offline) but
-- preserve the original PDF + hash for verification.

-- 1. New enum value for sign method.
ALTER TYPE "sign_method" ADD VALUE IF NOT EXISTS 'MANUAL_IMPORT';--> statement-breakpoint

-- 2. Per-signer columns for tracking import provenance.
ALTER TABLE "signers"
  ADD COLUMN IF NOT EXISTS "signature_source" text DEFAULT 'DIGITAL' NOT NULL,
  ADD COLUMN IF NOT EXISTS "imported_pdf_url" text,
  ADD COLUMN IF NOT EXISTS "imported_pdf_hash" text,
  ADD COLUMN IF NOT EXISTS "imported_pdf_size" integer,
  ADD COLUMN IF NOT EXISTS "imported_at" timestamp;--> statement-breakpoint

-- 3. Document-level: keep a hash of the blank PDF that was exported, so we can
-- prove which printable version a returned scan corresponds to.
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "blank_pdf_hash" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "signers_signature_source_idx"
  ON "signers" USING btree ("signature_source");
