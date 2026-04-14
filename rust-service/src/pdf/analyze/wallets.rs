//! Wallet address detection — finds ETH, BTC, and SOL addresses in document text.

use std::collections::HashSet;

use once_cell::sync::Lazy;
use regex::Regex;

use crate::util::patterns::{BTC_ADDR_RE, ETH_ADDR_RE};

use super::types::DetectedAddress;

pub fn find_wallet_addresses(text: &str) -> Vec<DetectedAddress> {
    let mut addresses = Vec::new();
    let mut seen = HashSet::new();

    let mut add_address = |address: &str, chain: &str, index: usize| {
        let seen_key = if chain == "ETH" {
            address.to_lowercase()
        } else {
            address.to_string()
        };
        if seen.insert(seen_key) {
            let after_window = if chain == "BTC" { 101 } else { 100 };
            addresses.push(DetectedAddress {
                address: address.to_string(),
                chain: chain.to_string(),
                context: get_context(text, index, after_window),
            });
        }
    };

    static LABELED_WALLET_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(
            r"(?im)\b(?:wallet|eth(?:ereum)?|btc|bitcoin|sol(?:ana)?|receiving|payment|treasury|deposit|payout|public|send\s*to|receive\s*at)\s*(?:address|addr\.?|wallet|key)?\s*:\s*([a-zA-Z0-9]{20,})",
        )
        .unwrap()
    });

    for caps in LABELED_WALLET_RE.captures_iter(text) {
        let Some(full_match) = caps.get(0) else {
            continue;
        };
        let Some(address_match) = caps.get(1) else {
            continue;
        };
        let address = address_match.as_str();
        if ETH_ADDR_RE.is_match(address) {
            add_address(address, "ETH", full_match.start());
        } else if BTC_ADDR_RE.is_match(address) {
            add_address(address, "BTC", full_match.start());
        }
    }

    for m in ETH_ADDR_RE.find_iter(text) {
        let addr = m.as_str();
        add_address(addr, "ETH", m.start());
    }

    for m in BTC_ADDR_RE.find_iter(text) {
        let addr = m.as_str();
        if addr.starts_with("bc1") || addr.starts_with('1') || addr.starts_with('3') {
            add_address(addr, "BTC", m.start());
        }
    }

    addresses
}

pub fn get_context(text: &str, index: usize, after_window: usize) -> String {
    let start = index.saturating_sub(200);
    let end = (index + after_window).min(text.len());
    let mut context = text[start..end]
        .replace('\n', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if start > 0 {
        context = format!("...{context}");
    }
    if end < text.len() {
        context.push_str("...");
    }
    context
}
