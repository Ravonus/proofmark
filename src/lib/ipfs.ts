import { createHash } from "crypto";
import { base32 } from "multiformats/bases/base32";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import { sha256 } from "multiformats/hashes/sha2";

// Compute an IPFS CIDv1 (raw + sha256) from content
// This is the same CID you'd get from `ipfs add --cid-version=1 --raw-leaves`
export async function computeIpfsCid(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const hash = await sha256.digest(bytes);
  const cid = CID.create(1, raw.code, hash);
  return cid.toString(base32);
}

// Compute SHA-256 hash (same as what we already store)
export function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// Build the full document manifest that gets stored on IPFS
// This is the canonical representation of a signed document
export function buildDocumentManifest(doc: {
  title: string;
  content: string;
  contentHash: string;
  createdBy: string;
  createdAt: Date;
  signers: Array<{
    label: string;
    address: string | null;
    chain: string | null;
    status: string;
    signature: string | null;
    scheme: string | null;
    signedAt: Date | null;
    handSignatureHash: string | null;
    fieldValues: Record<string, string> | null;
  }>;
}): string {
  const manifest = {
    version: 1,
    type: "proofmark-document",
    title: doc.title,
    contentHash: doc.contentHash,
    content: doc.content,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    signatures: doc.signers
      .filter((s) => s.status === "SIGNED")
      .map((s) => ({
        label: s.label,
        address: s.address,
        chain: s.chain,
        signature: s.signature,
        scheme: s.scheme,
        signedAt: s.signedAt?.toISOString() ?? null,
        handSignatureHash: s.handSignatureHash,
        fieldValues: s.fieldValues,
      })),
  };
  return JSON.stringify(manifest, null, 2);
}

// IPFS gateway URL for a CID
export function ipfsGatewayUrl(cid: string): string {
  return `https://ipfs.io/ipfs/${cid}`;
}

// Instructions for CLI verification
export function cliVerificationInstructions(cid: string, contentHash: string): string {
  return `
# Verify this document on IPFS

## Option 1: Via IPFS Gateway
curl -s https://ipfs.io/ipfs/${cid} | sha256sum
# Should match: ${contentHash}

## Option 2: Via local IPFS node
ipfs cat ${cid} | sha256sum
# Should match: ${contentHash}

## Option 3: Pin and verify
ipfs pin add ${cid}
ipfs cat ${cid} | python3 -c "import sys,hashlib; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())"
# Should match: ${contentHash}

## Option 4: Verify content hash directly
echo -n '<paste document content>' | sha256sum
# Should match: ${contentHash}
`.trim();
}
