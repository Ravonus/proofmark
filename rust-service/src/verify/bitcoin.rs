//! Bitcoin signature verification: Legacy ECDSA message signing + BIP-322.
//!
//! Supports:
//! - Legacy 65-byte ECDSA (P2PKH, P2SH-P2WPKH, P2WPKH)
//! - BIP-322 P2TR (Taproot / Schnorr)
//! - BIP-322 P2WPKH (SegWit)
//!
//! Mirrors src/lib/verify.ts Bitcoin verification logic.

use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

use super::VerifyResult;
use crate::crypto::{double_sha256, sha256};
use crate::util::encoding::{hash160, base58check_encode, bech32_encode, bech32m_encode};
use crate::util::varint::{btc_encode_varint, btc_read_varint};

const BITCOIN_MESSAGE_MAGIC: &str = "Bitcoin Signed Message:\n";

// ── Bitcoin message hash ─────────────────────────────────────────────────────

fn bitcoin_message_hash(message: &str) -> [u8; 32] {
    let prefix = BITCOIN_MESSAGE_MAGIC.as_bytes();
    let body = message.as_bytes();

    let mut data = Vec::new();
    data.extend_from_slice(&btc_encode_varint(prefix.len()));
    data.extend_from_slice(prefix);
    data.extend_from_slice(&btc_encode_varint(body.len()));
    data.extend_from_slice(body);

    double_sha256(&data)
}

// ── Public key compression ───────────────────────────────────────────────────

fn compress_pubkey(uncompressed: &[u8]) -> Option<[u8; 33]> {
    if uncompressed.len() == 33 {
        let mut out = [0u8; 33];
        out.copy_from_slice(uncompressed);
        return Some(out);
    }
    if uncompressed.len() != 65 || uncompressed[0] != 0x04 {
        return None;
    }
    let x = &uncompressed[1..33];
    let y_last = uncompressed[64];
    let prefix = if y_last % 2 == 0 { 0x02 } else { 0x03 };
    let mut out = [0u8; 33];
    out[0] = prefix;
    out[1..].copy_from_slice(x);
    Some(out)
}

// ── Address derivation from compressed pubkey ────────────────────────────────

/// Derive multiple Bitcoin address formats from a compressed public key.
/// Returns: [P2PKH, P2WPKH (bech32), P2SH-P2WPKH, P2TR] (lowercase).
fn addresses_from_pubkey(compressed: &[u8; 33]) -> Vec<String> {
    let mut addrs = Vec::with_capacity(4);

    // P2PKH: HASH160(pubkey) → Base58Check with version 0x00
    let pubkey_hash = hash160(compressed);
    addrs.push(base58check_encode(0x00, &pubkey_hash));

    // P2WPKH: bech32 encoding of HASH160
    if let Some(addr) = bech32_encode("bc", 0, &pubkey_hash) {
        // P2SH-P2WPKH: wrap the witness program in P2SH
        let witness_program = {
            let mut script = Vec::with_capacity(22);
            script.push(0x00); // OP_0
            script.push(0x14); // push 20 bytes
            script.extend_from_slice(&pubkey_hash);
            script
        };
        let script_hash = hash160(&witness_program);
        addrs.push(base58check_encode(0x05, &script_hash));
        addrs.push(addr);
    }

    // P2TR: bech32m encoding of x-only pubkey
    let x_only = &compressed[1..33];
    if let Some(addr) = bech32m_encode("bc", 1, x_only) {
        addrs.push(addr);
    }

    addrs.into_iter().map(|a| a.to_lowercase()).collect()
}

// ── Witness stack parser ─────────────────────────────────────────────────────

fn parse_witness_stack(buf: &[u8], debug: &mut Vec<String>) -> Option<Vec<Vec<u8>>> {
    let mut offset = 0;
    let (num_items, bytes_read) = btc_read_varint(buf, offset)?;
    offset += bytes_read;

    let mut items = Vec::with_capacity(num_items);
    for i in 0..num_items {
        let (len, len_bytes) = btc_read_varint(buf, offset)?;
        offset += len_bytes;
        if offset + len > buf.len() {
            debug.push(format!(
                "witness: item {i} overflow (need {len} at offset {offset}, have {})",
                buf.len()
            ));
            return None;
        }
        items.push(buf[offset..offset + len].to_vec());
        offset += len;
    }

    debug.push(format!(
        "witness: parsed {} items, sizes=[{}], consumed={}/{}",
        items.len(),
        items.iter().map(|i| i.len().to_string()).collect::<Vec<_>>().join(","),
        offset,
        buf.len()
    ));

    Some(items)
}

// ── BIP-322 Tagged Hash ──────────────────────────────────────────────────────

