//! Collaboration CRDT endpoints — merge, compact, diff, batch operations.

use actix_web::{web, HttpResponse, Responder};

use super::error;
use super::types::*;
use crate::collab;
use crate::util::b64;

pub async fn collab_merge(body: web::Json<CollabMergeReq>) -> impl Responder {
    let states: Result<Vec<Vec<u8>>, _> = body.states.iter().map(|s| b64::decode(s)).collect();
    let states = match states {
        Ok(s) => s,
        Err(e) => return error::bad_request(e),
    };
    match web::block(move || collab::crdt::merge_states(&states)).await {
        Ok(Ok(merged)) => HttpResponse::Ok().json(serde_json::json!({
            "merged_state": b64::encode(&merged),
            "size_bytes": merged.len(),
        })),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn collab_compact(body: web::Json<CollabCompactReq>) -> impl Responder {
    let state = match b64::decode(&body.state) {
        Ok(s) => s,
        Err(e) => return error::bad_request(e),
    };
    let original_size = state.len();
    match web::block(move || collab::crdt::compact_state(&state)).await {
        Ok(Ok(compacted)) => HttpResponse::Ok().json(serde_json::json!({
            "compacted_state": b64::encode(&compacted),
            "original_bytes": original_size,
            "compacted_bytes": compacted.len(),
            "savings_percent": if original_size > 0 {
                (1.0 - compacted.len() as f64 / original_size as f64) * 100.0
            } else { 0.0 }
        })),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn collab_diff(body: web::Json<CollabDiffReq>) -> impl Responder {
    let base = match b64::decode(&body.base_state) {
        Ok(s) => s,
        Err(e) => return error::bad_request(e),
    };
    let current = match b64::decode(&body.current_state) {
        Ok(s) => s,
        Err(e) => return error::bad_request(e),
    };
    match web::block(move || collab::crdt::compute_diff(&base, &current)).await {
        Ok(Ok(diff)) => HttpResponse::Ok().json(serde_json::json!({
            "diff": b64::encode(&diff),
            "diff_bytes": diff.len(),
        })),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn collab_room_stats(room_mgr: web::Data<collab::RoomManager>) -> impl Responder {
    HttpResponse::Ok().json(room_mgr.stats())
}

pub async fn collab_analyze_state(body: web::Json<CollabCompactReq>) -> impl Responder {
    let state = match b64::decode(&body.state) {
        Ok(s) => s,
        Err(e) => return error::bad_request(e),
    };
    error::block_ok(web::block(move || collab::crdt::analyze_state(&state)).await)
}

pub async fn collab_batch_merge(body: web::Json<CollabBatchMergeReq>) -> impl Responder {
    let states: Result<Vec<Vec<u8>>, _> = body.states.iter().map(|s| b64::decode(s)).collect();
    let states = match states {
        Ok(s) => s,
        Err(e) => return error::bad_request(e),
    };
    let chunk_size = body.chunk_size.unwrap_or(4);
    match web::block(move || collab::crdt::batch_merge(states, chunk_size)).await {
        Ok(Ok(merged)) => HttpResponse::Ok().json(serde_json::json!({
            "merged_state": b64::encode(&merged),
            "size_bytes": merged.len(),
        })),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}
