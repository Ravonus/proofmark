use sha2::{Digest, Sha256};

#[inline]
pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

#[inline]
pub fn sha256_hex(data: &[u8]) -> String {
    hex::encode(sha256(data))
}

#[inline]
pub fn double_sha256(data: &[u8]) -> [u8; 32] {
    sha256(&sha256(data))
}

pub fn hash_document(content: &str) -> String {
    sha256_hex(content.as_bytes())
}

pub fn hash_hand_signature(data_url: &str) -> String {
    let b64 = match data_url.find(',') {
        Some(idx) => &data_url[idx + 1..],
        None => data_url,
    };
    match crate::util::b64::decode(b64) {
        Ok(raw) => sha256_hex(&raw),
        Err(_) => sha256_hex(b64.as_bytes()),
    }
}

/// Build the wallet signing message: `proofmark:{hash}:{addr}:{label}[:{ink_hash}]`
pub fn build_signing_message(
    content_hash: &str,
    address: &str,
    signer_label: &str,
    hand_signature_hash: Option<&str>,
) -> String {
    let addr = address.to_lowercase();
    let mut msg = format!("proofmark:{content_hash}:{addr}:{signer_label}");
    if let Some(hsh) = hand_signature_hash {
        msg.push(':');
        msg.push_str(hsh);
    }
    msg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_document() {
        let hash = hash_document("hello world");
        assert_eq!(
            hash,
            "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"
        );
    }

    #[test]
    fn test_double_sha256() {
        let result = double_sha256(b"test");
        assert_eq!(result.len(), 32);
        assert_ne!(result, sha256(b"test"));
    }

    #[test]
    fn test_build_signing_message() {
        let msg = build_signing_message("abc123", "0xDEAD", "Alice", None);
        assert_eq!(msg, "proofmark:abc123:0xdead:Alice");

        let msg2 = build_signing_message("abc123", "0xDEAD", "Alice", Some("inkhash"));
        assert_eq!(msg2, "proofmark:abc123:0xdead:Alice:inkhash");
    }
}
