//! PDF analysis — extracts text, detects fields, signature blocks, signers,
//! AcroForm fields, document structure, and generates walkthrough guidance.
//! Uses rayon for parallel regex passes on large documents.

pub mod acroform;
pub mod fields;
pub mod patterns;
pub mod signers;
pub mod structure;
pub mod types;
pub mod util;
pub mod wallets;

pub use types::*;

use acroform::extract_acroform_fields;
use fields::detect_fields;
use patterns::*;
use signers::{
    build_signer_list, deduplicate_fields, detect_signature_blocks, estimate_signer_count,
    find_witness_whereof_line,
};
use structure::{extract_sections, generate_walkthrough};
use util::{clean_content, extract_title, normalize_text, strip_headers_footers};
use wallets::find_wallet_addresses;

fn detect_document_type(text: &str) -> Option<String> {
    let sample = if text.len() > 4000 {
        &text[..4000]
    } else {
        text
    };

    // Specific agreement types (checked first for precision)
    if NDA_AGREEMENT_RE.is_match(sample) {
        return Some("Non-Disclosure Agreement (NDA)".into());
    }
    if CONFIDENTIALITY_AGREEMENT_RE.is_match(sample) {
        return Some("Confidentiality Agreement".into());
    }
    if MASTER_SERVICE_AGREEMENT_RE.is_match(sample) {
        return Some("Master Service Agreement".into());
    }
    if SERVICE_LEVEL_AGREEMENT_RE.is_match(sample) {
        return Some("Service Agreement".into());
    }
    if CONSULTING_AGREEMENT_RE.is_match(sample) {
        return Some("Consulting Agreement".into());
    }
    if TOKEN_PURCHASE_AGREEMENT_RE.is_match(sample) {
        return Some("Token Purchase Agreement".into());
    }
    // New: additional contract types
    if DOCTYPE_PARTNERSHIP_RE.is_match(sample) {
        return Some("Partnership Agreement".into());
    }
    if DOCTYPE_LLC_RE.is_match(sample) {
        return Some("LLC Operating Agreement".into());
    }
    if DOCTYPE_SHAREHOLDER_RE.is_match(sample) {
        return Some("Shareholder Agreement".into());
    }
    if DOCTYPE_LICENSING_RE.is_match(sample) {
        return Some("Licensing Agreement".into());
    }
    if DOCTYPE_DISTRIBUTION_RE.is_match(sample) {
        return Some("Distribution Agreement".into());
    }
    if DOCTYPE_FRANCHISE_RE.is_match(sample) {
        return Some("Franchise Agreement".into());
    }
    if DOCTYPE_POWER_OF_ATTORNEY_RE.is_match(sample) {
        return Some("Power of Attorney".into());
    }
    if DOCTYPE_INSURANCE_RE.is_match(sample) {
        return Some("Insurance Policy".into());
    }
    if DOCTYPE_CONSTRUCTION_RE.is_match(sample) {
        return Some("Construction Contract".into());
    }
    if DOCTYPE_SETTLEMENT_RE.is_match(sample) {
        return Some("Settlement Agreement".into());
    }
    if DOCTYPE_NON_COMPETE_RE.is_match(sample) {
        return Some("Non-Compete Agreement".into());
    }
    if DOCTYPE_ASSIGNMENT_RE.is_match(sample) {
        return Some("Assignment Agreement".into());
    }
    if DOCTYPE_SUBSCRIPTION_RE.is_match(sample) {
        return Some("Subscription Agreement".into());
    }
    if DOCTYPE_PLEDGE_RE.is_match(sample) {
        return Some("Pledge / Security Agreement".into());
    }
    if DOCTYPE_GUARANTY_RE.is_match(sample) {
        return Some("Guaranty Agreement".into());
    }
    if DOCTYPE_MEMORANDUM_RE.is_match(sample) {
        return Some("Memorandum of Understanding".into());
    }
    if DOCTYPE_LETTER_OF_INTENT_RE.is_match(sample) {
        return Some("Letter of Intent".into());
    }
    if DOCTYPE_WILL_RE.is_match(sample) {
        return Some("Last Will and Testament".into());
    }
    if DOCTYPE_TRUST_RE.is_match(sample) {
        return Some("Trust Agreement".into());
    }
    // Broader categories (fallback)
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

/// Analyze a PDF buffer: extract text, detect fields, signers, AcroForm fields,
/// document structure, and generate walkthrough guidance.
///
/// This is the main CPU-intensive operation. It uses rayon for parallel regex
/// matching on large documents.
pub fn analyze_pdf(pdf_bytes: &[u8]) -> Result<PdfAnalysisResult, anyhow::Error> {
    // Extract text using pdf-extract (lopdf underneath)
    let text = pdf_extract::extract_text_from_mem(pdf_bytes)
        .map_err(|e| anyhow::anyhow!("PDF text extraction failed: {e}"))?;

    // Load document for page count + AcroForm extraction
    let doc = lopdf::Document::load_mem(pdf_bytes).ok();
    let page_count = doc.as_ref().map(|d| d.get_pages().len()).unwrap_or(1);

    // Extract AcroForm fields
    let acroform_fields = doc
        .as_ref()
        .map(extract_acroform_fields)
        .unwrap_or_default();

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
    let detected_signers =
        build_signer_list(&signature_blocks, &detected_addresses, &detected_fields);

    let suggested_signer_count = detected_signers
        .len()
        .max(signature_blocks.len())
        .max(estimate_signer_count(&normalized, &lines))
        .max(2);

    // Extract document structure
    let sections = extract_sections(&lines);

    // Count filled vs blank fields (text detection + AcroForm)
    let text_blank = detected_fields.iter().filter(|f| f.blank).count();
    let text_filled = detected_fields.iter().filter(|f| !f.blank).count();
    let acro_blank = acroform_fields.iter().filter(|f| !f.filled && !f.read_only).count();
    let acro_filled = acroform_fields.iter().filter(|f| f.filled).count();
    let blank_field_count = text_blank + acro_blank;
    let filled_field_count = text_filled + acro_filled;
    let is_filled = filled_field_count > 0 && blank_field_count == 0;

    // Generate walkthrough
    let total_fields = detected_fields.len() + acroform_fields.len();
    let has_acroform = !acroform_fields.is_empty();
    let walkthrough = generate_walkthrough(
        &sections,
        total_fields,
        suggested_signer_count,
        has_acroform,
        is_filled,
    );

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
        acroform_fields,
        sections,
        is_filled,
        blank_field_count,
        filled_field_count,
        walkthrough,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use util::{normalize_text, title_case};

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
    fn test_detect_new_document_types() {
        assert_eq!(
            detect_document_type("Partnership Agreement between LLC members"),
            Some("Partnership Agreement".into())
        );
        assert_eq!(
            detect_document_type("LICENSE AGREEMENT for software"),
            Some("Licensing Agreement".into())
        );
        assert_eq!(
            detect_document_type("This Power of Attorney grants authority"),
            Some("Power of Attorney".into())
        );
        assert_eq!(
            detect_document_type("MEMORANDUM OF UNDERSTANDING between parties"),
            Some("Memorandum of Understanding".into())
        );
        assert_eq!(
            detect_document_type("LETTER OF INTENT regarding acquisition"),
            Some("Letter of Intent".into())
        );
    }

    #[test]
    fn test_title_case() {
        assert_eq!(title_case("hello world"), "Hello World");
        assert_eq!(title_case("BUYER"), "BUYER");
    }
}
