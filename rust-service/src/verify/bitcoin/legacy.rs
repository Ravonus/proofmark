use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

use super::super::encoding::{hash160, base58check_encode, bech32_encode, bech32m_encode};
use super::message::bitcoin_message_hash;

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

/// Derive multiple Bitcoin address formats from a compressed public key.
/// Returns: [P2PKH, P2SH-P2WPKH, P2WPKH, P2TR] (lowercase).
pub fn addresses_from_pubkey(compressed: &[u8; 33]) -> Vec<String> {
    let mut addrs = Vec::with_capacity(4);

    let pubkey_hash = hash160(compressed);
    addrs.push(base58check_encode(0x00, &pubkey_hash));

    if let Some(addr) = bech32_encode("bc", 0, &pubkey_hash) {
        let witness_program = {
            let mut script = Vec::with_capacity(22);
            script.push(0x00);
            script.push(0x14);
            script.extend_from_slice(&pubkey_hash);
            script
        };
        let script_hash = hash160(&witness_program);
        addrs.push(base58check_encode(0x05, &script_hash));
        addrs.push(addr);
    }

    let x_only = &compressed[1..33];
    if let Some(addr) = bech32m_encode("bc", 1, x_only) {
        addrs.push(addr);
    }

    addrs.into_iter().map(|a| a.to_lowercase()).collect()
}

pub fn verify_legacy_btc_signature(
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
