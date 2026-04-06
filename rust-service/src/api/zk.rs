use actix_web::{web, HttpResponse, Responder};
use serde::Deserialize;

use super::error;
use crate::util::b64;
use crate::zk;

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

pub async fn zk_document_proof(body: web::Json<ZkDocProofReq>) -> impl Responder {
    let content = body.document_content.clone();
    match web::block(move || zk::create_document_proof(&content)).await {
        Ok(proof) => HttpResponse::Ok().json(proof),
        Err(e) => error::internal_error(e),
    }
}

pub async fn zk_verify_document_proof(body: web::Json<zk::DocumentProof>) -> impl Responder {
    let valid = zk::verify_document_proof(&body);
    HttpResponse::Ok().json(serde_json::json!({ "valid": valid }))
}

pub async fn zk_signature_proof(body: web::Json<ZkSigProofReq>) -> impl Responder {
    let sig_bytes = match b64::decode(&body.signature) {
        Ok(b) => b,
        Err(e) => return error::bad_request(e),
    };
    let proof = zk::create_signature_proof(
        &body.document_hash,
        &body.signer_address,
        &body.scheme,
        &sig_bytes,
    );
    HttpResponse::Ok().json(proof)
}

pub async fn zk_verify_signature_proof(body: web::Json<zk::SignatureProof>) -> impl Responder {
    let valid = zk::verify_signature_proof(&body);
    HttpResponse::Ok().json(serde_json::json!({ "valid": valid }))
}

pub async fn zk_field_proof(body: web::Json<ZkFieldProofReq>) -> impl Responder {
    let proof = zk::create_field_proof(
        &body.document_hash,
        &body.field_id,
        &body.field_value,
        body.reveal.unwrap_or(false),
    );
    HttpResponse::Ok().json(proof)
}

pub async fn zk_verify_field_proof(body: web::Json<zk::FieldProof>) -> impl Responder {
    let valid = zk::verify_field_proof(&body);
    HttpResponse::Ok().json(serde_json::json!({ "valid": valid }))
}
