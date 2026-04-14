//! PDF endpoints — analysis, generation, and editing.

use actix_web::{web, HttpResponse, Responder};
use base64::Engine;

use super::error;
use crate::pdf;

pub async fn analyze_pdf(body: web::Bytes) -> impl Responder {
    let bytes = body.to_vec();
    let result = web::block(move || pdf::analyze_pdf(&bytes)).await;

    match result {
        Ok(Ok(analysis)) => HttpResponse::Ok().json(analysis),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn generate_pdf(body: web::Json<pdf::PdfGenerateRequest>) -> impl Responder {
    let req = body.into_inner();
    let result = web::block(move || pdf::generate_signed_pdf(&req)).await;

    match result {
        Ok(Ok(pdf_bytes)) => HttpResponse::Ok()
            .content_type("application/pdf")
            .body(pdf_bytes),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn fill_fields(body: web::Json<pdf::FillFieldsRequest>) -> impl Responder {
    let req = body.into_inner();
    let result = web::block(move || {
        let pdf_bytes = base64::engine::general_purpose::STANDARD
            .decode(&req.pdf_base64)
            .map_err(|e| anyhow::anyhow!("Invalid base64: {e}"))?;
        pdf::fill_pdf_fields(&pdf_bytes, &req.field_values, req.flatten_after)
    })
    .await;

    match result {
        Ok(Ok(edit_result)) => HttpResponse::Ok().json(edit_result),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn create_template(body: web::Json<pdf::CreateTemplateRequest>) -> impl Responder {
    let req = body.into_inner();
    let result = web::block(move || {
        let pdf_bytes = base64::engine::general_purpose::STANDARD
            .decode(&req.pdf_base64)
            .map_err(|e| anyhow::anyhow!("Invalid base64: {e}"))?;
        pdf::create_blank_template(&pdf_bytes, &req.fields_to_clear)
    })
    .await;

    match result {
        Ok(Ok(edit_result)) => HttpResponse::Ok().json(edit_result),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}

pub async fn flatten(body: web::Json<pdf::FlattenRequest>) -> impl Responder {
    let req = body.into_inner();
    let result = web::block(move || {
        let pdf_bytes = base64::engine::general_purpose::STANDARD
            .decode(&req.pdf_base64)
            .map_err(|e| anyhow::anyhow!("Invalid base64: {e}"))?;
        pdf::flatten_pdf(&pdf_bytes)
    })
    .await;

    match result {
        Ok(Ok(edit_result)) => HttpResponse::Ok().json(edit_result),
        Ok(Err(e)) => error::internal_error(e),
        Err(e) => error::internal_error(e),
    }
}
