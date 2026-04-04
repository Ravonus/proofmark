//! EVM (Ethereum) EIP-191 personal_sign signature verification.
//!
//! Verifies `personal_sign` messages by recovering the public key from the
//! ECDSA signature over the EIP-191 prefixed hash, then deriving the address
//! from the recovered key.

use k256::ecdsa::{RecoveryId, Signature, VerifyingKey};

use super::VerifyResult;

/// Keccak-256 hash (Ethereum uses keccak, not standard SHA-3).
fn keccak256(data: &[u8]) -> [u8; 32] {
    use sha3::{Digest, Keccak256};
    let mut hasher = Keccak256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

/// Compute the EIP-191 personal message hash.
/// Format: "\x19Ethereum Signed Message:\n" + len(message) + message
fn eip191_hash(message: &str) -> [u8; 32] {
    let prefix = format!("\x19Ethereum Signed Message:\n{}", message.len());
    let mut data = Vec::with_capacity(prefix.len() + message.len());
    data.extend_from_slice(prefix.as_bytes());
    data.extend_from_slice(message.as_bytes());
    keccak256(&data)
}

/// Derive an Ethereum address from an uncompressed public key.
fn pubkey_to_address(pubkey: &VerifyingKey) -> String {
    let encoded = pubkey.to_encoded_point(false);
    let bytes = encoded.as_bytes();
    // Skip the 0x04 prefix byte, hash the remaining 64 bytes
    let hash = keccak256(&bytes[1..]);
    // Address is last 20 bytes
    format!("0x{}", hex::encode(&hash[12..]))
}

/// Verify an EVM EIP-191 personal_sign signature.
/// Mirrors the TypeScript `verifyEvmMessage` from viem.
pub fn verify_evm_signature(address: &str, message: &str, signature_hex: &str) -> VerifyResult {
    let debug = Vec::new();

    // Strip 0x prefix from signature
    let sig_hex = signature_hex.strip_prefix("0x").unwrap_or(signature_hex);

    let sig_bytes = match hex::decode(sig_hex) {
        Ok(b) => b,
        Err(_) => {
            return VerifyResult {
                ok: false,
                scheme: "EIP191".into(),
                debug: vec!["failed to decode signature hex".into()],
            }
        }
    };

    if sig_bytes.len() != 65 {
        return VerifyResult {
            ok: false,
            scheme: "EIP191".into(),
            debug: vec![format!("invalid signature length: {}", sig_bytes.len())],
        };
    }

    let hash = eip191_hash(message);

    // Extract r, s, v from the 65-byte signature
    let r_s = &sig_bytes[..64];
    let v = sig_bytes[64];

    // v is either 27/28 (legacy) or 0/1
    let recovery_id = match v {
        0 | 27 => 0u8,
        1 | 28 => 1u8,
        _ => {
            return VerifyResult {
                ok: false,
                scheme: "EIP191".into(),
                debug: vec![format!("invalid v value: {v}")],
            }
        }
    };

    let signature = match Signature::from_slice(r_s) {
        Ok(s) => s,
        Err(e) => {
            return VerifyResult {
                ok: false,
                scheme: "EIP191".into(),
                debug: vec![format!("invalid signature: {e}")],
            }
        }
    };

    let recid = match RecoveryId::from_byte(recovery_id) {
        Some(r) => r,
        None => {
            return VerifyResult {
                ok: false,
                scheme: "EIP191".into(),
                debug: vec!["invalid recovery id".into()],
            }
        }
    };

    let recovered = match VerifyingKey::recover_from_prehash(&hash, &signature, recid) {
        Ok(key) => key,
        Err(e) => {
            return VerifyResult {
                ok: false,
                scheme: "EIP191".into(),
                debug: vec![format!("recovery failed: {e}")],
            }
        }
    };

    let recovered_addr = pubkey_to_address(&recovered);
    let ok = recovered_addr.to_lowercase() == address.to_lowercase();

    VerifyResult {
        ok,
        scheme: "EIP191".into(),
        debug,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_eip191_hash_deterministic() {
        let h1 = eip191_hash("hello");
        let h2 = eip191_hash("hello");
        assert_eq!(h1, h2);
    }
}
