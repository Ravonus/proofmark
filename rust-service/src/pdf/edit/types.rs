//! Types for PDF editing operations.

use serde::{Deserialize, Serialize};

/// Request to fill form fields in a PDF.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FillFieldsRequest {
    /// Base64-encoded PDF bytes.
    pub pdf_base64: String,
    /// Field name -> value mapping.
    pub field_values: Vec<FieldValuePair>,
    /// Whether to flatten fields after filling (making them non-editable).
    #[serde(default)]
    pub flatten_after: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldValuePair {
    pub name: String,
    pub value: String,
}

/// Request to create a blank template from a filled PDF.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTemplateRequest {
    /// Base64-encoded PDF bytes.
    pub pdf_base64: String,
    /// Specific field names to clear (if empty, clears all fields).
    #[serde(default)]
    pub fields_to_clear: Vec<String>,
}

/// Request to flatten a PDF (make all form fields non-editable).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlattenRequest {
    /// Base64-encoded PDF bytes.
    pub pdf_base64: String,
}

/// Response for PDF edit operations.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfEditResult {
    /// Base64-encoded result PDF.
    pub pdf_base64: String,
    /// Number of fields modified.
    pub fields_modified: usize,
    /// Summary of what was done.
    pub summary: String,
}
