//! Structural analysis — detects sections, clauses, recitals, definitions,
//! parties, and terms from document text. Produces a document outline that
//! powers the smart walkthrough UI.

use once_cell::sync::Lazy;
use regex::Regex;

use super::types::{DocumentSection, SectionKind};

static RECITAL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:RECITALS?|WHEREAS|WITNESSETH|PREAMBLE)\s*:?").unwrap()
});
static DEFINITIONS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:DEFINITIONS?|DEFINED\s+TERMS|INTERPRETATION)\s*[.:]?$").unwrap()
});
static PARTIES_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:PARTIES|THE\s+PARTIES|BETWEEN|AMONG)\s*:?$").unwrap()
});
static TERM_DURATION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:\d+\.?\s*)?(?:TERM\s+(?:AND\s+)?(?:TERMINATION|DURATION|RENEWAL)|TERM|DURATION|EFFECTIVE\s+DATE\s+AND\s+TERM|COMMENCEMENT\s+AND\s+TERM)\s*\.?$").unwrap()
});
static CONFIDENTIALITY_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:\d+\.?\s*)?(?:CONFIDENTIAL(?:ITY)?|NON-?DISCLOSURE|PROPRIETARY\s+INFORMATION)\s*\.?$").unwrap()
});
static INDEMNIFICATION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:\d+\.?\s*)?(?:INDEMNIFI?CATION|HOLD\s+HARMLESS|LIABILITY)\s*\.?$").unwrap()
});
static GOVERNING_LAW_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:\d+\.?\s*)?(?:GOVERNING\s+LAW|JURISDICTION|APPLICABLE\s+LAW|CHOICE\s+OF\s+LAW|DISPUTE\s+RESOLUTION)\s*\.?$").unwrap()
});
static PAYMENT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:\d+\.?\s*)?(?:PAYMENT|COMPENSATION|FEES?\s+AND\s+PAYMENT|CONSIDERATION|PURCHASE\s+PRICE|RENT)\s*\.?$").unwrap()
});
static REPRESENTATIONS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:\d+\.?\s*)?(?:REPRESENTATIONS?\s+(?:AND\s+)?WARRANTIES?|WARRANTIES?)\s*\.?$").unwrap()
});
static TERMINATION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:\d+\.?\s*)?(?:TERMINATION|CANCELLATION|EXPIRATION)\s*\.?$").unwrap()
});
static MISC_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:\d+\.?\s*)?(?:MISCELLANEOUS|GENERAL\s+PROVISIONS?|ADDITIONAL\s+TERMS|BOILERPLATE)\s*\.?$").unwrap()
});
static OBLIGATIONS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:\d+\.?\s*)?(?:OBLIGATIONS?\s+OF|DUTIES|RESPONSIBILITIES|SCOPE\s+OF\s+(?:WORK|SERVICES)|DELIVERABLES)\s*\.?").unwrap()
});
static IP_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:\d+\.?\s*)?(?:INTELLECTUAL\s+PROPERTY|IP\s+RIGHTS|OWNERSHIP|COPYRIGHT|LICENSE\s+GRANT)\s*\.?$").unwrap()
});

// Generic numbered section heading
static NUMBERED_SECTION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(\d+)\.\s+(.+)").unwrap()
});
static ARTICLE_SECTION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^(?:ARTICLE|SECTION|CLAUSE|PART|SCHEDULE|EXHIBIT|APPENDIX)\s+(\d+|[IVXLC]+)[.:\s]*(.*)").unwrap()
});
static ALL_CAPS_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^[A-Z][A-Z &/,().-]{2,}$").unwrap()
});

