//! HTTP API endpoints for the Proofmark Rust engine.
//!
//! All endpoints accept JSON POST requests and return JSON responses.
//! Heavy operations are offloaded to rayon's thread pool for true parallelism.

use std::sync::Arc;

use actix_web::{web, HttpResponse, Responder};
use serde::Deserialize;

use crate::audit;
use crate::collab;
use crate::crypto;
use crate::forensic;
use crate::index;
use crate::pqcrypto;
use crate::pdf;
use crate::qr;
use crate::verify;

// ══════════════════════════════════════════════════════════════════════════════
// Route configuration
// ══════════════════════════════════════════════════════════════════════════════

pub fn configure(cfg: &mut web::ServiceConfig, pdf_analyze_payload_limit_bytes: usize) {
    cfg.service(
        web::scope("/api/v1")
            .route("/health", web::get().to(health))
            // Crypto
            .route("/crypto/hash", web::post().to(hash_document))
            .route("/crypto/hash-hand-signature", web::post().to(hash_hand_signature))
            .route("/crypto/build-signing-message", web::post().to(build_signing_message))
            .route("/crypto/encrypt", web::post().to(encrypt_document))
            .route("/crypto/decrypt", web::post().to(decrypt_document))
            // Signature verification
            .route("/verify/signature", web::post().to(verify_signature))
            // PDF
            .service(
                web::resource("/pdf/analyze")
                    .app_data(web::PayloadConfig::new(pdf_analyze_payload_limit_bytes))
                    .route(web::post().to(analyze_pdf)),
            )
            .route("/pdf/generate", web::post().to(generate_pdf))
            // Audit
            .route("/audit/compute-hash", web::post().to(compute_audit_hash))
            .route("/audit/verify-chain", web::post().to(verify_audit_chain))
            .route("/audit/compute-chain", web::post().to(compute_audit_chain_batch))
            // QR
            .route("/qr/svg", web::post().to(generate_qr_svg))
            .route("/qr/data-url", web::post().to(generate_qr_data_url))
            // Forensic
            .route("/forensic/hash", web::post().to(hash_forensic))
            .route("/forensic/analyze-flags", web::post().to(analyze_forensic_flags))
            .route("/forensic/header-fingerprint", web::post().to(header_fingerprint))
            .route("/forensic/validate-replay", web::post().to(validate_replay))
            // Index
            .route("/index/document", web::post().to(index_document))
            .route("/index/remove", web::post().to(remove_document))
            .route("/index/search", web::post().to(search_index))
            .route("/index/autocomplete", web::post().to(autocomplete))
            .route("/index/scan", web::post().to(scan_document))
            .route("/index/privacy-scan", web::post().to(privacy_scan))
            .route("/index/stats", web::get().to(index_stats))
            .route("/index/queue/enqueue", web::post().to(enqueue_index_job))
            .route("/index/queue/bulk-import", web::post().to(bulk_encrypted_import))
            .route("/index/queue/stats", web::get().to(queue_stats))
            .route("/index/queue/owner", web::post().to(owner_queue_jobs))
            .route("/index/queue/cancel", web::post().to(cancel_owner_queue))
            .route("/index/ai/index", web::post().to(ai_index_document))
            .route("/index/ai/config", web::post().to(set_ai_config))
            .route("/index/encrypted/config", web::post().to(set_encrypted_config))
            .route("/index/compact", web::post().to(compact_index))
            // Collaboration CRDT operations
            .route("/collab/merge", web::post().to(collab_merge))
            .route("/collab/compact", web::post().to(collab_compact))
            .route("/collab/diff", web::post().to(collab_diff))
            .route("/collab/stats", web::get().to(collab_room_stats))
            .route("/collab/analyze", web::post().to(collab_analyze_state))
            .route("/collab/batch-merge", web::post().to(collab_batch_merge))
            // Post-quantum encryption
            .route("/pq/keygen", web::post().to(pq_keygen))
            .route("/pq/encrypt", web::post().to(pq_encrypt))
            .route("/pq/decrypt", web::post().to(pq_decrypt))
            // Zero-knowledge proofs
            .route("/zk/document-proof", web::post().to(zk_document_proof))
            .route("/zk/verify-document-proof", web::post().to(zk_verify_document_proof))
            .route("/zk/signature-proof", web::post().to(zk_signature_proof))
            .route("/zk/verify-signature-proof", web::post().to(zk_verify_signature_proof))
            .route("/zk/field-proof", web::post().to(zk_field_proof))
            .route("/zk/verify-field-proof", web::post().to(zk_verify_field_proof)),
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// Health
// ══════════════════════════════════════════════════════════════════════════════

async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "engine": "proofmark-engine",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

// ══════════════════════════════════════════════════════════════════════════════
// Crypto endpoints
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Deserialize)]
struct HashDocReq {
    content: String,
}

