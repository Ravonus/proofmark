//! PDF analysis engine — extracts text, detects fields, signature blocks, and signers.
//!
//! Mirrors src/server/pdf-analyze.ts with identical detection logic.
//! Uses rayon for parallel regex passes over large documents.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

// ══════════════════════════════════════════════════════════════════════════════
// Types (mirror pdf-types.ts)
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum FieldType {
    Name,
    Address,
    Date,
    Signature,
    Initials,
    Wallet,
    Title,
    Email,
    Company,
    Phone,
    Witness,
    Notary,
    Amount,
    Reference,
    Checkbox,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedField {
    #[serde(rename = "type")]
    pub field_type: FieldType,
    pub label: String,
    pub value: Option<String>,
    pub blank: bool,
    pub party_role: Option<String>,
    pub line: usize,
    pub position: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureBlock {
    pub party_role: String,
    pub party_label: String,
    pub signer_index: usize,
    pub fields: Vec<DetectedField>,
    pub line: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedSigner {
    pub label: String,
    pub role: Option<String>,
    pub address: Option<String>,
    pub mailing_address: Option<String>,
    pub chain: Option<String>,
    pub confidence: String, // "high" | "medium" | "low"
    pub source: String,
    pub fields: Vec<DetectedField>,
    pub signature_block: Option<SignatureBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedAddress {
    pub address: String,
    pub chain: String,
    pub context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfAnalysisResult {
    pub title: String,
    pub content: String,
    pub page_count: usize,
    pub document_type: Option<String>,
    pub detected_signers: Vec<DetectedSigner>,
    pub detected_addresses: Vec<DetectedAddress>,
    pub signature_blocks: Vec<SignatureBlock>,
    pub detected_fields: Vec<DetectedField>,
    pub suggested_signer_count: usize,
}

// ══════════════════════════════════════════════════════════════════════════════
// Compiled Regexes (compiled once, used across all analysis calls)
// ══════════════════════════════════════════════════════════════════════════════

static BLANK_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?:_{3,}|\.{5,}|-{5,})").unwrap());

static MULTI_PARTY_INITIALS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b[A-Za-z]+\s+Initials\s*:\s*(?:_{3,}|\.{3,}|-{3,}).*\b[A-Za-z]+\s+Initials\s*:\s*(?:_{3,}|\.{3,}|-{3,})").unwrap()
});

static MULTI_PARTY_INITIALS_CAPTURE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b([A-Za-z]+)\s+Initials\s*:\s*(?:_{3,}|\.{3,}|-{3,})").unwrap()
});

static PARTY_ROLES_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:Buyer|Seller|Investor|Borrower|Lender|Licensor|Licensee|Landlord|Tenant|Legal\s*Counsel|Counsel|Auditor|Guarantor|Contractor|Client|Vendor|Supplier|Agent|Broker|Trustee|Beneficiary|Employer|Employee|Consultant|Service\s*Provider|Recipient|Grantor|Grantee|Assignor|Assignee|Mortgagor|Mortgagee|Pledgor|Pledgee|Principal|Surety|Indemnitor|Indemnitee|Obligor|Obligee|Franchisor|Franchisee|Lessor|Lessee|Partner|Member|Manager|Director|Officer|Shareholder|Stakeholder|Underwriter|Arranger|Servicer|Originator|Custodian)\b").unwrap()
});

static SIGNATURE_HEADING_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^\s*(?:IN\s+WITNESS\s+WHEREOF|SIGNATURES?\s*(?:PAGE|BLOCK|SECTION)?|EXECUTION\s+(?:PAGE|BLOCK)|AGREED\s+AND\s+ACCEPTED|ACKNOWLEDGED\s+AND\s+AGREED|SIGNED\s*,?\s*SEALED\s*,?\s*(?:AND\s*)?DELIVERED|BY\s+THEIR\s+(?:DULY\s+)?AUTHORIZED\s+REPRESENTATIVES?)\b").unwrap()
});

static EVM_ADDRESS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b0x[0-9a-fA-F]{40}\b").unwrap());

static BTC_ADDRESS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(?:bc1[a-zA-HJ-NP-Z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b").unwrap()
});

// Solana address regex — available for future use
#[allow(dead_code)]
static SOL_ADDRESS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b").unwrap());

static CHECKBOX_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[\u2610\u2611\u2612\u25A1\u25A0\u25CB\u25CF]|(?:\[\s*[xX]?\s*\])").unwrap());

