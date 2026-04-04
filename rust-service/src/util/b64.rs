//! Base64 encoding/decoding helpers — eliminates scattered decode/encode patterns.

/// Decode a base64 string, returning a user-friendly error message.
pub fn decode(s: &str) -> Result<Vec<u8>, String> {
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s)
        .map_err(|e| format!("Invalid base64: {e}"))
}

/// Encode bytes as a base64 string.
pub fn encode(data: &[u8]) -> String {
    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, data)
}
