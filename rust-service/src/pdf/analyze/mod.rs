//! PDF analysis — extracts text, detects fields, signature blocks, and signers.
//! Uses rayon for parallel regex passes over large documents.

pub mod fields;
pub mod patterns;
pub mod signers;
pub mod types;
pub mod util;
pub mod wallets;

pub use types::*;

use patterns::*;

use fields::detect_fields;
use signers::{
    build_signer_list, deduplicate_fields, detect_signature_blocks, estimate_signer_count,
    find_witness_whereof_line,
};
use util::{clean_content, extract_title, normalize_text, strip_headers_footers};
use wallets::find_wallet_addresses;

fn detect_document_type(text: &str) -> Option<String> {
    let sample = if text.len() > 2000 {
        &text[..2000]
    } else {
        text
    };

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
    let detected_signers =
        build_signer_list(&signature_blocks, &detected_addresses, &detected_fields);

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
    fn test_title_case() {
        assert_eq!(title_case("hello world"), "Hello World");
        assert_eq!(title_case("BUYER"), "BUYER");
    }
}
