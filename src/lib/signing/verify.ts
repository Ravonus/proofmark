import { createHash } from "node:crypto";
import { verifyMessage as verifyEvmMessage, hexToBytes, recoverPublicKey } from "viem";
import type { WalletChain } from "../crypto/chains";
import { normalizeAddress } from "../crypto/chains";

// ── Debug log collector — attaches to every verification attempt ─────────────
type VerifyResult = { ok: boolean; scheme: string; debug: string[] };

const BITCOIN_MESSAGE_MAGIC = "Bitcoin Signed Message:\n";

function encodeVarInt(length: number): Buffer {
  if (length < 0xfd) return Buffer.from([length]);
  if (length <= 0xffff) {
    const b = Buffer.allocUnsafe(3);
    b[0] = 0xfd;
    b.writeUInt16LE(length, 1);
    return b;
  }
  const b = Buffer.allocUnsafe(5);
  b[0] = 0xfe;
  b.writeUInt32LE(length, 1);
  return b;
}

function sha256(input: Buffer): Buffer {
  return createHash("sha256").update(input).digest();
}

function doubleSha256(input: Buffer): Buffer {
  return sha256(sha256(input));
}

function bitcoinMessageHash(message: string): Buffer {
  const prefix = Buffer.from(BITCOIN_MESSAGE_MAGIC, "utf8");
  const body = Buffer.from(message, "utf8");
  return doubleSha256(Buffer.concat([encodeVarInt(prefix.length), prefix, encodeVarInt(body.length), body]));
}

function compressPublicKey(hex: `0x${string}`): Uint8Array {
  const bytes = hexToBytes(hex);
  if (bytes.length === 33) return bytes;
  if (bytes.length !== 65 || bytes[0] !== 0x04) throw new Error("Bad pubkey format");
  const x = bytes.slice(1, 33);
  const y = bytes.slice(33);
  const prefix = y.at(-1)! % 2 === 0 ? 0x02 : 0x03;
  return new Uint8Array([prefix, ...x]);
}

function readVarInt(buf: Buffer, offset: number): [number, number] {
  const first = buf[offset]!;
  if (first < 0xfd) return [first, 1];
  if (first === 0xfd) return [buf.readUInt16LE(offset + 1), 3];
  if (first === 0xfe) return [buf.readUInt32LE(offset + 1), 5];
  throw new Error("64-bit varint not supported");
}

async function addressesFromPubkey(compressed: Uint8Array): Promise<string[]> {
  const { NETWORK, p2pkh, p2sh, p2tr, p2wpkh } = await import("@scure/btc-signer");
  const xOnly = compressed.slice(1, 33);
  const wrapped = p2wpkh(compressed, NETWORK);
  return [
    p2pkh(compressed, NETWORK).address,
    wrapped.address,
    wrapped.script ? p2sh(wrapped, NETWORK).address : undefined,
    p2tr(xOnly, undefined, NETWORK).address,
  ]
    .filter((a): a is string => typeof a === "string")
    .map((a) => a.toLowerCase());
}

// ── BIP-322 Tagged Hash ──────────────────────────────────────────────────────

function taggedHash(tag: string, ...msgs: Buffer[]): Buffer {
  const tagBuf = Buffer.from(tag, "utf8");
  const tagHash = sha256(tagBuf);
  return sha256(Buffer.concat([tagHash, tagHash, ...msgs]));
}

// ── BIP-322 Transaction Construction ─────────────────────────────────────────

function buildBip322ToSpend(message: string, scriptPubKey: Buffer): Buffer {
  const msgHash = taggedHash("BIP0322-signed-message", Buffer.from(message, "utf8"));
  const scriptSig = Buffer.concat([Buffer.from([0x00, 0x20]), msgHash]);
  return Buffer.concat([
    Buffer.from("00000000", "hex"),
    Buffer.from("01", "hex"),
    Buffer.alloc(32),
    Buffer.from("ffffffff", "hex"),
    encodeVarInt(scriptSig.length),
    scriptSig,
    Buffer.from("00000000", "hex"),
    Buffer.from("01", "hex"),
    Buffer.alloc(8),
    encodeVarInt(scriptPubKey.length),
    scriptPubKey,
    Buffer.from("00000000", "hex"),
  ]);
}

