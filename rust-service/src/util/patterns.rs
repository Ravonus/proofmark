//! Shared compiled regex patterns — single source of truth for crypto address
//! and date detection patterns used across pdf/analyze, index/privacy, and
//! index/scanner modules.

use once_cell::sync::Lazy;
use regex::Regex;

// ── Crypto address patterns ─────────────────────────────────────────────────────

/// Ethereum (EVM) address: 0x followed by 40 hex characters.
pub static ETH_ADDR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b0x[0-9a-fA-F]{40}\b").unwrap());

/// Bitcoin address: bech32 (bc1...) or legacy (1.../3...).
pub static BTC_ADDR_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(?:bc1[a-zA-HJ-NP-Z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b").unwrap()
});

/// Solana address: base58 string 32-44 characters.
pub static SOL_ADDR_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b[1-9A-HJ-NP-Za-km-z]{32,44}\b").unwrap());

// ── Date patterns ───────────────────────────────────────────────────────────────

/// ISO date: YYYY-MM-DD or YYYY/MM/DD.
pub static DATE_ISO_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\b(\d{4}[-/]\d{2}[-/]\d{2})\b").unwrap());

/// Written date: "January 31, 2024" style.
pub static DATE_WRITTEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})").unwrap()
});
