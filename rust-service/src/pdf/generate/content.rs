//! Document tokenization and content-to-segment parsing.

use std::collections::{HashMap, HashSet};

use super::fields::{format_field_value, guess_field_type};
use super::theme::*;
use super::types::*;

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

pub(super) fn is_image_data_url(value: &str) -> bool {
    IMAGE_DATA_URL_RE.is_match(value.trim())
}

pub(super) fn is_signature_placeholder_value(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "signed" | "(user signed this)" | "user signed this"
    )
}

pub(super) fn resolve_signature_display_value(raw_value: &str, fallback_signature_data: Option<&str>) -> String {
    if is_image_data_url(raw_value) {
        return raw_value.to_string();
    }
    if let Some(fallback) = fallback_signature_data {
        if is_signature_placeholder_value(raw_value) {
            return fallback.to_string();
        }
    }
    raw_value.to_string()
}

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut idx = 0usize;
    while idx < bytes.len() {
        if bytes[idx] == b'%' && idx + 2 < bytes.len() {
            let hi = (bytes[idx + 1] as char).to_digit(16)?;
            let lo = (bytes[idx + 2] as char).to_digit(16)?;
            out.push((hi * 16 + lo) as u8);
            idx += 3;
        } else {
            out.push(bytes[idx]);
            idx += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn decode_marker_payload<T: serde::de::DeserializeOwned>(payload: &str) -> Option<T> {
    let decoded = percent_decode(payload)?;
    serde_json::from_str::<T>(&decoded).ok()
}

fn clamp_signer_idx(raw: Option<i64>, signer_count: usize, fallback: usize) -> usize {
    if signer_count == 0 {
        return 0;
    }
    match raw {
        Some(value) if value >= 0 => (value as usize).min(signer_count.saturating_sub(1)),
        _ => fallback.min(signer_count.saturating_sub(1)),
    }
}

fn string_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(text) if text.is_empty() => None,
        serde_json::Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Canonical line parsing
// ══════════════════════════════════════════════════════════════════════════════

pub(super) fn parse_canonical_line(
    line: &str,
    signer_count: usize,
    field_counter: &mut usize,
    current_signer_guess: usize,
    fields: &mut Vec<InlineFieldDef>,
) -> Option<Vec<DocToken>> {
    if !MARKER_RE.is_match(line) {
        return None;
    }

    if line.trim().starts_with("{{W3S_SIGNATURE:") && line.trim().ends_with("}}") && line.trim() == line {
        if let Some(captures) = SIGNATURE_MARKER_EXACT_RE.captures(line.trim()) {
            let payload = decode_marker_payload::<SignatureMarkerPayload>(captures.get(1)?.as_str())?;
            return Some(vec![DocToken::SignatureBlock {
                label: payload.label.unwrap_or_else(|| "Signature".to_string()),
                signer_idx: clamp_signer_idx(payload.signer_idx, signer_count, current_signer_guess),
            }]);
        }
    }

    let mut tokens = Vec::new();
    let mut last_index = 0usize;

    for captures in MARKER_RE.captures_iter(line) {
        let whole = captures.get(0)?;
        if whole.start() > last_index {
            tokens.push(DocToken::Text(line[last_index..whole.start()].to_string()));
        }

        match captures.get(1)?.as_str() {
            "FIELD" => {
                let payload = decode_marker_payload::<FieldMarkerPayload>(captures.get(2)?.as_str())?;
                let fallback_id = format!("field-{}", *field_counter);
                *field_counter += 1;
                let field = InlineFieldDef {
                    id: payload.id.unwrap_or(fallback_id),
                    field_type: payload.field_type.unwrap_or_else(|| "free-text".to_string()),
                    label: payload.label.unwrap_or_else(|| "Field".to_string()),
                };
                fields.push(field.clone());
                tokens.push(DocToken::Field(field));
            }
            "SIGNATURE" => {
                let payload = decode_marker_payload::<SignatureMarkerPayload>(captures.get(2)?.as_str())?;
                tokens.push(DocToken::SignatureBlock {
                    label: payload.label.unwrap_or_else(|| "Signature".to_string()),
                    signer_idx: clamp_signer_idx(payload.signer_idx, signer_count, current_signer_guess),
                });
            }
            _ => {}
        }

        last_index = whole.end();
    }

    if last_index < line.len() {
        tokens.push(DocToken::Text(line[last_index..].to_string()));
    }

    Some(tokens)
}

// ══════════════════════════════════════════════════════════════════════════════
// Inline field processing
// ══════════════════════════════════════════════════════════════════════════════

pub(super) fn process_inline_fields(
    line: &str,
    field_counter: &mut usize,
    fields: &mut Vec<InlineFieldDef>,
    prev_line: &str,
) -> Vec<DocToken> {
    let mut tokens = Vec::new();
    let mut last_idx = 0usize;

    for captures in INLINE_FIELD_RE.captures_iter(line) {
        let whole = match captures.get(0) {
            Some(value) => value,
            None => continue,
        };

        if whole.start() > last_idx {
            tokens.push(DocToken::Text(line[last_idx..whole.start()].to_string()));
        }

        let raw_label = captures.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
        let text_before_blank = &line[..whole.start()];
        let full_context = format!("{prev_line} {text_before_blank} {raw_label}");
        let field_type = guess_field_type(&raw_label, &full_context);

        let label = if !raw_label.is_empty() {
            raw_label
        } else {
            let context_words = text_before_blank
                .trim()
                .split_whitespace()
                .rev()
                .take(3)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join(" ");
            if !context_words.is_empty() && field_type != "other" {
                let mut chars = field_type.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => "Field".to_string(),
                }
            } else if context_words.len() > 2 {
                context_words
            } else if field_type != "other" {
                let mut chars = field_type.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => "Field".to_string(),
                }
            } else {
                "Field".to_string()
            }
        };

        let field = InlineFieldDef {
            id: format!("field-{}", *field_counter),
            field_type,
            label,
        };
        *field_counter += 1;
        fields.push(field.clone());
        tokens.push(DocToken::Field(field));
        last_idx = whole.end();
    }

    if last_idx == 0 {
        tokens.push(DocToken::Text(line.to_string()));
    } else if last_idx < line.len() {
        tokens.push(DocToken::Text(line[last_idx..].to_string()));
    }

    tokens
}

