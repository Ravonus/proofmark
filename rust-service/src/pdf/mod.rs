//! PDF processing: text extraction, analysis, field detection, and generation.
//!
//! This module handles the heaviest compute in Proofmark — PDF parsing with
//! complex regex matching, field detection, and multi-page PDF generation.

pub mod analyze;
pub mod generate;

pub use analyze::analyze_pdf;
pub use generate::{generate_signed_pdf, PdfGenerateRequest};
