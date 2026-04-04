//! Post-quantum encryption and zero-knowledge proof endpoints.

use actix_web::{web, HttpResponse, Responder};

use super::error;
use super::types::*;
use crate::pqcrypto;

// ── Post-Quantum Encryption ─────────────────────────────────────────────────────

pub async fn pq_keygen() -> impl Responder {
    let kp = pqcrypto::pq_generate_keypair();
    HttpResponse::Ok().json(kp)
}

pub async fn pq_encrypt(body: web::Json<PqEncryptReq>) -> impl Responder {
    let plaintext =
        match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &body.plaintext) {
            Ok(b) => b,
            Err(e) => return error::bad_request(format!("Invalid base64: {e}")),
        };
    match web::block(move || pqcrypto::pq_encrypt(&plaintext, &body.recipient_public_key)).await {
        Ok(Ok(ct)) => HttpResponse::Ok().json(ct),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn pq_decrypt(body: web::Json<PqDecryptReq>) -> impl Responder {
    let ct = body.ciphertext.clone();
    let key = body.recipient_private_key.clone();
    match web::block(move || pqcrypto::pq_decrypt(&ct, &key)).await {
        Ok(Ok(plaintext)) => {
            let b64 =
                base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &plaintext);
            HttpResponse::Ok().json(serde_json::json!({ "plaintext": b64 }))
        }
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

// ── Zero-Knowledge Proofs ───────────────────────────────────────────────────────

pub async fn zk_document_proof(body: web::Json<ZkDocProofReq>) -> impl Responder {
    let content = body.document_content.clone();
    match web::block(move || pqcrypto::create_document_proof(&content)).await {
        Ok(proof) => HttpResponse::Ok().json(proof),
        Err(e) => error::internal_error(e),
    }
}

pub async fn zk_verify_document_proof(
    body: web::Json<pqcrypto::DocumentProof>,
) -> impl Responder {
    let valid = pqcrypto::verify_document_proof(&body);
    HttpResponse::Ok().json(serde_json::json!({ "valid": valid }))
}

pub async fn zk_signature_proof(body: web::Json<ZkSigProofReq>) -> impl Responder {
    let sig_bytes =
        match base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &body.signature) {
            Ok(b) => b,
            Err(e) => return error::bad_request(format!("Invalid base64: {e}")),
        };
    let proof = pqcrypto::create_signature_proof(
        &body.document_hash,
        &body.signer_address,
        &body.scheme,
        &sig_bytes,
    );
    HttpResponse::Ok().json(proof)
}

pub async fn zk_verify_signature_proof(
    body: web::Json<pqcrypto::SignatureProof>,
) -> impl Responder {
    let valid = pqcrypto::verify_signature_proof(&body);
    HttpResponse::Ok().json(serde_json::json!({ "valid": valid }))
}

pub async fn zk_field_proof(body: web::Json<ZkFieldProofReq>) -> impl Responder {
    let proof = pqcrypto::create_field_proof(
        &body.document_hash,
        &body.field_id,
        &body.field_value,
        body.reveal.unwrap_or(false),
    );
    HttpResponse::Ok().json(proof)
}

pub async fn zk_verify_field_proof(body: web::Json<pqcrypto::FieldProof>) -> impl Responder {
    let valid = pqcrypto::verify_field_proof(&body);
    HttpResponse::Ok().json(serde_json::json!({ "valid": valid }))
}
