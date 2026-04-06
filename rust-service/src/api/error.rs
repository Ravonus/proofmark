use actix_web::HttpResponse;

pub fn internal_error(e: impl std::fmt::Display) -> HttpResponse {
    HttpResponse::InternalServerError()
        .json(serde_json::json!({ "error": e.to_string() }))
}

pub fn bad_request(msg: impl std::fmt::Display) -> HttpResponse {
    HttpResponse::BadRequest()
        .json(serde_json::json!({ "error": msg.to_string() }))
}

/// Unwrap the `web::block(|| ...)` double-Result into a JSON response.
pub fn block_ok<T: serde::Serialize>(
    result: Result<Result<T, impl std::fmt::Display>, actix_web::error::BlockingError>,
) -> HttpResponse {
    match result {
        Ok(Ok(val)) => HttpResponse::Ok().json(val),
        Ok(Err(e)) => internal_error(e),
        Err(e) => internal_error(e),
    }
}
