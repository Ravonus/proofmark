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

/// Handle the common web::block result pattern: Ok(Ok(T)) -> json, Ok(Err)/Err -> error.
pub fn block_ok<T: serde::Serialize>(
    result: Result<Result<T, impl std::fmt::Display>, actix_web::error::BlockingError>,
) -> HttpResponse {
    match result {
        Ok(Ok(val)) => HttpResponse::Ok().json(val),
        Ok(Err(e)) => internal_error(e),
        Err(e) => internal_error(e),
    }
}
