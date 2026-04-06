//! Cryptographic primitives: SHA-256 hashing, AES-256-GCM encryption, HKDF key derivation.

mod aes;
mod hash;

pub use aes::{decrypt_document, encrypt_document, EncryptedDocument};
pub use hash::{
    build_signing_message, double_sha256, hash_document, hash_hand_signature, sha256, sha256_hex,
};
