//! Privacy detection engine for identifying PII and sensitive data in text.
//!
//! Detects: emails, phone numbers, SSNs, credit cards, crypto addresses,
//! IP addresses, dates of birth, passport numbers, bank account numbers,
//! and other sensitive patterns. Uses regex + heuristics.

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::util::patterns::{ETH_ADDR_RE, BTC_ADDR_RE, SOL_ADDR_RE};

/// Classification of detected private data.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum PiiType {
    Email,
    Phone,
    Ssn,
    CreditCard,
    CryptoAddress,
    IpAddress,
    DateOfBirth,
    PassportNumber,
    BankAccount,
    DriverLicense,
    TaxId,
    PersonName,
    PhysicalAddress,
    Custom(String),
}

/// A detected PII span in the text.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiiDetection {
    pub pii_type: PiiType,
    pub start: usize,
    pub end: usize,
    pub confidence: f64,
    pub redacted_preview: String,
}

/// Result of scanning text for privacy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyScanResult {
    pub detections: Vec<PiiDetection>,
    pub risk_score: f64,
    pub safe_tokens: Vec<String>,
    pub redacted_text: String,
}




static RE_EMAIL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}").unwrap()
});

static RE_PHONE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}").unwrap()
});

static RE_SSN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b").unwrap()
});

static RE_CREDIT_CARD: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(?:\d{4}[-\s]?){3}\d{4}\b").unwrap()
});

static RE_IPV4: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap()
});

static RE_DOB: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(?:0[1-9]|1[0-2])[/\-](?:0[1-9]|[12]\d|3[01])[/\-](?:19|20)\d{2}\b").unwrap()
});

static RE_PASSPORT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b[A-Z]{1,2}\d{6,9}\b").unwrap()
});

static RE_TAX_ID: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b\d{2}[-]?\d{7}\b").unwrap()
});

/// Context keywords that increase confidence of a nearby pattern being PII.
static CONTEXT_KEYWORDS: Lazy<Vec<(&'static str, PiiType)>> = Lazy::new(|| {
    vec![
        ("social security", PiiType::Ssn),
        ("ssn", PiiType::Ssn),
        ("date of birth", PiiType::DateOfBirth),
        ("dob", PiiType::DateOfBirth),
        ("born on", PiiType::DateOfBirth),
        ("credit card", PiiType::CreditCard),
        ("card number", PiiType::CreditCard),
        ("passport", PiiType::PassportNumber),
        ("driver license", PiiType::DriverLicense),
        ("driver's license", PiiType::DriverLicense),
        ("bank account", PiiType::BankAccount),
        ("routing number", PiiType::BankAccount),
        ("account number", PiiType::BankAccount),
        ("tax id", PiiType::TaxId),
        ("ein", PiiType::TaxId),
        ("tin", PiiType::TaxId),
        ("wallet address", PiiType::CryptoAddress),
        ("ethereum address", PiiType::CryptoAddress),
        ("bitcoin address", PiiType::CryptoAddress),
        ("ip address", PiiType::IpAddress),
        ("home address", PiiType::PhysicalAddress),
        ("mailing address", PiiType::PhysicalAddress),
        ("residential address", PiiType::PhysicalAddress),
    ]
});

