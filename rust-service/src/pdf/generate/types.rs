//! Struct and enum definitions for PDF generation.

use serde::{Deserialize, Serialize};

// ══════════════════════════════════════════════════════════════════════════════
// Request / Response types
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfGenerateRequest {
    pub title: String,
    pub content: String,
    pub content_hash: String,
    pub document_id: String,
    pub verify_url: String,
    pub created_at: String,
    pub status: String,
    pub encrypted_at_rest: bool,
    pub ipfs_cid: Option<String>,
    pub field_summary_style: Option<String>,
    pub content_lines: Option<Vec<Vec<ContentSegment>>>,
    pub field_summary: Option<Vec<FieldSummaryEntry>>,
    pub signers: Vec<SignerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum ContentSegment {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "field")]
    Field {
        label: String,
        value: String,
        filled: bool,
        field_type: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldSummaryEntry {
    pub label: String,
    pub value: String,
    pub signer: String,
    pub field_type: String,
    pub field_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerInfo {
    pub label: String,
    pub status: String,
    pub chain: Option<String>,
    pub address: Option<String>,
    pub scheme: Option<String>,
    pub signature: Option<String>,
    pub signed_at: Option<String>,
    pub hand_signature_hash: Option<String>,
    pub hand_signature_data: Option<String>,
    pub field_values: Option<serde_json::Value>,
    pub forensic_evidence: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub(super) struct InlineFieldDef {
    pub id: String,
    pub field_type: String,
    pub label: String,
}

#[derive(Debug, Clone)]
pub(super) enum DocToken {
    Heading(String),
    Subheading(String),
    Text(String),
    Field(InlineFieldDef),
    ListItem(String),
    Break,
    SignatureBlock { label: String, signer_idx: usize },
}

#[derive(Debug, Deserialize)]
pub(super) struct FieldMarkerPayload {
    pub id: Option<String>,
    #[serde(rename = "type")]
    pub field_type: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct SignatureMarkerPayload {
    pub label: Option<String>,
    #[serde(rename = "signerIdx")]
    pub signer_idx: Option<i64>,
}

#[derive(Debug, Clone)]
pub(super) struct FieldValueEntry {
    pub value: String,
    pub signer: String,
    pub hand_signature_data: Option<String>,
}

#[derive(Debug, Clone)]
pub(super) struct ParsedSignatureSvg {
    pub width: f32,
    pub height: f32,
    pub paths: Vec<String>,
}

pub(super) enum InlineAtom {
    Space { width_mm: f32 },
    Word {
        text: String,
        size_pt: f32,
        color: (f32, f32, f32),
        mono: bool,
        bold: bool,
        width_mm: f32,
    },
    FieldText {
        text: String,
        size_pt: f32,
        color: (f32, f32, f32),
        bold: bool,
        width_mm: f32,
        underline: bool,
        placeholder: bool,
    },
    Signature {
        data_url: String,
        width_mm: f32,
        height_mm: f32,
        underline: bool,
    },
}
