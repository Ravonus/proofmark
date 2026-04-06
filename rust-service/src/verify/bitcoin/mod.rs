//! Bitcoin signature verification: legacy ECDSA + BIP-322 (Taproot/Schnorr, SegWit).

mod bip322;
mod legacy;
mod message;
mod witness;

use super::VerifyResult;
use crate::util::b64;

pub fn verify_btc_signature(address: &str, message: &str, signature_raw: &str) -> VerifyResult {
    let mut debug = Vec::new();

    let raw = if let Ok(bytes) = b64::decode(signature_raw) {
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
            if legacy::verify_legacy_btc_signature(address, message, &raw, &mut debug) {
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

    if let Some(witness_items) = witness::parse_witness_stack(&raw, &mut debug) {
        // P2TR: single 64/65-byte schnorr sig
        if witness_items.len() == 1
            && (witness_items[0].len() == 64 || witness_items[0].len() == 65)
        {
            debug.push("bip322: trying P2TR (single witness item)".into());
            if bip322::verify_taproot(address, message, &witness_items[0], &mut debug) {
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
            if bip322::verify_p2wpkh(address, &witness_items[1], &mut debug) {
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
                    if bip322::verify_taproot(address, message, item, &mut debug) {
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
                if bip322::verify_p2wpkh(address, item, &mut debug) {
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
        if bip322::verify_taproot(address, message, &raw, &mut debug) {
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
        if legacy::verify_legacy_btc_signature(address, message, &raw, &mut debug) {
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