/// Scan text for PII and return detections + safe tokens.
pub fn scan_privacy(text: &str) -> PrivacyScanResult {
    let mut detections = Vec::new();
    let lower = text.to_lowercase();

    // Regex-based detection
    detect_regex(&RE_EMAIL, text, PiiType::Email, 0.95, &mut detections);
    detect_regex(&RE_PHONE, text, PiiType::Phone, 0.80, &mut detections);
    detect_regex(&RE_SSN, text, PiiType::Ssn, 0.70, &mut detections);
    detect_regex(&RE_CREDIT_CARD, text, PiiType::CreditCard, 0.85, &mut detections);
    detect_regex(&ETH_ADDR_RE, text, PiiType::CryptoAddress, 0.95, &mut detections);
    detect_regex(&BTC_ADDR_RE, text, PiiType::CryptoAddress, 0.90, &mut detections);
    detect_regex(&RE_IPV4, text, PiiType::IpAddress, 0.75, &mut detections);
    detect_regex(&RE_DOB, text, PiiType::DateOfBirth, 0.70, &mut detections);
    detect_regex(&RE_PASSPORT, text, PiiType::PassportNumber, 0.50, &mut detections);
    detect_regex(&RE_TAX_ID, text, PiiType::TaxId, 0.50, &mut detections);

    // Context-aware confidence boosting
    for det in &mut detections {
        boost_confidence_from_context(&lower, det);
    }

    // Remove low-confidence false positives
    detections.retain(|d| d.confidence >= 0.5);

    // Sort by position
    detections.sort_by_key(|d| d.start);

    // Merge overlapping detections (keep highest confidence)
    let detections = merge_overlapping(detections);

    // Compute risk score (0.0 = safe, 1.0 = very sensitive)
    let risk_score = compute_risk_score(&detections);

    // Extract safe tokens (words not in any detection span)
    let safe_tokens = extract_safe_tokens(text, &detections);

    // Build redacted text
    let redacted_text = redact_text(text, &detections);

    PrivacyScanResult {
        detections,
        risk_score,
        safe_tokens,
        redacted_text,
    }
}

/// Check if a specific piece of text contains PII (quick check, no details).
pub fn contains_pii(text: &str) -> bool {
    RE_EMAIL.is_match(text)
        || RE_SSN.is_match(text)
        || RE_CREDIT_CARD.is_match(text)
        || ETH_ADDR_RE.is_match(text)
        || BTC_ADDR_RE.is_match(text)
        || SOL_ADDR_RE.is_match(text)
}

/// Redact detected PII from text, replacing with type labels.
pub fn redact_text(text: &str, detections: &[PiiDetection]) -> String {
    if detections.is_empty() {
        return text.to_string();
    }

    let mut result = String::with_capacity(text.len());
    let mut last_end = 0;

    for det in detections {
        if det.start > last_end {
            result.push_str(&text[last_end..det.start]);
        }
        result.push_str(&format!("[{:?}]", det.pii_type));
        last_end = det.end;
    }

    if last_end < text.len() {
        result.push_str(&text[last_end..]);
    }

    result
}

/// Extract tokens that don't overlap with any PII detection.
pub fn extract_safe_tokens(text: &str, detections: &[PiiDetection]) -> Vec<String> {
    let words: Vec<(usize, usize, &str)> = text
        .split_whitespace()
        .scan(0usize, |pos, word| {
            let start = text[*pos..].find(word).map(|i| *pos + i).unwrap_or(*pos);
            let end = start + word.len();
            *pos = end;
            Some((start, end, word))
        })
        .collect();

    let mut safe = Vec::new();
    for (start, end, word) in words {
        let overlaps = detections.iter().any(|d| start < d.end && end > d.start);
        if !overlaps {
            // Clean the word
            let cleaned: String = word.chars().filter(|c| c.is_alphanumeric()).collect();
            if cleaned.len() >= 2 {
                safe.push(cleaned.to_lowercase());
            }
        }
    }
    safe
}

fn detect_regex(
    re: &Regex,
    text: &str,
    pii_type: PiiType,
    base_confidence: f64,
    detections: &mut Vec<PiiDetection>,
) {
    for m in re.find_iter(text) {
        let matched = m.as_str();
        let redacted = redact_preview(matched, &pii_type);
        detections.push(PiiDetection {
            pii_type: pii_type.clone(),
            start: m.start(),
            end: m.end(),
            confidence: base_confidence,
            redacted_preview: redacted,
        });
    }
}

fn boost_confidence_from_context(lower_text: &str, detection: &mut PiiDetection) {
    // Look in a window around the detection for context keywords
    let window_start = detection.start.saturating_sub(100);
    let window_end = (detection.end + 100).min(lower_text.len());
    let window = &lower_text[window_start..window_end];

    for (keyword, pii_type) in CONTEXT_KEYWORDS.iter() {
        if window.contains(keyword) && *pii_type == detection.pii_type {
            detection.confidence = (detection.confidence + 0.2).min(1.0);
            break;
        }
    }
}

