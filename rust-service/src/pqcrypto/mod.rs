//! Post-quantum cryptography + zero-knowledge proofs.
//!
//! - ML-KEM-768 (CRYSTALS-Kyber): NIST FIPS 203 key encapsulation for quantum-safe encryption
//! - Hybrid encryption: ML-KEM-768 + AES-256-GCM (belt-and-suspenders approach)
//! - ZK proofs: prove document knowledge/signatures without revealing content

pub mod encrypt;
pub mod zkproof;

pub use encrypt::{
    pq_decrypt, pq_encrypt, pq_generate_keypair, HybridCiphertext, PqKeypair,
};
pub use zkproof::{
    create_document_proof, create_field_proof, create_signature_proof, verify_document_proof,
    verify_field_proof, verify_signature_proof, DocumentProof, FieldProof, SignatureProof,
};
