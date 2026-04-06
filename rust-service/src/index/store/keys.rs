//! Shared composite key encoding for RocksDB column families.
//!
//! All index modules that store `(prefix, doc_id)` pairs use this module
//! to ensure consistent encoding. The separator byte `0xFF` cannot appear
//! in valid UTF-8, making it a safe delimiter.

/// Separator byte between key components. Cannot appear in valid UTF-8.
pub const SEP: u8 = 0xFF;

/// Build a composite key: `prefix + SEP + suffix`.
#[inline]
pub fn composite_key(prefix: &[u8], suffix: &[u8]) -> Vec<u8> {
    let mut key = Vec::with_capacity(prefix.len() + 1 + suffix.len());
    key.extend_from_slice(prefix);
    key.push(SEP);
    key.extend_from_slice(suffix);
    key
}

/// Build a scan prefix: `prefix + SEP` (for RocksDB prefix iteration).
#[inline]
pub fn scan_prefix(prefix: &[u8]) -> Vec<u8> {
    let mut key = Vec::with_capacity(prefix.len() + 1);
    key.extend_from_slice(prefix);
    key.push(SEP);
    key
}

/// Extract the suffix after `prefix + SEP` from a composite key.
#[inline]
pub fn extract_suffix(key: &[u8], prefix_len: usize) -> Option<&[u8]> {
    // prefix_len + 1 for the SEP byte
    let offset = prefix_len + 1;
    if key.len() > offset && key[prefix_len] == SEP {
        Some(&key[offset..])
    } else {
        None
    }
}

/// Extract the part before the first SEP.
#[inline]
pub fn extract_prefix(key: &[u8]) -> Option<&[u8]> {
    key.iter().position(|&b| b == SEP).map(|pos| &key[..pos])
}

/// Sort a vec of scored items by score descending, then truncate to `max`.
pub fn top_k_by_score<T>(items: &mut Vec<T>, max: usize, score_fn: impl Fn(&T) -> f64) {
    items.sort_unstable_by(|a, b| {
        score_fn(b)
            .partial_cmp(&score_fn(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    items.truncate(max);
}
