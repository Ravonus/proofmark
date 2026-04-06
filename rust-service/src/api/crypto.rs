use actix_web::{web, HttpResponse, Responder};
use serde::Deserialize;

use super::error;
use crate::crypto;

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

pub async fn hash_document(body: web::Json<HashDocReq>) -> impl Responder {
    let hash = crypto::hash_document(&body.content);
    HttpResponse::Ok().json(serde_json::json!({ "hash": hash }))
}

pub async fn hash_hand_signature(body: web::Json<HashHandSigReq>) -> impl Responder {
    let hash = crypto::hash_hand_signature(&body.data_url);
    HttpResponse::Ok().json(serde_json::json!({ "hash": hash }))
}

pub async fn build_signing_message(body: web::Json<BuildSigningMsgReq>) -> impl Responder {
    let msg = crypto::build_signing_message(
        &body.content_hash,
        &body.address,
        &body.signer_label,
        body.hand_signature_hash.as_deref(),
    );
    HttpResponse::Ok().json(serde_json::json!({ "message": msg }))
}

pub async fn encrypt_document(body: web::Json<EncryptReq>) -> impl Responder {
    match crypto::encrypt_document(&body.content, &body.master_secret) {
        Ok(result) => HttpResponse::Ok().json(result),
        Err(e) => error::internal_error(e),
    }
}

pub async fn decrypt_document(body: web::Json<DecryptReq>) -> impl Responder {
    let encrypted = crypto::EncryptedDocument {
        encrypted_content: body.encrypted_content.clone(),
        wrapped_key: body.wrapped_key.clone(),
    };
    match crypto::decrypt_document(&encrypted, &body.master_secret) {
        Ok(plaintext) => HttpResponse::Ok().json(serde_json::json!({ "content": plaintext })),
        Err(e) => error::internal_error(e),
    }
}
