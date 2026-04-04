//! Utility functions — text processing, boilerplate detection, party header extraction.

use std::collections::HashSet;

use once_cell::sync::Lazy;
use regex::Regex;

use super::patterns::*;

pub fn title_case(s: &str) -> String {
    let small = [
        "a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "by", "at",
    ];

    s.split_whitespace()
        .enumerate()
        .map(|(idx, word)| {
            if word == word.to_uppercase()
                && word.len() <= 5
                && word.chars().all(|c| c.is_ascii_uppercase())
            {
                return word.to_string();
            }
            if PARENS_UPPERCASE_RE.is_match(word) {
                return word.to_string();
            }

            let lower = word.to_lowercase();
            if idx > 0 && small.contains(&lower.as_str()) {
                return lower;
            }

            if lower.contains('-') {
                return lower
                    .split('-')
                    .map(|part| {
                        let mut chars = part.chars();
                        match chars.next() {
                            Some(first) => {
                                first.to_uppercase().collect::<String>() + chars.as_str()
                            }
                            None => String::new(),
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("-");
            }

            let mut chars = lower.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn is_boilerplate_line(line: &str) -> bool {
    if line.len() < 10 {
        return false;
    }
    if FIELD_HEADER_RE.is_match(line) {
        return false;
    }
    if FIELD_IN_SENTENCE_RE.is_match(line) {
        return true;
    }
    PARAGRAPH_START_RE.is_match(line) && line.len() > 60
}

pub fn find_excluded_zone_lines(lines: &[String]) -> HashSet<usize> {
    let mut excluded = HashSet::new();

    for (idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim().to_lowercase();

        if WITNESS_ZONE_RE.is_match(&trimmed) {
            for line_idx in idx..(idx + 10).min(lines.len()) {
                excluded.insert(line_idx);
            }
        }

        if NOTARY_ZONE_RE.is_match(&trimmed) {
            for line_idx in idx..(idx + 20).min(lines.len()) {
                excluded.insert(line_idx);
            }
        }

        if LEGAL_REVIEW_ZONE_RE.is_match(&trimmed) {
            for line_idx in idx..(idx + 6).min(lines.len()) {
                excluded.insert(line_idx);
            }
        }

        if COPYRIGHT_RE.is_match(&trimmed) || ALL_RIGHTS_RESERVED_RE.is_match(&trimmed) {
            excluded.insert(idx);
        }

        if DRAFT_CONFIDENTIAL_RE.is_match(&trimmed) {
            excluded.insert(idx);
        }
    }

    excluded
}

pub fn extract_party_header(line: &str) -> Option<String> {
    static GENERIC_PARTY_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(
            r"(?i)^((?:DISCLOSING|RECEIVING|FIRST|SECOND|THIRD|FOURTH|FIFTH|HIRING|CONTRACTING|GUARANTOR|CO-?SIGNING|INDEMNIFYING|INDEMNIFIED)\s+PARTY|PARTY\s+[A-Z\d])\s*$",
        )
        .unwrap()
    });
    static PARTY_INFO_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(r"(?i)^Party\s+(Disclosing|Receiving|Providing|Requesting)\s+Information\s*:")
            .unwrap()
    });
    static NAMED_APPROVAL_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(&format!(
            r"(?i)^(.+?)\s+\(\s*({})\s*\)\s*(?:Approval|Acknowledgment|Acceptance|Confirmation|Authorization)\s*:",
            PARTY_ROLES_RE.as_str()
        ))
        .unwrap()
    });

    if let Some(caps) = GENERIC_PARTY_RE.captures(line) {
        return caps.get(1).map(|m| title_case(m.as_str()));
    }
    if let Some(caps) = PARTY_INFO_RE.captures(line) {
        return caps
            .get(1)
            .map(|m| title_case(&format!("{} Party", m.as_str())));
    }
    if let Some(caps) = NAMED_APPROVAL_RE.captures(line) {
        return caps.get(2).map(|m| m.as_str().trim().to_string());
    }
    None
}

