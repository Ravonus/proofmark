//! Smart document scanner with entity extraction and intelligent categorization.
//!
//! Scans documents to extract:
//! - Named entities (people, organizations, locations — respecting privacy)
//! - Legal terms and clause types
//! - Document structure (headers, sections, signatures)
//! - Key dates and deadlines
//! - Monetary values and terms
//! - Contract-specific metadata (parties, obligations, conditions)

use std::collections::HashMap;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

use super::privacy;
use crate::index::store::{IndexStore, CF_ENTITIES, StoreResult};
use crate::index::search::tokenizer;

use crate::util::patterns::{DATE_ISO_RE, DATE_WRITTEN_RE};

/// Result of a smart document scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub doc_id: String,
    pub entities: Vec<Entity>,
    pub legal_terms: Vec<LegalTerm>,
    pub sections: Vec<Section>,
    pub key_dates: Vec<KeyDate>,
    pub monetary_values: Vec<MonetaryValue>,
    pub document_type: Option<String>,
    pub complexity_score: f64,
    pub language_hint: String,
    pub word_count: usize,
    pub unique_token_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub entity_type: EntityType,
    pub value: String,
    pub frequency: usize,
    pub is_safe: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum EntityType {
    Organization,
    Location,
    LegalReference,
    DocumentTitle,
    Jurisdiction,
    Role,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegalTerm {
    pub term: String,
    pub category: LegalCategory,
    pub positions: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum LegalCategory {
    Obligation,
    Right,
    Condition,
    Termination,
    Liability,
    Indemnity,
    Confidentiality,
    IntellectualProperty,
    Payment,
    Governance,
    Dispute,
    Warranty,
    Representation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub title: String,
    pub level: u8,
    pub start_pos: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyDate {
    pub label: String,
    pub date_str: String,
    pub is_deadline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonetaryValue {
    pub amount: String,
    pub currency: String,
    pub context: String,
}




static RE_SECTION_HEADER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^(?:(?:ARTICLE|SECTION|CLAUSE)\s+)?(\d+(?:\.\d+)*)[.\s]+([A-Z][A-Za-z\s]{2,60})$").unwrap()
});

static RE_ALL_CAPS_HEADER: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^\s*([A-Z][A-Z\s]{4,60})\s*$").unwrap()
});

static RE_MONEY_USD: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\$\s?([\d,]+(?:\.\d{2})?)").unwrap()
});

static RE_MONEY_WRITTEN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(\d[\d,]*(?:\.\d{2})?)\s*(?:dollars|usd|eur|gbp|eth|btc|sol)").unwrap()
});

static RE_ORGANIZATION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b([A-Z][a-zA-Z&\s]+(?:Inc|LLC|Ltd|Corp|Co|LLP|LP|GmbH|AG|SA|PLC|Foundation|Trust|Association)\.?)(?:\s|,|$)").unwrap()
});

static RE_JURISDICTION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:state of|commonwealth of|province of|laws of)\s+([A-Z][a-zA-Z\s]+)").unwrap()
});

static RE_LEGAL_REF: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:section|§)\s*(\d+(?:\.\d+)*(?:\([a-z]\))?)(?:\s+of\s+(?:the\s+)?([A-Za-z\s]+(?:Act|Code|Law|Statute|Regulation)))").unwrap()
});




