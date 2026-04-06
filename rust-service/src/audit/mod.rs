//! Audit chain hashing and verification — chained SHA-256 hashes for
//! tamper detection in the audit trail.

use crate::crypto::sha256_hex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub event_type: String,
    pub actor: String,
    pub timestamp: String,
    pub metadata: Option<serde_json::Value>,
    pub event_hash: String,
    pub prev_event_hash: Option<String>,
}

/// Compute a chained hash for tamper detection.
/// Hash = SHA-256(JSON({ prev, type, actor, ts, meta }))
pub fn compute_event_hash(
    prev_hash: Option<&str>,
    event_type: &str,
    actor: &str,
    timestamp: &str,
    metadata: Option<&serde_json::Value>,
) -> String {
    let payload = serde_json::json!({
        "prev": prev_hash.unwrap_or("genesis"),
        "type": event_type,
        "actor": actor,
        "ts": timestamp,
        "meta": metadata.cloned().unwrap_or(serde_json::json!({})),
    });
    sha256_hex(payload.to_string().as_bytes())
}

/// Verify an entire audit chain.
/// Returns Ok(()) if valid, Err(broken_index) if tampered.
pub fn verify_audit_chain(events: &[AuditEvent]) -> Result<(), usize> {
    if events.is_empty() {
        return Ok(());
    }

    for (i, event) in events.iter().enumerate() {
        // Verify prev_event_hash linkage
        let expected_prev = if i == 0 {
            None
        } else {
            Some(events[i - 1].event_hash.as_str())
        };

        if event.prev_event_hash.as_deref() != expected_prev {
            return Err(i);
        }

        // Verify event hash
        let expected_hash = compute_event_hash(
            expected_prev,
            &event.event_type,
            &event.actor,
            &event.timestamp,
            event.metadata.as_ref(),
        );

        if event.event_hash != expected_hash {
            return Err(i);
        }
    }

    Ok(())
}

/// Compute a batch of event hashes in sequence (for re-building a chain).
pub fn compute_event_chain(
    events: &[(String, String, String, Option<serde_json::Value>)], // (type, actor, ts, meta)
) -> Vec<String> {
    let mut hashes = Vec::with_capacity(events.len());
    let mut prev: Option<String> = None;

    for (event_type, actor, timestamp, metadata) in events {
        let hash = compute_event_hash(
            prev.as_deref(),
            event_type,
            actor,
            timestamp,
            metadata.as_ref(),
        );
        prev = Some(hash.clone());
        hashes.push(hash);
    }

    hashes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_event_hash_deterministic() {
        let h1 = compute_event_hash(None, "CREATED", "alice", "2024-01-01T00:00:00Z", None);
        let h2 = compute_event_hash(None, "CREATED", "alice", "2024-01-01T00:00:00Z", None);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_chain_verification() {
        let h1 = compute_event_hash(None, "CREATED", "alice", "2024-01-01T00:00:00Z", None);
        let h2 = compute_event_hash(Some(&h1), "SIGNED", "bob", "2024-01-01T01:00:00Z", None);

        let events = vec![
            AuditEvent {
                event_type: "CREATED".into(),
                actor: "alice".into(),
                timestamp: "2024-01-01T00:00:00Z".into(),
                metadata: None,
                event_hash: h1.clone(),
                prev_event_hash: None,
            },
            AuditEvent {
                event_type: "SIGNED".into(),
                actor: "bob".into(),
                timestamp: "2024-01-01T01:00:00Z".into(),
                metadata: None,
                event_hash: h2,
                prev_event_hash: Some(h1),
            },
        ];

        assert!(verify_audit_chain(&events).is_ok());
    }

    #[test]
    fn test_tampered_chain() {
        let h1 = compute_event_hash(None, "CREATED", "alice", "2024-01-01T00:00:00Z", None);

        let events = vec![
            AuditEvent {
                event_type: "CREATED".into(),
                actor: "alice".into(),
                timestamp: "2024-01-01T00:00:00Z".into(),
                metadata: None,
                event_hash: h1.clone(),
                prev_event_hash: None,
            },
            AuditEvent {
                event_type: "SIGNED".into(),
                actor: "bob".into(),
                timestamp: "2024-01-01T01:00:00Z".into(),
                metadata: None,
                event_hash: "tampered_hash".into(),
                prev_event_hash: Some(h1),
            },
        ];

        assert_eq!(verify_audit_chain(&events), Err(1));
    }
}
