//! Forensic evidence hashing, anomaly detection, and replay tape validation.

pub mod replay;
pub mod anomaly;

use crate::crypto::sha256_hex;
use serde::{Deserialize, Serialize};

pub use replay::validate_replay_tape;
pub use anomaly::analyze_flags;

/// Hash a forensic evidence packet (JSON-serialized with evidenceHash omitted).
pub fn hash_forensic_evidence(evidence: &serde_json::Value) -> String {
    // Clone and remove evidenceHash before hashing (matches TS behavior)
    let mut ev = evidence.clone();
    if let Some(obj) = ev.as_object_mut() {
        obj.remove("evidenceHash");
    }
    sha256_hex(ev.to_string().as_bytes())
}

/// Compute HTTP header fingerprint (sorted header names, pipe-separated, SHA-256).
pub fn compute_header_fingerprint(header_names: &mut [String]) -> String {
    header_names.sort();
    let joined = header_names.join("|");
    sha256_hex(joined.as_bytes())
}

/// Analyze forensic flags from evidence data — returns risk flags.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForensicFlag {
    pub code: String,
    pub severity: String, // "info" | "warn" | "critical"
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_hash_forensic_evidence() {
        let ev = json!({
            "version": 1,
            "fingerprint": { "visitorId": "abc" },
            "evidenceHash": "old_hash"
        });
        let hash = hash_forensic_evidence(&ev);
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn test_analyze_flags_vpn() {
        let ev = json!({
            "geo": { "isVpn": true },
            "fingerprint": {},
            "behavioral": { "timeOnPage": 5000, "mouseMoveCount": 10, "scrolledToBottom": true }
        });
        let flags = analyze_flags(&ev);
        assert!(flags.iter().any(|f| f.code == "VPN_DETECTED"));
    }
}
