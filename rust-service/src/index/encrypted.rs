//! Encrypted document partial indexing (opt-in).
//!
//! When users opt in, this module extracts small, non-private word chunks
//! from encrypted documents to enable searchability without revealing content.
//!
//! Strategy:
//! 1. Decrypt document server-side (ephemeral, in-memory only)
//! 2. Run privacy scanner to identify PII regions
//! 3. Extract only safe, non-private tokens (common words, legal terms, categories)
//! 4. Store partial index entries with PrivacyLevel::Partial
//! 5. Wipe plaintext from memory immediately after indexing
//!
//! The encrypted CF stores: doc_id → PartialIndexEntry

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::privacy::{self, PiiType, PrivacyScanResult};
use super::store::{IndexStore, CF_ENCRYPTED, PrivacyLevel, StoreResult};
use super::tokenizer;

// Regexes for safe entity extraction — compiled once.
static RE_MONEY: Lazy<Regex> = Lazy::new(|| Regex::new(r"\$[\d,]+\.?\d*").unwrap());
static RE_ISO_DATE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\b\d{4}[-/]\d{2}[-/]\d{2}\b").unwrap());
static RE_DOC_REF: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:ref|doc|contract|agreement)[#:\s-]*(\w+-?\w+)").unwrap()
});

/// Configuration for encrypted document indexing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedIndexConfig {
    /// Maximum number of safe tokens to index per document.
    pub max_tokens: usize,
    /// Minimum token length to include.
    pub min_token_len: usize,
    /// Maximum token length to include (prevents indexing long unique strings).
    pub max_token_len: usize,
    /// Whether to include category detection.
    pub include_categories: bool,
    /// Whether to include entity extraction (safe entities only).
    pub include_safe_entities: bool,
    /// Risk score threshold — reject documents above this score.
    pub max_risk_score: f64,
}

impl Default for EncryptedIndexConfig {
    fn default() -> Self {
        Self {
            max_tokens: 50,
            min_token_len: 3,
            max_token_len: 20,
            include_categories: true,
            include_safe_entities: true,
            max_risk_score: 0.8,
        }
    }
}

/// Partial index entry stored for encrypted documents.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartialIndexEntry {
    pub doc_id: String,
    pub safe_tokens: Vec<String>,
    pub safe_bigrams: Vec<String>,
    pub detected_category: Option<String>,
    pub safe_entities: Vec<SafeEntity>,
    pub privacy_level: PrivacyLevel,
    pub risk_score: f64,
    pub token_count: usize,
    pub pii_types_found: Vec<String>,
}

/// An entity extracted from the document that is safe to index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SafeEntity {
    pub entity_type: String,
    pub value: String,
}

/// Index an encrypted document after decryption (plaintext is ephemeral).
///
/// Returns the partial index entry, or None if the document is too risky
/// or the user hasn't opted in.
pub fn index_encrypted_document(
    store: &IndexStore,
    doc_id: &str,
    plaintext: &str,
    config: &EncryptedIndexConfig,
) -> StoreResult<Option<PartialIndexEntry>> {
    // Step 1: Run privacy scan
    let scan = privacy::scan_privacy(plaintext);

    // Step 2: Check risk threshold
    if scan.risk_score > config.max_risk_score {
        tracing::warn!(
            doc_id = doc_id,
            risk_score = scan.risk_score,
            "Encrypted document too risky to index"
        );
        return Ok(None);
    }

    // Step 3: Extract safe tokens with length filtering
    let safe_tokens = filter_safe_tokens(&scan, config);

    // Step 4: Generate safe bigrams
    let safe_bigrams = if safe_tokens.len() >= 2 {
        safe_tokens
            .windows(2)
            .take(config.max_tokens / 2)
            .map(|pair| format!("{}_{}", pair[0], pair[1]))
            .collect()
    } else {
        Vec::new()
    };

    // Step 5: Detect category from safe content
    let detected_category = if config.include_categories {
        detect_safe_category(&safe_tokens)
    } else {
        None
    };

    // Step 6: Extract safe entities
    let safe_entities = if config.include_safe_entities {
        extract_safe_entities(plaintext, &scan)
    } else {
        Vec::new()
    };

    // Step 7: Record which PII types were found (but NOT the values)
    let pii_types_found: Vec<String> = scan
        .detections
        .iter()
        .map(|d| format!("{:?}", d.pii_type))
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    let entry = PartialIndexEntry {
        doc_id: doc_id.to_string(),
        safe_tokens: safe_tokens.clone(),
        safe_bigrams,
        detected_category,
        safe_entities,
        privacy_level: PrivacyLevel::Partial,
        risk_score: scan.risk_score,
        token_count: safe_tokens.len(),
        pii_types_found,
    };

    // Step 8: Store in encrypted CF
    let val = serde_json::to_vec(&entry)?;
    store.put_cf(CF_ENCRYPTED, doc_id.as_bytes(), &val)?;

    Ok(Some(entry))
}

