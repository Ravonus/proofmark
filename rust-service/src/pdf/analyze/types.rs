//! Type definitions for PDF analysis results.
//!
//! Mirrors pdf-types.ts with identical structure.

use serde::{Deserialize, Serialize};

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
