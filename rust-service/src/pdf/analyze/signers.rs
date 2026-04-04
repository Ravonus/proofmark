//! Signature block detection, signer inference, and merge/dedup logic.

use std::collections::{HashMap, HashSet};

use super::patterns::*;
use super::types::*;
use super::util::{
    extract_named_party_info, extract_party_header, find_excluded_zone_lines, is_boilerplate_line,
};

pub fn find_witness_whereof_line(lines: &[String]) -> Option<usize> {
    for (i, line) in lines.iter().enumerate().rev() {
        if SIGNATURE_HEADING_RE.is_match(line.trim()) {
            return Some(i);
        }
    }
    None
}

pub fn detect_signature_blocks(
    lines: &[String],
    fields: &[DetectedField],
    _witness_idx: Option<usize>,
) -> Vec<SignatureBlock> {
    let excluded = find_excluded_zone_lines(lines);

    let mut raw_blocks = Vec::new();

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        let Some(header) = extract_party_header(trimmed) else {
            continue;
        };
        if excluded.contains(&idx) {
            continue;
        }

        let named_info = extract_named_party_info(trimmed);
        let mut block_fields = Vec::new();

        for next_idx in (idx + 1)..(idx + 9).min(lines.len()) {
            let next_line = lines[next_idx].trim();
            if extract_party_header(next_line).is_some() {
                break;
            }
            if MULTI_PARTY_INITIALS_RE.is_match(next_line) || is_boilerplate_line(next_line) {
                continue;
            }
            block_fields.extend(
                fields
                    .iter()
                    .filter(|field| field.line == next_idx + 1)
                    .cloned(),
            );
        }

        block_fields.extend(
            fields
                .iter()
                .filter(|field| field.line == idx + 1)
                .cloned(),
        );

        if block_fields
            .iter()
            .any(|field| matches!(field.field_type, FieldType::Signature | FieldType::Initials))
        {
            let cloned_fields = block_fields
                .into_iter()
                .map(|mut field| {
                    field.party_role = Some(header.clone());
                    field
                })
                .collect::<Vec<_>>();

            raw_blocks.push(SignatureBlock {
                party_role: header.clone(),
                party_label: named_info
                    .map(|(entity, role)| format!("{entity} ({role})"))
                    .unwrap_or_else(|| trimmed.to_string()),
                signer_index: 0,
                fields: cloned_fields,
                line: idx + 1,
            });
        }
    }

    let mut deduped: HashMap<String, SignatureBlock> = HashMap::new();
    for block in raw_blocks {
        let key = block.party_role.to_lowercase();
        match deduped.get_mut(&key) {
            Some(existing) => {
                let mut field_keys = existing
                    .fields
                    .iter()
                    .map(|field| format!("{:?}:{}", field.field_type, field.label))
                    .collect::<HashSet<_>>();
                for field in block.fields {
                    let field_key = format!("{:?}:{}", field.field_type, field.label);
                    if field_keys.insert(field_key) {
                        existing.fields.push(field);
                    }
                }
                if block.party_label.contains('(') && !existing.party_label.contains('(') {
                    existing.party_label = block.party_label;
                }
            }
            None => {
                deduped.insert(key, block);
            }
        }
    }

    let mut blocks = deduped.into_values().collect::<Vec<_>>();
    blocks.sort_by(|a, b| a.line.cmp(&b.line).then(a.party_label.cmp(&b.party_label)));
    for (idx, block) in blocks.iter_mut().enumerate() {
        block.signer_index = idx;
    }
    blocks
}

pub fn estimate_signer_count(text: &str, lines: &[String]) -> usize {
    // Count unique party roles mentioned
    let mut roles = HashSet::new();
    for m in PARTY_ROLES_RE.find_iter(text) {
        roles.insert(m.as_str().to_lowercase());
    }

    // Count signature lines
    let sig_lines = lines
        .iter()
        .filter(|l| {
            let t = l.trim().to_lowercase();
            t.contains("signature") && BLANK_RE.is_match(l)
        })
        .count();

    roles.len().max(sig_lines).max(2)
}

pub fn deduplicate_fields(fields: Vec<DetectedField>) -> Vec<DetectedField> {
    let mut seen = HashSet::new();
    let mut result = Vec::with_capacity(fields.len());

    for field in fields {
        let key = format!("{}:{:?}:{}", field.line, field.field_type, field.label);
        if seen.insert(key) {
            result.push(field);
        }
    }

    result
}

pub fn build_signer_list(
    signature_blocks: &[SignatureBlock],
    addresses: &[DetectedAddress],
    fields: &[DetectedField],
) -> Vec<DetectedSigner> {
    let mut signers = Vec::new();

    for block in signature_blocks {
        signers.push(DetectedSigner {
            label: block.party_label.clone(),
            role: Some(block.party_role.clone()),
            address: None,
            mailing_address: None,
            chain: None,
            confidence: "medium".into(),
            source: "signature block".into(),
            fields: dedupe_fields_by_type(&block.fields),
            signature_block: Some(block.clone()),
        });
    }

    if signers.is_empty() {
        let mut roles = Vec::new();
        for field in fields.iter().filter(|field| {
            field.blank
                && matches!(field.field_type, FieldType::Name | FieldType::Signature)
                && field.party_role.is_some()
        }) {
            if let Some(role) = &field.party_role {
                if !roles.contains(role) {
                    roles.push(role.clone());
                }
            }
        }
        for role in roles {
            let role_fields = fields
                .iter()
                .filter(|field| field.party_role.as_deref() == Some(role.as_str()))
                .cloned()
                .collect::<Vec<_>>();
            signers.push(DetectedSigner {
                label: role.clone(),
                role: Some(role),
                address: None,
                mailing_address: None,
                chain: None,
                confidence: "low".into(),
                source: "field analysis".into(),
                fields: dedupe_fields_by_type(&role_fields),
                signature_block: None,
            });
        }
    }

    for address in addresses {
        if signers
            .iter()
            .any(|signer| signer.address.as_deref() == Some(address.address.as_str()))
        {
            continue;
        }
        signers.push(DetectedSigner {
            label: format!("Wallet ({})", address.chain),
            role: None,
            address: Some(address.address.clone()),
            mailing_address: None,
            chain: Some(address.chain.clone()),
            confidence: "low".into(),
            source: "address detection".into(),
            fields: Vec::new(),
            signature_block: None,
        });
    }

    signers
}

fn dedupe_fields_by_type(fields: &[DetectedField]) -> Vec<DetectedField> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();

    for field in fields {
        let key = format!("{:?}:{}", field.field_type, field.label);
        if seen.insert(key) {
            deduped.push(field.clone());
        }
    }

    deduped
}
