//! Prefix trie for fast autocomplete and prefix-based document search.
//!
//! Backed by RocksDB's `prefix` CF. For each indexed token, we store
//! every prefix of length 2..=len, enabling instant prefix lookups.
//! Scoring favours shorter matching tokens (more specific match).

use std::collections::{HashMap, HashSet};

use super::keys;
use super::store::{IndexStore, CF_PREFIX, StoreResult};

// ── Indexing ─────────────────────────────────────────────────────────

/// Insert all prefixes of each token, associated with `doc_id`.
pub fn index_prefixes(
    store: &IndexStore,
    doc_id: &str,
    tokens: &[String],
) -> StoreResult<()> {
    let mut batch = store.new_batch();

    for_each_prefix(tokens, doc_id, |prefix, token_len| {
        let key = keys::composite_key(prefix.as_bytes(), doc_id.as_bytes());
        store.batch_put(&mut batch, CF_PREFIX, &key, &(token_len as u32).to_le_bytes())
    })?;

    store.write_batch(batch)
}

/// Remove all prefix entries for a document.
pub fn remove_prefixes(
    store: &IndexStore,
    doc_id: &str,
    tokens: &[String],
) -> StoreResult<()> {
    let mut batch = store.new_batch();

    for_each_prefix(tokens, doc_id, |prefix, _| {
        let key = keys::composite_key(prefix.as_bytes(), doc_id.as_bytes());
        store.batch_delete(&mut batch, CF_PREFIX, &key)
    })?;

    store.write_batch(batch)
}

/// Shared prefix-generation loop. Calls `f(prefix_str, token_char_len)`
/// for each unique (prefix, doc_id) pair.
fn for_each_prefix<F>(tokens: &[String], doc_id: &str, mut f: F) -> StoreResult<()>
where
    F: FnMut(&str, usize) -> StoreResult<()>,
{
    let mut seen = HashSet::new();
    for token in tokens {
        let chars: Vec<char> = token.chars().collect();
        for len in 2..=chars.len() {
            let prefix: String = chars[..len].iter().collect();
            let compound_key = (prefix.clone(), doc_id.to_string());
            if seen.insert(compound_key) {
                f(&prefix, chars.len())?;
            }
        }
    }
    Ok(())
}

// ── Search ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PrefixMatch {
    pub doc_id: String,
    pub score: f64,
    pub title: String,
}

/// Search for documents matching a prefix, returning top-K by relevance.
pub fn prefix_search(
    store: &IndexStore,
    prefix: &str,
    owner_id: Option<&str>,
    max_results: usize,
) -> StoreResult<Vec<PrefixMatch>> {
    let prefix_lower = prefix.to_lowercase();
    if prefix_lower.len() < 2 {
        return Ok(Vec::new());
    }

    let scan_key = keys::scan_prefix(prefix_lower.as_bytes());
    let entries = store.prefix_scan(CF_PREFIX, &scan_key)?;

    // Collect best score per doc_id
    let mut doc_scores: HashMap<String, f64> = HashMap::new();
    for (key, val) in entries {
        if let Some(suffix) = keys::extract_suffix(&key, prefix_lower.len()) {
            if let Ok(doc_id) = std::str::from_utf8(suffix) {
                let token_len = parse_token_len(&val);
                let score = 1.0 / token_len;
                let current = doc_scores.entry(doc_id.to_string()).or_insert(0.0);
                *current = current.max(score);
            }
        }
    }

    // Enrich with metadata + owner filter
    let mut results: Vec<PrefixMatch> = doc_scores
        .into_iter()
        .filter_map(|(doc_id, score)| {
            let meta = store.get_meta(&doc_id).ok()??;
            if let Some(oid) = owner_id {
                if meta.owner_id != oid {
                    return None;
                }
            }
            Some(PrefixMatch {
                doc_id,
                score,
                title: meta.title,
            })
        })
        .collect();

    keys::top_k_by_score(&mut results, max_results, |m| m.score);
    Ok(results)
}

/// Return unique token completions for a prefix (for autocomplete UI).
pub fn autocomplete(
    store: &IndexStore,
    prefix: &str,
    max_suggestions: usize,
) -> StoreResult<Vec<String>> {
    let prefix_lower = prefix.to_lowercase();
    if prefix_lower.len() < 2 {
        return Ok(Vec::new());
    }

    let scan_key = keys::scan_prefix(prefix_lower.as_bytes());
    let entries = store.prefix_scan(CF_PREFIX, &scan_key)?;

    let mut completions = HashSet::new();
    for (key, _) in entries {
        if let Some(prefix_bytes) = keys::extract_prefix(&key) {
            if let Ok(full) = std::str::from_utf8(prefix_bytes) {
                if full.starts_with(&prefix_lower) {
                    completions.insert(full.to_string());
                    if completions.len() >= max_suggestions * 3 {
                        break;
                    }
                }
            }
        }
    }

    let mut sorted: Vec<String> = completions.into_iter().collect();
    sorted.sort_by(|a, b| a.len().cmp(&b.len()).then(a.cmp(b)));
    sorted.truncate(max_suggestions);
    Ok(sorted)
}

fn parse_token_len(val: &[u8]) -> f64 {
    if val.len() >= 4 {
        u32::from_le_bytes([val[0], val[1], val[2], val[3]]) as f64
    } else {
        10.0
    }
}