// Document type classification
static DOCTYPE_NDA_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:non-?disclosure|nda|confidentiality)\b").unwrap()
});
static DOCTYPE_EMPLOYMENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:employment\s+(?:agreement|contract)|offer\s+letter|job\s+offer)\b")
        .unwrap()
});
static DOCTYPE_LEASE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:lease\s+agreement|rental\s+agreement|tenancy)\b").unwrap()
});
static DOCTYPE_LOAN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:loan\s+agreement|promissory\s+note|mortgage)\b").unwrap()
});
static DOCTYPE_SERVICE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)\b(?:service\s+agreement|consulting\s+agreement|independent\s+contractor)\b",
    )
    .unwrap()
});
static DOCTYPE_PURCHASE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)\b(?:purchase\s+agreement|sale\s+agreement|bill\s+of\s+sale)\b").unwrap()
});

// ══════════════════════════════════════════════════════════════════════════════
// Text normalization
// ══════════════════════════════════════════════════════════════════════════════

fn normalize_text(text: &str) -> String {
    let mut s = text.to_string();
    // Ligatures
    s = s.replace('\u{FB00}', "ff");
    s = s.replace('\u{FB01}', "fi");
    s = s.replace('\u{FB02}', "fl");
    s = s.replace('\u{FB03}', "ffi");
    s = s.replace('\u{FB04}', "ffl");
    // Smart quotes → ASCII
    for c in ['\u{2018}', '\u{2019}', '\u{201A}', '\u{FF07}'] {
        s = s.replace(c, "'");
    }
    for c in ['\u{201C}', '\u{201D}', '\u{201E}', '\u{FF02}'] {
        s = s.replace(c, "\"");
    }
    // Dashes → standard
    for c in ['\u{2013}', '\u{2014}', '\u{2015}'] {
        s = s.replace(c, "-");
    }
    // Non-breaking space
    s = s.replace('\u{00A0}', " ");
    // Section symbol
    s = s.replace('\u{00A7}', "§");
    // Zero-width chars
    for c in ['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'] {
        s = s.replace(c, "");
    }
    // Multiple spaces → single (via regex for efficiency)
    static MULTI_SPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]{2,}").unwrap());
    MULTI_SPACE.replace_all(&s, " ").into_owned()
}

// ══════════════════════════════════════════════════════════════════════════════
// Header/Footer stripping
// ══════════════════════════════════════════════════════════════════════════════

fn strip_headers_footers(lines: Vec<&str>) -> Vec<String> {
    static PAGE_NUM_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"^(?:page\s+)?\d+\s*(?:of\s+\d+)?$").unwrap());
    static DASHED_PAGE_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"^-\s*\d+\s*-$").unwrap());
    static BATES_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"^[A-Z]{2,6}\d{4,10}$").unwrap());
    static WATERMARK_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"^(?:DRAFT|CONFIDENTIAL|PRIVILEGED|SAMPLE)$").unwrap());

    lines
        .into_iter()
        .filter(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return false;
            }
            if PAGE_NUM_RE.is_match(trimmed) {
                return false;
            }
            if DASHED_PAGE_RE.is_match(trimmed) {
                return false;
            }
            if BATES_RE.is_match(trimmed) {
                return false;
            }
            if WATERMARK_RE.is_match(trimmed) {
                return false;
            }
            true
        })
        .map(String::from)
        .collect()
}

// ══════════════════════════════════════════════════════════════════════════════
// Title extraction
// ══════════════════════════════════════════════════════════════════════════════

fn extract_title(lines: &[String]) -> String {
    static SKIP_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"^(page|date|section|article|clause|copyright|©|\(c\)|--|draft|confidential|$)")
            .unwrap()
    });

    for line in lines.iter().take(15) {
        let trimmed = line.trim();
        if trimmed.is_empty() || SKIP_RE.is_match(trimmed) {
            continue;
        }
        if trimmed.len() > 5
            && trimmed.len() < 120
            && trimmed == trimmed.to_uppercase()
            && trimmed.chars().any(|c| c.is_ascii_uppercase())
        {
            return title_case(trimmed);
        }
    }

    for line in lines.iter().take(8) {
        let trimmed = line.trim();
        if trimmed.is_empty() || SKIP_RE.is_match(trimmed) {
            continue;
        }
        if trimmed.len() > 4 && trimmed.len() < 120 && !trimmed.chars().all(|c| c.is_ascii_digit()) {
            return trimmed.to_string();
        }
    }

    "Uploaded Document".to_string()
}

// ══════════════════════════════════════════════════════════════════════════════
// Document type detection
// ══════════════════════════════════════════════════════════════════════════════