function buildBip322ToSignSighash(toSpendTxid: Buffer, scriptPubKey: Buffer): Buffer {
  const prevouts = sha256(Buffer.concat([toSpendTxid, Buffer.from("00000000", "hex")]));
  const amounts = sha256(Buffer.alloc(8));
  const scriptPubKeys = sha256(Buffer.concat([encodeVarInt(scriptPubKey.length), scriptPubKey]));
  const sequences = sha256(Buffer.from("00000000", "hex"));
  const output = Buffer.concat([Buffer.alloc(8), Buffer.from([0x01, 0x6a])]);
  const hashOutputs = sha256(output);

  const preimage = Buffer.concat([
    Buffer.from([0x00]), // epoch
    Buffer.from([0x00]), // SIGHASH_DEFAULT
    Buffer.from("00000000", "hex"), // nVersion
    Buffer.from("00000000", "hex"), // nLockTime
    prevouts,
    amounts,
    scriptPubKeys,
    sequences,
    hashOutputs,
    Buffer.from([0x00]), // spendType
    Buffer.from("00000000", "hex"), // input index
  ]);

  return taggedHash("TapSighash", preimage);
}

// ── Legacy 65-byte ECDSA ─────────────────────────────────────────────────────

async function verifyLegacyBtcSignature(
  address: string,
  message: string,
  raw: Buffer,
  debug: string[],
): Promise<boolean> {
  const header = raw[0]!;
  debug.push(`legacy: header=0x${header.toString(16)} (${header})`);

  const hash = bitcoinMessageHash(message);
  const r = `0x${raw.subarray(1, 33).toString("hex")}` as const;
  const s = `0x${raw.subarray(33, 65).toString("hex")}` as const;
  const addrLower = address.toLowerCase();

  const flag = header - 27;
  const primaryBit = flag >= 0 ? flag & 3 : 0;
  const attempts = [primaryBit, ...[0, 1, 2, 3].filter((b) => b !== primaryBit)];

  for (const bit of attempts) {
    try {
      const recovered = await recoverPublicKey({
        hash: `0x${hash.toString("hex")}`,
        signature: { r, s, yParity: bit },
      });
      const compressed = compressPublicKey(recovered);
      const candidates = await addressesFromPubkey(compressed);
      debug.push(`legacy: bit=${bit} recovered_addrs=[${candidates.join(", ")}]`);
      if (candidates.includes(addrLower)) return true;
    } catch (e) {
      debug.push(`legacy: bit=${bit} error=${(e as Error).message}`);
    }
  }
  return false;
}

// ── Witness Stack Parser ─────────────────────────────────────────────────────

function parseWitnessStack(buf: Buffer, debug: string[]): Buffer[] | null {
  try {
    let offset = 0;
    const [numItems, numBytes] = readVarInt(buf, offset);
    offset += numBytes;
    const items: Buffer[] = [];
    for (let i = 0; i < numItems; i++) {
      const [len, lenBytes] = readVarInt(buf, offset);
      offset += lenBytes;
      if (offset + len > buf.length) {
        debug.push(`witness: item ${i} overflow (need ${len} bytes at offset ${offset}, have ${buf.length})`);
        return null;
      }
      items.push(Buffer.from(buf.subarray(offset, offset + len)));
      offset += len;
    }
    debug.push(
      `witness: parsed ${items.length} items, sizes=[${items.map((i) => i.length).join(",")}], consumed=${offset}/${buf.length} bytes`,
    );
    return items;
  } catch (e) {
    debug.push(`witness: parse failed: ${(e as Error).message}`);
    return null;
  }
}

// ── BIP-322 Taproot (Schnorr) ────────────────────────────────────────────────

