use actix_web::{web, HttpResponse, Responder};
use serde::Deserialize;

use super::error;
use crate::verify;

#[derive(Deserialize)]
pub struct VerifySigReq {
    pub chain: String,
    pub address: String,
    pub message: String,
    pub signature: String,
}

pub async fn verify_signature(body: web::Json<VerifySigReq>) -> impl Responder {
    let chain = match body.chain.to_uppercase().as_str() {
        "ETH" | "ETHEREUM" => verify::WalletChain::Eth,
        "BTC" | "BITCOIN" => verify::WalletChain::Btc,
        "SOL" | "SOLANA" => verify::WalletChain::Sol,
        _ => return error::bad_request("unsupported chain"),
    };

    let address = body.address.clone();
    let message = body.message.clone();
    let signature = body.signature.clone();

    match web::block(move || verify::verify_signature(chain, &address, &message, &signature)).await
    {
        Ok(result) => HttpResponse::Ok().json(result),
        Err(e) => error::internal_error(e),
    }
}