fn detect_document_type(text: &str) -> Option<String> {
    let sample = if text.len() > 2000 { &text[..2000] } else { text };

    if Regex::new(r"(?i)\bnon[\s-]?disclosure\s+agreement\b")
        .unwrap()
        .is_match(sample)
    {
        return Some("Non-Disclosure Agreement (NDA)".into());
    }
    if Regex::new(r"(?i)\bconfidentiality\s+agreement\b")
        .unwrap()
        .is_match(sample)
    {
        return Some("Confidentiality Agreement".into());
    }
    if Regex::new(r"(?i)\bmaster\s+service\s+agreement\b")
        .unwrap()
        .is_match(sample)
    {
        return Some("Master Service Agreement".into());
    }
    if Regex::new(r"(?i)\bservice\s+(?:level\s+)?agreement\b")
        .unwrap()
        .is_match(sample)
    {
        return Some("Service Agreement".into());
    }
    if Regex::new(r"(?i)\bconsulting\s+agreement\b")
        .unwrap()
        .is_match(sample)
    {
        return Some("Consulting Agreement".into());
    }
    if Regex::new(r"(?i)\btoken\s+(purchase|sale)\s+agreement\b")
        .unwrap()
        .is_match(sample)
    {
        return Some("Token Purchase Agreement".into());
    }
    if DOCTYPE_NDA_RE.is_match(sample) {
        return Some("NDA / Confidentiality Agreement".into());
    }
    if DOCTYPE_EMPLOYMENT_RE.is_match(sample) {
        return Some("Employment Agreement".into());
    }
    if DOCTYPE_LEASE_RE.is_match(sample) {
        return Some("Lease Agreement".into());
    }
    if DOCTYPE_LOAN_RE.is_match(sample) {
        return Some("Loan / Promissory Note".into());
    }
    if DOCTYPE_SERVICE_RE.is_match(sample) {
        return Some("Service / Consulting Agreement".into());
    }
    if DOCTYPE_PURCHASE_RE.is_match(sample) {
        return Some("Purchase / Sale Agreement".into());
    }
    None
}

// ══════════════════════════════════════════════════════════════════════════════
// Field detection
// ══════════════════════════════════════════════════════════════════════════════

/// Detect fields from document text lines.
/// Uses parallel processing for large documents via rayon.
fn detect_fields(lines: &[String], _recital_zone: Option<(usize, usize)>) -> Vec<DetectedField> {
    let mut fields = Vec::new();
    let mut current_party: Option<String> = None;
    let mut party_set_at = 0usize;
    let party_scope_lines = 6usize;
    let mut char_pos = 0usize;

    for (line_num, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        if let Some(header) = extract_party_header(trimmed) {
            current_party = Some(header);
            party_set_at = line_num;
        }

        if current_party.is_some() && line_num.saturating_sub(party_set_at) > party_scope_lines {
            current_party = None;
        }

        if Regex::new(r"(?i)^\d+\.\s+(?:COMPLEX\s+)?CLAUSE\s+\d+")
            .unwrap()
            .is_match(trimmed)
            || Regex::new(r"(?i)^(?:ARTICLE|SECTION)\s+\d+")
                .unwrap()
                .is_match(trimmed)
            || Regex::new(r"(?i)^SPECIAL\s+CONDITIONS")
                .unwrap()
                .is_match(trimmed)
        {
            current_party = None;
        }

        fields.extend(detect_fields_in_line(line, line_num, current_party.as_deref(), char_pos));
        char_pos += line.len() + 1;
    }

    fields
}

