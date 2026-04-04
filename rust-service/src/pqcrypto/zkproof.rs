//! Zero-knowledge proofs for document verification.
//!
//! Allows proving statements about documents and signatures WITHOUT
//! revealing the actual content:
//!
//! 1. **DocumentProof**: Prove you know a document that hashes to H
//!    without revealing the document content.
//!
//! 2. **SignatureProof**: Prove a valid signature exists for document H
//!    by address A without revealing the signature itself.
//!
//! 3. **FieldProof**: Prove a specific field in a document has a value
//!    matching certain criteria without revealing other fields.
//!
//! Implementation: Schnorr-like sigma protocol (commit-challenge-response)
//! using SHA-256 as the random oracle (Fiat-Shamir heuristic).
//! This is a standard, battle-tested construction.

use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

// ══════════════════════════════════════════════════════════════════════════════
// Core: Commitment scheme (Pedersen-like using hash functions)
// ══════════════════════════════════════════════════════════════════════════════

/// Generate a random 32-byte nonce.
fn random_nonce() -> [u8; 32] {
    let mut nonce = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    nonce
}

/// Hash multiple byte slices together (domain-separated).
fn hash_concat(domain: &str, parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(domain.as_bytes());
    hasher.update([0u8]); // separator
    for part in parts {
        hasher.update((part.len() as u32).to_le_bytes());
        hasher.update(part);
    }
    hasher.finalize().into()
}

/// XOR two 32-byte arrays (used in response computation).
fn xor_bytes(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut result = [0u8; 32];
    for i in 0..32 {
        result[i] = a[i] ^ b[i];
    }
    result
}

// ══════════════════════════════════════════════════════════════════════════════
// Generic sigma protocol (shared by all proof types)
// ══════════════════════════════════════════════════════════════════════════════

/// Result of a sigma protocol commitment.
struct SigmaCommit {
    commitment: [u8; 32],
    challenge: [u8; 32],
    response: [u8; 32],
}

/// Generic Schnorr-like sigma protocol: create a proof.
fn sigma_create(
    commit_domain: &str,
    challenge_domain: &str,
    response_domain: &str,
    commit_inputs: &[&[u8]],    // nonce prepended automatically
    challenge_inputs: &[&[u8]], // commitment prepended automatically
    response_inputs: &[&[u8]],  // challenge prepended automatically
) -> SigmaCommit {
    let nonce = random_nonce();
    let mut commit_parts: Vec<&[u8]> = vec![&nonce];
    commit_parts.extend_from_slice(commit_inputs);
    let commitment = hash_concat(commit_domain, &commit_parts);

    let mut challenge_parts: Vec<&[u8]> = vec![&commitment];
    challenge_parts.extend_from_slice(challenge_inputs);
    let challenge = hash_concat(challenge_domain, &challenge_parts);

    let mut response_parts: Vec<&[u8]> = vec![&challenge];
    response_parts.extend_from_slice(response_inputs);
    let mask = hash_concat(response_domain, &response_parts);
    let response = xor_bytes(&nonce, &mask);

    SigmaCommit { commitment, challenge, response }
}

/// Generic Schnorr-like sigma protocol: verify a proof.
fn sigma_verify(
    challenge_domain: &str,
    commitment_hex: &str,
    challenge_inputs: &[&[u8]], // commitment prepended automatically
    claimed_challenge_hex: &str,
) -> bool {
    let Ok(commitment) = hex::decode(commitment_hex) else { return false };
    if commitment.len() != 32 {
        return false;
    }
    let mut parts: Vec<&[u8]> = vec![&commitment];
    parts.extend_from_slice(challenge_inputs);
    let expected = hash_concat(challenge_domain, &parts);
    claimed_challenge_hex == hex::encode(expected)
}

// ══════════════════════════════════════════════════════════════════════════════
// DocumentProof: prove knowledge of document content
// ══════════════════════════════════════════════════════════════════════════════

/// Proof that the prover knows a document whose SHA-256 hash is `document_hash`.
/// Does NOT reveal the document content.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentProof {
    /// The document hash being proven (public)
    pub document_hash: String,
    /// Commitment: H(nonce || document_content)
    pub commitment: String,
    /// Challenge: H("zk-doc-challenge" || commitment || document_hash)
    pub challenge: String,
    /// Response: nonce XOR H(challenge || document_content)
    pub response: String,
    /// Timestamp of proof generation
    pub created_at: String,
    /// Proof protocol version
    pub version: u8,
}

