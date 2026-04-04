//! Unified API error response helpers.

use actix_web::HttpResponse;

/// Return a 500 Internal Server Error with a JSON error message.
pub fn internal_error(e: impl std::fmt::Display) -> HttpResponse {
    HttpResponse::InternalServerError()
        .json(serde_json::json!({ "error": e.to_string() }))
}

/// Return a 400 Bad Request with a JSON error message.
pub fn bad_request(msg: impl std::fmt::Display) -> HttpResponse {
    HttpResponse::BadRequest()
        .json(serde_json::json!({ "error": msg.to_string() }))
}