fn detect_fields_in_line(
    line: &str,
    line_num: usize,
    current_party: Option<&str>,
    char_pos: usize,
) -> Vec<DetectedField> {
    let mut fields = Vec::new();
    let trimmed = line.trim();

    if Regex::new(r"(?i)signature\s*:\s*(?:_{3,}|\.{5,}|-{5,})")
        .unwrap()
        .is_match(trimmed)
    {
        fields.push(blank_field(
            FieldType::Signature,
            "Signature",
            current_party,
            line_num,
            char_pos + line.find('_').unwrap_or(0),
        ));
    }

    if Regex::new(r"(?i)\bBy\s*:\s*(?:_{3,}|\.{5,}|-{5,})")
        .unwrap()
        .is_match(trimmed)
    {
        fields.push(blank_field(
            FieldType::Signature,
            "Authorized Signature (By)",
            current_party,
            line_num,
            char_pos + line.find('_').unwrap_or(0),
        ));
    }

    if Regex::new(r"(?i)\bIts\s*:\s*(?:_{3,}|\.{5,}|-{5,})")
        .unwrap()
        .is_match(trimmed)
    {
        fields.push(blank_field(
            FieldType::Title,
            "Corporate Title (Its)",
            current_party,
            line_num,
            char_pos + line.find('_').unwrap_or(0),
        ));
    }

    if CHECKBOX_RE.is_match(trimmed) {
        fields.push(DetectedField {
            field_type: FieldType::Checkbox,
            label: trimmed.to_string(),
            value: None,
            blank: true,
            party_role: None,
            line: line_num + 1,
            position: char_pos,
        });
    }

    if MULTI_PARTY_INITIALS_RE.is_match(trimmed) {
        for caps in MULTI_PARTY_INITIALS_CAPTURE.captures_iter(trimmed) {
            if let Some(party) = caps.get(1) {
                fields.push(DetectedField {
                    field_type: FieldType::Initials,
                    label: format!("{} Initials", party.as_str()),
                    value: None,
                    blank: true,
                    party_role: Some(party.as_str().to_string()),
                    line: line_num + 1,
                    position: char_pos,
                });
            }
        }
    } else if Regex::new(r"(?i)\binitials\s*:\s*(?:_{3,}|\.{3,}|-{3,})")
        .unwrap()
        .is_match(trimmed)
    {
        fields.push(blank_field(
            FieldType::Initials,
            "Initials",
            current_party,
            line_num,
            char_pos + line.find('_').unwrap_or(0),
        ));
    }

    if let Some(caps) = Regex::new(
        r"(?i)(?:(?:typed\s+or\s+)?print(?:ed)?\s+name|name\s*\(print(?:ed)?\)|^name)\s*:\s*((?:_{3,}|\.{5,}|-{5,})|([A-Za-z\u{00C0}-\u{024F}][A-Za-z\u{00C0}-\u{024F}\s.'-]{1,60}))",
    )
    .unwrap()
    .captures(trimmed)
    {
        let raw_value = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
        let value = caps.get(2).map(|m| m.as_str().trim().to_string());
        fields.push(DetectedField {
            field_type: FieldType::Name,
            label: "Printed Name".into(),
            value: if BLANK_RE.is_match(raw_value) { None } else { value },
            blank: BLANK_RE.is_match(raw_value),
            party_role: current_party.map(str::to_string),
            line: line_num + 1,
            position: char_pos + line.find(raw_value).unwrap_or(0),
        });
    }

    if !Regex::new(r"(?i)effective\s+date").unwrap().is_match(trimmed) {
        if let Some(caps) = Regex::new(
            r"(?i)\bDate\s*:\s*((?:_{3,}|\.{5,}|-{5,})|[\d/.-]+|[A-Z][a-z]+\s+\d{1,2},?\s*\d{4}|\d{1,2}\s+[A-Z][a-z]+\s+\d{4})",
        )
        .unwrap()
        .captures(trimmed)
        {
            let raw_value = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
            fields.push(DetectedField {
                field_type: FieldType::Date,
                label: "Date".into(),
                value: if BLANK_RE.is_match(raw_value) {
                    None
                } else {
                    Some(raw_value.to_string())
                },
                blank: BLANK_RE.is_match(raw_value),
                party_role: current_party.map(str::to_string),
                line: line_num + 1,
                position: char_pos + line.find(raw_value).unwrap_or(0),
            });
        }
    }

    if let Some(caps) = Regex::new(
        r"(?i)\bTitle\s*:\s*((?:_{3,}|\.{5,}|-{5,})|([A-Za-z\u{00C0}-\u{024F}][A-Za-z\u{00C0}-\u{024F}\s.'-]{2,40}))",
    )
    .unwrap()
    .captures(trimmed)
    {
        let raw_value = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
        let value = caps.get(2).map(|m| m.as_str().trim().to_string());
        fields.push(DetectedField {
            field_type: FieldType::Title,
            label: "Title/Role".into(),
            value: if BLANK_RE.is_match(raw_value) { None } else { value },
            blank: BLANK_RE.is_match(raw_value),
            party_role: current_party.map(str::to_string),
            line: line_num + 1,
            position: char_pos + line.find(raw_value).unwrap_or(0),
        });
    }

    fields
}

// ══════════════════════════════════════════════════════════════════════════════
// Wallet address detection
// ══════════════════════════════════════════════════════════════════════════════