// ══════════════════════════════════════════════════════════════════════════════
// Document tokenization
// ══════════════════════════════════════════════════════════════════════════════

pub(super) fn tokenize_document(content: &str, signer_count: usize) -> (Vec<DocToken>, Vec<InlineFieldDef>) {
    let mut tokens = Vec::new();
    let mut fields = Vec::new();
    let mut field_counter = 0usize;
    let mut current_signer_guess = 0usize;
    let mut prev_line_text = String::new();

    for raw_line in content.split('\n') {
        let line = raw_line.trim();
        if line.is_empty() {
            tokens.push(DocToken::Break);
            continue;
        }
        if PAGE_NUM_RE.is_match(line) {
            continue;
        }

        if let Some(canonical_tokens) = parse_canonical_line(
            line,
            signer_count,
            &mut field_counter,
            current_signer_guess,
            &mut fields,
        ) {
            tokens.extend(canonical_tokens);
            prev_line_text = line.to_string();
            continue;
        }

        if let Some(captures) = PARTY_ALPHA_RE.captures(line) {
            if let Some(letter) = captures.get(1) {
                let upper = letter.as_str().chars().next().unwrap_or('A').to_ascii_uppercase();
                current_signer_guess = (upper as usize).saturating_sub('A' as usize);
            }
        }
        let line_lower = line.to_ascii_lowercase();
        if (line_lower.contains("disclos")
            || line_lower.contains("first")
            || line_lower.contains("landlord")
            || line_lower.contains("lessor")
            || line_lower.contains("seller")
            || line_lower.contains("employer")
            || line_lower.contains("licensor"))
            && (line_lower.contains("party") || line_lower.contains("information"))
        {
            current_signer_guess = 0;
        }
        if (line_lower.contains("receiv")
            || line_lower.contains("second")
            || line_lower.contains("tenant")
            || line_lower.contains("lessee")
            || line_lower.contains("buyer")
            || line_lower.contains("employee")
            || line_lower.contains("licensee"))
            && (line_lower.contains("party") || line_lower.contains("information"))
        {
            current_signer_guess = 1.min(signer_count.saturating_sub(1));
        }

        if NUMBERED_HEADING_RE.is_match(line) || (SECTION_HEADING_RE.is_match(line) && line.len() < 100) {
            tokens.push(DocToken::Heading(line.to_string()));
            prev_line_text = line.to_string();
            continue;
        }
        if SUBHEADING_RE.is_match(line) {
            tokens.push(DocToken::Subheading(line.to_string()));
            prev_line_text = line.to_string();
            continue;
        }
        if line == line.to_ascii_uppercase() && line.len() > 3 && line.len() < 60 && ALL_CAPS_HEADING_RE.is_match(line) {
            tokens.push(DocToken::Subheading(line.to_string()));
            prev_line_text = line.to_string();
            continue;
        }
        if LIST_ITEM_RE.is_match(line) {
            tokens.push(DocToken::ListItem(line.to_string()));
            prev_line_text = line.to_string();
            continue;
        }
        if SIGNATURE_LINE_RE.is_match(line) && UNDERSCORE_RE.is_match(line) {
            let label = line
                .split("signature")
                .next()
                .map(|value| value.trim().trim_end_matches(':').trim())
                .filter(|value| !value.is_empty())
                .unwrap_or("Signature")
                .to_string();
            tokens.push(DocToken::SignatureBlock {
                label,
                signer_idx: current_signer_guess.min(signer_count.saturating_sub(1)),
            });
            prev_line_text = line.to_string();
            continue;
        }

        tokens.extend(process_inline_fields(
            line,
            &mut field_counter,
            &mut fields,
            &prev_line_text,
        ));
        prev_line_text = line.to_string();
    }

    (tokens, fields)
}

