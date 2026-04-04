//! PDF endpoints — analysis and generation.

use actix_web::{web, HttpResponse, Responder};

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