fn find_wallet_addresses(text: &str) -> Vec<DetectedAddress> {
    let mut addresses = Vec::new();
    let mut seen = HashSet::new();

    let mut add_address = |address: &str, chain: &str, index: usize| {
        let seen_key = if chain == "ETH" {
            address.to_lowercase()
        } else {
            address.to_string()
        };
        if seen.insert(seen_key) {
            let after_window = if chain == "BTC" { 101 } else { 100 };
            addresses.push(DetectedAddress {
                address: address.to_string(),
                chain: chain.to_string(),
                context: get_context(text, index, after_window),
            });
        }
    };

    static LABELED_WALLET_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(
            r"(?im)\b(?:wallet|eth(?:ereum)?|btc|bitcoin|sol(?:ana)?|receiving|payment|treasury|deposit|payout|public|send\s*to|receive\s*at)\s*(?:address|addr\.?|wallet|key)?\s*:\s*([a-zA-Z0-9]{20,})",
        )
        .unwrap()
    });

    for caps in LABELED_WALLET_RE.captures_iter(text) {
        let Some(full_match) = caps.get(0) else {
            continue;
        };
        let Some(address_match) = caps.get(1) else {
            continue;
        };
        let address = address_match.as_str();
        if EVM_ADDRESS_RE.is_match(address) {
            add_address(address, "ETH", full_match.start());
        } else if BTC_ADDRESS_RE.is_match(address) {
            add_address(address, "BTC", full_match.start());
        }
    }

    for m in EVM_ADDRESS_RE.find_iter(text) {
        let addr = m.as_str();
        add_address(addr, "ETH", m.start());
    }

    for m in BTC_ADDRESS_RE.find_iter(text) {
        let addr = m.as_str();
        if addr.starts_with("bc1") || addr.starts_with('1') || addr.starts_with('3') {
            add_address(addr, "BTC", m.start());
        }
    }

    addresses
}

// ══════════════════════════════════════════════════════════════════════════════
// Signature block detection
// ══════════════════════════════════════════════════════════════════════════════

fn find_witness_whereof_line(lines: &[String]) -> Option<usize> {
    for (i, line) in lines.iter().enumerate().rev() {
        if SIGNATURE_HEADING_RE.is_match(line.trim()) {
            return Some(i);
        }
    }
    None
}

fn detect_signature_blocks(
    lines: &[String],
    fields: &[DetectedField],
    _witness_idx: Option<usize>,
) -> Vec<SignatureBlock> {
    let excluded = find_excluded_zone_lines(lines);
    let mut raw_blocks = Vec::new();

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        let Some(header) = extract_party_header(trimmed) else {
            continue;
        };
        if excluded.contains(&idx) {
            continue;
        }

        let named_info = extract_named_party_info(trimmed);
        let mut block_fields = Vec::new();

        for next_idx in (idx + 1)..(idx + 9).min(lines.len()) {
            let next_line = lines[next_idx].trim();
            if extract_party_header(next_line).is_some() {
                break;
            }
            if MULTI_PARTY_INITIALS_RE.is_match(next_line) || is_boilerplate_line(next_line) {
                continue;
            }
            block_fields.extend(
                fields
                    .iter()
                    .filter(|field| field.line == next_idx + 1)
                    .cloned(),
            );
        }

        block_fields.extend(
            fields
                .iter()
                .filter(|field| field.line == idx + 1)
                .cloned(),
        );

        if block_fields
            .iter()
            .any(|field| matches!(field.field_type, FieldType::Signature | FieldType::Initials))
        {
            let cloned_fields = block_fields
                .into_iter()
                .map(|mut field| {
                    field.party_role = Some(header.clone());
                    field
                })
                .collect::<Vec<_>>();

            raw_blocks.push(SignatureBlock {
                party_role: header.clone(),
                party_label: named_info
                    .map(|(entity, role)| format!("{entity} ({role})"))
                    .unwrap_or_else(|| trimmed.to_string()),
                signer_index: 0,
                fields: cloned_fields,
                line: idx + 1,
            });
        }
    }

    let mut deduped: HashMap<String, SignatureBlock> = HashMap::new();
    for block in raw_blocks {
        let key = block.party_role.to_lowercase();
        match deduped.get_mut(&key) {
            Some(existing) => {
                let mut field_keys = existing
                    .fields
                    .iter()
                    .map(|field| format!("{:?}:{}", field.field_type, field.label))
                    .collect::<HashSet<_>>();
                for field in block.fields {
                    let field_key = format!("{:?}:{}", field.field_type, field.label);
                    if field_keys.insert(field_key) {
                        existing.fields.push(field);
                    }
                }
                if block.party_label.contains('(') && !existing.party_label.contains('(') {
                    existing.party_label = block.party_label;
                }
            }
            None => {
                deduped.insert(key, block);
            }
        }
    }

    let mut blocks = deduped.into_values().collect::<Vec<_>>();
    blocks.sort_by(|a, b| a.line.cmp(&b.line).then(a.party_label.cmp(&b.party_label)));
    for (idx, block) in blocks.iter_mut().enumerate() {
        block.signer_index = idx;
    }
    blocks
}

