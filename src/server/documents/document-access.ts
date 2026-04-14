import { GROUP_ROLE } from "~/lib/signing/signing-constants";
import type { UnifiedRequestIdentity } from "~/server/auth/auth-identity";
import { normalizeStoredWalletAddress } from "~/server/auth/wallet-identity";
import type { Document, Signer } from "~/server/db/schema";

type SignerIdentityFields = Pick<Signer, "email" | "address" | "chain" | "userId">;
type CreatorFallbackSignerFields = SignerIdentityFields & Partial<Pick<Signer, "groupRole" | "status">>;

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

function findCreatorFallbackSigner<TSigner extends CreatorFallbackSignerFields>(
  signers: TSigner[],
  isCreator: boolean,
) {
  if (!isCreator) return null;

  const discloserCandidates = signers.filter(
    (signer) =>
      signer.groupRole === GROUP_ROLE.DISCLOSER &&
      (signer.status ?? "PENDING") === "PENDING" &&
      !signer.address &&
      !signer.userId,
  );

  return discloserCandidates.length === 1 ? discloserCandidates[0]! : null;
}

export function resolveDocumentViewerAccess<TSigner extends CreatorFallbackSignerFields>(params: {
  document: Pick<Document, "createdBy">;
  signers: TSigner[];
  identity: UnifiedRequestIdentity;
}) {
  const creator = viewerIsCreator(params.document, params.identity);
  const matchingSigner =
    findMatchingSigner(params.signers, params.identity) ?? findCreatorFallbackSigner(params.signers, creator);

  return {
    isCreator: creator,
    matchingSigner,
    hasSignedAccess: Boolean(matchingSigner),
    canAccessDocument: creator || Boolean(matchingSigner),
  };
}