// ══════════════════════════════════════════════════════════════════════════════
// Content to segments
// ══════════════════════════════════════════════════════════════════════════════

pub(super) fn parse_content_to_segments(content: &str, signers: &[SignerInfo]) -> (Vec<Vec<ContentSegment>>, Vec<FieldSummaryEntry>) {
    let mut vals = HashMap::<String, FieldValueEntry>::new();
    for signer in signers {
        if let Some(serde_json::Value::Object(field_values)) = &signer.field_values {
            for (field_id, raw_value) in field_values {
                if let Some(value) = string_value(raw_value) {
                    vals.insert(
                        field_id.clone(),
                        FieldValueEntry {
                            value,
                            signer: signer.label.clone(),
                            hand_signature_data: signer.hand_signature_data.clone(),
                        },
                    );
                }
            }
        }
    }

    let signer_count = signers.len().max(1);
    let (tokens, token_fields) = tokenize_document(content, signer_count);
    let field_by_id = token_fields
        .into_iter()
        .map(|field| (field.id.clone(), field))
        .collect::<HashMap<_, _>>();

    let mut matched_ids = HashSet::<String>::new();
    let mut field_summary = Vec::<FieldSummaryEntry>::new();
    let mut result = Vec::<Vec<ContentSegment>>::new();
    let mut current_line = Vec::<ContentSegment>::new();

    let flush_line = |result: &mut Vec<Vec<ContentSegment>>, current_line: &mut Vec<ContentSegment>| {
        result.push(std::mem::take(current_line));
    };

    let ensure_gap = |current_line: &mut Vec<ContentSegment>| {
        if current_line.is_empty() {
            return;
        }
        match current_line.last_mut() {
            Some(ContentSegment::Text { text }) => {
                if !text.ends_with(' ') && !text.ends_with('\t') {
                    text.push(' ');
                }
            }
            _ => current_line.push(ContentSegment::Text { text: " ".to_string() }),
        }
    };

    for token in tokens {
        match token {
            DocToken::Heading(text) | DocToken::Subheading(text) => {
                if !current_line.is_empty() {
                    flush_line(&mut result, &mut current_line);
                }
                result.push(vec![ContentSegment::Text { text }]);
            }
            DocToken::Text(text) => {
                if !current_line.is_empty() && !text.is_empty() && !text.chars().next().unwrap_or(' ').is_whitespace() {
                    ensure_gap(&mut current_line);
                }
                current_line.push(ContentSegment::Text { text });
            }
            DocToken::Field(field) => {
                if !current_line.is_empty() {
                    ensure_gap(&mut current_line);
                }
                if let Some(entry) = vals.get(&field.id) {
                    matched_ids.insert(field.id.clone());
                    let resolved_value = if field.field_type == "signature" {
                        resolve_signature_display_value(&entry.value, entry.hand_signature_data.as_deref())
                    } else {
                        entry.value.clone()
                    };
                    let display_value = format_field_value(&entry.value, &field.field_type, entry.hand_signature_data.as_deref());
                    field_summary.push(FieldSummaryEntry {
                        label: field.label.clone(),
                        value: display_value,
                        signer: entry.signer.clone(),
                        field_type: field.field_type.clone(),
                        field_id: field.id.clone(),
                    });
                    current_line.push(ContentSegment::Field {
                        label: field.label,
                        value: resolved_value,
                        filled: true,
                        field_type: field.field_type,
                    });
                } else {
                    current_line.push(ContentSegment::Field {
                        label: field.label,
                        value: String::new(),
                        filled: false,
                        field_type: field.field_type,
                    });
                }
            }
            DocToken::SignatureBlock { label, signer_idx } => {
                if !current_line.is_empty() {
                    flush_line(&mut result, &mut current_line);
                }
                if let Some(signer) = signers.get(signer_idx) {
                    if signer.status == "SIGNED" {
                        let value = if signer
                            .hand_signature_data
                            .as_deref()
                            .is_some_and(is_image_data_url)
                        {
                            signer.hand_signature_data.clone().unwrap_or_default()
                        } else {
                            format!("Signed by {}", signer.label)
                        };
                        result.push(vec![ContentSegment::Field {
                            label,
                            value,
                            filled: true,
                            field_type: "signature".to_string(),
                        }]);
                    } else {
                        result.push(vec![ContentSegment::Field {
                            label,
                            value: String::new(),
                            filled: false,
                            field_type: "signature".to_string(),
                        }]);
                    }
                } else {
                    result.push(vec![ContentSegment::Field {
                        label,
                        value: String::new(),
                        filled: false,
                        field_type: "signature".to_string(),
                    }]);
                }
            }
            DocToken::ListItem(text) => {
                if !current_line.is_empty() {
                    flush_line(&mut result, &mut current_line);
                }
                result.push(vec![ContentSegment::Text { text }]);
            }
            DocToken::Break => {
                if !current_line.is_empty() {
                    flush_line(&mut result, &mut current_line);
                }
                result.push(Vec::new());
            }
        }
    }

    if !current_line.is_empty() {
        result.push(current_line);
    }

    for (field_id, entry) in vals {
        if matched_ids.contains(&field_id) {
            continue;
        }
        let field = field_by_id.get(&field_id);
        let field_type = field
            .map(|value| value.field_type.as_str())
            .unwrap_or("other");
        field_summary.push(FieldSummaryEntry {
            label: field.map(|value| value.label.clone()).unwrap_or_else(|| field_id.clone()),
            value: format_field_value(&entry.value, field_type, entry.hand_signature_data.as_deref()),
            signer: entry.signer,
            field_type: field_type.to_string(),
            field_id,
        });
    }

    (result, field_summary)
}
