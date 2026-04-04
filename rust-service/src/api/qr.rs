//! QR code endpoints — SVG and data URL generation.

use actix_web::{web, HttpResponse, Responder};

use super::error;
use super::types::*;
use crate::qr;

pub async fn generate_qr_svg(body: web::Json<QrReq>) -> impl Responder {
    let size = body.size.unwrap_or(200);
    match qr::generate_qr_svg(&body.text, size) {
        Ok(svg) => HttpResponse::Ok().content_type("image/svg+xml").body(svg),
        Err(e) => error::internal_error(e),
    }
}

pub async fn generate_qr_data_url(body: web::Json<QrReq>) -> impl Responder {
    let size = body.size.unwrap_or(256);
    match qr::generate_qr_data_url(&body.text, size) {
        Ok(url) => HttpResponse::Ok().json(serde_json::json!({ "data_url": url })),
        Err(e) => error::internal_error(e),
    }
}
