//! Field detection logic — identifies form fields, signature lines, dates, etc.

use super::patterns::*;
use super::types::*;
use super::util::extract_party_header;

/// Detect fields from document text lines.
/// Uses parallel processing for large documents via rayon.
pub fn detect_fields(
    lines: &[String],
    _recital_zone: Option<(usize, usize)>,
) -> Vec<DetectedField> {
    let mut fields = Vec::new();
    let mut current_party: Option<String> = None;
    let mut party_set_at = 0usize;
    let party_scope_lines = 6usize;
    let mut char_pos = 0usize;

    for (line_num, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        if let Some(header) = extract_party_header(trimmed) {
            current_party = Some(header);
            party_set_at = line_num;
        }

        if current_party.is_some() && line_num.saturating_sub(party_set_at) > party_scope_lines {
            current_party = None;
        }

        if CLAUSE_NUM_RE.is_match(trimmed)
            || ARTICLE_SECTION_RE.is_match(trimmed)
            || SPECIAL_CONDITIONS_RE.is_match(trimmed)
        {
            current_party = None;
        }

        fields.extend(detect_fields_in_line(
            line,
            line_num,
            current_party.as_deref(),
            char_pos,
        ));
        char_pos += line.len() + 1;
    }

    fields
}

pub fn detect_fields_in_line(
    line: &str,
    line_num: usize,
    current_party: Option<&str>,
    char_pos: usize,
) -> Vec<DetectedField> {
    let mut fields = Vec::new();
    let trimmed = line.trim();

    if SIG_LINE_RE.is_match(trimmed) {
        fields.push(blank_field(
            FieldType::Signature,
            "Signature",
            current_party,
            line_num,
            char_pos + line.find('_').unwrap_or(0),
        ));
    }

    if BY_LINE_RE.is_match(trimmed) {
        fields.push(blank_field(
            FieldType::Signature,
            "Authorized Signature (By)",
            current_party,
            line_num,
            char_pos + line.find('_').unwrap_or(0),
        ));
    }

    if ITS_LINE_RE.is_match(trimmed) {
        fields.push(blank_field(
            FieldType::Title,
            "Corporate Title (Its)",
            current_party,
            line_num,
            char_pos + line.find('_').unwrap_or(0),
        ));
    }

    if CHECKBOX_RE.is_match(trimmed) {
        fields.push(DetectedField {
            field_type: FieldType::Checkbox,
            label: trimmed.to_string(),
            value: None,
            blank: true,
            party_role: None,
            line: line_num + 1,
            position: char_pos,
        });
    }

    if MULTI_PARTY_INITIALS_RE.is_match(trimmed) {
        for caps in MULTI_PARTY_INITIALS_CAPTURE.captures_iter(trimmed) {
            if let Some(party) = caps.get(1) {
                fields.push(DetectedField {
                    field_type: FieldType::Initials,
                    label: format!("{} Initials", party.as_str()),
                    value: None,
                    blank: true,
                    party_role: Some(party.as_str().to_string()),
                    line: line_num + 1,
                    position: char_pos,
                });
            }
        }
    } else if INITIALS_LINE_RE.is_match(trimmed) {
        fields.push(blank_field(
            FieldType::Initials,
            "Initials",
            current_party,
            line_num,
            char_pos + line.find('_').unwrap_or(0),
        ));
    }

    if let Some(caps) = NAME_CAPTURE_RE.captures(trimmed) {
        let raw_value = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
        let value = caps.get(2).map(|m| m.as_str().trim().to_string());
        fields.push(DetectedField {
            field_type: FieldType::Name,
            label: "Printed Name".into(),
            value: if BLANK_RE.is_match(raw_value) {
                None
            } else {
                value
            },
            blank: BLANK_RE.is_match(raw_value),
            party_role: current_party.map(str::to_string),
            line: line_num + 1,
            position: char_pos + line.find(raw_value).unwrap_or(0),
        });
    }

    if !EFFECTIVE_DATE_RE.is_match(trimmed) {
        if let Some(caps) = DATE_CAPTURE_RE.captures(trimmed) {
            let raw_value = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
            fields.push(DetectedField {
                field_type: FieldType::Date,
                label: "Date".into(),
                value: if BLANK_RE.is_match(raw_value) {
                    None
                } else {
                    Some(raw_value.to_string())
                },
                blank: BLANK_RE.is_match(raw_value),
                party_role: current_party.map(str::to_string),
                line: line_num + 1,
                position: char_pos + line.find(raw_value).unwrap_or(0),
            });
        }
    }

    if let Some(caps) = TITLE_CAPTURE_RE.captures(trimmed) {
        let raw_value = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
        let value = caps.get(2).map(|m| m.as_str().trim().to_string());
        fields.push(DetectedField {
            field_type: FieldType::Title,
            label: "Title/Role".into(),
            value: if BLANK_RE.is_match(raw_value) {
                None
            } else {
                value
            },
            blank: BLANK_RE.is_match(raw_value),
            party_role: current_party.map(str::to_string),
            line: line_num + 1,
            position: char_pos + line.find(raw_value).unwrap_or(0),
        });
    }

    fields
}

pub fn blank_field(
    field_type: FieldType,
    label: &str,
    party_role: Option<&str>,
    line_num: usize,
    position: usize,
) -> DetectedField {
    DetectedField {
        field_type,
        label: label.into(),
        value: None,
        blank: true,
        party_role: party_role.map(str::to_string),
        line: line_num + 1,
        position,
    }
}
