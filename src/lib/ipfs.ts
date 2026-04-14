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

