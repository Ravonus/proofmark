//! AES-256-GCM encryption/decryption with HKDF key derivation.
//! Mirrors src/server/encryption.ts

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use thiserror::Error;

const IV_LEN: usize = 12;
const TAG_LEN: usize = 16;

#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("encryption failed: {0}")]
    EncryptionFailed(String),
    #[error("decryption failed: {0}")]
    DecryptionFailed(String),
    #[error("invalid ciphertext format")]
    InvalidFormat,
    #[allow(dead_code)]
    #[error("master key not provided")]
    NoMasterKey,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct EncryptedDocument {
    pub encrypted_content: String, // base64
    pub wrapped_key: String,       // base64
}

/// Derive a 32-byte master key from a secret using HKDF-SHA256.
fn derive_master_key(secret: &str) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(b"proofmark-at-rest"), secret.as_bytes());
    let mut okm = [0u8; 32];
    hk.expand(b"encryption-key", &mut okm)
        .expect("HKDF expand should never fail for 32 bytes");
    okm
}

/// Encrypt plaintext with AES-256-GCM. Returns base64: [12B IV][ciphertext][16B tag].
pub fn aes_encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<String, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

    let mut iv = [0u8; IV_LEN];
    OsRng.fill_bytes(&mut iv);
    let nonce = Nonce::from_slice(&iv);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| CryptoError::EncryptionFailed(e.to_string()))?;

    // AES-GCM appends the tag to ciphertext, so layout is already [ct + tag]
    // We prepend IV: [IV][ct][tag]
    let mut blob = Vec::with_capacity(IV_LEN + ciphertext.len());
    blob.extend_from_slice(&iv);
    blob.extend_from_slice(&ciphertext);

    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &blob,
    ))
}

/// Decrypt AES-256-GCM ciphertext from base64 blob.
pub fn aes_decrypt(key: &[u8; 32], ciphertext_b64: &str) -> Result<Vec<u8>, CryptoError> {
    let blob = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, ciphertext_b64)
        .map_err(|_| CryptoError::InvalidFormat)?;

    if blob.len() < IV_LEN + TAG_LEN {
        return Err(CryptoError::InvalidFormat);
    }

    let iv = &blob[..IV_LEN];
    let ct_and_tag = &blob[IV_LEN..];

    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| CryptoError::DecryptionFailed(e.to_string()))?;

    let nonce = Nonce::from_slice(iv);

    cipher
        .decrypt(nonce, ct_and_tag)
        .map_err(|e| CryptoError::DecryptionFailed(e.to_string()))
}

/// Encrypt a document's content for storage (DEK + KEK wrapping).
/// Mirrors `encryptDocument()` from encryption.ts.
pub fn encrypt_document(
    content: &str,
    master_secret: &str,
) -> Result<EncryptedDocument, CryptoError> {
    let master_key = derive_master_key(master_secret);

    // Generate random DEK
    let mut dek = [0u8; 32];
    OsRng.fill_bytes(&mut dek);

    // Encrypt content with DEK
    let encrypted_content = aes_encrypt(&dek, content.as_bytes())?;

    // Wrap DEK with master key
    let wrapped_key = aes_encrypt(&master_key, &dek)?;

    Ok(EncryptedDocument {
        encrypted_content,
        wrapped_key,
    })
}

/// Decrypt a document's content. Mirrors `decryptDocument()`.
pub fn decrypt_document(
    encrypted: &EncryptedDocument,
    master_secret: &str,
) -> Result<String, CryptoError> {
    let master_key = derive_master_key(master_secret);

    // Unwrap DEK
    let dek_bytes = aes_decrypt(&master_key, &encrypted.wrapped_key)?;
    if dek_bytes.len() != 32 {
        return Err(CryptoError::InvalidFormat);
    }

    let mut dek = [0u8; 32];
    dek.copy_from_slice(&dek_bytes);

    // Decrypt content
    let plaintext = aes_decrypt(&dek, &encrypted.encrypted_content)?;
    String::from_utf8(plaintext).map_err(|_| CryptoError::DecryptionFailed("invalid UTF-8".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = derive_master_key("test-secret");
        let plaintext = b"Hello, Proofmark!";

        let encrypted = aes_encrypt(&key, plaintext).unwrap();
        let decrypted = aes_decrypt(&key, &encrypted).unwrap();

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_document_encrypt_decrypt() {
        let content = "This is a legal document with important content.";
        let secret = "my-master-key-2024";

        let encrypted = encrypt_document(content, secret).unwrap();
        let decrypted = decrypt_document(&encrypted, secret).unwrap();

        assert_eq!(decrypted, content);
    }

    #[test]
    fn test_wrong_key_fails() {
        let content = "secret document";
        let encrypted = encrypt_document(content, "key1").unwrap();
        let result = decrypt_document(&encrypted, "key2");
        assert!(result.is_err());
    }
}