static LEGAL_PATTERNS: Lazy<Vec<(Regex, LegalCategory)>> = Lazy::new(|| {
    vec![
        (Regex::new(r"(?i)\b(?:shall|must|obligat|requir|covenant)\b").unwrap(), LegalCategory::Obligation),
        (Regex::new(r"(?i)\b(?:right|entitl|may|permit|authoriz)\b").unwrap(), LegalCategory::Right),
        (Regex::new(r"(?i)\b(?:condition|subject to|provided that|contingent|prerequisite)\b").unwrap(), LegalCategory::Condition),
        (Regex::new(r"(?i)\b(?:terminat|cancel|expir|revok|dissolv)\b").unwrap(), LegalCategory::Termination),
        (Regex::new(r"(?i)\b(?:liabil|liable|damages|consequential|loss)\b").unwrap(), LegalCategory::Liability),
        (Regex::new(r"(?i)\b(?:indemnif|hold harmless|defend|reimburse)\b").unwrap(), LegalCategory::Indemnity),
        (Regex::new(r"(?i)\b(?:confidential|proprietary|trade secret|non-disclosure|nda)\b").unwrap(), LegalCategory::Confidentiality),
        (Regex::new(r"(?i)\b(?:intellectual property|patent|copyright|trademark|trade mark|ip rights)\b").unwrap(), LegalCategory::IntellectualProperty),
        (Regex::new(r"(?i)\b(?:payment|compensat|fee|invoice|remunerat|salary|wage)\b").unwrap(), LegalCategory::Payment),
        (Regex::new(r"(?i)\b(?:govern|jurisdiction|applicable law|venue|forum)\b").unwrap(), LegalCategory::Governance),
        (Regex::new(r"(?i)\b(?:arbitrat|mediat|dispute|resolution|litigation)\b").unwrap(), LegalCategory::Dispute),
        (Regex::new(r"(?i)\b(?:warrant|guaranty|guarantee|assur)\b").unwrap(), LegalCategory::Warranty),
        (Regex::new(r"(?i)\b(?:represent|certif|declar|acknowledg|attest)\b").unwrap(), LegalCategory::Representation),
    ]
});

/// Perform a full smart scan of a document.
pub fn scan_document(
    store: &IndexStore,
    doc_id: &str,
    text: &str,
    is_encrypted: bool,
) -> StoreResult<ScanResult> {
    // Parallel extraction of different entity types via nested rayon::join
    let ((entities, legal_terms), ((sections, key_dates), monetary_values)) = rayon::join(
        || rayon::join(
            || extract_entities(text, is_encrypted),
            || extract_legal_terms(text),
        ),
        || rayon::join(
            || rayon::join(
                || extract_sections(text),
                || extract_key_dates(text),
            ),
            || extract_monetary_values(text),
        ),
    );

    let tokenized = tokenizer::tokenize(text);
    let unique_tokens: std::collections::HashSet<_> = tokenized.tokens.iter().collect();

    let document_type = detect_document_type(&legal_terms, &sections, text);
    let complexity_score = compute_complexity(&tokenized.tokens, &legal_terms, &sections);
    let language_hint = detect_language(text);

    let result = ScanResult {
        doc_id: doc_id.to_string(),
        entities: entities.clone(),
        legal_terms,
        sections,
        key_dates,
        monetary_values,
        document_type,
        complexity_score,
        language_hint,
        word_count: text.split_whitespace().count(),
        unique_token_count: unique_tokens.len(),
    };

    // Store entity index entries
    index_entities(store, doc_id, &entities)?;

    Ok(result)
}

/// Index extracted entities into the entities CF for cross-document search.
fn index_entities(store: &IndexStore, doc_id: &str, entities: &[Entity]) -> StoreResult<()> {
    let mut batch = store.new_batch();

    for entity in entities {
        if !entity.is_safe {
            continue;
        }
        let key = entity_key(&entity.entity_type, &entity.value, doc_id);
        let val = entity.frequency.to_le_bytes();
        store.batch_put(&mut batch, CF_ENTITIES, &key, &val)?;
    }

    store.write_batch(batch)?;
    Ok(())
}

