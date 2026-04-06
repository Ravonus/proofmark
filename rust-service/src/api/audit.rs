use actix_web::{web, HttpResponse, Responder};
use serde::Deserialize;

use crate::audit;

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
    pub events: Vec<audit::AuditEvent>,
}

#[derive(Deserialize)]
pub struct ComputeChainBatchReq {
    pub events: Vec<(String, String, String, Option<serde_json::Value>)>,
}

pub async fn compute_audit_hash(body: web::Json<ComputeAuditHashReq>) -> impl Responder {
    let hash = audit::compute_event_hash(
        body.prev_hash.as_deref(),
        &body.event_type,
        &body.actor,
        &body.timestamp,
        body.metadata.as_ref(),
    );
    HttpResponse::Ok().json(serde_json::json!({ "hash": hash }))
}

pub async fn verify_audit_chain(body: web::Json<VerifyAuditChainReq>) -> impl Responder {
    match audit::verify_audit_chain(&body.events) {
        Ok(()) => HttpResponse::Ok().json(serde_json::json!({ "valid": true })),
        Err(idx) => HttpResponse::Ok().json(serde_json::json!({
            "valid": false,
            "broken_at": idx,
        })),
    }
}

pub async fn compute_audit_chain_batch(body: web::Json<ComputeChainBatchReq>) -> impl Responder {
    let hashes = audit::compute_event_chain(&body.events);
    HttpResponse::Ok().json(serde_json::json!({ "hashes": hashes }))
}
