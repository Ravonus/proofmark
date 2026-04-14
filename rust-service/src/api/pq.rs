use actix_web::{web, HttpResponse, Responder};
use serde::Deserialize;

use super::error;
use crate::pq;
use crate::util::b64;

#[derive(Deserialize)]
pub struct PqEncryptReq {
    pub plaintext: String,
    pub recipient_public_key: String,
}

#[derive(Deserialize)]
pub struct PqDecryptReq {
    pub ciphertext: pq::HybridCiphertext,
    pub recipient_private_key: String,
}

pub async fn pq_keygen() -> impl Responder {
    let kp = pq::pq_generate_keypair();
    HttpResponse::Ok().json(kp)
}

pub async fn pq_encrypt(body: web::Json<PqEncryptReq>) -> impl Responder {
    let plaintext = match b64::decode(&body.plaintext) {
        Ok(b) => b,
        Err(e) => return error::bad_request(e),
    };
    error::block_ok(web::block(move || pq::pq_encrypt(&plaintext, &body.recipient_public_key)).await)
}

pub async fn pq_decrypt(body: web::Json<PqDecryptReq>) -> impl Responder {
    let ct = body.ciphertext.clone();
    let key = body.recipient_private_key.clone();
    match web::block(move || pq::pq_decrypt(&ct, &key)).await {
        Ok(Ok(plaintext)) => {
            HttpResponse::Ok().json(serde_json::json!({ "plaintext": b64::encode(&plaintext) }))
        }
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}