/// Parse document lines into a structured section outline.
pub fn extract_sections(lines: &[String]) -> Vec<DocumentSection> {
    let mut sections = Vec::new();
    let mut current_section: Option<DocumentSection> = None;

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if let Some(ref mut sec) = current_section {
                sec.content_lines.push(String::new());
            }
            continue;
        }

        let detected_kind = classify_section(trimmed);

        if let Some(kind) = detected_kind {
            // Flush previous section
            if let Some(sec) = current_section.take() {
                sections.push(sec);
            }

            let title = extract_section_title(trimmed);
            current_section = Some(DocumentSection {
                kind,
                title,
                line_start: idx + 1,
                line_end: idx + 1,
                content_lines: Vec::new(),
                subsections: Vec::new(),
            });
        } else if let Some(ref mut sec) = current_section {
            sec.line_end = idx + 1;
            sec.content_lines.push(trimmed.to_string());
        } else {
            // Before any section detected — could be preamble
            current_section = Some(DocumentSection {
                kind: SectionKind::Preamble,
                title: "Preamble".into(),
                line_start: idx + 1,
                line_end: idx + 1,
                content_lines: vec![trimmed.to_string()],
                subsections: Vec::new(),
            });
        }
    }

    if let Some(sec) = current_section {
        sections.push(sec);
    }

    // Merge consecutive preamble sections
    merge_preamble(&mut sections);

    sections
}

fn classify_section(line: &str) -> Option<SectionKind> {
    if RECITAL_RE.is_match(line) {
        return Some(SectionKind::Recitals);
    }
    if DEFINITIONS_RE.is_match(line) {
        return Some(SectionKind::Definitions);
    }
    if PARTIES_RE.is_match(line) {
        return Some(SectionKind::Parties);
    }
    if TERM_DURATION_RE.is_match(line) {
        return Some(SectionKind::Term);
    }
    if CONFIDENTIALITY_RE.is_match(line) {
        return Some(SectionKind::Confidentiality);
    }
    if INDEMNIFICATION_RE.is_match(line) {
        return Some(SectionKind::Indemnification);
    }
    if GOVERNING_LAW_RE.is_match(line) {
        return Some(SectionKind::GoverningLaw);
    }
    if PAYMENT_RE.is_match(line) {
        return Some(SectionKind::Payment);
    }
    if REPRESENTATIONS_RE.is_match(line) {
        return Some(SectionKind::Representations);
    }
    if TERMINATION_RE.is_match(line) {
        return Some(SectionKind::Termination);
    }
    if MISC_RE.is_match(line) {
        return Some(SectionKind::Miscellaneous);
    }
    if OBLIGATIONS_RE.is_match(line) {
        return Some(SectionKind::Obligations);
    }
    if IP_RE.is_match(line) {
        return Some(SectionKind::IntellectualProperty);
    }

    // For numbered headings like "1. Definitions", extract the title part
    // and re-check against specific section patterns
    if let Some(caps) = NUMBERED_SECTION_RE.captures(line) {
        if let Some(title) = caps.get(2) {
            let t = title.as_str().trim().trim_end_matches('.');
            if let Some(kind) = classify_section_title(t) {
                return Some(kind);
            }
        }
        if line.len() < 100 {
            return Some(SectionKind::Clause);
        }
    }

    // ARTICLE/SECTION heading with title
    if let Some(caps) = ARTICLE_SECTION_RE.captures(line) {
        if let Some(title) = caps.get(2) {
            let t = title.as_str().trim().trim_end_matches('.');
            if let Some(kind) = classify_section_title(t) {
                return Some(kind);
            }
        }
        return Some(SectionKind::Clause);
    }

    // All-caps heading (short)
    if ALL_CAPS_RE.is_match(line) && line.len() > 3 && line.len() < 60 {
        if let Some(kind) = classify_section_title(line) {
            return Some(kind);
        }
        return Some(SectionKind::Clause);
    }

    None
}

/// Classify a bare section title (without numbering prefix).
fn classify_section_title(title: &str) -> Option<SectionKind> {
    if DEFINITIONS_RE.is_match(title) {
        return Some(SectionKind::Definitions);
    }
    if PARTIES_RE.is_match(title) {
        return Some(SectionKind::Parties);
    }
    if TERM_DURATION_RE.is_match(title) {
        return Some(SectionKind::Term);
    }
    if CONFIDENTIALITY_RE.is_match(title) {
        return Some(SectionKind::Confidentiality);
    }
    if INDEMNIFICATION_RE.is_match(title) {
        return Some(SectionKind::Indemnification);
    }
    if GOVERNING_LAW_RE.is_match(title) {
        return Some(SectionKind::GoverningLaw);
    }
    if PAYMENT_RE.is_match(title) {
        return Some(SectionKind::Payment);
    }
    if REPRESENTATIONS_RE.is_match(title) {
        return Some(SectionKind::Representations);
    }
    if TERMINATION_RE.is_match(title) {
        return Some(SectionKind::Termination);
    }
    if MISC_RE.is_match(title) {
        return Some(SectionKind::Miscellaneous);
    }
    if OBLIGATIONS_RE.is_match(title) {
        return Some(SectionKind::Obligations);
    }
    if IP_RE.is_match(title) {
        return Some(SectionKind::IntellectualProperty);
    }
    None
}

