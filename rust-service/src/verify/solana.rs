//! Solana Ed25519 signature verification.
//! Mirrors the Solana verification path from src/lib/verify.ts.

use ed25519_dalek::{Signature, Verifier, VerifyingKey};

use super::VerifyResult;

/// Verify a Solana Ed25519 detached signature.
pub fn verify_sol_signature(address: &str, message: &str, signature_b64: &str) -> VerifyResult {
    let mut debug = Vec::new();

    // Decode the public key from base58
    let pubkey_bytes = match bs58::decode(address).into_vec() {
        Ok(b) if b.len() == 32 => {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&b);
            arr
        }
        Ok(b) => {
            return VerifyResult {
                ok: false,
                scheme: "SOLANA_SIGN_MESSAGE".into(),
                debug: vec![format!("invalid pubkey length: {}", b.len())],
            };
        }
        Err(e) => {
            return VerifyResult {
                ok: false,
                scheme: "SOLANA_SIGN_MESSAGE".into(),
                debug: vec![format!("failed to decode address: {e}")],
            };
        }
    };

    let verifying_key = match VerifyingKey::from_bytes(&pubkey_bytes) {
        Ok(vk) => vk,
        Err(e) => {
            return VerifyResult {
                ok: false,
                scheme: "SOLANA_SIGN_MESSAGE".into(),
                debug: vec![format!("invalid verifying key: {e}")],
            };
        }
    };

    // Decode the signature from base64
    let sig_bytes = match base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        signature_b64,
    ) {
        Ok(b) if b.len() == 64 => {
            let mut arr = [0u8; 64];
            arr.copy_from_slice(&b);
            arr
        }
        Ok(b) => {
            return VerifyResult {
                ok: false,
                scheme: "SOLANA_SIGN_MESSAGE".into(),
                debug: vec![format!("invalid signature length: {}", b.len())],
            };
        }
        Err(e) => {
            return VerifyResult {
                ok: false,
                scheme: "SOLANA_SIGN_MESSAGE".into(),
                debug: vec![format!("failed to decode signature: {e}")],
            };
        }
    };

    let signature = Signature::from_bytes(&sig_bytes);
    let msg_bytes = message.as_bytes();

    let ok = verifying_key.verify(msg_bytes, &signature).is_ok();
    debug.push(format!("ed25519.verify={ok}"));

    VerifyResult {
        ok,
        scheme: "SOLANA_SIGN_MESSAGE".into(),
        debug,
    }
}
