//! Yrs (Rust Yjs) CRDT operations — merge, compact, diff, and conflict resolution.
//!
//! This is the heavy compute that justifies Rust. These operations run on rayon
//! thread pool for true parallelism.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use yrs::{updates::decoder::Decode, updates::encoder::Encode, Doc, ReadTxn, StateVector, Transact, Update};

/// Apply a binary Yjs update to a document. Returns the new state.
pub fn apply_update(doc_state: &[u8], update: &[u8]) -> Result<Vec<u8>> {
    let doc = Doc::new();
    {
        let mut txn = doc.transact_mut();
        if !doc_state.is_empty() {
            let existing = Update::decode_v1(doc_state)
                .map_err(|e| anyhow!("Failed to decode existing state: {e}"))?;
            txn.apply_update(existing)?;
        }
        let new_update =
            Update::decode_v1(update).map_err(|e| anyhow!("Failed to decode update: {e}"))?;
        txn.apply_update(new_update)?;
    }
    let txn = doc.transact();
    Ok(txn.encode_state_as_update_v1(&StateVector::default()))
}

/// Merge multiple Yjs states into one compacted state.
/// This is the primary heavy operation — useful when a room has accumulated
/// many incremental updates and needs compaction.
pub fn merge_states(states: &[Vec<u8>]) -> Result<Vec<u8>> {
    if states.is_empty() {
        return Ok(Vec::new());
    }
    if states.len() == 1 {
        return Ok(states[0].clone());
    }

    let doc = Doc::new();
    {
        let mut txn = doc.transact_mut();
        for (i, state) in states.iter().enumerate() {
            if state.is_empty() {
                continue;
            }
            let update = Update::decode_v1(state)
                .map_err(|e| anyhow!("Failed to decode state {i}: {e}"))?;
            txn.apply_update(update)?;
        }
    }
    let txn = doc.transact();
    Ok(txn.encode_state_as_update_v1(&StateVector::default()))
}

/// Compact a Yjs state — re-encode to eliminate tombstones and redundant data.
/// Returns the compacted state (typically smaller).
pub fn compact_state(state: &[u8]) -> Result<Vec<u8>> {
    if state.is_empty() {
        return Ok(Vec::new());
    }
    let doc = Doc::new();
    {
        let mut txn = doc.transact_mut();
        let update =
            Update::decode_v1(state).map_err(|e| anyhow!("Failed to decode state: {e}"))?;
        txn.apply_update(update)?;
    }
    let txn = doc.transact();
    Ok(txn.encode_state_as_update_v1(&StateVector::default()))
}

/// Compute the diff between two states (what updates are in `current` that aren't in `base`).
pub fn compute_diff(base_state: &[u8], current_state: &[u8]) -> Result<Vec<u8>> {
    // Build the base document to get its state vector
    let base_doc = Doc::new();
    if !base_state.is_empty() {
        let mut txn = base_doc.transact_mut();
        let update = Update::decode_v1(base_state)
            .map_err(|e| anyhow!("Failed to decode base state: {e}"))?;
        txn.apply_update(update)?;
    }
    let base_sv = base_doc.transact().state_vector();

    // Build the current document and encode diff relative to base
    let current_doc = Doc::new();
    if !current_state.is_empty() {
        let mut txn = current_doc.transact_mut();
        let update = Update::decode_v1(current_state)
            .map_err(|e| anyhow!("Failed to decode current state: {e}"))?;
        txn.apply_update(update)?;
    }
    let txn = current_doc.transact();
    Ok(txn.encode_state_as_update_v1(&base_sv))
}

/// Get the state vector (version clock) from a Yjs state.
pub fn get_state_vector(state: &[u8]) -> Result<Vec<u8>> {
    let doc = Doc::new();
    if !state.is_empty() {
        let mut txn = doc.transact_mut();
        let update =
            Update::decode_v1(state).map_err(|e| anyhow!("Failed to decode state: {e}"))?;
        txn.apply_update(update)?;
    }
    let txn = doc.transact();
    Ok(txn.state_vector().encode_v1())
}