fn extract_section_title(line: &str) -> String {
    if let Some(caps) = NUMBERED_SECTION_RE.captures(line) {
        if let Some(title) = caps.get(2) {
            return title.as_str().trim_end_matches('.').to_string();
        }
    }
    if let Some(caps) = ARTICLE_SECTION_RE.captures(line) {
        if let Some(title) = caps.get(2) {
            let t = title.as_str().trim();
            if !t.is_empty() {
                return t.trim_end_matches('.').to_string();
            }
        }
    }
    line.trim_end_matches(['.', ':']).to_string()
}

fn merge_preamble(sections: &mut Vec<DocumentSection>) {
    if sections.len() < 2 {
        return;
    }

    let mut i = 1;
    while i < sections.len() {
        if matches!(sections[i].kind, SectionKind::Preamble)
            && matches!(sections[i - 1].kind, SectionKind::Preamble)
        {
            let merged = sections.remove(i);
            sections[i - 1].line_end = merged.line_end;
            sections[i - 1].content_lines.extend(merged.content_lines);
        } else {
            i += 1;
        }
    }
}

/// Generate walkthrough guidance based on detected sections and fields.
pub fn generate_walkthrough(
    sections: &[DocumentSection],
    field_count: usize,
    signer_count: usize,
    has_acroform: bool,
    is_filled: bool,
) -> Vec<WalkthroughStep> {
    let mut steps = Vec::new();

    // Step 1: Document overview
    steps.push(WalkthroughStep {
        step: 1,
        title: "Review Document Structure".into(),
        description: format!(
            "This document has {} section{}. Review the outline to understand the agreement.",
            sections.len(),
            if sections.len() == 1 { "" } else { "s" }
        ),
        action: "review".into(),
        target: None,
        required: false,
    });

    // Step 2: Parties
    if sections.iter().any(|s| matches!(s.kind, SectionKind::Parties)) {
        steps.push(WalkthroughStep {
            step: steps.len() + 1,
            title: "Identify Parties".into(),
            description: "Review the parties involved and confirm their details.".into(),
            action: "review".into(),
            target: Some("parties".into()),
            required: true,
        });
    }

    // Step 3: Key terms
    let key_sections: Vec<&str> = sections
        .iter()
        .filter(|s| matches!(
            s.kind,
            SectionKind::Term | SectionKind::Payment | SectionKind::Obligations
        ))
        .map(|s| s.title.as_str())
        .collect();
    if !key_sections.is_empty() {
        steps.push(WalkthroughStep {
            step: steps.len() + 1,
            title: "Review Key Terms".into(),
            description: format!(
                "Pay attention to: {}",
                key_sections.join(", ")
            ),
            action: "review".into(),
            target: Some("terms".into()),
            required: true,
        });
    }

    // Step 4: Fill fields
    if field_count > 0 {
        let verb = if is_filled { "Review" } else { "Complete" };
        steps.push(WalkthroughStep {
            step: steps.len() + 1,
            title: format!("{verb} Form Fields"),
            description: format!(
                "{} {} field{} {} in this document.{}",
                if is_filled { "There are" } else { "Fill in the" },
                field_count,
                if field_count == 1 { "" } else { "s" },
                if is_filled { "already filled" } else { "requiring input" },
                if has_acroform { " Interactive form fields were detected." } else { "" }
            ),
            action: if is_filled { "review".into() } else { "fill".into() },
            target: Some("fields".into()),
            required: !is_filled,
        });
    }

    // Step 5: Signers
    if signer_count > 0 {
        steps.push(WalkthroughStep {
            step: steps.len() + 1,
            title: "Configure Signers".into(),
            description: format!(
                "Set up {} signer{} for this document.",
                signer_count,
                if signer_count == 1 { "" } else { "s" }
            ),
            action: "configure".into(),
            target: Some("signers".into()),
            required: true,
        });
    }

    // Step 6: Legal review sections
    let review_sections: Vec<&str> = sections
        .iter()
        .filter(|s| matches!(
            s.kind,
            SectionKind::Confidentiality
                | SectionKind::Indemnification
                | SectionKind::GoverningLaw
                | SectionKind::Representations
        ))
        .map(|s| s.title.as_str())
        .collect();
    if !review_sections.is_empty() {
        steps.push(WalkthroughStep {
            step: steps.len() + 1,
            title: "Review Legal Provisions".into(),
            description: format!(
                "Carefully review these sections: {}",
                review_sections.join(", ")
            ),
            action: "review".into(),
            target: Some("legal".into()),
            required: true,
        });
    }

    // Final step: Sign
    steps.push(WalkthroughStep {
        step: steps.len() + 1,
        title: "Sign Document".into(),
        description: "Once all fields are complete and reviewed, proceed to sign.".into(),
        action: "sign".into(),
        target: Some("signature".into()),
        required: true,
    });

    steps
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalkthroughStep {
    pub step: usize,
    pub title: String,
    pub description: String,
    pub action: String,  // "review" | "fill" | "configure" | "sign"
    pub target: Option<String>,
    pub required: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_recitals() {
        assert!(matches!(classify_section("RECITALS"), Some(SectionKind::Recitals)));
        assert!(matches!(classify_section("WHEREAS"), Some(SectionKind::Recitals)));
    }

    #[test]
    fn test_classify_numbered() {
        assert!(matches!(classify_section("1. Definitions"), Some(SectionKind::Definitions)));
        assert!(matches!(classify_section("3. PAYMENT"), Some(SectionKind::Payment)));
    }

    #[test]
    fn test_classify_article() {
        assert!(matches!(classify_section("ARTICLE I: Term"), Some(SectionKind::Term)));
        assert!(matches!(classify_section("ARTICLE II: Term and Termination"), Some(SectionKind::Term)));
        assert!(matches!(classify_section("Section 2. Scope of Work"), Some(SectionKind::Obligations)));
        assert!(matches!(classify_section("ARTICLE III: Miscellaneous"), Some(SectionKind::Miscellaneous)));
        assert!(matches!(classify_section("Section 5. General Stuff"), Some(SectionKind::Clause)));
    }

    #[test]
    fn test_extract_title() {
        assert_eq!(extract_section_title("1. Definitions"), "Definitions");
        assert_eq!(extract_section_title("ARTICLE III: Payment."), "Payment");
    }

    #[test]
    fn test_extract_sections_basic() {
        let lines: Vec<String> = vec![
            "AGREEMENT".into(),
            "This agreement is made between...".into(),
            "".into(),
            "1. Definitions".into(),
            "Term means the period...".into(),
            "".into(),
            "2. Payment".into(),
            "The buyer shall pay...".into(),
        ];
        let sections = extract_sections(&lines);
        assert!(sections.len() >= 2);
    }

    #[test]
    fn test_walkthrough_generation() {
        let sections = vec![
            DocumentSection {
                kind: SectionKind::Preamble,
                title: "Preamble".into(),
                line_start: 1,
                line_end: 3,
                content_lines: vec!["Agreement text".into()],
                subsections: Vec::new(),
            },
            DocumentSection {
                kind: SectionKind::Payment,
                title: "Payment".into(),
                line_start: 4,
                line_end: 6,
                content_lines: vec!["Payment terms".into()],
                subsections: Vec::new(),
            },
        ];
        let steps = generate_walkthrough(&sections, 5, 2, false, false);
        assert!(steps.len() >= 3);
        assert!(steps.iter().any(|s| s.title.contains("Form Fields")));
        assert!(steps.last().unwrap().title.contains("Sign"));
    }
}