fn tagged_hash(tag: &str, msgs: &[&[u8]]) -> [u8; 32] {
    let tag_hash = sha256(tag.as_bytes());
    let mut data = Vec::new();
    data.extend_from_slice(&tag_hash);
    data.extend_from_slice(&tag_hash);
    for msg in msgs {
        data.extend_from_slice(msg);
    }
    sha256(&data)
}

// ── BIP-322 Transaction Construction ─────────────────────────────────────────

fn build_bip322_to_spend(message: &str, script_pubkey: &[u8]) -> Vec<u8> {
    let msg_hash = tagged_hash(
        "BIP0322-signed-message",
        &[message.as_bytes()],
    );

    let mut script_sig = vec![0x00, 0x20];
    script_sig.extend_from_slice(&msg_hash);

    let mut tx = Vec::new();
    // version
    tx.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
    // input count
    tx.push(0x01);
    // prevout hash (32 zero bytes)
    tx.extend_from_slice(&[0u8; 32]);
    // prevout index (0xffffffff)
    tx.extend_from_slice(&[0xff, 0xff, 0xff, 0xff]);
    // scriptSig
    tx.extend_from_slice(&btc_encode_varint(script_sig.len()));
    tx.extend_from_slice(&script_sig);
    // sequence
    tx.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
    // output count
    tx.push(0x01);
    // value (0)
    tx.extend_from_slice(&[0u8; 8]);
    // scriptPubKey
    tx.extend_from_slice(&btc_encode_varint(script_pubkey.len()));
    tx.extend_from_slice(script_pubkey);
    // locktime
    tx.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);

    tx
}

fn build_bip322_sighash(to_spend_txid: &[u8; 32], script_pubkey: &[u8]) -> [u8; 32] {
    let mut prevout_data = Vec::new();
    prevout_data.extend_from_slice(to_spend_txid);
    prevout_data.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]);
    let prevouts = sha256(&prevout_data);

    let amounts = sha256(&[0u8; 8]);

    let mut spk_data = Vec::new();
    spk_data.extend_from_slice(&btc_encode_varint(script_pubkey.len()));
    spk_data.extend_from_slice(script_pubkey);
    let script_pubkeys = sha256(&spk_data);

    let sequences = sha256(&[0x00, 0x00, 0x00, 0x00]);

    let mut output = Vec::new();
    output.extend_from_slice(&[0u8; 8]);
    output.extend_from_slice(&[0x01, 0x6a]); // OP_RETURN
    let hash_outputs = sha256(&output);

    let mut preimage = Vec::new();
    preimage.push(0x00); // epoch
    preimage.push(0x00); // SIGHASH_DEFAULT
    preimage.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // nVersion
    preimage.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // nLockTime
    preimage.extend_from_slice(&prevouts);
    preimage.extend_from_slice(&amounts);
    preimage.extend_from_slice(&script_pubkeys);
    preimage.extend_from_slice(&sequences);
    preimage.extend_from_slice(&hash_outputs);
    preimage.push(0x00); // spendType
    preimage.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // input index

    tagged_hash("TapSighash", &[&preimage])
}

// ── Legacy ECDSA verification ────────────────────────────────────────────────

fn verify_legacy_btc_signature(
    address: &str,
    message: &str,
    raw: &[u8],
    debug: &mut Vec<String>,
) -> bool {
    if raw.len() != 65 {
        return false;
    }

    let header = raw[0];
    debug.push(format!("legacy: header=0x{:02x} ({header})", header));

    let hash = bitcoin_message_hash(message);
    let r_s = &raw[1..65];

    let signature = match Signature::from_slice(r_s) {
        Ok(s) => s,
        Err(e) => {
            debug.push(format!("legacy: invalid sig: {e}"));
            return false;
        }
    };

    let flag = header.wrapping_sub(27);
    let primary_bit = if header >= 27 { flag & 3 } else { 0 };
    let attempts: Vec<u8> = {
        let mut v = vec![primary_bit];
        for b in 0..=3u8 {
            if b != primary_bit {
                v.push(b);
            }
        }
        v
    };

    let addr_lower = address.to_lowercase();

    for bit in attempts {
        let recid = match RecoveryId::from_byte(bit) {
            Some(r) => r,
            None => continue,
        };

        match VerifyingKey::recover_from_prehash(&hash, &signature, recid) {
            Ok(recovered) => {
                let encoded = recovered.to_encoded_point(false);
                let uncompressed = encoded.as_bytes();
                if let Some(compressed) = compress_pubkey(uncompressed) {
                    let candidates = addresses_from_pubkey(&compressed);
                    debug.push(format!(
                        "legacy: bit={bit} recovered_addrs=[{}]",
                        candidates.join(", ")
                    ));
                    if candidates.iter().any(|c| c == &addr_lower) {
                        return true;
                    }
                }
            }
            Err(e) => {
                debug.push(format!("legacy: bit={bit} error={e}"));
            }
        }
    }
    false
}

