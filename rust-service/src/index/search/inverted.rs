//! Inverted index for full-text search.
//!
//! Stores `(token, doc_id) → TermEntry` mappings in RocksDB.
//! Scoring uses log-TF (log(1 + freq)) for diminishing returns on repetition.
//! Uses rayon for parallel candidate gathering on multi-token queries.

use std::collections::HashMap;

use rayon::prelude::*;

use crate::index::store::keys;
use crate::index::store::{IndexStore, CF_INVERTED, CF_FORWARD, StoreResult};




/// Per-(token, doc_id) payload: frequency + first position.
#[derive(Debug, Clone, Copy)]
pub struct TermEntry {
    pub frequency: u32,
    pub first_position: u32,
}

impl TermEntry {
    pub fn to_bytes(self) -> [u8; 8] {
        let mut buf = [0u8; 8];
        buf[0..4].copy_from_slice(&self.frequency.to_le_bytes());
        buf[4..8].copy_from_slice(&self.first_position.to_le_bytes());
        buf
    }

    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        if b.len() < 8 {
            return None;
        }
        Some(Self {
            frequency: u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
            first_position: u32::from_le_bytes([b[4], b[5], b[6], b[7]]),
        })
    }
}


/// Index a document's tokens into the inverted + forward indices atomically.
pub fn index_tokens(
    store: &IndexStore,
    doc_id: &str,
    tokens: &[(String, usize)],
) -> StoreResult<()> {
    let mut term_freq: HashMap<&str, TermEntry> = HashMap::with_capacity(tokens.len());
    for (token, pos) in tokens {
        let entry = term_freq.entry(token.as_str()).or_insert(TermEntry {
            frequency: 0,
            first_position: *pos as u32,
        });
        entry.frequency += 1;
    }

    let mut batch = store.new_batch();
    let mut forward_tokens = Vec::with_capacity(term_freq.len());

    for (token, entry) in &term_freq {
        let key = keys::composite_key(token.as_bytes(), doc_id.as_bytes());
        store.batch_put(&mut batch, CF_INVERTED, &key, &entry.to_bytes())?;
        forward_tokens.push(token.to_string());
    }

    // Forward index: doc_id → token list (enables O(1) deletion)
    let forward_val = serde_json::to_vec(&forward_tokens).unwrap_or_default();
    store.batch_put(&mut batch, CF_FORWARD, doc_id.as_bytes(), &forward_val)?;

    store.write_batch(batch)
}

/// Remove a document from both inverted and forward indices.
pub fn remove_document(store: &IndexStore, doc_id: &str) -> StoreResult<()> {
    let tokens: Vec<String> = match store.get_cf(CF_FORWARD, doc_id.as_bytes())? {
        Some(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        None => return Ok(()),
    };

    let mut batch = store.new_batch();
    for token in &tokens {
        let key = keys::composite_key(token.as_bytes(), doc_id.as_bytes());
        store.batch_delete(&mut batch, CF_INVERTED, &key)?;
    }
    store.batch_delete(&mut batch, CF_FORWARD, doc_id.as_bytes())?;

    store.write_batch(batch)
}


#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ScoredDoc {
    pub doc_id: String,
    pub score: f64,
}

/// AND search: documents must contain ALL query tokens.
pub fn search(
    store: &IndexStore,
    query_tokens: &[String],
    owner_id: Option<&str>,
    max_results: usize,
) -> StoreResult<Vec<ScoredDoc>> {
    if query_tokens.is_empty() {
        return Ok(Vec::new());
    }

    // Gather candidates per token (parallel for ≥2 tokens)
    let per_token: Vec<HashMap<String, TermEntry>> = query_tokens
        .par_iter()
        .map(|token| gather_token_docs(store, token))
        .collect();

    // Intersect: keep only doc_ids present in ALL token sets
    let first = &per_token[0];
    let mut candidates: HashMap<String, f64> = HashMap::with_capacity(first.len());

    for (doc_id, entry) in first {
        let mut score = tf_score(entry.frequency);
        let mut in_all = true;

        for other in &per_token[1..] {
            match other.get(doc_id) {
                Some(e) => score += tf_score(e.frequency),
                None => {
                    in_all = false;
                    break;
                }
            }
        }

        if in_all {
            candidates.insert(doc_id.clone(), score);
        }
    }

    finish_results(store, candidates, owner_id, max_results)
}