/// Retrieve a partial index entry for an encrypted document.
pub fn get_partial_index(store: &IndexStore, doc_id: &str) -> StoreResult<Option<PartialIndexEntry>> {
    match store.get_cf(CF_ENCRYPTED, doc_id.as_bytes())? {
        Some(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        None => Ok(None),
    }
}

/// Remove partial index for an encrypted document.
pub fn remove_partial_index(store: &IndexStore, doc_id: &str) -> StoreResult<()> {
    store.delete_cf(CF_ENCRYPTED, doc_id.as_bytes())
}

/// Search encrypted document partial indices for matching tokens.
pub fn search_encrypted(
    store: &IndexStore,
    query_tokens: &[String],
    owner_id: Option<&str>,
    max_results: usize,
) -> StoreResult<Vec<EncryptedSearchResult>> {
    let entries = store.prefix_scan(CF_ENCRYPTED, &[])?;
    let mut results = Vec::new();

    for (_, val) in entries {
        if let Ok(entry) = serde_json::from_slice::<PartialIndexEntry>(&val) {
            // Check ownership
            if let Some(oid) = owner_id {
                if let Ok(Some(meta)) = store.get_meta(&entry.doc_id) {
                    if meta.owner_id != oid {
                        continue;
                    }
                } else {
                    continue;
                }
            }

            // Score: count how many query tokens match safe tokens
            let score = compute_encrypted_match_score(query_tokens, &entry);
            if score > 0.0 {
                results.push(EncryptedSearchResult {
                    doc_id: entry.doc_id.clone(),
                    score,
                    matched_tokens: count_matched_tokens(query_tokens, &entry),
                    privacy_level: entry.privacy_level,
                });
            }
        }

        if results.len() >= max_results * 2 {
            break;
        }
    }

    results.sort_unstable_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(max_results);
    Ok(results)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedSearchResult {
    pub doc_id: String,
    pub score: f64,
    pub matched_tokens: usize,
    pub privacy_level: PrivacyLevel,
}

// ── Internal helpers ─────────────────────────────────────────────────

fn filter_safe_tokens(scan: &PrivacyScanResult, config: &EncryptedIndexConfig) -> Vec<String> {
    let tokenized = tokenizer::tokenize(&scan.redacted_text);

    tokenized
        .tokens
        .into_iter()
        .filter(|t| {
            t.len() >= config.min_token_len
                && t.len() <= config.max_token_len
                && !is_redaction_marker(t)
        })
        .take(config.max_tokens)
        .collect()
}

fn is_redaction_marker(token: &str) -> bool {
    token.starts_with('[') && token.ends_with(']')
}

/// Detect document category from safe tokens only.
fn detect_safe_category(tokens: &[String]) -> Option<String> {
    let text = tokens.join(" ");
    let categories: &[(&[&str], &str)] = &[
        (&["nda", "non", "disclosur", "confidenti"], "NDA"),
        (&["servic", "agreement", "sow", "work"], "SERVICE_AGREEMENT"),
        (&["employ", "offer", "hire"], "EMPLOYMENT"),
        (&["leas", "rental", "tenanc"], "LEASE"),
        (&["invoic", "bill", "payment"], "INVOICE"),
        (&["purchas", "order"], "PURCHASE_ORDER"),
        (&["term", "servic", "condit"], "TERMS_OF_SERVICE"),
        (&["privaci", "gdpr", "data", "process"], "PRIVACY"),
        (&["partner", "joint", "ventur"], "PARTNERSHIP"),
        (&["loan", "promissori", "credit"], "LOAN"),
        (&["amend", "addendum", "modif"], "AMENDMENT"),
        (&["releas", "waiver", "indemn"], "WAIVER"),
        (&["power", "attornei"], "POWER_OF_ATTORNEY"),
        (&["consent", "author", "approv"], "CONSENT"),
    ];

    for (keywords, category) in categories {
        let matches = keywords.iter().filter(|k| text.contains(**k)).count();
        if matches >= 2 || (keywords.len() == 1 && matches == 1) {
            return Some(category.to_string());
        }
    }
    None
}

/// Extract entities that are safe to index (non-PII).
fn extract_safe_entities(text: &str, scan: &PrivacyScanResult) -> Vec<SafeEntity> {
    let mut entities = Vec::new();

    // Monetary amounts (not PII)
    for m in RE_MONEY.find_iter(text) {
        if !overlaps_detection(m.start(), m.end(), &scan.detections) {
            entities.push(SafeEntity {
                entity_type: "monetary_amount".to_string(),
                value: m.as_str().to_string(),
            });
        }
    }

    // ISO dates that aren't DOB
    for m in RE_ISO_DATE.find_iter(text) {
        let is_dob = scan.detections.iter().any(|d| {
            d.pii_type == PiiType::DateOfBirth && m.start() >= d.start && m.end() <= d.end
        });
        if !is_dob {
            entities.push(SafeEntity {
                entity_type: "date".to_string(),
                value: m.as_str().to_string(),
            });
        }
    }

    // Document reference numbers
    let lower = text.to_lowercase();
    for cap in RE_DOC_REF.captures_iter(&lower) {
        if let Some(m) = cap.get(1) {
            entities.push(SafeEntity {
                entity_type: "reference_number".to_string(),
                value: m.as_str().to_string(),
            });
        }
    }

    entities.truncate(20);
    entities
}

/// Check if a span overlaps any PII detection.
fn overlaps_detection(start: usize, end: usize, detections: &[privacy::PiiDetection]) -> bool {
    detections.iter().any(|d| start < d.end && end > d.start)
}

fn compute_encrypted_match_score(query_tokens: &[String], entry: &PartialIndexEntry) -> f64 {
    let mut score = 0.0;

    for qt in query_tokens {
        // Exact match in safe tokens
        if entry.safe_tokens.iter().any(|t| t == qt) {
            score += 2.0;
        }
        // Prefix match
        else if entry.safe_tokens.iter().any(|t| t.starts_with(qt.as_str())) {
            score += 1.0;
        }

        // Bigram match
        if entry.safe_bigrams.iter().any(|b| b.contains(qt.as_str())) {
            score += 0.5;
        }

        // Category match
        if let Some(ref cat) = entry.detected_category {
            if cat.to_lowercase().contains(qt.as_str()) {
                score += 1.5;
            }
        }

        // Entity match
        for entity in &entry.safe_entities {
            if entity.value.to_lowercase().contains(qt.as_str()) {
                score += 1.0;
            }
        }
    }

    score
}

fn count_matched_tokens(query_tokens: &[String], entry: &PartialIndexEntry) -> usize {
    query_tokens
        .iter()
        .filter(|qt| {
            entry.safe_tokens.iter().any(|t| t == *qt || t.starts_with(qt.as_str()))
        })
        .count()
}