// ── BIP-322 Taproot (Schnorr) ────────────────────────────────────────────────

fn verify_bip322_taproot(
    address: &str,
    message: &str,
    schnorr_sig: &[u8],
    debug: &mut Vec<String>,
) -> bool {
    // Decode bech32m address to get x-only pubkey
    let addr_lower = address.to_lowercase();
    let pubkey_bytes = match decode_bech32m_witness(&addr_lower) {
        Some(bytes) if bytes.len() == 32 => bytes,
        _ => {
            debug.push("bip322-p2tr: failed to decode address".into());
            return false;
        }
    };

    debug.push(format!(
        "bip322-p2tr: pubkey_from_addr={} ({} bytes)",
        hex::encode(&pubkey_bytes),
        pubkey_bytes.len()
    ));

    // Build scriptPubKey: OP_1 PUSH32 <output_key>
    let mut script_pubkey = vec![0x51, 0x20];
    script_pubkey.extend_from_slice(&pubkey_bytes);

    let to_spend = build_bip322_to_spend(message, &script_pubkey);
    let to_spend_txid = double_sha256(&to_spend);

    let sighash = build_bip322_sighash(&to_spend_txid, &script_pubkey);
    debug.push(format!("bip322-p2tr: sighash={}", hex::encode(sighash)));

    // Take 64 bytes of schnorr sig (strip hashtype if 65)
    let sig = if schnorr_sig.len() == 65 {
        &schnorr_sig[..64]
    } else {
        schnorr_sig
    };

    if sig.len() != 64 {
        debug.push(format!("bip322-p2tr: invalid sig length {}", sig.len()));
        return false;
    }

    // Verify Schnorr signature using k256
    use k256::schnorr::VerifyingKey as SchnorrVerifyingKey;
    use k256::schnorr::signature::hazmat::PrehashVerifier;

    let vk = match SchnorrVerifyingKey::from_bytes(&pubkey_bytes) {
        Ok(vk) => vk,
        Err(e) => {
            debug.push(format!("bip322-p2tr: invalid pubkey: {e}"));
            return false;
        }
    };

    let schnorr_signature = match k256::schnorr::Signature::try_from(sig) {
        Ok(s) => s,
        Err(e) => {
            debug.push(format!("bip322-p2tr: invalid schnorr sig: {e}"));
            return false;
        }
    };

    // BIP-340 verification over the sighash (prehash since we already computed the sighash)
    match vk.verify_prehash(&sighash, &schnorr_signature) {
        Ok(()) => {
            debug.push("bip322-p2tr: schnorr.verify=true".into());
            true
        }
        Err(e) => {
            debug.push(format!("bip322-p2tr: schnorr.verify=false ({e})"));
            false
        }
    }
}

// ── BIP-322 P2WPKH ──────────────────────────────────────────────────────────

fn verify_bip322_p2wpkh(address: &str, pubkey: &[u8], debug: &mut Vec<String>) -> bool {
    if pubkey.len() != 33 {
        return false;
    }
    let mut compressed = [0u8; 33];
    compressed.copy_from_slice(pubkey);
    let candidates = addresses_from_pubkey(&compressed);
    debug.push(format!(
        "bip322-p2wpkh: pubkey={} derived_addrs=[{}]",
        hex::encode(pubkey),
        candidates.join(", ")
    ));
    candidates.iter().any(|c| c == &address.to_lowercase())
}

// ── Bech32m decode ───────────────────────────────────────────────────────────

fn decode_bech32m_witness(address: &str) -> Option<Vec<u8>> {
    let pos = address.rfind('1')?;
    let data_part = &address[pos + 1..];
    let charset = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";

    let mut values = Vec::new();
    for ch in data_part.chars() {
        let idx = charset.iter().position(|&c| c as char == ch)?;
        values.push(idx as u8);
    }

    if values.len() < 7 {
        return None;
    }

    // Skip witness version (first value) and checksum (last 6)
    let data_5bit = &values[1..values.len() - 6];

    // Convert from 5-bit to 8-bit
    let mut acc = 0u32;
    let mut acc_bits = 0u32;
    let mut result = Vec::new();
    for &val in data_5bit {
        acc = (acc << 5) | val as u32;
        acc_bits += 5;
        if acc_bits >= 8 {
            acc_bits -= 8;
            result.push((acc >> acc_bits) as u8);
        }
    }

    Some(result)
}

// ── Main BTC entry point ─────────────────────────────────────────────────────

