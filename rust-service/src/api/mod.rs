//! HTTP API — route configuration and handler modules.

mod audit;
mod collab;
mod crypto;
mod error;
mod forensic;
mod index;
mod pdf;
mod pq;
mod qr;
mod verify;
mod zk;

use actix_web::{web, HttpResponse, Responder};

pub fn configure(cfg: &mut web::ServiceConfig, pdf_analyze_payload_limit_bytes: usize) {
    cfg.service(
        web::scope("/api/v1")
            .route("/health", web::get().to(health))

            // Crypto
            .route("/crypto/hash", web::post().to(crypto::hash_document))
            .route("/crypto/hash-hand-signature", web::post().to(crypto::hash_hand_signature))
            .route("/crypto/build-signing-message", web::post().to(crypto::build_signing_message))
            .route("/crypto/encrypt", web::post().to(crypto::encrypt_document))
            .route("/crypto/decrypt", web::post().to(crypto::decrypt_document))

            // Verify
            .route("/verify/signature", web::post().to(verify::verify_signature))

            // PDF
            .service(
                web::resource("/pdf/analyze")
                    .app_data(web::PayloadConfig::new(pdf_analyze_payload_limit_bytes))
                    .route(web::post().to(pdf::analyze_pdf)),
            )
            .route("/pdf/generate", web::post().to(pdf::generate_pdf))

            // Audit
            .route("/audit/compute-hash", web::post().to(audit::compute_audit_hash))
            .route("/audit/verify-chain", web::post().to(audit::verify_audit_chain))
            .route("/audit/compute-chain", web::post().to(audit::compute_audit_chain_batch))

            // QR
            .route("/qr/svg", web::post().to(qr::generate_qr_svg))
            .route("/qr/data-url", web::post().to(qr::generate_qr_data_url))

            // Forensic
            .route("/forensic/hash", web::post().to(forensic::hash_forensic))
            .route("/forensic/analyze-flags", web::post().to(forensic::analyze_forensic_flags))
            .route("/forensic/header-fingerprint", web::post().to(forensic::header_fingerprint))
            .route("/forensic/validate-replay", web::post().to(forensic::validate_replay))

            // Index
            .route("/index/document", web::post().to(index::index_document))
            .route("/index/remove", web::post().to(index::remove_document))
            .route("/index/search", web::post().to(index::search_index))
            .route("/index/autocomplete", web::post().to(index::autocomplete))
            .route("/index/scan", web::post().to(index::scan_document))
            .route("/index/privacy-scan", web::post().to(index::privacy_scan))
            .route("/index/stats", web::get().to(index::index_stats))
            .route("/index/queue/enqueue", web::post().to(index::enqueue_index_job))
            .route("/index/queue/bulk-import", web::post().to(index::bulk_encrypted_import))
            .route("/index/queue/stats", web::get().to(index::queue_stats))
            .route("/index/queue/owner", web::post().to(index::owner_queue_jobs))
            .route("/index/queue/cancel", web::post().to(index::cancel_owner_queue))
            .route("/index/ai/index", web::post().to(index::ai_index_document))
            .route("/index/ai/config", web::post().to(index::set_ai_config))
            .route("/index/encrypted/config", web::post().to(index::set_encrypted_config))
            .route("/index/compact", web::post().to(index::compact_index))

            // Collaboration
            .route("/collab/merge", web::post().to(collab::collab_merge))
            .route("/collab/compact", web::post().to(collab::collab_compact))
            .route("/collab/diff", web::post().to(collab::collab_diff))
            .route("/collab/stats", web::get().to(collab::collab_room_stats))
            .route("/collab/analyze", web::post().to(collab::collab_analyze_state))
            .route("/collab/batch-merge", web::post().to(collab::collab_batch_merge))

            // Post-quantum encryption
            .route("/pq/keygen", web::post().to(pq::pq_keygen))
            .route("/pq/encrypt", web::post().to(pq::pq_encrypt))
            .route("/pq/decrypt", web::post().to(pq::pq_decrypt))

            // Zero-knowledge proofs
            .route("/zk/document-proof", web::post().to(zk::zk_document_proof))
            .route("/zk/verify-document-proof", web::post().to(zk::zk_verify_document_proof))
            .route("/zk/signature-proof", web::post().to(zk::zk_signature_proof))
            .route("/zk/verify-signature-proof", web::post().to(zk::zk_verify_signature_proof))
            .route("/zk/field-proof", web::post().to(zk::zk_field_proof))
            .route("/zk/verify-field-proof", web::post().to(zk::zk_verify_field_proof)),
    );
}

async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "engine": "proofmark-engine",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
