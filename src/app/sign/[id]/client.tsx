"use client";

import { SignDocument } from "~/components/signing/sign-document";

export function SignDocumentWrapper({ documentId, claimToken }: { documentId: string; claimToken: string | null }) {
  return <SignDocument documentId={documentId} claimToken={claimToken} />;
}
