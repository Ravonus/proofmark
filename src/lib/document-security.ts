export type SecurityMode = "HASH_ONLY" | "ENCRYPTED_PRIVATE" | "ENCRYPTED_IPFS";

export const SECURITY_MODE_LABELS: Record<SecurityMode, string> = {
  HASH_ONLY: "SHA-256 only",
  ENCRYPTED_PRIVATE: "Encrypted storage",
  ENCRYPTED_IPFS: "Encrypted + IPFS",
};

export const SECURITY_MODE_DESCRIPTIONS: Record<SecurityMode, string> = {
  HASH_ONLY: "Standard mode. The document is verified with its SHA-256 fingerprint only.",
  ENCRYPTED_PRIVATE: "Encrypts the stored document at rest while keeping SHA-256 as the public proof.",
  ENCRYPTED_IPFS: "Encrypts the stored document and computes an IPFS CID for the encrypted payload.",
};

export function deriveSecurityMode(input: {
  encryptedAtRest?: boolean | null;
  ipfsCid?: string | null;
}): SecurityMode {
  if (!input.encryptedAtRest) return "HASH_ONLY";
  return input.ipfsCid ? "ENCRYPTED_IPFS" : "ENCRYPTED_PRIVATE";
}

export function usesEncryptedIpfs(input: {
  encryptedAtRest?: boolean | null;
  ipfsCid?: string | null;
}): boolean {
  return deriveSecurityMode(input) === "ENCRYPTED_IPFS";
}