async fn hash_document(body: web::Json<HashDocReq>) -> impl Responder {
    let hash = crypto::hash_document(&body.content);
    HttpResponse::Ok().json(serde_json::json!({ "hash": hash }))
}

#[derive(Deserialize)]
struct HashHandSigReq {
    data_url: String,
}

async fn hash_hand_signature(body: web::Json<HashHandSigReq>) -> impl Responder {
    let hash = crypto::hash_hand_signature(&body.data_url);
    HttpResponse::Ok().json(serde_json::json!({ "hash": hash }))
}

#[derive(Deserialize)]
struct BuildSigningMsgReq {
    content_hash: String,
    address: String,
    signer_label: String,
    hand_signature_hash: Option<String>,
}

async fn build_signing_message(body: web::Json<BuildSigningMsgReq>) -> impl Responder {
    let msg = crypto::build_signing_message(
        &body.content_hash,
        &body.address,
        &body.signer_label,
        body.hand_signature_hash.as_deref(),
    );
    HttpResponse::Ok().json(serde_json::json!({ "message": msg }))
}

#[derive(Deserialize)]
struct EncryptReq {
    content: String,
    master_secret: String,
}

async fn encrypt_document(body: web::Json<EncryptReq>) -> impl Responder {
    match crypto::encrypt_document(&body.content, &body.master_secret) {
        Ok(result) => HttpResponse::Ok().json(result),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[derive(Deserialize)]
struct DecryptReq {
    encrypted_content: String,
    wrapped_key: String,
    master_secret: String,
}

async fn decrypt_document(body: web::Json<DecryptReq>) -> impl Responder {
    let encrypted = crypto::EncryptedDocument {
        encrypted_content: body.encrypted_content.clone(),
        wrapped_key: body.wrapped_key.clone(),
    };
    match crypto::decrypt_document(&encrypted, &body.master_secret) {
        Ok(plaintext) => HttpResponse::Ok().json(serde_json::json!({ "content": plaintext })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Signature verification
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Deserialize)]
struct VerifySigReq {
    chain: String,
    address: String,
    message: String,
    signature: String,
}

async fn verify_signature(body: web::Json<VerifySigReq>) -> impl Responder {
    let chain = match body.chain.to_uppercase().as_str() {
        "ETH" | "ETHEREUM" => verify::WalletChain::Eth,
        "BTC" | "BITCOIN" => verify::WalletChain::Btc,
        "SOL" | "SOLANA" => verify::WalletChain::Sol,
        _ => {
            return HttpResponse::BadRequest()
                .json(serde_json::json!({ "error": "unsupported chain" }))
        }
    };

    // Offload to blocking threadpool (crypto is CPU-intensive)
    let address = body.address.clone();
    let message = body.message.clone();
    let signature = body.signature.clone();

    let result = web::block(move || verify::verify_signature(chain, &address, &message, &signature))
        .await
        .unwrap();

    HttpResponse::Ok().json(result)
}

// ══════════════════════════════════════════════════════════════════════════════
// PDF endpoints
// ══════════════════════════════════════════════════════════════════════════════

async fn analyze_pdf(body: web::Bytes) -> impl Responder {
    let bytes = body.to_vec();

    // Offload heavy PDF parsing to blocking threadpool
    let result = web::block(move || pdf::analyze_pdf(&bytes)).await;

    match result {
        Ok(Ok(analysis)) => HttpResponse::Ok().json(analysis),
        Ok(Err(e)) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

async fn generate_pdf(body: web::Json<pdf::PdfGenerateRequest>) -> impl Responder {
    let req = body.into_inner();

    let result = web::block(move || pdf::generate_signed_pdf(&req)).await;

    match result {
        Ok(Ok(pdf_bytes)) => HttpResponse::Ok()
            .content_type("application/pdf")
            .body(pdf_bytes),
        Ok(Err(e)) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Audit endpoints
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Deserialize)]
struct ComputeAuditHashReq {
    prev_hash: Option<String>,
    event_type: String,
    actor: String,
    timestamp: String,
    metadata: Option<serde_json::Value>,
}

async fn compute_audit_hash(body: web::Json<ComputeAuditHashReq>) -> impl Responder {
    let hash = audit::compute_event_hash(
        body.prev_hash.as_deref(),
        &body.event_type,
        &body.actor,
        &body.timestamp,
        body.metadata.as_ref(),
    );
    HttpResponse::Ok().json(serde_json::json!({ "hash": hash }))
}

#[derive(Deserialize)]
struct VerifyAuditChainReq {
    events: Vec<audit::AuditEvent>,
}

async fn verify_audit_chain(body: web::Json<VerifyAuditChainReq>) -> impl Responder {
    match audit::verify_audit_chain(&body.events) {
        Ok(()) => HttpResponse::Ok().json(serde_json::json!({ "valid": true })),
        Err(idx) => HttpResponse::Ok().json(serde_json::json!({
            "valid": false,
            "broken_at": idx,
        })),
    }
}

#[derive(Deserialize)]
struct ComputeChainBatchReq {
    events: Vec<(String, String, String, Option<serde_json::Value>)>,
}

async fn compute_audit_chain_batch(body: web::Json<ComputeChainBatchReq>) -> impl Responder {
    let hashes = audit::compute_event_chain(&body.events);
    HttpResponse::Ok().json(serde_json::json!({ "hashes": hashes }))
}

// ══════════════════════════════════════════════════════════════════════════════
// QR endpoints
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Deserialize)]
struct QrReq {
    text: String,
    size: Option<u32>,
}

async fn generate_qr_svg(body: web::Json<QrReq>) -> impl Responder {
    let size = body.size.unwrap_or(200);
    match qr::generate_qr_svg(&body.text, size) {
        Ok(svg) => HttpResponse::Ok()
            .content_type("image/svg+xml")
            .body(svg),
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

async fn generate_qr_data_url(body: web::Json<QrReq>) -> impl Responder {
    let size = body.size.unwrap_or(256);
    match qr::generate_qr_data_url(&body.text, size) {
        Ok(url) => HttpResponse::Ok().json(serde_json::json!({ "data_url": url })),
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() }))
        }
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Forensic endpoints
// ══════════════════════════════════════════════════════════════════════════════

async fn hash_forensic(body: web::Json<serde_json::Value>) -> impl Responder {
    let hash = forensic::hash_forensic_evidence(&body);
    HttpResponse::Ok().json(serde_json::json!({ "hash": hash }))
}

async fn analyze_forensic_flags(body: web::Json<serde_json::Value>) -> impl Responder {
    let flags = forensic::analyze_flags(&body);
    HttpResponse::Ok().json(serde_json::json!({ "flags": flags }))
}

#[derive(Deserialize)]
struct ValidateReplayReq {
    tape_base64: String,
    claimed_metrics: serde_json::Value,
    claimed_behavioral: serde_json::Value,
}

async fn validate_replay(body: web::Json<ValidateReplayReq>) -> impl Responder {
    let req = body.into_inner();
    let result = forensic::validate_replay_tape(
        &req.tape_base64,
        &req.claimed_metrics,
        &req.claimed_behavioral,
    );
    HttpResponse::Ok().json(result)
}

#[derive(Deserialize)]
struct HeaderFingerprintReq {
    header_names: Vec<String>,
}

async fn header_fingerprint(body: web::Json<HeaderFingerprintReq>) -> impl Responder {
    let mut names = body.into_inner().header_names;
    let hash = forensic::compute_header_fingerprint(&mut names);
    HttpResponse::Ok().json(serde_json::json!({ "fingerprint": hash }))
}

// ════════════════��════════════════════════════════���════════════════════════════
// Index endpoints
// ══════════════════════════════════════════════════════════════════════��═══════

async fn index_document(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<index::IndexRequest>,
) -> impl Responder {
    let req = body.into_inner();
    let engine = engine.get_ref().clone();

    match web::block(move || engine.index_document(&req)).await {
        Ok(Ok(result)) => HttpResponse::Ok().json(result),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[derive(Deserialize)]
struct RemoveDocReq {
    doc_id: String,
}

async fn remove_document(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<RemoveDocReq>,
) -> impl Responder {
    let doc_id = body.doc_id.clone();
    let engine = engine.get_ref().clone();

    match web::block(move || engine.remove_document(&doc_id)).await {
        Ok(Ok(())) => HttpResponse::Ok().json(serde_json::json!({ "removed": true })),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

async fn search_index(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<index::SearchRequest>,
) -> impl Responder {
    let req = body.into_inner();
    let engine = engine.get_ref().clone();

    match web::block(move || engine.search(&req)).await {
        Ok(Ok(result)) => HttpResponse::Ok().json(result),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[derive(Deserialize)]
struct AutocompleteReq {
    prefix: String,
    max_suggestions: Option<usize>,
}

async fn autocomplete(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<AutocompleteReq>,
) -> impl Responder {
    let prefix = body.prefix.clone();
    let max = body.max_suggestions.unwrap_or(10);
    let engine = engine.get_ref().clone();

    match web::block(move || engine.autocomplete(&prefix, max)).await {
        Ok(Ok(suggestions)) => HttpResponse::Ok().json(serde_json::json!({ "suggestions": suggestions })),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[derive(Deserialize)]
struct ScanDocReq {
    doc_id: String,
    content: String,
    encrypted: Option<bool>,
}

async fn scan_document(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<ScanDocReq>,
) -> impl Responder {
    let req = body.into_inner();
    let engine = engine.get_ref().clone();

    match web::block(move || {
        index::scanner::scan_document(
            engine.store(),
            &req.doc_id,
            &req.content,
            req.encrypted.unwrap_or(false),
        )
    }).await {
        Ok(Ok(result)) => HttpResponse::Ok().json(result),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[derive(Deserialize)]
struct PrivacyScanReq {
    text: String,
}

async fn privacy_scan(body: web::Json<PrivacyScanReq>) -> impl Responder {
    let text = body.text.clone();
    let result = web::block(move || index::privacy::scan_privacy(&text)).await;

    match result {
        Ok(scan) => HttpResponse::Ok().json(scan),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

async fn index_stats(engine: web::Data<Arc<index::IndexEngine>>) -> impl Responder {
    HttpResponse::Ok().json(engine.index_stats())
}

#[derive(Deserialize)]
struct EnqueueJobReq {
    doc_id: String,
    owner_id: String,
    job_type: String,
}

async fn enqueue_index_job(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<EnqueueJobReq>,
) -> impl Responder {
    let job_type = match body.job_type.as_str() {
        "index_new" => index::queue::JobType::IndexNew,
        "re_index" => index::queue::JobType::ReIndex,
        "index_encrypted" => index::queue::JobType::IndexEncrypted,
        "ai_enhance" => index::queue::JobType::AiEnhance,
        "full_re_index" => index::queue::JobType::FullReIndex,
        _ => return HttpResponse::BadRequest().json(serde_json::json!({ "error": "Invalid job_type" })),
    };

    let engine = engine.get_ref().clone();
    let doc_id = body.doc_id.clone();
    let owner_id = body.owner_id.clone();

    match web::block(move || engine.enqueue_index(&doc_id, &owner_id, job_type)).await {
        Ok(Ok(job_id)) => HttpResponse::Ok().json(serde_json::json!({ "job_id": job_id })),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[derive(Deserialize)]
struct BulkImportReq {
    owner_id: String,
    doc_ids: Vec<String>,
}

async fn bulk_encrypted_import(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<BulkImportReq>,
) -> impl Responder {
    let engine = engine.get_ref().clone();
    let owner_id = body.owner_id.clone();
    let doc_ids = body.doc_ids.clone();

    match web::block(move || engine.enqueue_bulk_import(&owner_id, &doc_ids)).await {
        Ok(Ok(count)) => HttpResponse::Ok().json(serde_json::json!({ "enqueued": count })),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

async fn queue_stats(engine: web::Data<Arc<index::IndexEngine>>) -> impl Responder {
    HttpResponse::Ok().json(engine.queue_stats())
}

#[derive(Deserialize)]
struct OwnerReq {
    owner_id: String,
}

async fn owner_queue_jobs(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<OwnerReq>,
) -> impl Responder {
    let engine = engine.get_ref().clone();
    let owner_id = body.owner_id.clone();

    match web::block(move || engine.get_owner_queue(&owner_id)).await {
        Ok(Ok(jobs)) => HttpResponse::Ok().json(serde_json::json!({ "jobs": jobs })),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

async fn cancel_owner_queue(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<OwnerReq>,
) -> impl Responder {
    let engine = engine.get_ref().clone();
    let owner_id = body.owner_id.clone();

    match web::block(move || engine.cancel_owner_queue(&owner_id)).await {
        Ok(Ok(count)) => HttpResponse::Ok().json(serde_json::json!({ "cancelled": count })),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[derive(Deserialize)]
struct AiIndexReq {
    doc_id: String,
    content: String,
}

async fn ai_index_document(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<AiIndexReq>,
) -> impl Responder {
    match engine.ai_index(&body.doc_id, &body.content).await {
        Ok(result) => HttpResponse::Ok().json(result),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

async fn set_ai_config(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<index::ai::AiIndexConfig>,
) -> impl Responder {
    engine.set_ai_config(body.into_inner());
    HttpResponse::Ok().json(serde_json::json!({ "updated": true }))
}

async fn set_encrypted_config(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<index::encrypted::EncryptedIndexConfig>,
) -> impl Responder {
    engine.set_encrypted_config(body.into_inner());
    HttpResponse::Ok().json(serde_json::json!({ "updated": true }))
}

async fn compact_index(engine: web::Data<Arc<index::IndexEngine>>) -> impl Responder {
    let engine = engine.get_ref().clone();
    web::block(move || {
        engine.compact();
        engine.flush()
    }).await.ok();
    HttpResponse::Ok().json(serde_json::json!({ "compacted": true }))
}

// ══════════════════════════════════════════════════════════════════════════════
// Collaboration CRDT endpoints
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Deserialize)]
struct CollabMergeReq {
    states: Vec<String>, // base64 encoded Yjs states
}

async fn collab_merge(body: web::Json<CollabMergeReq>) -> impl Responder {
    let states: Result<Vec<Vec<u8>>, _> = body.states.iter()
        .map(|s| base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s))
        .collect();
    let states = match states {
        Ok(s) => s,
        Err(e) => return HttpResponse::BadRequest().json(serde_json::json!({ "error": format!("Invalid base64: {e}") })),
    };
    match web::block(move || collab::crdt::merge_states(&states)).await {
        Ok(Ok(merged)) => {
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &merged);
            HttpResponse::Ok().json(serde_json::json!({ "merged_state": b64, "size_bytes": merged.len() }))
        }
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[derive(Deserialize)]
struct CollabCompactReq {
    state: String, // base64
}

async fn collab_compact(body: web::Json<CollabCompactReq>) -> impl Responder {
    let state = match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &body.state) {
        Ok(s) => s,
        Err(e) => return HttpResponse::BadRequest().json(serde_json::json!({ "error": format!("Invalid base64: {e}") })),
    };
    let original_size = state.len();
    match web::block(move || collab::crdt::compact_state(&state)).await {
        Ok(Ok(compacted)) => {
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &compacted);
            HttpResponse::Ok().json(serde_json::json!({
                "compacted_state": b64,
                "original_bytes": original_size,
                "compacted_bytes": compacted.len(),
                "savings_percent": if original_size > 0 {
                    (1.0 - compacted.len() as f64 / original_size as f64) * 100.0
                } else { 0.0 }
            }))
        }
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[derive(Deserialize)]
struct CollabDiffReq {
    base_state: String,    // base64
    current_state: String, // base64
}

async fn collab_diff(body: web::Json<CollabDiffReq>) -> impl Responder {
    let base = match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &body.base_state) {
        Ok(s) => s,
        Err(e) => return HttpResponse::BadRequest().json(serde_json::json!({ "error": format!("Invalid base64: {e}") })),
    };
    let current = match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &body.current_state) {
        Ok(s) => s,
        Err(e) => return HttpResponse::BadRequest().json(serde_json::json!({ "error": format!("Invalid base64: {e}") })),
    };
    match web::block(move || collab::crdt::compute_diff(&base, &current)).await {
        Ok(Ok(diff)) => {
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &diff);
            HttpResponse::Ok().json(serde_json::json!({ "diff": b64, "diff_bytes": diff.len() }))
        }
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

async fn collab_room_stats(room_mgr: web::Data<collab::RoomManager>) -> impl Responder {
    HttpResponse::Ok().json(room_mgr.stats())
}

async fn collab_analyze_state(body: web::Json<CollabCompactReq>) -> impl Responder {
    let state = match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &body.state) {
        Ok(s) => s,
        Err(e) => return HttpResponse::BadRequest().json(serde_json::json!({ "error": format!("Invalid base64: {e}") })),
    };
    match web::block(move || collab::crdt::analyze_state(&state)).await {
        Ok(Ok(stats)) => HttpResponse::Ok().json(stats),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[derive(Deserialize)]
struct CollabBatchMergeReq {
    states: Vec<String>, // base64
    chunk_size: Option<usize>,
}

async fn collab_batch_merge(body: web::Json<CollabBatchMergeReq>) -> impl Responder {
    let states: Result<Vec<Vec<u8>>, _> = body.states.iter()
        .map(|s| base64::Engine::decode(&base64::engine::general_purpose::STANDARD, s))
        .collect();
    let states = match states {
        Ok(s) => s,
        Err(e) => return HttpResponse::BadRequest().json(serde_json::json!({ "error": format!("Invalid base64: {e}") })),
    };
    let chunk_size = body.chunk_size.unwrap_or(4);
    match web::block(move || collab::crdt::batch_merge(states, chunk_size)).await {
        Ok(Ok(merged)) => {
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &merged);
            HttpResponse::Ok().json(serde_json::json!({ "merged_state": b64, "size_bytes": merged.len() }))
        }
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Post-Quantum Encryption endpoints
// ══════════════════════════════════════════════════════════════════════════════

async fn pq_keygen() -> impl Responder {
    let kp = pqcrypto::pq_generate_keypair();
    HttpResponse::Ok().json(kp)
}

#[derive(Deserialize)]
struct PqEncryptReq {
    plaintext: String, // base64
    recipient_public_key: String, // hex
}

async fn pq_encrypt(body: web::Json<PqEncryptReq>) -> impl Responder {
    let plaintext = match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &body.plaintext) {
        Ok(b) => b,
        Err(e) => return HttpResponse::BadRequest().json(serde_json::json!({ "error": format!("Invalid base64: {e}") })),
    };
    match web::block(move || pqcrypto::pq_encrypt(&plaintext, &body.recipient_public_key)).await {
        Ok(Ok(ct)) => HttpResponse::Ok().json(ct),
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

#[derive(Deserialize)]
struct PqDecryptReq {
    ciphertext: pqcrypto::HybridCiphertext,
    recipient_private_key: String, // hex
}

async fn pq_decrypt(body: web::Json<PqDecryptReq>) -> impl Responder {
    let ct = body.ciphertext.clone();
    let key = body.recipient_private_key.clone();
    match web::block(move || pqcrypto::pq_decrypt(&ct, &key)).await {
        Ok(Ok(plaintext)) => {
            let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &plaintext);
            HttpResponse::Ok().json(serde_json::json!({ "plaintext": b64 }))
        }
        Ok(Err(e)) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({ "error": e.to_string() })),
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Zero-Knowledge Proof endpoints
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Deserialize)]
struct ZkDocProofReq {
    document_content: String,
}

async fn zk_document_proof(body: web::Json<ZkDocProofReq>) -> impl Responder {
    let content = body.document_content.clone();
    let proof = web::block(move || pqcrypto::create_document_proof(&content)).await.unwrap();
    HttpResponse::Ok().json(proof)
}

async fn zk_verify_document_proof(body: web::Json<pqcrypto::DocumentProof>) -> impl Responder {
    let valid = pqcrypto::verify_document_proof(&body);
    HttpResponse::Ok().json(serde_json::json!({ "valid": valid }))
}

#[derive(Deserialize)]
struct ZkSigProofReq {
    document_hash: String,
    signer_address: String,
    scheme: String,
    signature: String, // base64
}

async fn zk_signature_proof(body: web::Json<ZkSigProofReq>) -> impl Responder {
    let sig_bytes = match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &body.signature) {
        Ok(b) => b,
        Err(e) => return HttpResponse::BadRequest().json(serde_json::json!({ "error": format!("Invalid base64: {e}") })),
    };
    let proof = pqcrypto::create_signature_proof(
        &body.document_hash, &body.signer_address, &body.scheme, &sig_bytes,
    );
    HttpResponse::Ok().json(proof)
}

async fn zk_verify_signature_proof(body: web::Json<pqcrypto::SignatureProof>) -> impl Responder {
    let valid = pqcrypto::verify_signature_proof(&body);
    HttpResponse::Ok().json(serde_json::json!({ "valid": valid }))
}

#[derive(Deserialize)]
struct ZkFieldProofReq {
    document_hash: String,
    field_id: String,
    field_value: String,
    reveal: Option<bool>,
}

async fn zk_field_proof(body: web::Json<ZkFieldProofReq>) -> impl Responder {
    let proof = pqcrypto::create_field_proof(
        &body.document_hash, &body.field_id, &body.field_value, body.reveal.unwrap_or(false),
    );
    HttpResponse::Ok().json(proof)
}

async fn zk_verify_field_proof(body: web::Json<pqcrypto::FieldProof>) -> impl Responder {
    let valid = pqcrypto::verify_field_proof(&body);
    HttpResponse::Ok().json(serde_json::json!({ "valid": valid }))
}
