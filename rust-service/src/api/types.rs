//! Request types for all API endpoints.

use serde::Deserialize;

// ── Crypto ──────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct HashDocReq {
    pub content: String,
}

#[derive(Deserialize)]
pub struct HashHandSigReq {
    pub data_url: String,
}

#[derive(Deserialize)]
pub struct BuildSigningMsgReq {
    pub content_hash: String,
    pub address: String,
    pub signer_label: String,
    pub hand_signature_hash: Option<String>,
}

#[derive(Deserialize)]
pub struct EncryptReq {
    pub content: String,
    pub master_secret: String,
}

#[derive(Deserialize)]
pub struct DecryptReq {
    pub encrypted_content: String,
    pub wrapped_key: String,
    pub master_secret: String,
}

// ── Verify ──────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct VerifySigReq {
    pub chain: String,
    pub address: String,
    pub message: String,
    pub signature: String,
}

// ── Audit ───────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ComputeAuditHashReq {
    pub prev_hash: Option<String>,
    pub event_type: String,
    pub actor: String,
    pub timestamp: String,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Deserialize)]
pub struct VerifyAuditChainReq {
    pub events: Vec<crate::audit::AuditEvent>,
}

#[derive(Deserialize)]
pub struct ComputeChainBatchReq {
    pub events: Vec<(String, String, String, Option<serde_json::Value>)>,
}

// ── QR ──────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct QrReq {
    pub text: String,
    pub size: Option<u32>,
}

// ── Forensic ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ValidateReplayReq {
    pub tape_base64: String,
    pub claimed_metrics: serde_json::Value,
    pub claimed_behavioral: serde_json::Value,
}

#[derive(Deserialize)]
pub struct HeaderFingerprintReq {
    pub header_names: Vec<String>,
}

// ── Index ───────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RemoveDocReq {
    pub doc_id: String,
}

#[derive(Deserialize)]
pub struct AutocompleteReq {
    pub prefix: String,
    pub max_suggestions: Option<usize>,
}

#[derive(Deserialize)]
pub struct ScanDocReq {
    pub doc_id: String,
    pub content: String,
    pub encrypted: Option<bool>,
}

#[derive(Deserialize)]
pub struct PrivacyScanReq {
    pub text: String,
}

#[derive(Deserialize)]
pub struct EnqueueJobReq {
    pub doc_id: String,
    pub owner_id: String,
    pub job_type: String,
}

#[derive(Deserialize)]
pub struct BulkImportReq {
    pub owner_id: String,
    pub doc_ids: Vec<String>,
}

#[derive(Deserialize)]
pub struct OwnerReq {
    pub owner_id: String,
}

#[derive(Deserialize)]
pub struct AiIndexReq {
    pub doc_id: String,
    pub content: String,
}

// ── Collab ──────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CollabMergeReq {
    pub states: Vec<String>,
}

#[derive(Deserialize)]
pub struct CollabCompactReq {
    pub state: String,
}

#[derive(Deserialize)]
pub struct CollabDiffReq {
    pub base_state: String,
    pub current_state: String,
}

#[derive(Deserialize)]
pub struct CollabBatchMergeReq {
    pub states: Vec<String>,
    pub chunk_size: Option<usize>,
}

// ── Post-Quantum ────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct PqEncryptReq {
    pub plaintext: String,
    pub recipient_public_key: String,
}

#[derive(Deserialize)]
pub struct PqDecryptReq {
    pub ciphertext: crate::pqcrypto::HybridCiphertext,
    pub recipient_private_key: String,
}

// ── Zero-Knowledge ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ZkDocProofReq {
    pub document_content: String,
}

#[derive(Deserialize)]
pub struct ZkSigProofReq {
    pub document_hash: String,
    pub signer_address: String,
    pub scheme: String,
    pub signature: String,
}

#[derive(Deserialize)]
pub struct ZkFieldProofReq {
    pub document_hash: String,
    pub field_id: String,
    pub field_value: String,
    pub reveal: Option<bool>,
}