pub fn extract_named_party_info(line: &str) -> Option<(String, String)> {
    static NAMED_APPROVAL_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(&format!(
            r"(?i)^(.+?)\s+\(\s*({})\s*\)\s*(?:Approval|Acknowledgment|Acceptance|Confirmation|Authorization)\s*:",
            PARTY_ROLES_RE.as_str()
        ))
        .unwrap()
    });

    NAMED_APPROVAL_RE.captures(line).map(|caps| {
        (
            caps.get(1)
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default(),
            caps.get(2)
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default(),
        )
    })
}

pub fn strip_headers_footers(lines: Vec<&str>) -> Vec<String> {
    static PAGE_NUM_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"^(?:page\s+)?\d+\s*(?:of\s+\d+)?$").unwrap());
    static DASHED_PAGE_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"^-\s*\d+\s*-$").unwrap());
    static BATES_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"^[A-Z]{2,6}\d{4,10}$").unwrap());
    static WATERMARK_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"^(?:DRAFT|CONFIDENTIAL|PRIVILEGED|SAMPLE)$").unwrap());

    lines
        .into_iter()
        .filter(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return false;
            }
            if PAGE_NUM_RE.is_match(trimmed) {
                return false;
            }
            if DASHED_PAGE_RE.is_match(trimmed) {
                return false;
            }
            if BATES_RE.is_match(trimmed) {
                return false;
            }
            if WATERMARK_RE.is_match(trimmed) {
                return false;
            }
            true
        })
        .map(String::from)
        .collect()
}

pub fn extract_title(lines: &[String]) -> String {
    static SKIP_RE: Lazy<Regex> = Lazy::new(|| {
        Regex::new(
            r"^(page|date|section|article|clause|copyright|©|\(c\)|--|draft|confidential|$)",
        )
        .unwrap()
    });

    for line in lines.iter().take(15) {
        let trimmed = line.trim();
        if trimmed.is_empty() || SKIP_RE.is_match(trimmed) {
            continue;
        }
        if trimmed.len() > 5
            && trimmed.len() < 120
            && trimmed == trimmed.to_uppercase()
            && trimmed.chars().any(|c| c.is_ascii_uppercase())
        {
            return title_case(trimmed);
        }
    }

    for line in lines.iter().take(8) {
        let trimmed = line.trim();
        if trimmed.is_empty() || SKIP_RE.is_match(trimmed) {
            continue;
        }
        if trimmed.len() > 4
            && trimmed.len() < 120
            && !trimmed.chars().all(|c| c.is_ascii_digit())
        {
            return trimmed.to_string();
        }
    }

    "Uploaded Document".to_string()
}

pub fn normalize_text(text: &str) -> String {
    let mut s = text.to_string();
    // Ligatures
    s = s.replace('\u{FB00}', "ff");
    s = s.replace('\u{FB01}', "fi");
    s = s.replace('\u{FB02}', "fl");
    s = s.replace('\u{FB03}', "ffi");
    s = s.replace('\u{FB04}', "ffl");
    // Smart quotes -> ASCII
    for c in ['\u{2018}', '\u{2019}', '\u{201A}', '\u{FF07}'] {
        s = s.replace(c, "'");
    }
    for c in ['\u{201C}', '\u{201D}', '\u{201E}', '\u{FF02}'] {
        s = s.replace(c, "\"");
    }
    // Dashes -> standard
    for c in ['\u{2013}', '\u{2014}', '\u{2015}'] {
        s = s.replace(c, "-");
    }
    // Non-breaking space
    s = s.replace('\u{00A0}', " ");
    // Section symbol
    s = s.replace('\u{00A7}', "§");
    // Zero-width chars
    for c in ['\u{200B}', '\u{200C}', '\u{200D}', '\u{FEFF}'] {
        s = s.replace(c, "");
    }
    // Multiple spaces -> single (via regex for efficiency)
    static MULTI_SPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]{2,}").unwrap());
    MULTI_SPACE.replace_all(&s, " ").into_owned()
}

pub fn clean_content(text: &str) -> String {
    static MULTI_NEWLINE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\n{4,}").unwrap());
    static MULTI_SPACE: Lazy<Regex> = Lazy::new(|| Regex::new(r"[ \t]+").unwrap());
    let collapsed = MULTI_NEWLINE.replace_all(text, "\n\n\n");
    MULTI_SPACE.replace_all(collapsed.trim(), " ").to_string()
}