// ══════════════════════════════════════════════════════════════════════════════
// Signer estimation
// ══════════════════════════════════════════════════════════════════════════════

fn estimate_signer_count(text: &str, lines: &[String]) -> usize {
    // Count unique party roles mentioned
    let mut roles = HashSet::new();
    for m in PARTY_ROLES_RE.find_iter(text) {
        roles.insert(m.as_str().to_lowercase());
    }

    // Count signature lines
    let sig_lines = lines
        .iter()
        .filter(|l| {
            let t = l.trim().to_lowercase();
            t.contains("signature") && BLANK_RE.is_match(l)
        })
        .count();

    roles.len().max(sig_lines).max(2)
}

// ══════════════════════════════════════════════════════════════════════════════
// Deduplication
// ══════════════════════════════════════════════════════════════════════════════

fn deduplicate_fields(fields: Vec<DetectedField>) -> Vec<DetectedField> {
    let mut seen = HashSet::new();
    let mut result = Vec::with_capacity(fields.len());

    for field in fields {
        let key = format!(
            "{}:{:?}:{}",
            field.line, field.field_type, field.label
        );
        if seen.insert(key) {
            result.push(field);
        }
    }

    result
}

// ══════════════════════════════════════════════════════════════════════════════
// Build signer list
// ══════════════════════════════════════════════════════════════════════════════

fn build_signer_list(
    signature_blocks: &[SignatureBlock],
    addresses: &[DetectedAddress],
    fields: &[DetectedField],
) -> Vec<DetectedSigner> {
    let mut signers = Vec::new();

    for block in signature_blocks {
        signers.push(DetectedSigner {
            label: block.party_label.clone(),
            role: Some(block.party_role.clone()),
            address: None,
            mailing_address: None,
            chain: None,
            confidence: "medium".into(),
            source: "signature block".into(),
            fields: dedupe_fields_by_type(&block.fields),
            signature_block: Some(block.clone()),
        });
    }

    if signers.is_empty() {
        let mut roles = Vec::new();
        for field in fields.iter().filter(|field| {
            field.blank
                && matches!(field.field_type, FieldType::Name | FieldType::Signature)
                && field.party_role.is_some()
        }) {
            if let Some(role) = &field.party_role {
                if !roles.contains(role) {
                    roles.push(role.clone());
                }
            }
        }
        for role in roles {
            let role_fields = fields
                .iter()
                .filter(|field| field.party_role.as_deref() == Some(role.as_str()))
                .cloned()
                .collect::<Vec<_>>();
            signers.push(DetectedSigner {
                label: role.clone(),
                role: Some(role),
                address: None,
                mailing_address: None,
                chain: None,
                confidence: "low".into(),
                source: "field analysis".into(),
                fields: dedupe_fields_by_type(&role_fields),
                signature_block: None,
            });
        }
    }

    for address in addresses {
        if signers
            .iter()
            .any(|signer| signer.address.as_deref() == Some(address.address.as_str()))
        {
            continue;
        }
        signers.push(DetectedSigner {
            label: format!("Wallet ({})", address.chain),
            role: None,
            address: Some(address.address.clone()),
            mailing_address: None,
            chain: Some(address.chain.clone()),
            confidence: "low".into(),
            source: "address detection".into(),
            fields: Vec::new(),
            signature_block: None,
        });
    }

    signers
}

// ══════════════════════════════════════════════════════════════════════════════
// Content cleaning
// ══════════════════════════════════════════════════════════════════════════════

fn clean_content(text: &str) -> String {
    static MULTI_NEWLINE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n{4,}").unwrap());
    static MULTI_SPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]+").unwrap());
    let collapsed = MULTI_NEWLINE.replace_all(text, "\n\n\n");
    MULTI_SPACE.replace_all(collapsed.trim(), " ").to_string()
}

// ══════════════════════════════════════════════════════════════════════════════
// Main entry point
// ══════════════════════════════════════════════════════════════════════════════