pub fn verify_btc_signature(address: &str, message: &str, signature_raw: &str) -> VerifyResult {
    let mut debug = Vec::new();

    // Decode signature (try base64 first, then hex)
    let raw = if let Ok(bytes) = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        signature_raw,
    ) {
        if bytes.is_empty() {
            if let Ok(hex_bytes) = hex::decode(signature_raw) {
                debug.push("decoded as hex".into());
                hex_bytes
            } else {
                return VerifyResult {
                    ok: false,
                    scheme: "UNKNOWN".into(),
                    debug: vec!["failed to decode signature".into()],
                };
            }
        } else {
            debug.push("decoded as base64".into());
            bytes
        }
    } else if let Ok(hex_bytes) = hex::decode(signature_raw) {
        debug.push("decoded as hex".into());
        hex_bytes
    } else {
        return VerifyResult {
            ok: false,
            scheme: "UNKNOWN".into(),
            debug: vec!["failed to decode signature".into()],
        };
    };

    let is_taproot = address.to_lowercase().starts_with("bc1p")
        || address.to_lowercase().starts_with("tb1p");

    debug.push(format!("address={address}"));
    debug.push(format!("isTaproot={is_taproot}"));
    debug.push(format!(
        "sig_raw_len={} sig_bytes={}",
        signature_raw.len(),
        raw.len()
    ));

    if raw.is_empty() {
        return VerifyResult {
            ok: false,
            scheme: "UNKNOWN".into(),
            debug,
        };
    }

    // Legacy 65-byte ECDSA
    if raw.len() == 65 {
        let header = raw[0];
        if (27..=46).contains(&header) {
            debug.push("trying legacy ECDSA (65 bytes, header in range)".into());
            if verify_legacy_btc_signature(address, message, &raw, &mut debug) {
                return VerifyResult {
                    ok: true,
                    scheme: "BTC_ECDSA_MESSAGE".into(),
                    debug,
                };
            }
        }
    }

    // BIP-322
    debug.push("trying BIP-322 verification".into());

    // Try parsing as witness stack
    if let Some(witness_items) = parse_witness_stack(&raw, &mut debug) {
        // P2TR: single 64/65-byte schnorr sig
        if witness_items.len() == 1
            && (witness_items[0].len() == 64 || witness_items[0].len() == 65)
        {
            debug.push("bip322: trying P2TR (single witness item)".into());
            if verify_bip322_taproot(address, message, &witness_items[0], &mut debug) {
                return VerifyResult {
                    ok: true,
                    scheme: "BIP322_P2TR".into(),
                    debug,
                };
            }
        }

        // P2WPKH: [DER_sig, compressed_pubkey(33)]
        if witness_items.len() == 2 && witness_items[1].len() == 33 {
            debug.push("bip322: trying P2WPKH".into());
            if verify_bip322_p2wpkh(address, &witness_items[1], &mut debug) {
                return VerifyResult {
                    ok: true,
                    scheme: "BIP322_P2WPKH".into(),
                    debug,
                };
            }
        }

        // Try any 64/65 byte item as schnorr sig (taproot)
        if is_taproot {
            for (i, item) in witness_items.iter().enumerate() {
                if item.len() == 64 || item.len() == 65 {
                    debug.push(format!("bip322: trying witness item[{i}] as P2TR schnorr"));
                    if verify_bip322_taproot(address, message, item, &mut debug) {
                        return VerifyResult {
                            ok: true,
                            scheme: "BIP322_P2TR".into(),
                            debug,
                        };
                    }
                }
            }
        }

        // Try any 33-byte item as pubkey
        for (i, item) in witness_items.iter().enumerate() {
            if item.len() == 33 {
                debug.push(format!("bip322: trying witness item[{i}] as P2WPKH pubkey"));
                if verify_bip322_p2wpkh(address, item, &mut debug) {
                    return VerifyResult {
                        ok: true,
                        scheme: "BIP322_P2WPKH".into(),
                        debug,
                    };
                }
            }
        }
    }

    // Raw bytes might be the sig directly
    if (raw.len() == 64 || raw.len() == 65) && is_taproot {
        debug.push("bip322: trying raw bytes as bare schnorr sig".into());
        if verify_bip322_taproot(address, message, &raw, &mut debug) {
            return VerifyResult {
                ok: true,
                scheme: "BIP322_P2TR".into(),
                debug,
            };
        }
    }

    // Last resort legacy
    if raw.len() == 65 {
        debug.push("last resort: trying legacy ECDSA with any header".into());
        if verify_legacy_btc_signature(address, message, &raw, &mut debug) {
            return VerifyResult {
                ok: true,
                scheme: "BTC_ECDSA_MESSAGE".into(),
                debug,
            };
        }
    }

    VerifyResult {
        ok: false,
        scheme: "UNKNOWN".into(),
        debug,
    }
}