/// OR search: documents matching ANY query token.
pub fn search_any(
    store: &IndexStore,
    query_tokens: &[String],
    owner_id: Option<&str>,
    max_results: usize,
) -> StoreResult<Vec<ScoredDoc>> {
    if query_tokens.is_empty() {
        return Ok(Vec::new());
    }

    let mut candidates: HashMap<String, f64> = HashMap::new();

    for token in query_tokens {
        for (doc_id, entry) in gather_token_docs(store, token) {
            *candidates.entry(doc_id).or_insert(0.0) += tf_score(entry.frequency);
        }
    }

    finish_results(store, candidates, owner_id, max_results)
}




/// Scan the inverted index for all documents containing `token`.
fn gather_token_docs(store: &IndexStore, token: &str) -> HashMap<String, TermEntry> {
    let prefix = keys::scan_prefix(token.as_bytes());
    let mut docs = HashMap::new();

    if let Ok(entries) = store.prefix_scan(CF_INVERTED, &prefix) {
        for (key, val) in entries {
            if let (Some(suffix), Some(entry)) = (
                keys::extract_suffix(&key, token.len()),
                TermEntry::from_bytes(&val),
            ) {
                if let Ok(doc_id) = std::str::from_utf8(suffix) {
                    docs.insert(doc_id.to_string(), entry);
                }
            }
        }
    }

    docs
}

/// Owner-filter, sort by score descending, truncate. Shared by AND/OR search.
fn finish_results(
    store: &IndexStore,
    candidates: HashMap<String, f64>,
    owner_id: Option<&str>,
    max_results: usize,
) -> StoreResult<Vec<ScoredDoc>> {
    let mut results: Vec<ScoredDoc> = if let Some(oid) = owner_id {
        candidates
            .into_par_iter()
            .filter_map(|(doc_id, score)| {
                store
                    .get_meta(&doc_id)
                    .ok()
                    .flatten()
                    .filter(|meta| meta.owner_id == oid)
                    .map(|_| ScoredDoc { doc_id, score })
            })
            .collect()
    } else {
        candidates
            .into_iter()
            .map(|(doc_id, score)| ScoredDoc { doc_id, score })
            .collect()
    };

    keys::top_k_by_score(&mut results, max_results, |d| d.score);
    Ok(results)
}

/// TF score: log(1 + frequency) — diminishing returns on repetition.
#[inline]
fn tf_score(freq: u32) -> f64 {
    (1.0 + freq as f64).ln()
}




#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::store::{DocumentMeta, IndexStore};

    fn temp_store() -> (IndexStore, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("inv_test_{}", uuid::Uuid::new_v4()));
        (IndexStore::open(&dir).unwrap(), dir)
    }

    #[test]
    fn test_index_and_search() {
        let (store, dir) = temp_store();

        let meta = DocumentMeta {
            doc_id: "d1".into(),
            owner_id: "alice".into(),
            title: "Test".into(),
            status: "PENDING".into(),
            proof_mode: "PRIVATE".into(),
            encrypted: false,
            encrypted_search_opt_in: false,
            category: None,
            tags: vec![],
            signer_labels: vec![],
            hash_prefix: "abcd".into(),
            cid_prefix: None,
            created_at: "2025-01-01".into(),
            updated_at: "2025-01-01".into(),
            token_count: 3,
        };
        store.put_meta("d1", &meta).unwrap();

        let tokens = vec![
            ("contract".into(), 0),
            ("sign".into(), 1),
            ("legal".into(), 2),
        ];
        index_tokens(&store, "d1", &tokens).unwrap();

        let results = search(&store, &["contract".into()], Some("alice"), 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].doc_id, "d1");

        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }
}