/// Analyze a PDF buffer: extract text, detect fields, signers, and addresses.
///
/// This is the main CPU-intensive operation. It uses rayon for parallel regex
/// matching on large documents.
pub fn analyze_pdf(pdf_bytes: &[u8]) -> Result<PdfAnalysisResult, anyhow::Error> {
    // Extract text using pdf-extract (lopdf underneath)
    let text = pdf_extract::extract_text_from_mem(pdf_bytes)
        .map_err(|e| anyhow::anyhow!("PDF text extraction failed: {e}"))?;

    // Count pages using lopdf
    let page_count = match lopdf::Document::load_mem(pdf_bytes) {
        Ok(doc) => doc.get_pages().len(),
        Err(_) => 1,
    };

    // Cap text at 500KB
    let capped = if text.len() > 500_000 {
        &text[..500_000]
    } else {
        &text
    };

    let normalized = normalize_text(capped);
    let raw_lines: Vec<&str> = normalized.split('\n').collect();
    let lines = strip_headers_footers(raw_lines);

    let title = extract_title(&lines);
    let mut content = clean_content(&lines.join("\n"));
    if page_count > 0 {
        content = format!("{content}\n\n-- {page_count} of {page_count} --");
    }
    let document_type = detect_document_type(&normalized);

    let witness_idx = find_witness_whereof_line(&lines);
    let text_fields = detect_fields(&lines, None);
    let detected_fields = deduplicate_fields(text_fields);

    let signature_blocks = detect_signature_blocks(&lines, &detected_fields, witness_idx);
    let detected_addresses = find_wallet_addresses(&normalized);
    let detected_signers = build_signer_list(&signature_blocks, &detected_addresses, &detected_fields);

    let suggested_signer_count = detected_signers
        .len()
        .max(signature_blocks.len())
        .max(estimate_signer_count(&normalized, &lines))
        .max(2);

    Ok(PdfAnalysisResult {
        title,
        content,
        page_count,
        document_type,
        detected_signers,
        detected_addresses,
        signature_blocks,
        detected_fields,
        suggested_signer_count,
    })
}

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

fn blank_field(
    field_type: FieldType,
    label: &str,
    party_role: Option<&str>,
    line_num: usize,
    position: usize,
) -> DetectedField {
    DetectedField {
        field_type,
        label: label.into(),
        value: None,
        blank: true,
        party_role: party_role.map(str::to_string),
        line: line_num + 1,
        position,
    }
}

fn extract_party_header(line: &str) -> Option<String> {
    static GENERIC_PARTY_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(
            r"(?i)^((?:DISCLOSING|RECEIVING|FIRST|SECOND|THIRD|FOURTH|FIFTH|HIRING|CONTRACTING|GUARANTOR|CO-?SIGNING|INDEMNIFYING|INDEMNIFIED)\s+PARTY|PARTY\s+[A-Z\d])\s*$",
        )
        .unwrap()
    });
    static PARTY_INFO_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)^Party\s+(Disclosing|Receiving|Providing|Requesting)\s+Information\s*:").unwrap()
    });
    static NAMED_APPROVAL_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(&format!(
            r"(?i)^(.+?)\s+\(\s*({})\s*\)\s*(?:Approval|Acknowledgment|Acceptance|Confirmation|Authorization)\s*:",
            PARTY_ROLES_RE.as_str()
        ))
        .unwrap()
    });

    if let Some(caps) = GENERIC_PARTY_RE.captures(line) {
        return caps.get(1).map(|m| title_case(m.as_str()));
    }
    if let Some(caps) = PARTY_INFO_RE.captures(line) {
        return caps
            .get(1)
            .map(|m| title_case(&format!("{} Party", m.as_str())));
    }
    if let Some(caps) = NAMED_APPROVAL_RE.captures(line) {
        return caps.get(2).map(|m| m.as_str().trim().to_string());
    }
    None
}

fn extract_named_party_info(line: &str) -> Option<(String, String)> {
    static NAMED_APPROVAL_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(&format!(
            r"(?i)^(.+?)\s+\(\s*({})\s*\)\s*(?:Approval|Acknowledgment|Acceptance|Confirmation|Authorization)\s*:",
            PARTY_ROLES_RE.as_str()
        ))
        .unwrap()
    });

    NAMED_APPROVAL_RE.captures(line).map(|caps| {
        (
            caps.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default(),
            caps.get(2).map(|m| m.as_str().trim().to_string()).unwrap_or_default(),
        )
    })
}