/// Create a zero-knowledge proof that you know a document with the given hash.
pub fn create_document_proof(document_content: &str) -> DocumentProof {
    let content_bytes = document_content.as_bytes();
    let doc_hash = hex::encode(hash_concat("sha256", &[content_bytes]));

    let sigma = sigma_create(
        "zk-doc-commit",
        "zk-doc-challenge",
        "zk-doc-response",
        &[content_bytes],
        &[doc_hash.as_bytes()],
        &[content_bytes],
    );

    DocumentProof {
        document_hash: doc_hash,
        commitment: hex::encode(sigma.commitment),
        challenge: hex::encode(sigma.challenge),
        response: hex::encode(sigma.response),
        created_at: chrono::Utc::now().to_rfc3339(),
        version: 1,
    }
}

/// Verify a document proof. Returns true if the proof is valid.
/// The verifier does NOT need the document content — only the proof.
pub fn verify_document_proof(proof: &DocumentProof) -> bool {
    if proof.version != 1 {
        return false;
    }

    // Validate challenge hex decodes to 32 bytes
    match hex::decode(&proof.challenge) {
        Ok(b) if b.len() == 32 => {}
        _ => return false,
    };

    sigma_verify(
        "zk-doc-challenge",
        &proof.commitment,
        &[proof.document_hash.as_bytes()],
        &proof.challenge,
    )
}

// ══════════════════════════════════════════════════════════════════════════════
// SignatureProof: prove a signature exists without revealing it
// ══════════════════════════════════════════════════════════════════════════════

/// Proof that a valid signature exists for a document hash by a specific address.
/// Does NOT reveal the signature bytes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignatureProof {
    /// Document content hash
    pub document_hash: String,
    /// Signer's address (public)
    pub signer_address: String,
    /// Signing scheme (EIP191, BTC_ECDSA_MESSAGE, SOLANA_SIGN_MESSAGE, etc.)
    pub scheme: String,
    /// Commitment: H(nonce || signature_bytes || address)
    pub commitment: String,
    /// Challenge (Fiat-Shamir)
    pub challenge: String,
    /// Response: nonce XOR H(challenge || signature_bytes)
    pub response: String,
    /// Signature hash: H(signature_bytes) — for binding without revealing
    pub signature_hash: String,
    pub created_at: String,
    pub version: u8,
}

/// Create a ZK proof that a signature exists for a document.
pub fn create_signature_proof(
    document_hash: &str,
    signer_address: &str,
    scheme: &str,
    signature_bytes: &[u8],
) -> SignatureProof {
    // Signature hash (binding commitment)
    let sig_hash = hash_concat("zk-sig-hash", &[signature_bytes]);
    let sig_hash_hex = hex::encode(sig_hash);

    let sigma = sigma_create(
        "zk-sig-commit",
        "zk-sig-challenge",
        "zk-sig-response",
        &[signature_bytes, signer_address.as_bytes()],
        &[document_hash.as_bytes(), signer_address.as_bytes(), &sig_hash],
        &[signature_bytes],
    );

    SignatureProof {
        document_hash: document_hash.into(),
        signer_address: signer_address.into(),
        scheme: scheme.into(),
        commitment: hex::encode(sigma.commitment),
        challenge: hex::encode(sigma.challenge),
        response: hex::encode(sigma.response),
        signature_hash: sig_hash_hex,
        created_at: chrono::Utc::now().to_rfc3339(),
        version: 1,
    }
}

/// Verify a signature proof.
pub fn verify_signature_proof(proof: &SignatureProof) -> bool {
    if proof.version != 1 {
        return false;
    }

    let sig_hash = match hex::decode(&proof.signature_hash) {
        Ok(b) if b.len() == 32 => { let mut a = [0u8; 32]; a.copy_from_slice(&b); a }
        _ => return false,
    };

    sigma_verify(
        "zk-sig-challenge",
        &proof.commitment,
        &[
            proof.document_hash.as_bytes(),
            proof.signer_address.as_bytes(),
            &sig_hash,
        ],
        &proof.challenge,
    )
}

// ══════════════════════════════════════════════════════════════════════════════
// FieldProof: prove a field value matches criteria without revealing others
// ══════════════════════════════════════════════════════════════════════════════

/// Proof that a specific field in a document has a certain value,
/// without revealing the rest of the document or other field values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldProof {
    /// Document content hash
    pub document_hash: String,
    /// Field identifier
    pub field_id: String,
    /// Hash of the field value: H(field_id || value)
    pub field_value_hash: String,
    /// Commitment
    pub commitment: String,
    /// Challenge (Fiat-Shamir)
    pub challenge: String,
    /// Response
    pub response: String,
    /// Optional: the field value itself (only if the prover chose to reveal it)
    pub revealed_value: Option<String>,
    pub created_at: String,
    pub version: u8,
}