/// Search entities across all documents.
pub fn search_entities(
    store: &IndexStore,
    entity_type: Option<EntityType>,
    query: &str,
    max_results: usize,
) -> StoreResult<Vec<EntitySearchResult>> {
    let query_lower = query.to_lowercase();
    let entries = store.prefix_scan(CF_ENTITIES, &[])?;
    let mut results: HashMap<String, EntitySearchResult> = HashMap::new();

    for (key, val) in entries {
        if let Some((etype, evalue, did)) = parse_entity_key(&key) {
            // Filter by type if specified
            if let Some(ref filter_type) = entity_type {
                if etype != *filter_type {
                    continue;
                }
            }

            // Match query
            if evalue.to_lowercase().contains(&query_lower) {
                let freq = if val.len() >= 8 {
                    usize::from_le_bytes(val[..8].try_into().unwrap_or([0; 8]))
                } else {
                    1
                };

                let entry = results.entry(did.clone()).or_insert(EntitySearchResult {
                    doc_id: did,
                    matched_entities: Vec::new(),
                    total_score: 0.0,
                });
                entry.matched_entities.push(evalue.clone());
                entry.total_score += freq as f64;
            }
        }

        if results.len() >= max_results * 2 {
            break;
        }
    }

    let mut sorted: Vec<EntitySearchResult> = results.into_values().collect();
    sorted.sort_unstable_by(|a, b| b.total_score.partial_cmp(&a.total_score).unwrap_or(std::cmp::Ordering::Equal));
    sorted.truncate(max_results);
    Ok(sorted)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntitySearchResult {
    pub doc_id: String,
    pub matched_entities: Vec<String>,
    pub total_score: f64,
}

// Extraction functions

fn extract_entities(text: &str, is_encrypted: bool) -> Vec<Entity> {
    let mut entities = Vec::new();
    let privacy_scan = if is_encrypted {
        Some(privacy::scan_privacy(text))
    } else {
        None
    };

    // Organizations
    for cap in RE_ORGANIZATION.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let value = m.as_str().trim().to_string();
            let is_safe = privacy_scan.as_ref().map_or(true, |scan| {
                !scan.detections.iter().any(|d| m.start() >= d.start && m.end() <= d.end)
            });
            entities.push(Entity {
                entity_type: EntityType::Organization,
                value,
                frequency: 1,
                is_safe,
            });
        }
    }

    // Jurisdictions
    for cap in RE_JURISDICTION.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            entities.push(Entity {
                entity_type: EntityType::Jurisdiction,
                value: m.as_str().trim().to_string(),
                frequency: 1,
                is_safe: true,
            });
        }
    }

    // Legal references
    for cap in RE_LEGAL_REF.captures_iter(text) {
        let section = cap.get(1).map_or("", |m| m.as_str());
        let law = cap.get(2).map_or("", |m| m.as_str());
        entities.push(Entity {
            entity_type: EntityType::LegalReference,
            value: format!("§{} {}", section, law).trim().to_string(),
            frequency: 1,
            is_safe: true,
        });
    }

    // Deduplicate and count frequencies
    deduplicate_entities(&mut entities);
    entities
}

fn extract_legal_terms(text: &str) -> Vec<LegalTerm> {
    let mut terms: HashMap<(String, LegalCategory), Vec<usize>> = HashMap::new();

    for (re, category) in LEGAL_PATTERNS.iter() {
        for m in re.find_iter(text) {
            let word = m.as_str().to_lowercase();
            terms
                .entry((word, category.clone()))
                .or_default()
                .push(m.start());
        }
    }

    terms
        .into_iter()
        .map(|((term, category), positions)| LegalTerm {
            term,
            category,
            positions,
        })
        .collect()
}

fn extract_sections(text: &str) -> Vec<Section> {
    let mut sections = Vec::new();

    // Numbered sections
    for cap in RE_SECTION_HEADER.captures_iter(text) {
        if let (Some(num), Some(title)) = (cap.get(1), cap.get(2)) {
            let level = num.as_str().matches('.').count() as u8 + 1;
            sections.push(Section {
                title: format!("{} {}", num.as_str(), title.as_str().trim()),
                level,
                start_pos: cap.get(0).map_or(0, |m| m.start()),
            });
        }
    }

    // ALL CAPS headers
    for cap in RE_ALL_CAPS_HEADER.captures_iter(text) {
        if let Some(m) = cap.get(1) {
            let title = m.as_str().trim();
            if title.len() >= 4 && title.split_whitespace().count() <= 8 {
                sections.push(Section {
                    title: title.to_string(),
                    level: 1,
                    start_pos: m.start(),
                });
            }
        }
    }

    sections.sort_by_key(|s| s.start_pos);
    sections
}

