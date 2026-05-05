/**
 * Affiliate / referral lifecycle hooks.
 *
 * Stubs that callers in document-packets and document-sign-email
 * fire-and-forget. The real implementation lives in the affiliate
 * tracking work (see src/lib/affiliate-tracking.ts and the affiliate
 * router) — these no-ops keep the build green while that logic is
 * being finalized. Drop-in compatible: same names, same signatures,
 * fire-and-forget semantics.
 */

export async function onDocumentCreated(_documentId: string): Promise<void> {
  // no-op: real attribution wiring happens elsewhere
}

export async function onDocumentSigned(_documentId: string, _signerId: string): Promise<void> {
  // no-op: real attribution wiring happens elsewhere
}