async function verifyBip322TaprootSignature(
  address: string,
  message: string,
  schnorrSig: Buffer,
  debug: string[],
): Promise<boolean> {
  try {
    const { bech32m } = await import("@scure/base");
    const decoded = bech32m.decode(address as `bc1p${string}`);
    const pubkeyBytes = Buffer.from(bech32m.fromWords(decoded.words.slice(1)));
    debug.push(`bip322-p2tr: pubkey_from_addr=${pubkeyBytes.toString("hex")} (${pubkeyBytes.length} bytes)`);
    if (pubkeyBytes.length !== 32) {
      debug.push(`bip322-p2tr: bad pubkey length ${pubkeyBytes.length}, expected 32`);
      return false;
    }

    // The pubkey from the address IS the output key (already tweaked).
    // Build scriptPubKey directly: OP_1 (0x51) PUSH32 (0x20) <output_key>
    // Do NOT pass through p2tr() — that would apply the tweak a second time.
    const scriptPubKey = Buffer.concat([Buffer.from([0x51, 0x20]), pubkeyBytes]);
    debug.push(`bip322-p2tr: scriptPubKey=${scriptPubKey.toString("hex")}`);

    const toSpend = buildBip322ToSpend(message, scriptPubKey);
    const toSpendTxid = doubleSha256(toSpend);
    debug.push(`bip322-p2tr: toSpendTxid=${toSpendTxid.toString("hex")}`);

    const sighash = buildBip322ToSignSighash(toSpendTxid, scriptPubKey);
    debug.push(`bip322-p2tr: sighash=${sighash.toString("hex")}`);

    const { schnorr } = await import("@noble/curves/secp256k1");
    const sig = schnorrSig.length === 65 ? schnorrSig.subarray(0, 64) : schnorrSig;
    debug.push(`bip322-p2tr: sig=${sig.toString("hex")} (${sig.length} bytes)`);

    const ok = schnorr.verify(new Uint8Array(sig), new Uint8Array(sighash), new Uint8Array(pubkeyBytes));
    debug.push(`bip322-p2tr: schnorr.verify=${ok}`);
    return ok;
  } catch (e) {
    debug.push(`bip322-p2tr: error: ${(e as Error).message}`);
    return false;
  }
}

// ── BIP-322 P2WPKH ──────────────────────────────────────────────────────────

async function verifyBip322P2wpkhSignature(address: string, pubkey: Buffer, debug: string[]): Promise<boolean> {
  const candidates = await addressesFromPubkey(new Uint8Array(pubkey));
  debug.push(`bip322-p2wpkh: pubkey=${pubkey.toString("hex")} derived_addrs=[${candidates.join(", ")}]`);
  return candidates.includes(address.toLowerCase());
}

// ── BIP-322 Dispatch ─────────────────────────────────────────────────────────

async function verifyBip322Signature(
  address: string,
  message: string,
  raw: Buffer,
  debug: string[],
): Promise<{ ok: boolean; scheme: string }> {
  const isTaproot = address.toLowerCase().startsWith("bc1p") || address.toLowerCase().startsWith("tb1p");
  debug.push(`bip322: isTaproot=${isTaproot} raw_len=${raw.length} raw_hex=${raw.toString("hex").slice(0, 80)}...`);

  // Try parsing as witness stack
  const witnessItems = parseWitnessStack(raw, debug);

  if (witnessItems) {
    // P2TR: [schnorr_sig(64)] or [schnorr_sig(65 with hashtype)]
    if (witnessItems.length === 1 && (witnessItems[0]!.length === 64 || witnessItems[0]!.length === 65)) {
      debug.push("bip322: trying P2TR (single witness item, 64/65 bytes)");
      const ok = await verifyBip322TaprootSignature(address, message, witnessItems[0]!, debug);
      return { ok, scheme: "BIP322_P2TR" };
    }

    // P2WPKH: [DER_sig, compressed_pubkey(33)]
    if (witnessItems.length === 2 && witnessItems[1]!.length === 33) {
      debug.push("bip322: trying P2WPKH (2 witness items, pubkey=33 bytes)");
      const ok = await verifyBip322P2wpkhSignature(address, witnessItems[1]!, debug);
      return { ok, scheme: "BIP322_P2WPKH" };
    }

    // Try any 64/65 byte item as schnorr sig (taproot)
    if (isTaproot) {
      for (let i = 0; i < witnessItems.length; i++) {
        const item = witnessItems[i]!;
        if (item.length === 64 || item.length === 65) {
          debug.push(`bip322: trying witness item[${i}] (${item.length} bytes) as P2TR schnorr`);
          const ok = await verifyBip322TaprootSignature(address, message, item, debug);
          if (ok) return { ok: true, scheme: "BIP322_P2TR" };
        }
      }
    }

    // Try any 33-byte item as pubkey (p2wpkh)
    for (let i = 0; i < witnessItems.length; i++) {
      const item = witnessItems[i]!;
      if (item.length === 33) {
        debug.push(`bip322: trying witness item[${i}] (33 bytes) as P2WPKH pubkey`);
        const ok = await verifyBip322P2wpkhSignature(address, item, debug);
        if (ok) return { ok: true, scheme: "BIP322_P2WPKH" };
      }
    }
  }

  // Raw bytes might be the sig directly (no witness wrapping)
  if ((raw.length === 64 || raw.length === 65) && isTaproot) {
    debug.push("bip322: trying raw bytes as bare schnorr sig");
    const ok = await verifyBip322TaprootSignature(address, message, raw, debug);
    if (ok) return { ok: true, scheme: "BIP322_P2TR" };
  }

  debug.push("bip322: all attempts exhausted");
  return { ok: false, scheme: "UNKNOWN" };
}