fn extract_key_dates(text: &str) -> Vec<KeyDate> {
    let mut dates = Vec::new();

    let date_regexes: &[&Lazy<Regex>] = &[&DATE_ISO_RE, &DATE_WRITTEN_RE];
    for re in date_regexes {
        for m in re.find_iter(text) {
            let context = get_surrounding_context(text, m.start(), 50);
            dates.push(classify_date(m.as_str(), &context));
        }
    }

    dates
}

fn classify_date(date_str: &str, context: &str) -> KeyDate {
    let lower = context.to_lowercase();
    let is_deadline = ["deadline", "due", "expire", "by "]
        .iter()
        .any(|kw| lower.contains(kw));
    KeyDate {
        label: extract_date_label(&lower),
        date_str: date_str.to_string(),
        is_deadline,
    }
}

fn extract_monetary_values(text: &str) -> Vec<MonetaryValue> {
    let mut values = Vec::new();

    for cap in RE_MONEY_USD.captures_iter(text) {
        if let Some(amount) = cap.get(1) {
            values.push(MonetaryValue {
                amount: amount.as_str().to_string(),
                currency: "USD".to_string(),
                context: get_surrounding_context(text, cap.get(0).unwrap().start(), 40),
            });
        }
    }

    for cap in RE_MONEY_WRITTEN.captures_iter(text) {
        if let Some(amount) = cap.get(1) {
            let full_lower = cap.get(0).unwrap().as_str().to_lowercase();
            let currency = detect_currency(&full_lower);
            values.push(MonetaryValue {
                amount: amount.as_str().to_string(),
                currency: currency.to_string(),
                context: get_surrounding_context(text, cap.get(0).unwrap().start(), 40),
            });
        }
    }

    values
}

fn detect_currency(text: &str) -> &'static str {
    const CURRENCIES: &[(&str, &str)] = &[
        ("eur", "EUR"), ("gbp", "GBP"), ("eth", "ETH"),
        ("btc", "BTC"), ("sol", "SOL"),
    ];
    for (keyword, code) in CURRENCIES {
        if text.contains(keyword) {
            return code;
        }
    }
    "USD"
}

// Helpers

/// Single-pass dedup: group by (type, lowered_value), sum frequencies.
fn deduplicate_entities(entities: &mut Vec<Entity>) {
    let mut map: HashMap<(String, String), Entity> = HashMap::new();

    for entity in entities.drain(..) {
        let key = (format!("{:?}", entity.entity_type), entity.value.to_lowercase());
        map.entry(key)
            .and_modify(|e| e.frequency += entity.frequency)
            .or_insert(entity);
    }

    *entities = map.into_values().collect();
}

