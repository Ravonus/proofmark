use actix_web::{web, HttpResponse, Responder};
use serde::Deserialize;

use crate::forensic;

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

pub async fn hash_forensic(body: web::Json<serde_json::Value>) -> impl Responder {
    let hash = forensic::hash_forensic_evidence(&body);
    HttpResponse::Ok().json(serde_json::json!({ "hash": hash }))
}

pub async fn analyze_forensic_flags(body: web::Json<serde_json::Value>) -> impl Responder {
    let flags = forensic::analyze_flags(&body);
    HttpResponse::Ok().json(serde_json::json!({ "flags": flags }))
}

pub async fn validate_replay(body: web::Json<ValidateReplayReq>) -> impl Responder {
    let req = body.into_inner();
    let result = forensic::validate_replay_tape(
        &req.tape_base64,
        &req.claimed_metrics,
        &req.claimed_behavioral,
    );
    HttpResponse::Ok().json(result)
}

pub async fn header_fingerprint(body: web::Json<HeaderFingerprintReq>) -> impl Responder {
    let mut names = body.into_inner().header_names;
    let hash = forensic::compute_header_fingerprint(&mut names);
    HttpResponse::Ok().json(serde_json::json!({ "fingerprint": hash }))
}