// ── Main BTC Entry Point ─────────────────────────────────────────────────────

async function verifyBtcSignature(address: string, message: string, signatureRaw: string): Promise<VerifyResult> {
  const debug: string[] = [];

  // Decode
  let raw = Buffer.from(signatureRaw, "base64");
  if (raw.length === 0 && /^[0-9a-fA-F]+$/.test(signatureRaw)) {
    raw = Buffer.from(signatureRaw, "hex");
    debug.push("decoded as hex");
  } else {
    debug.push("decoded as base64");
  }

  const isTaproot = address.toLowerCase().startsWith("bc1p") || address.toLowerCase().startsWith("tb1p");
  debug.push(`address=${address}`);
  debug.push(`isTaproot=${isTaproot}`);
  debug.push(`sig_raw_len=${signatureRaw.length} sig_bytes=${raw.length}`);
  debug.push(`first_bytes=0x${raw.subarray(0, 4).toString("hex")}`);
  debug.push(`message_preview=${message.slice(0, 60).replace(/\n/g, "\\n")}...`);

  if (raw.length === 0) return { ok: false, scheme: "UNKNOWN", debug };

  // Legacy 65-byte ECDSA
  if (raw.length === 65) {
    const header = raw[0]!;
    if (header >= 27 && header <= 46) {
      debug.push("trying legacy ECDSA (65 bytes, header in range)");
      const ok = await verifyLegacyBtcSignature(address, message, raw, debug);
      if (ok) return { ok: true, scheme: "BTC_ECDSA_MESSAGE", debug };
    } else {
      debug.push(`skipping legacy: header=0x${header.toString(16)} not in 27-46 range`);
    }
  }

  // BIP-322
  debug.push("trying BIP-322 verification");
  const bip322 = await verifyBip322Signature(address, message, raw, debug);
  if (bip322.ok) return { ...bip322, debug };

  // Last resort legacy
  if (raw.length === 65) {
    debug.push("last resort: trying legacy ECDSA with any header");
    const ok = await verifyLegacyBtcSignature(address, message, raw, debug);
    if (ok) return { ok: true, scheme: "BTC_ECDSA_MESSAGE", debug };
  }

  return { ok: false, scheme: "UNKNOWN", debug };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function verifySignature(params: {
  chain: WalletChain;
  address: string;
  message: string;
  signature: string;
}): Promise<VerifyResult> {
  const addr = normalizeAddress(params.chain, params.address);

  if (params.chain === "ETH") {
    const ok = await verifyEvmMessage({
      address: addr as `0x${string}`,
      message: params.message,
      signature: params.signature as `0x${string}`,
    });
    return { ok, scheme: "EIP191", debug: [] };
  }

  if (params.chain === "SOL") {
    const nacl = (await import("tweetnacl")).default;
    const bs58 = (await import("bs58")).default;
    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode(params.message),
      Buffer.from(params.signature, "base64"),
      bs58.decode(addr),
    );
    return { ok, scheme: "SOLANA_SIGN_MESSAGE", debug: [] };
  }

  return verifyBtcSignature(addr, params.message, params.signature);
}
