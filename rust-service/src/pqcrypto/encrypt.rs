//! Hybrid post-quantum encryption: ML-KEM-768 + AES-256-GCM.
//!
//! ML-KEM-768 (CRYSTALS-Kyber, NIST FIPS 203) provides quantum-resistant
//! key encapsulation. The shared secret derives an AES-256-GCM key.
//!
//! Wire format (base64-encoded):
//!   [2 bytes version: 0x50 0x51 ("PQ")]
//!   [N bytes ML-KEM-768 ciphertext]
//!   [12 bytes AES-GCM IV]
//!   [M bytes AES-GCM ciphertext + 16-byte tag appended]

use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use hkdf::Hkdf;
use ml_kem::{KemCore, MlKem768};
use ml_kem::kem::{Decapsulate, Encapsulate};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use sha2::Sha256;

const VERSION: [u8; 2] = [0x50, 0x51]; // "PQ"
const IV_LEN: usize = 12;
const HKDF_INFO: &[u8] = b"proofmark-pq-v1-aes256gcm";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PqKeypair {
    pub public_key: String,  // hex
    pub private_key: String, // hex
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HybridCiphertext {
    pub ciphertext: String,  // base64
    pub algorithm: String,
}

/// Generate an ML-KEM-768 keypair.
pub fn pq_generate_keypair() -> PqKeypair {
    let (dk, ek) = MlKem768::generate(&mut OsRng);

    // Encode keys to bytes
    use ml_kem::EncodedSizeUser;
    let ek_bytes = ek.as_bytes();
    let dk_bytes = dk.as_bytes();

    PqKeypair {
        public_key: hex::encode(ek_bytes.as_slice()),
        private_key: hex::encode(dk_bytes.as_slice()),
    }
}

fn derive_aes_key(shared_secret: &[u8]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(None, shared_secret);
    let mut key = [0u8; 32];
    hk.expand(HKDF_INFO, &mut key).expect("HKDF expand 32 bytes");
    key
}

/// Encrypt with ML-KEM-768 + AES-256-GCM.
pub fn pq_encrypt(
    plaintext: &[u8],
    recipient_public_key_hex: &str,
) -> Result<HybridCiphertext, anyhow::Error> {
    let ek_bytes = hex::decode(recipient_public_key_hex)
        .map_err(|e| anyhow::anyhow!("Invalid public key hex: {e}"))?;

    // Reconstruct encapsulation key
    use ml_kem::EncodedSizeUser;
    use ml_kem::array::Array;
    let ek_array = Array::try_from_iter(ek_bytes.into_iter())
        .map_err(|_| anyhow::anyhow!("Public key wrong length for ML-KEM-768"))?;
    let ek = <MlKem768 as KemCore>::EncapsulationKey::from_bytes(&ek_array);

    // Encapsulate: shared secret + KEM ciphertext
    let (kem_ct, shared_secret) = ek.encapsulate(&mut OsRng)
        .map_err(|_| anyhow::anyhow!("Encapsulation failed"))?;

    // Derive AES key
    let aes_key = derive_aes_key(shared_secret.as_slice());

    // AES-256-GCM encrypt
    let cipher = Aes256Gcm::new_from_slice(&aes_key)
        .map_err(|e| anyhow::anyhow!("AES init: {e}"))?;
    let mut iv = [0u8; IV_LEN];
    rand::RngCore::fill_bytes(&mut OsRng, &mut iv);
    let nonce = Nonce::from_slice(&iv);
    let encrypted = cipher.encrypt(nonce, plaintext)
        .map_err(|e| anyhow::anyhow!("AES encrypt: {e}"))?;

    // Pack: VERSION + KEM_CT + IV + encrypted(ct+tag)
    let kem_ct_bytes = kem_ct.as_slice();
    let mut packed = Vec::with_capacity(2 + kem_ct_bytes.len() + IV_LEN + encrypted.len());
    packed.extend_from_slice(&VERSION);
    packed.extend_from_slice(kem_ct_bytes);
    packed.extend_from_slice(&iv);
    packed.extend_from_slice(&encrypted);

    Ok(HybridCiphertext {
        ciphertext: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &packed),
        algorithm: "ML-KEM-768+AES-256-GCM".into(),
    })
}

/// Decrypt ML-KEM-768 + AES-256-GCM ciphertext.
pub fn pq_decrypt(
    ciphertext: &HybridCiphertext,
    recipient_private_key_hex: &str,
) -> Result<Vec<u8>, anyhow::Error> {
    let packed = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &ciphertext.ciphertext,
    ).map_err(|e| anyhow::anyhow!("Invalid base64: {e}"))?;

    if packed.len() < 2 {
        return Err(anyhow::anyhow!("Ciphertext too short"));
    }
    if packed[0..2] != VERSION {
        return Err(anyhow::anyhow!("Unknown version"));
    }

    // Figure out KEM ciphertext size from the type
    use ml_kem::EncodedSizeUser;
    use ml_kem::array::Array;

    let kem_ct_len = <<MlKem768 as KemCore>::CiphertextSize as typenum::Unsigned>::USIZE;
    let min_len = 2 + kem_ct_len + IV_LEN + 16; // at least tag
    if packed.len() < min_len {
        return Err(anyhow::anyhow!("Ciphertext too short (need {min_len}, got {})", packed.len()));
    }

    let kem_ct_bytes = &packed[2..2 + kem_ct_len];
    let iv = &packed[2 + kem_ct_len..2 + kem_ct_len + IV_LEN];
    let encrypted = &packed[2 + kem_ct_len + IV_LEN..];

    // Reconstruct decapsulation key
    let dk_bytes = hex::decode(recipient_private_key_hex)
        .map_err(|e| anyhow::anyhow!("Invalid private key hex: {e}"))?;
    let dk_array = Array::try_from_iter(dk_bytes.into_iter())
        .map_err(|_| anyhow::anyhow!("Private key wrong length for ML-KEM-768"))?;
    let dk = <MlKem768 as KemCore>::DecapsulationKey::from_bytes(&dk_array);

    // Reconstruct KEM ciphertext
    let kem_ct_array: Array<u8, _> = Array::try_from_iter(kem_ct_bytes.iter().copied())
        .map_err(|_| anyhow::anyhow!("KEM ciphertext wrong length"))?;

    // Decapsulate
    let shared_secret = dk.decapsulate(&kem_ct_array)
        .map_err(|_| anyhow::anyhow!("Decapsulation failed"))?;

    // Derive AES key
    let aes_key = derive_aes_key(shared_secret.as_slice());

    // AES-256-GCM decrypt
    let cipher = Aes256Gcm::new_from_slice(&aes_key)
        .map_err(|e| anyhow::anyhow!("AES init: {e}"))?;
    let nonce = Nonce::from_slice(iv);
    cipher.decrypt(nonce, encrypted)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keygen() {
        let kp = pq_generate_keypair();
        assert!(!kp.public_key.is_empty());
        assert!(!kp.private_key.is_empty());
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let kp = pq_generate_keypair();
        let plaintext = b"Top secret quantum-proof document!";
        let ct = pq_encrypt(plaintext, &kp.public_key).unwrap();
        assert_eq!(ct.algorithm, "ML-KEM-768+AES-256-GCM");

        let decrypted = pq_decrypt(&ct, &kp.private_key).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails() {
        let kp1 = pq_generate_keypair();
        let kp2 = pq_generate_keypair();
        let ct = pq_encrypt(b"secret", &kp1.public_key).unwrap();
        assert!(pq_decrypt(&ct, &kp2.private_key).is_err());
    }
}