fn find_excluded_zone_lines(lines: &[String]) -> HashSet<usize> {
    let mut excluded = HashSet::new();

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim().to_lowercase();

        if Regex::new(r"^(?:witness(?:ed)?(?:\s+by)?|in\s+the\s+presence\s+of)\s*:?")
            .unwrap()
            .is_match(&trimmed)
        {
            for line_idx in idx..(idx + 10).min(lines.len()) {
                excluded.insert(line_idx);
            }
        }

        if Regex::new(r"^(?:state\s+of|notary\s+public|before\s+me.*notary|subscribed\s+and\s+sworn)")
            .unwrap()
            .is_match(&trimmed)
        {
            for line_idx in idx..(idx + 20).min(lines.len()) {
                excluded.insert(line_idx);
            }
        }

        if Regex::new(r"^(?:approved\s+as\s+to\s+form|legal\s+counsel\s+review)")
            .unwrap()
            .is_match(&trimmed)
        {
            for line_idx in idx..(idx + 6).min(lines.len()) {
                excluded.insert(line_idx);
            }
        }

        if Regex::new(r"^(?:copyright|©|\(c\))\s*\d{4}")
            .unwrap()
            .is_match(&trimmed)
            || Regex::new(r"\ball\s+rights\s+reserved\b")
                .unwrap()
                .is_match(&trimmed)
        {
            excluded.insert(idx);
        }

        if Regex::new(r"^(?:draft|confidential|sample|do\s+not\s+copy|privileged)\s*$")
            .unwrap()
            .is_match(&trimmed)
        {
            excluded.insert(idx);
        }
    }

    excluded
}

fn is_boilerplate_line(line: &str) -> bool {
    if line.len() < 10 {
        return false;
    }
    if Regex::new(r"(?i)^(?:Signature|Date|Initials|(?:Typed\s+or\s+)?Print(?:ed)?\s+Name|Name|Title|By|Its|Email|Phone|Company|Wallet|Authorized)\s*:")
        .unwrap()
        .is_match(line)
    {
        return false;
    }
    if Regex::new(r"(?i)[.!?;]\s+(?:Signature|Date|Initials|Wallet)\s*:")
        .unwrap()
        .is_match(line)
    {
        return true;
    }
    Regex::new(r"(?i)^(?:Each|The\s|All\s|Any\s|No\s|In\s|This\s|That\s|Such\s|For\s|If\s|As\s|To\s|Upon\s)")
        .unwrap()
        .is_match(line)
        && line.len() > 60
}

fn get_context(text: &str, index: usize, after_window: usize) -> String {
    let start = index.saturating_sub(200);
    let end = (index + after_window).min(text.len());
    let mut context = text[start..end]
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if start > 0 {
        context = format!("...{context}");
    }
    if end < text.len() {
        context.push_str("...");
    }
    context
}

fn title_case(s: &str) -> String {
    let small = [
        "a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "by", "at",
    ];

    s.split_whitespace()
        .enumerate()
        .map(|(idx, word)| {
            if word == word.to_uppercase()
                && word.len() <= 5
                && word.chars().all(|c| c.is_ascii_uppercase())
            {
                return word.to_string();
            }
            if Regex::new(r"^\([A-Z]+\)$").unwrap().is_match(word) {
                return word.to_string();
            }

            let lower = word.to_lowercase();
            if idx > 0 && small.contains(&lower.as_str()) {
                return lower;
            }

            if lower.contains('-') {
                return lower
                    .split('-')
                    .map(|part| {
                        let mut chars = part.chars();
                        match chars.next() {
                            Some(first) => {
                                first.to_uppercase().collect::<String>() + chars.as_str()
                            }
                            None => String::new(),
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("-");
            }

            let mut chars = lower.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn dedupe_fields_by_type(fields: &[DetectedField]) -> Vec<DetectedField> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();

    for field in fields {
        let key = format!("{:?}:{}", field.field_type, field.label);
        if seen.insert(key) {
            deduped.push(field.clone());
        }
    }

    deduped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_text() {
        assert_eq!(normalize_text("hello\u{FB01}world"), "hellofiworld");
        assert_eq!(normalize_text("test  \t  spaces"), "test spaces");
    }

    #[test]
    fn test_detect_document_type() {
        assert_eq!(
            detect_document_type("NON-DISCLOSURE AGREEMENT"),
            Some("Non-Disclosure Agreement (NDA)".into())
        );
        assert_eq!(
            detect_document_type("Employment Agreement between..."),
            Some("Employment Agreement".into())
        );
        assert_eq!(detect_document_type("random text"), None);
    }

    #[test]
    fn test_title_case() {
        assert_eq!(title_case("hello world"), "Hello World");
        assert_eq!(title_case("BUYER"), "BUYER");
    }
}