/// Encode a state update from a state vector (for sync protocol step 2).
pub fn encode_state_from_sv(state: &[u8], remote_sv: &[u8]) -> Result<Vec<u8>> {
    let sv = StateVector::decode_v1(remote_sv)
        .map_err(|e| anyhow!("Failed to decode state vector: {e}"))?;

    let doc = Doc::new();
    if !state.is_empty() {
        let mut txn = doc.transact_mut();
        let update =
            Update::decode_v1(state).map_err(|e| anyhow!("Failed to decode state: {e}"))?;
        txn.apply_update(update)?;
    }
    let txn = doc.transact();
    Ok(txn.encode_state_as_update_v1(&sv))
}

/// Stats about a Yjs document state.
#[derive(Debug, Serialize, Deserialize)]
pub struct DocStats {
    pub state_size_bytes: usize,
    pub compacted_size_bytes: usize,
    pub savings_percent: f64,
}

/// Analyze a document state and return compaction stats.
pub fn analyze_state(state: &[u8]) -> Result<DocStats> {
    let state_size = state.len();
    let compacted = compact_state(state)?;
    let compacted_size = compacted.len();
    let savings = if state_size > 0 {
        (1.0 - compacted_size as f64 / state_size as f64) * 100.0
    } else {
        0.0
    };

    Ok(DocStats {
        state_size_bytes: state_size,
        compacted_size_bytes: compacted_size,
        savings_percent: savings,
    })
}

/// Batch merge: merge many documents in parallel using rayon.
pub fn batch_merge(doc_states: Vec<Vec<u8>>, chunk_size: usize) -> Result<Vec<u8>> {
    use rayon::prelude::*;

    if doc_states.is_empty() {
        return Ok(Vec::new());
    }
    if doc_states.len() == 1 {
        return compact_state(&doc_states[0]);
    }

    // Divide-and-conquer: merge in parallel chunks, then merge the results
    let chunk_size = chunk_size.max(2);
    let mut current: Vec<Vec<u8>> = doc_states;

    while current.len() > 1 {
        let chunks: Vec<Vec<Vec<u8>>> = current
            .chunks(chunk_size)
            .map(|c| c.to_vec())
            .collect();

        current = chunks
            .into_par_iter()
            .map(|chunk| merge_states(&chunk.iter().map(|v| v.as_slice()).collect::<Vec<_>>().iter().map(|s| s.to_vec()).collect::<Vec<_>>()))
            .collect::<Result<Vec<_>>>()?;
    }

    Ok(current.into_iter().next().unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{Text, Transact};

    fn make_doc_with_text(text: &str) -> Vec<u8> {
        let doc = Doc::new();
        {
            let txt = doc.get_or_insert_text("content");
            let mut txn = doc.transact_mut();
            txt.insert(&mut txn, 0, text);
        }
        let txn = doc.transact();
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    #[test]
    fn test_compact_state() {
        let state = make_doc_with_text("hello world");
        let compacted = compact_state(&state).unwrap();
        assert!(!compacted.is_empty());
    }

    #[test]
    fn test_merge_states() {
        let s1 = make_doc_with_text("hello");
        let s2 = make_doc_with_text("world");
        let merged = merge_states(&[s1, s2]).unwrap();
        assert!(!merged.is_empty());
    }

    #[test]
    fn test_compute_diff() {
        let base = make_doc_with_text("hello");
        let current = {
            let doc = Doc::new();
            {
                let txt = doc.get_or_insert_text("content");
                let mut txn = doc.transact_mut();
                txt.insert(&mut txn, 0, "hello world");
            }
            let txn = doc.transact();
            txn.encode_state_as_update_v1(&StateVector::default())
        };
        let diff = compute_diff(&base, &current).unwrap();
        assert!(!diff.is_empty());
    }

    #[test]
    fn test_analyze_state() {
        let state = make_doc_with_text("test document content");
        let stats = analyze_state(&state).unwrap();
        assert!(stats.state_size_bytes > 0);
    }
}