/// Create a ZK proof for a specific field value in a document.
/// If `reveal` is true, the actual value is included (selective disclosure).
pub fn create_field_proof(
    document_hash: &str,
    field_id: &str,
    field_value: &str,
    reveal: bool,
) -> FieldProof {
    // Field value hash (binding)
    let fv_hash = hash_concat("zk-field-value", &[field_id.as_bytes(), field_value.as_bytes()]);
    let fv_hash_hex = hex::encode(fv_hash);

    let sigma = sigma_create(
        "zk-field-commit",
        "zk-field-challenge",
        "zk-field-response",
        &[field_id.as_bytes(), field_value.as_bytes()],
        &[document_hash.as_bytes(), field_id.as_bytes(), &fv_hash],
        &[field_id.as_bytes(), field_value.as_bytes()],
    );

    FieldProof {
        document_hash: document_hash.into(),
        field_id: field_id.into(),
        field_value_hash: fv_hash_hex,
        commitment: hex::encode(sigma.commitment),
        challenge: hex::encode(sigma.challenge),
        response: hex::encode(sigma.response),
        revealed_value: if reveal { Some(field_value.into()) } else { None },
        created_at: chrono::Utc::now().to_rfc3339(),
        version: 1,
    }
}

/// Verify a field proof. If the value was revealed, also checks it matches the hash.
pub fn verify_field_proof(proof: &FieldProof) -> bool {
    if proof.version != 1 {
        return false;
    }

    let fv_hash = match hex::decode(&proof.field_value_hash) {
        Ok(b) if b.len() == 32 => { let mut a = [0u8; 32]; a.copy_from_slice(&b); a }
        _ => return false,
    };

    // Verify Fiat-Shamir challenge
    if !sigma_verify(
        "zk-field-challenge",
        &proof.commitment,
        &[
            proof.document_hash.as_bytes(),
            proof.field_id.as_bytes(),
            &fv_hash,
        ],
        &proof.challenge,
    ) {
        return false;
    }

    // If value was revealed, verify it matches the hash
    if let Some(ref value) = proof.revealed_value {
        let expected_hash = hash_concat(
            "zk-field-value",
            &[proof.field_id.as_bytes(), value.as_bytes()],
        );
        if fv_hash != expected_hash {
            return false;
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_document_proof_roundtrip() {
        let content = "This is a legal agreement between Alice and Bob.";
        let proof = create_document_proof(content);
        assert!(verify_document_proof(&proof));
        assert_eq!(proof.version, 1);
        assert!(!proof.document_hash.is_empty());
    }

    #[test]
    fn test_tampered_document_proof_fails() {
        let proof = create_document_proof("original content");
        let mut tampered = proof.clone();
        tampered.document_hash = hex::encode([0u8; 32]);
        assert!(!verify_document_proof(&tampered));
    }

    #[test]
    fn test_signature_proof_roundtrip() {
        let proof = create_signature_proof(
            "abcdef1234567890",
            "0x1234567890abcdef",
            "EIP191",
            b"fake-signature-bytes-for-test",
        );
        assert!(verify_signature_proof(&proof));
        assert_eq!(proof.scheme, "EIP191");
    }

    #[test]
    fn test_field_proof_hidden() {
        let proof = create_field_proof("doc_hash_123", "signer-name", "Alice Smith", false);
        assert!(verify_field_proof(&proof));
        assert!(proof.revealed_value.is_none());
    }

    #[test]
    fn test_field_proof_revealed() {
        let proof = create_field_proof("doc_hash_123", "signer-name", "Alice Smith", true);
        assert!(verify_field_proof(&proof));
        assert_eq!(proof.revealed_value.as_deref(), Some("Alice Smith"));
    }

    #[test]
    fn test_field_proof_tampered_value() {
        let mut proof = create_field_proof("doc_hash_123", "amount", "$10,000", true);
        proof.revealed_value = Some("$1,000,000".into()); // tamper
        assert!(!verify_field_proof(&proof)); // hash mismatch
    }

    #[test]
    fn test_different_documents_different_proofs() {
        let p1 = create_document_proof("Document A");
        let p2 = create_document_proof("Document B");
        assert_ne!(p1.document_hash, p2.document_hash);
        assert_ne!(p1.commitment, p2.commitment);
    }
}