fn merge_overlapping(mut detections: Vec<PiiDetection>) -> Vec<PiiDetection> {
    if detections.len() <= 1 {
        return detections;
    }

    detections.sort_by_key(|d| d.start);
    let mut merged = vec![detections[0].clone()];

    for det in &detections[1..] {
        let last = merged.last_mut().unwrap();
        if det.start < last.end {
            // Overlapping — keep the one with higher confidence
            if det.confidence > last.confidence {
                *last = det.clone();
            } else {
                last.end = last.end.max(det.end);
            }
        } else {
            merged.push(det.clone());
        }
    }

    merged
}

fn compute_risk_score(detections: &[PiiDetection]) -> f64 {
    if detections.is_empty() {
        return 0.0;
    }

    let weights: f64 = detections
        .iter()
        .map(|d| {
            let type_weight = match d.pii_type {
                PiiType::Ssn => 1.0,
                PiiType::CreditCard => 1.0,
                PiiType::PassportNumber => 0.9,
                PiiType::BankAccount => 0.9,
                PiiType::TaxId => 0.85,
                PiiType::DriverLicense => 0.8,
                PiiType::DateOfBirth => 0.6,
                PiiType::Email => 0.5,
                PiiType::Phone => 0.5,
                PiiType::CryptoAddress => 0.4,
                PiiType::IpAddress => 0.3,
                PiiType::PersonName => 0.4,
                PiiType::PhysicalAddress => 0.6,
                PiiType::Custom(_) => 0.5,
            };
            type_weight * d.confidence
        })
        .sum();

    // Normalize: more detections → higher risk, capped at 1.0
    (weights / detections.len() as f64).min(1.0)
}

fn redact_preview(matched: &str, pii_type: &PiiType) -> String {
    match pii_type {
        PiiType::Email => {
            match matched.find('@') {
                Some(at) if at > 2 => format!("{}***{}", &matched[..1], &matched[at..]),
                Some(at) => format!("***{}", &matched[at..]),
                None => "***@***".to_string(),
            }
        }
        PiiType::Phone | PiiType::CreditCard | PiiType::Ssn => {
            redact_last_n_digits(matched, 4)
        }
        PiiType::CryptoAddress if matched.len() > 10 => {
            format!("{}...{}", &matched[..6], &matched[matched.len() - 4..])
        }
        _ => "***".to_string(),
    }
}

/// Show only the last `n` digits, mask the rest.
fn redact_last_n_digits(s: &str, n: usize) -> String {
    let digits: String = s.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() >= n {
        format!("***{}", &digits[digits.len() - n..])
    } else {
        "***".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_email_detection() {
        let result = scan_privacy("Contact john@example.com for details");
        assert!(result.detections.iter().any(|d| d.pii_type == PiiType::Email));
        assert!(result.risk_score > 0.0);
    }

    #[test]
    fn test_ssn_with_context() {
        let result = scan_privacy("Social Security Number: 123-45-6789");
        let ssn = result.detections.iter().find(|d| d.pii_type == PiiType::Ssn);
        assert!(ssn.is_some());
        assert!(ssn.unwrap().confidence > 0.8);
    }

    #[test]
    fn test_crypto_address() {
        let result = scan_privacy("Send to 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD38");
        assert!(result.detections.iter().any(|d| d.pii_type == PiiType::CryptoAddress));
    }

    #[test]
    fn test_safe_tokens() {
        let result = scan_privacy("This agreement between john@example.com and the company");
        assert!(result.safe_tokens.contains(&"agreement".to_string()));
        assert!(result.safe_tokens.contains(&"company".to_string()));
        assert!(!result.safe_tokens.iter().any(|t| t.contains("john")));
    }

    #[test]
    fn test_no_pii() {
        let result = scan_privacy("This is a standard non-disclosure agreement");
        assert!(result.detections.is_empty());
        assert_eq!(result.risk_score, 0.0);
    }
}
