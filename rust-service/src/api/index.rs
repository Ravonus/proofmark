//! Index endpoints — document indexing, search, privacy scanning, queue management.

use std::sync::Arc;

use actix_web::{web, HttpResponse, Responder};

use super::error;
use super::types::*;
use crate::index;

pub async fn index_document(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<index::IndexRequest>,
) -> impl Responder {
    let req = body.into_inner();
    let engine = engine.get_ref().clone();

    match web::block(move || engine.index_document(&req)).await {
        Ok(Ok(result)) => HttpResponse::Ok().json(result),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn remove_document(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<RemoveDocReq>,
) -> impl Responder {
    let doc_id = body.doc_id.clone();
    let engine = engine.get_ref().clone();

    match web::block(move || engine.remove_document(&doc_id)).await {
        Ok(Ok(())) => HttpResponse::Ok().json(serde_json::json!({ "removed": true })),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn search_index(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<index::SearchRequest>,
) -> impl Responder {
    let req = body.into_inner();
    let engine = engine.get_ref().clone();

    match web::block(move || engine.search(&req)).await {
        Ok(Ok(result)) => HttpResponse::Ok().json(result),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn autocomplete(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<AutocompleteReq>,
) -> impl Responder {
    let prefix = body.prefix.clone();
    let max = body.max_suggestions.unwrap_or(10);
    let engine = engine.get_ref().clone();

    match web::block(move || engine.autocomplete(&prefix, max)).await {
        Ok(Ok(suggestions)) => {
            HttpResponse::Ok().json(serde_json::json!({ "suggestions": suggestions }))
        }
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn scan_document(
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
    })
    .await
    {
        Ok(Ok(result)) => HttpResponse::Ok().json(result),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn privacy_scan(body: web::Json<PrivacyScanReq>) -> impl Responder {
    let text = body.text.clone();
    let result = web::block(move || index::privacy::scan_privacy(&text)).await;

    match result {
        Ok(scan) => HttpResponse::Ok().json(scan),
        Err(e) => error::internal_error(e),
    }
}

pub async fn index_stats(engine: web::Data<Arc<index::IndexEngine>>) -> impl Responder {
    HttpResponse::Ok().json(engine.index_stats())
}

pub async fn enqueue_index_job(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<EnqueueJobReq>,
) -> impl Responder {
    let job_type = match body.job_type.as_str() {
        "index_new" => index::queue::JobType::IndexNew,
        "re_index" => index::queue::JobType::ReIndex,
        "index_encrypted" => index::queue::JobType::IndexEncrypted,
        "ai_enhance" => index::queue::JobType::AiEnhance,
        "full_re_index" => index::queue::JobType::FullReIndex,
        _ => return error::bad_request("Invalid job_type"),
    };

    let engine = engine.get_ref().clone();
    let doc_id = body.doc_id.clone();
    let owner_id = body.owner_id.clone();

    match web::block(move || engine.enqueue_index(&doc_id, &owner_id, job_type)).await {
        Ok(Ok(job_id)) => HttpResponse::Ok().json(serde_json::json!({ "job_id": job_id })),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn bulk_encrypted_import(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<BulkImportReq>,
) -> impl Responder {
    let engine = engine.get_ref().clone();
    let owner_id = body.owner_id.clone();
    let doc_ids = body.doc_ids.clone();

    match web::block(move || engine.enqueue_bulk_import(&owner_id, &doc_ids)).await {
        Ok(Ok(count)) => HttpResponse::Ok().json(serde_json::json!({ "enqueued": count })),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn queue_stats(engine: web::Data<Arc<index::IndexEngine>>) -> impl Responder {
    HttpResponse::Ok().json(engine.queue_stats())
}

pub async fn owner_queue_jobs(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<OwnerReq>,
) -> impl Responder {
    let engine = engine.get_ref().clone();
    let owner_id = body.owner_id.clone();

    match web::block(move || engine.get_owner_queue(&owner_id)).await {
        Ok(Ok(jobs)) => HttpResponse::Ok().json(serde_json::json!({ "jobs": jobs })),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn cancel_owner_queue(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<OwnerReq>,
) -> impl Responder {
    let engine = engine.get_ref().clone();
    let owner_id = body.owner_id.clone();

    match web::block(move || engine.cancel_owner_queue(&owner_id)).await {
        Ok(Ok(count)) => HttpResponse::Ok().json(serde_json::json!({ "cancelled": count })),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn ai_index_document(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<AiIndexReq>,
) -> impl Responder {
    match engine.ai_index(&body.doc_id, &body.content).await {
        Ok(result) => HttpResponse::Ok().json(result),
        Err(e) => error::internal_error(e),
    }
}

pub async fn set_ai_config(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<index::ai::AiIndexConfig>,
) -> impl Responder {
    engine.set_ai_config(body.into_inner());
    HttpResponse::Ok().json(serde_json::json!({ "updated": true }))
}

pub async fn set_encrypted_config(
    engine: web::Data<Arc<index::IndexEngine>>,
    body: web::Json<index::encrypted::EncryptedIndexConfig>,
) -> impl Responder {
    engine.set_encrypted_config(body.into_inner());
    HttpResponse::Ok().json(serde_json::json!({ "updated": true }))
}

pub async fn compact_index(engine: web::Data<Arc<index::IndexEngine>>) -> impl Responder {
    let engine = engine.get_ref().clone();
    web::block(move || {
        engine.compact();
        engine.flush()
    })
    .await
    .ok();
    HttpResponse::Ok().json(serde_json::json!({ "compacted": true }))
}