fn detect_document_type(_legal_terms: &[LegalTerm], _sections: &[Section], text: &str) -> Option<String> {
    let lower = text.to_lowercase();

    let type_signals: &[(&[&str], &str)] = &[
        (&["non-disclosure", "nda", "confidential information", "receiving party", "disclosing party"], "NDA"),
        (&["scope of work", "deliverables", "service agreement", "contractor"], "SERVICE_AGREEMENT"),
        (&["employment", "employee", "employer", "at-will", "probation"], "EMPLOYMENT_AGREEMENT"),
        (&["lease", "landlord", "tenant", "premises", "rent"], "LEASE_AGREEMENT"),
        (&["invoice", "amount due", "payment terms", "bill to"], "INVOICE"),
        (&["purchase order", "quantity", "unit price", "shipping"], "PURCHASE_ORDER"),
        (&["terms of service", "acceptable use", "user agreement"], "TERMS_OF_SERVICE"),
        (&["privacy policy", "personal data", "data controller", "gdpr"], "PRIVACY_POLICY"),
        (&["partnership", "partner", "profit sharing", "joint venture"], "PARTNERSHIP_AGREEMENT"),
        (&["promissory note", "principal amount", "interest rate", "maturity"], "PROMISSORY_NOTE"),
        (&["power of attorney", "attorney-in-fact", "principal", "agent"], "POWER_OF_ATTORNEY"),
        (&["last will", "testament", "beneficiary", "executor"], "WILL"),
    ];

    let mut best_match = None;
    let mut best_score = 0usize;

    for (signals, doc_type) in type_signals {
        let score = signals.iter().filter(|s| lower.contains(**s)).count();
        if score > best_score {
            best_score = score;
            best_match = Some(doc_type.to_string());
        }
    }

    if best_score >= 2 {
        best_match
    } else {
        None
    }
}

fn compute_complexity(tokens: &[String], legal_terms: &[LegalTerm], sections: &[Section]) -> f64 {
    let word_count = tokens.len() as f64;
    let legal_density = if word_count > 0.0 {
        legal_terms.len() as f64 / word_count
    } else {
        0.0
    };
    let section_count = sections.len() as f64;

    // Normalized complexity: 0.0 = simple, 1.0 = very complex
    let raw = (word_count / 5000.0) * 0.3
        + legal_density * 100.0 * 0.4
        + (section_count / 20.0) * 0.3;

    raw.min(1.0)
}

fn detect_language(text: &str) -> String {
    // Simple heuristic: check for common words
    let lower = text.to_lowercase();
    let en_words = ["the", "and", "is", "of", "to", "in", "for", "with"];
    let en_count = en_words.iter().filter(|w| lower.contains(**w)).count();

    if en_count >= 4 {
        "en".to_string()
    } else {
        "unknown".to_string()
    }
}

fn get_surrounding_context(text: &str, pos: usize, window: usize) -> String {
    let start = pos.saturating_sub(window);
    let end = (pos + window).min(text.len());
    text[start..end].replace('\n', " ").trim().to_string()
}

/// `lower_context` is already lowercased by the caller.
fn extract_date_label(lower_context: &str) -> String {
    let labels = [
        ("effective", "Effective Date"),
        ("start", "Start Date"),
        ("end", "End Date"),
        ("expir", "Expiration Date"),
        ("deadline", "Deadline"),
        ("due", "Due Date"),
        ("sign", "Signing Date"),
        ("execut", "Execution Date"),
        ("terminat", "Termination Date"),
    ];

    for (keyword, label) in labels {
        if lower_context.contains(keyword) {
            return label.to_string();
        }
    }
    "Date".to_string()
}

fn entity_key(etype: &EntityType, value: &str, doc_id: &str) -> Vec<u8> {
    let type_str = format!("{:?}", etype);
    let lower_val = value.to_lowercase();
    format!("{}:{}:{}", type_str, lower_val, doc_id).into_bytes()
}

fn parse_entity_key(key: &[u8]) -> Option<(EntityType, String, String)> {
    let s = String::from_utf8(key.to_vec()).ok()?;
    let parts: Vec<&str> = s.splitn(3, ':').collect();
    if parts.len() != 3 {
        return None;
    }

    let etype = match parts[0] {
        "Organization" => EntityType::Organization,
        "Location" => EntityType::Location,
        "LegalReference" => EntityType::LegalReference,
        "DocumentTitle" => EntityType::DocumentTitle,
        "Jurisdiction" => EntityType::Jurisdiction,
        "Role" => EntityType::Role,
        _ => return None,
    };

    Some((etype, parts[1].to_string(), parts[2].to_string()))
}

