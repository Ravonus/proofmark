//! Multi-chain signature verification: EVM (EIP-191), Bitcoin (ECDSA + BIP-322), Solana (Ed25519).
//!
//! Mirrors src/lib/verify.ts with identical verification logic.

mod bitcoin;
mod evm;
mod solana;

use serde::{Deserialize, Serialize};

pub use bitcoin::verify_btc_signature;
pub use evm::verify_evm_signature;
pub use solana::verify_sol_signature;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyResult {
    pub ok: bool,
    pub scheme: String,
    pub debug: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum WalletChain {
    Eth,
    Btc,
    Sol,
}

/// Verify a signature for any supported chain.
pub fn verify_signature(
    chain: WalletChain,
    address: &str,
    message: &str,
    signature: &str,
) -> VerifyResult {
    match chain {
        WalletChain::Eth => verify_evm_signature(address, message, signature),
        WalletChain::Btc => verify_btc_signature(address, message, signature),
        WalletChain::Sol => verify_sol_signature(address, message, signature),
    }
}
