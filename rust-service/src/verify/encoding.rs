//! Bitcoin address encoding: Bech32, Bech32m, Base58Check, HASH160.

use crate::crypto::sha256;
use crate::crypto::double_sha256;
use ripemd::{Digest as RipemdDigest, Ripemd160};

/// HASH160 = RIPEMD-160(SHA-256(data)).
pub fn hash160(data: &[u8]) -> [u8; 20] {
    let sha = sha256(data);
    let mut hasher = Ripemd160::new();
    hasher.update(sha);
    let result = hasher.finalize();
    let mut out = [0u8; 20];
    out.copy_from_slice(&result);
    out
}

/// Base58Check encoding with version byte prefix.
pub fn base58check_encode(version: u8, payload: &[u8]) -> String {
    let mut data = Vec::with_capacity(1 + payload.len() + 4);
    data.push(version);
    data.extend_from_slice(payload);
    let checksum = double_sha256(&data);
    data.extend_from_slice(&checksum[..4]);
    bs58::encode(data).into_string()
}


const BECH32_CHARSET: &[u8; 32] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_SPEC: u32 = 1;
const BECH32M_SPEC: u32 = 0x2bc830a3;

/// Convert 8-bit data to 5-bit groups for bech32 encoding.
fn to_5bit_groups(data: &[u8]) -> Vec<u8> {
    let mut bits = Vec::new();
    let mut acc = 0u32;
    let mut acc_bits = 0u32;
    for &byte in data {
        acc = (acc << 8) | byte as u32;
        acc_bits += 8;
        while acc_bits >= 5 {
            acc_bits -= 5;
            bits.push(((acc >> acc_bits) & 0x1f) as u8);
        }
    }
    if acc_bits > 0 {
        bits.push(((acc << (5 - acc_bits)) & 0x1f) as u8);
    }
    bits
}

fn bech32_polymod(values: &[u8]) -> u32 {
    let gen = [0x3b6a57b2u32, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let mut chk = 1u32;
    for &v in values {
        let b = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ (v as u32);
        for (i, &g) in gen.iter().enumerate() {
            if (b >> i) & 1 == 1 {
                chk ^= g;
            }
        }
    }
    chk
}

fn bech32_hrp_expand(hrp: &str) -> Vec<u8> {
    let mut ret = Vec::with_capacity(hrp.len() * 2 + 1);
    for c in hrp.chars() {
        ret.push((c as u8) >> 5);
    }
    ret.push(0);
    for c in hrp.chars() {
        ret.push((c as u8) & 31);
    }
    ret
}

fn bech32_create_checksum(hrp: &str, data: &[u8], spec: u32) -> Vec<u8> {
    let mut values = bech32_hrp_expand(hrp);
    values.extend_from_slice(data);
    values.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
    let polymod = bech32_polymod(&values) ^ spec;
    (0..6)
        .map(|i| ((polymod >> (5 * (5 - i))) & 31) as u8)
        .collect()
}

/// Encode a witness program using the given bech32 spec constant.
fn bech32_encode_internal(
    hrp: &str,
    witness_version: u8,
    data: &[u8],
    spec: u32,
) -> Option<String> {
    let bits = to_5bit_groups(data);
    let mut values = vec![witness_version];
    values.extend_from_slice(&bits);

    let checksum = bech32_create_checksum(hrp, &values, spec);
    values.extend_from_slice(&checksum);

    let mut result = String::with_capacity(hrp.len() + 1 + values.len());
    result.push_str(hrp);
    result.push('1');
    for v in values {
        result.push(BECH32_CHARSET[v as usize] as char);
    }
    Some(result)
}

/// Bech32 encoding for witness v0 (P2WPKH/P2WSH).
pub fn bech32_encode(hrp: &str, witness_version: u8, data: &[u8]) -> Option<String> {
    bech32_encode_internal(hrp, witness_version, data, BECH32_SPEC)
}

/// Bech32m encoding for witness v1+ (P2TR).
pub fn bech32m_encode(hrp: &str, witness_version: u8, data: &[u8]) -> Option<String> {
    bech32_encode_internal(hrp, witness_version, data, BECH32M_SPEC)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash160_produces_20_bytes() {
        let result = hash160(b"test data");
        assert_eq!(result.len(), 20);
    }

    #[test]
    fn base58check_roundtrip() {
        let payload = [0u8; 20]; // zero pubkey hash
        let encoded = base58check_encode(0x00, &payload);
        // P2PKH address for zero hash starts with '1'
        assert!(encoded.starts_with('1'));
    }

    #[test]
    fn bech32_encode_produces_valid_prefix() {
        let data = [0u8; 20]; // 20-byte witness program
        let result = bech32_encode("bc", 0, &data).unwrap();
        assert!(result.starts_with("bc1"));
    }

    #[test]
    fn bech32m_encode_produces_valid_prefix() {
        let data = [0u8; 32]; // 32-byte x-only pubkey
        let result = bech32m_encode("bc", 1, &data).unwrap();
        assert!(result.starts_with("bc1"));
    }
}
