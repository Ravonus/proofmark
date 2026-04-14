//! PDF processing: text extraction, analysis, field detection, editing, and generation.
//!
//! This module handles the heaviest compute in Proofmark — PDF parsing with
//! complex regex matching, field detection, form editing, and multi-page PDF generation.

pub mod analyze;
pub mod edit;
pub mod generate;

pub use analyze::analyze_pdf;
pub use edit::{
    create_blank_template, fill_pdf_fields, flatten_pdf,
    CreateTemplateRequest, FillFieldsRequest, FlattenRequest,
};
pub use generate::{generate_signed_pdf, PdfGenerateRequest};
