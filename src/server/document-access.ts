import type { Document, Signer } from "~/server/db/schema";
import type { UnifiedRequestIdentity } from "~/server/auth-identity";
import { normalizeStoredWalletAddress } from "~/server/wallet-identity";

type SignerIdentityFields = Pick<Signer, "email" | "address" | "chain" | "userId">;

function normalizeViewerEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() ?? null;
}

export function viewerMatchesSigner(signer: SignerIdentityFields, identity: UnifiedRequestIdentity) {
  if (identity.userId && signer.userId && signer.userId === identity.userId) {
    return true;
  }

  const signerEmail = normalizeViewerEmail(signer.email);
  if (signerEmail && identity.email === signerEmail) {
    return true;
  }

  if (!signer.address || !signer.chain) {
    return false;
  }

  const normalizedSignerWallet = normalizeStoredWalletAddress(signer.chain, signer.address);
  return identity.walletAddressSet.has(normalizedSignerWallet.toLowerCase());
}

export function viewerIsCreator(document: Pick<Document, "createdBy">, identity: UnifiedRequestIdentity) {
  if (!document.createdBy) return false;
  const normalizedCreator = document.createdBy.trim().toLowerCase();
  return identity.walletAddressSet.has(normalizedCreator);
}

export function findMatchingSigner<TSigner extends SignerIdentityFields>(
  signers: TSigner[],
  identity: UnifiedRequestIdentity,
) {
  return signers.find((signer) => viewerMatchesSigner(signer, identity)) ?? null;
}

export function resolveDocumentViewerAccess<TSigner extends SignerIdentityFields>(params: {
  document: Pick<Document, "createdBy">;
  signers: TSigner[];
  identity: UnifiedRequestIdentity;
}) {
  const matchingSigner = findMatchingSigner(params.signers, params.identity);
  const creator = viewerIsCreator(params.document, params.identity);

  return {
    isCreator: creator,
    matchingSigner,
    hasSignedAccess: Boolean(matchingSigner),
    canAccessDocument: creator || Boolean(matchingSigner),
  };
}
