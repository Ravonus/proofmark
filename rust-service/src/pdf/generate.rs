//! PDF generation engine — produces signed document PDFs with cover page,
//! content, field summaries, signature cards, forensic evidence, and verification.
//!
//! Uses printpdf for PDF construction — optimized for speed over pixel-perfect
//! layout matching (the JS version uses pdf-lib).

use base64::Engine;
use ::lopdf::{dictionary, Document as LoDocument, Object as LoObject, ObjectId as LoObjectId};
use once_cell::sync::Lazy;
use printpdf::*;
use printpdf::path::{PaintMode, WindingOrder};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::BufWriter;

// ══════════════════════════════════════════════════════════════════════════════
// Request / Response types
// ══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfGenerateRequest {
    pub title: String,
    pub content: String,
    pub content_hash: String,
    pub document_id: String,
    pub verify_url: String,
    pub created_at: String,
    pub status: String,
    pub encrypted_at_rest: bool,
    pub ipfs_cid: Option<String>,
    pub field_summary_style: Option<String>,
    pub content_lines: Option<Vec<Vec<ContentSegment>>>,
    pub field_summary: Option<Vec<FieldSummaryEntry>>,
    pub signers: Vec<SignerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum ContentSegment {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "field")]
    Field {
        label: String,
        value: String,
        filled: bool,
        field_type: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldSummaryEntry {
    pub label: String,
    pub value: String,
    pub signer: String,
    pub field_type: String,
    pub field_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignerInfo {
    pub label: String,
    pub status: String,
    pub chain: Option<String>,
    pub address: Option<String>,
    pub scheme: Option<String>,
    pub signature: Option<String>,
    pub signed_at: Option<String>,
    pub hand_signature_hash: Option<String>,
    pub hand_signature_data: Option<String>,
    pub field_values: Option<serde_json::Value>,
    pub forensic_evidence: Option<serde_json::Value>,
}

// ══════════════════════════════════════════════════════════════════════════════
// Theme constants (pt → mm conversion)
// ══════════════════════════════════════════════════════════════════════════════

const PAGE_W_MM: f32 = 215.9; // Letter width
const PAGE_H_MM: f32 = 279.4; // Letter height
const MARGIN_MM: f32 = 17.64; // ~50pt
const CONTENT_W_MM: f32 = PAGE_W_MM - 2.0 * MARGIN_MM;
const FOOTER_Y_MM: f32 = 14.0;

// Colors (RGB 0-1 as f32)
const ACCENT: (f32, f32, f32) = (0.28, 0.25, 0.85);
const TEXT_CLR: (f32, f32, f32) = (0.12, 0.12, 0.14);
const SECONDARY: (f32, f32, f32) = (0.35, 0.35, 0.42);
const MUTED: (f32, f32, f32) = (0.55, 0.55, 0.60);
const SUCCESS: (f32, f32, f32) = (0.10, 0.60, 0.25);
const PENDING: (f32, f32, f32) = (0.85, 0.55, 0.10);
const BORDER: (f32, f32, f32) = (0.85, 0.85, 0.88);
const SUBTLE_BG: (f32, f32, f32) = (0.97, 0.97, 0.98);
const WHITE: (f32, f32, f32) = (1.0, 1.0, 1.0);

static MARKER_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\{\{W3S_(FIELD|SIGNATURE):([^}]+)\}\}").unwrap());
static SIGNATURE_MARKER_EXACT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\{\{W3S_SIGNATURE:([^}]+)\}\}$").unwrap());
static PAGE_NUM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^--\s*\d+\s*of\s*\d+\s*--$").unwrap());
static PARTY_ALPHA_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"party\s+([a-z])\b").unwrap());
static NUMBERED_HEADING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d+\.\s+\S").unwrap());
static SECTION_HEADING_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^(?:section|article|clause|part|schedule|exhibit|appendix|recital)\s+[\dIVXivx]+").unwrap());
static SUBHEADING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d+\.\d+\.?\d*\s+\S").unwrap());
static ALL_CAPS_HEADING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Z][A-Z &/,().-]+$").unwrap());
static LIST_ITEM_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\([a-z]\)\s|^\([ivx]+\)\s|^\(\d+\)\s|^[-*•]\s|^[a-z]\)\s|^[ivx]+\)\s").unwrap());
static SIGNATURE_LINE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"signature\s*:").unwrap());
static UNDERSCORE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"_{3,}").unwrap());
static INLINE_FIELD_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?:([A-Za-z\s]+?)\s*:\s*)?_{3,}").unwrap());
static IMAGE_DATA_URL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^data:image/[A-Za-z0-9.+-]+;base64,").unwrap());

fn pt_to_mm(pt: f32) -> f32 {
    pt * 0.3528
}

fn rgb_color(c: (f32, f32, f32)) -> Color {
    Color::Rgb(Rgb::new(c.0, c.1, c.2, None))
}

// ══════════════════════════════════════════════════════════════════════════════
// PDF Context
// ══════════════════════════════════════════════════════════════════════════════

struct PdfCtx {
    doc: PdfDocumentReference,
    current_page: PdfPageIndex,
    current_layer: PdfLayerIndex,
    pages: Vec<(PdfPageIndex, PdfLayerIndex)>,
    y: f32, // mm from bottom
    page_count: usize,
    font_regular: IndirectFontRef,
    font_bold: IndirectFontRef,
    font_mono: IndirectFontRef,
}

impl PdfCtx {
    fn new_page(&mut self) {
        let (page, layer) = self.doc.add_page(
            Mm(PAGE_W_MM),
            Mm(PAGE_H_MM),
            &format!("Page {}", self.page_count + 1),
        );
        self.current_page = page;
        self.current_layer = layer;
        self.pages.push((page, layer));
        self.y = PAGE_H_MM - MARGIN_MM - pt_to_mm(20.0);
        self.page_count += 1;

        // Accent bar at top
        let layer_ref = self.doc.get_page(page).get_layer(layer);
        draw_rect(&layer_ref, 0.0, PAGE_H_MM - pt_to_mm(4.0), PAGE_W_MM, pt_to_mm(4.0), ACCENT);
    }

    fn ensure_space(&mut self, needed_mm: f32) {
        if self.y < FOOTER_Y_MM + needed_mm {
            self.new_page();
        }
    }

    fn layer(&self) -> PdfLayerReference {
        self.doc
            .get_page(self.current_page)
            .get_layer(self.current_layer)
    }

    fn draw_text(
        &self,
        text: &str,
        x_mm: f32,
        y_mm: f32,
        size_pt: f32,
        font: &IndirectFontRef,
        color: (f32, f32, f32),
    ) {
        let layer = self.layer();
        layer.set_fill_color(rgb_color(color));
        layer.use_text(text, size_pt, Mm(x_mm), Mm(y_mm), font);
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Drawing helpers
// ══════════════════════════════════════════════════════════════════════════════

fn draw_rect(
    layer: &PdfLayerReference,
    x_mm: f32,
    y_mm: f32,
    w_mm: f32,
    h_mm: f32,
    color: (f32, f32, f32),
) {
    layer.set_fill_color(rgb_color(color));
    let points = vec![
        (Point::new(Mm(x_mm), Mm(y_mm)), false),
        (Point::new(Mm(x_mm + w_mm), Mm(y_mm)), false),
        (Point::new(Mm(x_mm + w_mm), Mm(y_mm + h_mm)), false),
        (Point::new(Mm(x_mm), Mm(y_mm + h_mm)), false),
    ];
    layer.add_polygon(Polygon {
        rings: vec![points],
        mode: PaintMode::Fill,
        winding_order: WindingOrder::NonZero,
    });
}

fn draw_hline(layer: &PdfLayerReference, y_mm: f32, color: (f32, f32, f32)) {
    layer.set_outline_color(rgb_color(color));
    layer.set_outline_thickness(0.5);
    let points = vec![
        (Point::new(Mm(MARGIN_MM), Mm(y_mm)), false),
        (Point::new(Mm(PAGE_W_MM - MARGIN_MM), Mm(y_mm)), false),
    ];
    let line = Line {
        points,
        is_closed: false,
    };
    layer.add_line(line);
}

/// Approximate word-wrap.
fn wrap_text(text: &str, max_width_mm: f32, font_size_pt: f32) -> Vec<String> {
    let avg_char_width_mm = font_size_pt * 0.18; // approximate
    let max_chars = (max_width_mm / avg_char_width_mm) as usize;
    if max_chars == 0 {
        return vec![text.to_string()];
    }

    let words: Vec<&str> = text.split_whitespace().collect();
    let mut lines = Vec::new();
    let mut current = String::new();

    for word in words {
        if current.is_empty() {
            current = word.to_string();
        } else if current.len() + 1 + word.len() <= max_chars {
            current.push(' ');
            current.push_str(word);
        } else {
            lines.push(current);
            current = word.to_string();
        }
    }
    if !current.is_empty() {
        lines.push(current);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }
    lines
}

fn wrap_long_text(text: &str, max_width_mm: f32, size_pt: f32, mono: bool) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }

    let mut lines = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        let mut candidate = current.clone();
        candidate.push(ch);

        if !current.is_empty() && measure_text_mm(&candidate, size_pt, mono) > max_width_mm {
            lines.push(current);
            current = ch.to_string();
        } else {
            current.push(ch);
        }
    }

    if !current.is_empty() {
        lines.push(current);
    }

    if lines.is_empty() {
        lines.push(String::new());
    }

    lines
}

fn measure_text_mm(text: &str, size_pt: f32, mono: bool) -> f32 {
    let count = text.chars().count() as f32;
    let factor = if mono { 0.215 } else { 0.19 };
    count * size_pt * factor
}

fn truncate_to_width(text: &str, size_pt: f32, max_width_mm: f32, mono: bool) -> String {
    if measure_text_mm(text, size_pt, mono) <= max_width_mm {
        return text.to_string();
    }

    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= 3 {
        return text.to_string();
    }

    let mut keep = chars.len().saturating_sub(1);
    while keep > 1 {
        let candidate = format!("{}...", chars[..keep].iter().collect::<String>());
        if measure_text_mm(&candidate, size_pt, mono) <= max_width_mm {
            return candidate;
        }
        keep -= 1;
    }

    "...".to_string()
}

fn compact_identifier(value: &str, prefix: usize, suffix: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= prefix + suffix + 3 {
        return value.to_string();
    }
    format!(
        "{}...{}",
        chars[..prefix].iter().collect::<String>(),
        chars[chars.len() - suffix..].iter().collect::<String>(),
    )
}

fn compact_verify_url(url: &str, content_hash: &str) -> String {
    let hash_tail = compact_identifier(content_hash, 6, 6);
    if url.contains(content_hash) {
        return url.replace(content_hash, &hash_tail);
    }
    compact_identifier(url, 30, 16)
}

fn split_preserve_whitespace(text: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut current_is_space: Option<bool> = None;

    for ch in text.chars() {
        let is_space = ch.is_whitespace();
        match current_is_space {
            Some(flag) if flag == is_space => current.push(ch),
            Some(_) => {
                parts.push(current);
                current = ch.to_string();
                current_is_space = Some(is_space);
            }
            None => {
                current.push(ch);
                current_is_space = Some(is_space);
            }
        }
    }

    if !current.is_empty() {
        parts.push(current);
    }

    parts
}

fn get_empty_field_placeholder(field_type: &str, label: &str) -> String {
    let text = if label.trim().is_empty() { field_type } else { label }.trim();
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= 28 {
        text.to_string()
    } else {
        format!("{}…", chars[..27].iter().collect::<String>())
    }
}

fn is_svg_data_url(value: &str) -> bool {
    value.trim_start().starts_with("data:image/svg+xml;base64,")
}

#[derive(Debug, Clone)]
struct ParsedSignatureSvg {
    width: f32,
    height: f32,
    paths: Vec<String>,
}

fn parse_signature_svg(data_url: &str) -> Option<ParsedSignatureSvg> {
    let b64 = data_url.split_once(',')?.1;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
    let svg = String::from_utf8(bytes).ok()?;

    let view_box_re = Regex::new(r#"viewBox=["']\s*0(?:\.0+)?\s+0(?:\.0+)?\s+([\d.]+)\s+([\d.]+)\s*["']"#).ok()?;
    let width_re = Regex::new(r#"width=["']([\d.]+)["']"#).ok()?;
    let height_re = Regex::new(r#"height=["']([\d.]+)["']"#).ok()?;
    let path_re = Regex::new(r#"<path\b[^>]*\bd=["']([^"']+)["'][^>]*\/?>"#).ok()?;

    let width = view_box_re
        .captures(&svg)
        .and_then(|caps| caps.get(1))
        .and_then(|m| m.as_str().parse::<f32>().ok())
        .or_else(|| {
            width_re
                .captures(&svg)
                .and_then(|caps| caps.get(1))
                .and_then(|m| m.as_str().parse::<f32>().ok())
        })
        .unwrap_or(320.0);

    let height = view_box_re
        .captures(&svg)
        .and_then(|caps| caps.get(2))
        .and_then(|m| m.as_str().parse::<f32>().ok())
        .or_else(|| {
            height_re
                .captures(&svg)
                .and_then(|caps| caps.get(1))
                .and_then(|m| m.as_str().parse::<f32>().ok())
        })
        .unwrap_or(140.0);

    let paths = path_re
        .captures_iter(&svg)
        .filter_map(|caps| caps.get(1).map(|m| m.as_str().to_string()))
        .collect::<Vec<_>>();

    if paths.is_empty() {
        return None;
    }

    Some(ParsedSignatureSvg { width, height, paths })
}

fn sample_quadratic(
    start: (f32, f32),
    control: (f32, f32),
    end: (f32, f32),
    steps: usize,
) -> Vec<(f32, f32)> {
    (1..=steps)
        .map(|step| {
            let t = step as f32 / steps as f32;
            let mt = 1.0 - t;
            let x = mt * mt * start.0 + 2.0 * mt * t * control.0 + t * t * end.0;
            let y = mt * mt * start.1 + 2.0 * mt * t * control.1 + t * t * end.1;
            (x, y)
        })
        .collect()
}

fn parse_signature_path(path: &str) -> Vec<(f32, f32)> {
    let mut points = Vec::new();
    let tokens = path.split_whitespace().collect::<Vec<_>>();
    let mut idx = 0usize;
    let mut current = (0.0f32, 0.0f32);

    while idx < tokens.len() {
        match tokens[idx] {
            "M" | "L" => {
                if idx + 2 >= tokens.len() {
                    break;
                }
                let x = tokens[idx + 1].parse::<f32>().ok();
                let y = tokens[idx + 2].parse::<f32>().ok();
                if let (Some(x), Some(y)) = (x, y) {
                    current = (x, y);
                    points.push(current);
                }
                idx += 3;
            }
            "Q" => {
                if idx + 4 >= tokens.len() {
                    break;
                }
                let cx = tokens[idx + 1].parse::<f32>().ok();
                let cy = tokens[idx + 2].parse::<f32>().ok();
                let ex = tokens[idx + 3].parse::<f32>().ok();
                let ey = tokens[idx + 4].parse::<f32>().ok();
                if let (Some(cx), Some(cy), Some(ex), Some(ey)) = (cx, cy, ex, ey) {
                    let sampled = sample_quadratic(current, (cx, cy), (ex, ey), 12);
                    points.extend(sampled);
                    current = (ex, ey);
                }
                idx += 5;
            }
            _ => idx += 1,
        }
    }

    points
}

fn draw_signature_svg(
    layer: &PdfLayerReference,
    data_url: &str,
    x_mm: f32,
    top_y_mm: f32,
    max_width_mm: f32,
    max_height_mm: f32,
) -> Option<(f32, f32)> {
    let svg = parse_signature_svg(data_url)?;
    let scale = (max_width_mm / svg.width).min(max_height_mm / svg.height).max(0.01);
    let draw_width = svg.width * scale;
    let draw_height = svg.height * scale;

    layer.set_outline_color(rgb_color(TEXT_CLR));
    layer.set_outline_thickness(0.95);

    for path in &svg.paths {
        let sampled = parse_signature_path(path);
        if sampled.len() < 2 {
            continue;
        }
        let points = sampled
            .into_iter()
            .map(|(px, py)| {
                (
                    Point::new(Mm(x_mm + px * scale), Mm(top_y_mm - py * scale)),
                    false,
                )
            })
            .collect::<Vec<_>>();
        layer.add_line(Line {
            points,
            is_closed: false,
        });
    }

    Some((draw_width, draw_height))
}

enum InlineAtom {
    Space { width_mm: f32 },
    Word {
        text: String,
        size_pt: f32,
        color: (f32, f32, f32),
        mono: bool,
        bold: bool,
        width_mm: f32,
    },
    FieldText {
        text: String,
        size_pt: f32,
        color: (f32, f32, f32),
        bold: bool,
        width_mm: f32,
        underline: bool,
        placeholder: bool,
    },
    Signature {
        data_url: String,
        width_mm: f32,
        height_mm: f32,
        underline: bool,
    },
}

fn build_inline_atoms(line: &[ContentSegment]) -> (Vec<InlineAtom>, f32) {
    let mut atoms = Vec::new();
    let mut line_height_mm = pt_to_mm(12.0);

    for segment in line {
        match segment {
            ContentSegment::Text { text } => {
                for part in split_preserve_whitespace(text) {
                    if part.chars().all(|ch| ch.is_whitespace()) {
                        atoms.push(InlineAtom::Space {
                            width_mm: measure_text_mm(&part, 9.5, false),
                        });
                    } else {
                        atoms.push(InlineAtom::Word {
                            width_mm: measure_text_mm(&part, 9.5, false),
                            text: part,
                            size_pt: 9.5,
                            color: SECONDARY,
                            mono: false,
                            bold: false,
                        });
                    }
                }
            }
            ContentSegment::Field { label, value, filled, field_type } => {
                if *filled && field_type == "signature" && is_svg_data_url(value) {
                    let signature_label = label.trim();
                    if !signature_label.is_empty() {
                        let label_text = format!("{signature_label} ");
                        atoms.push(InlineAtom::Word {
                            width_mm: measure_text_mm(&label_text, 7.0, false),
                            text: label_text,
                            size_pt: 7.0,
                            color: MUTED,
                            mono: false,
                            bold: false,
                        });
                    }
                    atoms.push(InlineAtom::Signature {
                        data_url: value.clone(),
                        width_mm: 40.0,
                        height_mm: 12.0,
                        underline: true,
                    });
                    line_height_mm = line_height_mm.max(18.0);
                } else {
                    let (text, size_pt, color, bold, placeholder) = if *filled {
                        (value.clone(), 9.5, ACCENT, true, false)
                    } else {
                        (
                            get_empty_field_placeholder(field_type, label),
                            6.75,
                            MUTED,
                            false,
                            true,
                        )
                    };
                    let width_mm = if placeholder {
                        measure_text_mm(&text, size_pt, false) + pt_to_mm(6.0)
                    } else {
                        measure_text_mm(&text, size_pt, false)
                    };
                    atoms.push(InlineAtom::FieldText {
                        text,
                        size_pt,
                        color,
                        bold,
                        width_mm,
                        underline: true,
                        placeholder,
                    });
                }
                atoms.push(InlineAtom::Space { width_mm: pt_to_mm(4.0) });
            }
        }
    }

    (atoms, line_height_mm)
}

fn draw_pill(
    layer: &PdfLayerReference,
    font: &IndirectFontRef,
    text: &str,
    x_mm: f32,
    y_mm: f32,
    bg: (f32, f32, f32),
    fg: (f32, f32, f32),
) -> f32 {
    let pill_width = measure_text_mm(text, 7.0, false) + pt_to_mm(14.0);
    let pill_height = pt_to_mm(16.0);
    draw_rect(layer, x_mm, y_mm - pt_to_mm(3.0), pill_width, pill_height, bg);
    layer.set_fill_color(rgb_color(fg));
    layer.use_text(text, 7.0, Mm(x_mm + pt_to_mm(7.0)), Mm(y_mm + pt_to_mm(1.0)), font);
    pill_width
}

fn render_structured_content_line(ctx: &mut PdfCtx, line: &[ContentSegment]) {
    let (atoms, line_height_mm) = build_inline_atoms(line);
    ctx.ensure_space(line_height_mm + pt_to_mm(10.0));

    let max_x = PAGE_W_MM - MARGIN_MM;
    let mut cx = MARGIN_MM;
    let mut line_y = ctx.y;

    for atom in atoms {
        let atom_width = match &atom {
            InlineAtom::Space { width_mm } => *width_mm,
            InlineAtom::Word { width_mm, .. } => *width_mm,
            InlineAtom::FieldText { width_mm, .. } => *width_mm,
            InlineAtom::Signature { width_mm, .. } => *width_mm,
        };

        if cx + atom_width > max_x && cx > MARGIN_MM {
            line_y -= line_height_mm;
            if line_y < FOOTER_Y_MM + line_height_mm + pt_to_mm(4.0) {
                ctx.new_page();
                line_y = ctx.y;
            }
            cx = MARGIN_MM;
        }

        let layer = ctx.layer();
        match atom {
            InlineAtom::Space { width_mm } => {
                cx += width_mm;
            }
            InlineAtom::Word { text, size_pt, color, mono, bold, width_mm } => {
                let font = if mono {
                    &ctx.font_mono
                } else if bold {
                    &ctx.font_bold
                } else {
                    &ctx.font_regular
                };
                layer.set_fill_color(rgb_color(color));
                layer.use_text(&text, size_pt, Mm(cx), Mm(line_y), font);
                cx += width_mm;
            }
            InlineAtom::FieldText { text, size_pt, color, bold, width_mm, underline, placeholder } => {
                let font = if bold { &ctx.font_bold } else { &ctx.font_regular };
                let text_width = measure_text_mm(&text, size_pt, false);
                let text_x = if placeholder {
                    cx + ((width_mm - text_width) / 2.0).max(0.0)
                } else {
                    cx
                };
                layer.set_fill_color(rgb_color(color));
                layer.use_text(&text, size_pt, Mm(text_x), Mm(line_y), font);
                if underline {
                    layer.set_outline_color(rgb_color(if placeholder { MUTED } else { ACCENT }));
                    layer.set_outline_thickness(if placeholder { 0.35 } else { 0.5 });
                    layer.add_line(Line {
                        points: vec![
                            (Point::new(Mm(cx), Mm(line_y - pt_to_mm(2.5))), false),
                            (Point::new(Mm(cx + width_mm), Mm(line_y - pt_to_mm(2.5))), false),
                        ],
                        is_closed: false,
                    });
                }
                cx += width_mm;
            }
            InlineAtom::Signature { data_url, width_mm, height_mm, underline } => {
                let drawn = draw_signature_svg(&layer, &data_url, cx, line_y + pt_to_mm(4.0), width_mm, height_mm);
                let draw_width = drawn.map(|(w, _)| w).unwrap_or(width_mm.max(30.0));
                let draw_height = drawn.map(|(_, h)| h).unwrap_or(height_mm);
                if underline {
                    layer.set_outline_color(rgb_color(BORDER));
                    layer.set_outline_thickness(0.35);
                    layer.add_line(Line {
                        points: vec![
                            (Point::new(Mm(cx), Mm(line_y - draw_height + pt_to_mm(2.0))), false),
                            (Point::new(Mm(cx + draw_width), Mm(line_y - draw_height + pt_to_mm(2.0))), false),
                        ],
                        is_closed: false,
                    });
                }
                cx += draw_width.max(30.0);
            }
        }
    }

    ctx.y = line_y - line_height_mm - pt_to_mm(2.0);
}

fn render_completed_field_cards(ctx: &mut PdfCtx, field_summary: &[FieldSummaryEntry]) {
    let layer = ctx.layer();
    draw_hline(&layer, ctx.y, BORDER);
    ctx.y -= pt_to_mm(18.0);
    ctx.draw_text("Completed Fields", MARGIN_MM, ctx.y, 12.0, &ctx.font_bold.clone(), TEXT_CLR);
    ctx.y -= pt_to_mm(6.0);
    ctx.draw_text("Values entered by signers during the signing process", MARGIN_MM, ctx.y, 8.0, &ctx.font_regular.clone(), MUTED);
    ctx.y -= pt_to_mm(18.0);

    for entry in field_summary {
        let value_lines = wrap_text(&entry.value, CONTENT_W_MM - pt_to_mm(24.0), 9.5);
        let card_h = pt_to_mm(24.0 + value_lines.len() as f32 * 13.0);
        ctx.ensure_space(card_h + pt_to_mm(8.0));
        let top = ctx.y + pt_to_mm(8.0);
        let layer = ctx.layer();
        draw_rect(&layer, MARGIN_MM, top - card_h, CONTENT_W_MM, card_h, SUBTLE_BG);
        draw_rect(&layer, MARGIN_MM, top - card_h, pt_to_mm(3.0), card_h, ACCENT);
        ctx.draw_text(&entry.label, MARGIN_MM + pt_to_mm(12.0), ctx.y, 7.0, &ctx.font_bold.clone(), MUTED);
        let by_text = format!("by {}", entry.signer);
        let by_width = measure_text_mm(&by_text, 7.0, false);
        ctx.draw_text(&by_text, PAGE_W_MM - MARGIN_MM - by_width - pt_to_mm(8.0), ctx.y, 7.0, &ctx.font_regular.clone(), MUTED);
        let mut vy = ctx.y - pt_to_mm(14.0);
        for line in value_lines {
            ctx.draw_text(&line, MARGIN_MM + pt_to_mm(12.0), vy, 9.5, &ctx.font_bold.clone(), TEXT_CLR);
            vy -= pt_to_mm(13.0);
        }
        ctx.y = top - card_h - pt_to_mm(4.0);
    }
}

fn render_completed_field_table(ctx: &mut PdfCtx, field_summary: &[FieldSummaryEntry]) {
    let layer = ctx.layer();
    draw_hline(&layer, ctx.y, BORDER);
    ctx.y -= pt_to_mm(18.0);
    ctx.draw_text("Completed Fields", MARGIN_MM, ctx.y, 12.0, &ctx.font_bold.clone(), TEXT_CLR);
    ctx.y -= pt_to_mm(6.0);
    ctx.draw_text("Indexed field values by signer", MARGIN_MM, ctx.y, 8.0, &ctx.font_regular.clone(), MUTED);
    ctx.y -= pt_to_mm(16.0);

    for (index, entry) in field_summary.iter().enumerate() {
        let row_h = pt_to_mm(18.0);
        ctx.ensure_space(row_h + pt_to_mm(4.0));
        let top = ctx.y + pt_to_mm(6.0);
        let layer = ctx.layer();
        draw_rect(&layer, MARGIN_MM, top - row_h, CONTENT_W_MM, row_h, SUBTLE_BG);
        draw_rect(&layer, MARGIN_MM, top - row_h, pt_to_mm(3.0), row_h, ACCENT);
        ctx.draw_text(&format!("{:02}", index + 1), MARGIN_MM + pt_to_mm(8.0), ctx.y - pt_to_mm(1.0), 7.0, &ctx.font_mono.clone(), MUTED);
        ctx.draw_text(&truncate_to_width(&entry.label, 8.0, pt_to_mm(92.0), false), MARGIN_MM + pt_to_mm(22.0), ctx.y - pt_to_mm(1.0), 8.0, &ctx.font_bold.clone(), SECONDARY);
        ctx.draw_text(&truncate_to_width(&entry.value, 8.0, pt_to_mm(110.0), false), MARGIN_MM + pt_to_mm(82.0), ctx.y - pt_to_mm(1.0), 8.0, &ctx.font_regular.clone(), TEXT_CLR);
        let signer = truncate_to_width(&entry.signer, 7.0, pt_to_mm(38.0), false);
        let signer_width = measure_text_mm(&signer, 7.0, false);
        ctx.draw_text(&signer, PAGE_W_MM - MARGIN_MM - signer_width - pt_to_mm(10.0), ctx.y - pt_to_mm(1.0), 7.0, &ctx.font_bold.clone(), ACCENT);
        ctx.y = top - row_h - pt_to_mm(2.0);
    }
}

fn render_completed_field_hybrid(ctx: &mut PdfCtx, field_summary: &[FieldSummaryEntry]) {
    let layer = ctx.layer();
    draw_hline(&layer, ctx.y, BORDER);
    ctx.y -= pt_to_mm(18.0);
    ctx.draw_text("Completed Fields", MARGIN_MM, ctx.y, 12.0, &ctx.font_bold.clone(), TEXT_CLR);
    ctx.y -= pt_to_mm(6.0);
    ctx.draw_text("Signed values in document order with signer attribution", MARGIN_MM, ctx.y, 8.0, &ctx.font_regular.clone(), MUTED);
    ctx.y -= pt_to_mm(18.0);

    for (index, entry) in field_summary.iter().enumerate() {
        let label_lines = wrap_text(&entry.label, CONTENT_W_MM - pt_to_mm(90.0), 8.25);
        let value_lines = wrap_text(&entry.value, CONTENT_W_MM - pt_to_mm(38.0), 9.5);
        let row_h = pt_to_mm(18.0 + label_lines.len() as f32 * 10.0 + value_lines.len() as f32 * 12.0 + 14.0);
        ctx.ensure_space(row_h + pt_to_mm(6.0));
        let card_top = ctx.y + pt_to_mm(10.0);
        let layer = ctx.layer();
        draw_rect(&layer, MARGIN_MM, card_top - row_h, CONTENT_W_MM, row_h, SUBTLE_BG);
        draw_rect(&layer, MARGIN_MM, card_top - row_h, pt_to_mm(3.0), row_h, ACCENT);
        ctx.draw_text(&format!("{:02}", index + 1), MARGIN_MM + pt_to_mm(10.0), ctx.y - pt_to_mm(1.0), 7.0, &ctx.font_mono.clone(), MUTED);

        let signer_width = measure_text_mm(&entry.signer, 7.0, false) + pt_to_mm(14.0);
        let pill_x = PAGE_W_MM - MARGIN_MM - signer_width - pt_to_mm(10.0);
        draw_pill(&layer, &ctx.font_bold.clone(), &entry.signer, pill_x, ctx.y - pt_to_mm(8.0), (0.95, 0.94, 1.0), ACCENT);

        let mut header_y = ctx.y;
        for label_line in label_lines {
            ctx.draw_text(&label_line, MARGIN_MM + pt_to_mm(32.0), header_y, 8.25, &ctx.font_bold.clone(), SECONDARY);
            header_y -= pt_to_mm(10.0);
        }
        let meta_label = entry.field_type.split('-').map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        }).collect::<Vec<_>>().join(" ");
        ctx.draw_text(&meta_label, MARGIN_MM + pt_to_mm(32.0), header_y - pt_to_mm(1.0), 6.5, &ctx.font_regular.clone(), MUTED);
        let mut value_y = header_y - pt_to_mm(14.0);
        for value_line in value_lines {
            ctx.draw_text(&value_line, MARGIN_MM + pt_to_mm(32.0), value_y, 9.5, &ctx.font_bold.clone(), TEXT_CLR);
            value_y -= pt_to_mm(12.0);
        }
        ctx.y = card_top - row_h - pt_to_mm(4.0);
    }
}

fn render_completed_fields(ctx: &mut PdfCtx, field_summary: &[FieldSummaryEntry], style: &str) {
    match style {
        "cards" => render_completed_field_cards(ctx, field_summary),
        "table" => render_completed_field_table(ctx, field_summary),
        _ => render_completed_field_hybrid(ctx, field_summary),
    }
}

fn stamp_footers(ctx: &PdfCtx, content_hash: &str) {
    let total = ctx.pages.len();
    let proofmark_width = measure_text_mm("PROOFMARK", 6.0, false);
    let verified_text = "Cryptographically Verified";
    let verified_x = MARGIN_MM + proofmark_width + pt_to_mm(7.0);
    let verified_width = measure_text_mm(verified_text, 6.0, false);

    for (index, (page, layer)) in ctx.pages.iter().enumerate() {
        let layer = ctx.doc.get_page(*page).get_layer(*layer);
        draw_hline(&layer, FOOTER_Y_MM + pt_to_mm(7.0), BORDER);
        layer.set_fill_color(rgb_color(ACCENT));
        layer.use_text("PROOFMARK", 6.0, Mm(MARGIN_MM), Mm(FOOTER_Y_MM), &ctx.font_bold);
        layer.set_fill_color(rgb_color(MUTED));
        layer.use_text(verified_text, 6.0, Mm(verified_x), Mm(FOOTER_Y_MM), &ctx.font_regular);
        let page_text = format!("{}/{}", index + 1, total);
        let page_width = measure_text_mm(&page_text, 6.0, false);
        let page_x = PAGE_W_MM - MARGIN_MM - page_width;

        let center_text = format!("sha {}", compact_identifier(content_hash, 8, 8));
        let center_width = measure_text_mm(&center_text, 5.0, true);
        let center_x = (PAGE_W_MM - center_width) / 2.0;
        let left_extent = verified_x + verified_width;
        if center_x > left_extent + pt_to_mm(10.0) && center_x + center_width < page_x - pt_to_mm(10.0) {
            layer.use_text(&center_text, 5.0, Mm(center_x), Mm(FOOTER_Y_MM), &ctx.font_mono);
        }

        layer.use_text(&page_text, 6.0, Mm(page_x), Mm(FOOTER_Y_MM), &ctx.font_regular);
    }
}

fn append_page_annotation(
    doc: &mut LoDocument,
    page_id: LoObjectId,
    annotation_id: LoObjectId,
) -> Result<(), anyhow::Error> {
    let existing_annots = {
        let page = doc.get_object(page_id)?.as_dict()?;
        page.get(b"Annots").ok().cloned()
    };

    match existing_annots {
        Some(LoObject::Reference(annots_id)) => {
            doc.get_object_mut(annots_id)?
                .as_array_mut()?
                .push(LoObject::Reference(annotation_id));
        }
        Some(LoObject::Array(_)) => {
            doc.get_object_mut(page_id)?
                .as_dict_mut()?
                .get_mut(b"Annots")?
                .as_array_mut()?
                .push(LoObject::Reference(annotation_id));
        }
        _ => {
            doc.get_object_mut(page_id)?
                .as_dict_mut()?
                .set("Annots", LoObject::Array(vec![LoObject::Reference(annotation_id)]));
        }
    }

    Ok(())
}

fn attach_cover_verification_note(
    pdf_bytes: Vec<u8>,
    content_hash: &str,
    encrypted_at_rest: bool,
    ipfs_cid: Option<&str>,
    verify_url: &str,
    verification_top_mm: f32,
    verification_card_h_mm: f32,
) -> Result<Vec<u8>, anyhow::Error> {
    let mut doc = LoDocument::load_mem(&pdf_bytes)?;
    let Some((_, page_id)) = doc.get_pages().into_iter().next() else {
        return Ok(pdf_bytes);
    };

    let note_text = match (encrypted_at_rest, ipfs_cid) {
        (true, Some(cid)) => format!(
            "Primary document proof\nSHA-256: {content_hash}\n\nEncrypted payload storage\nIPFS CID: {cid}\n\nThe SHA-256 fingerprint verifies the document itself. The CID identifies the encrypted payload only.\n\nVerify online: {verify_url}"
        ),
        _ => format!(
            "Primary document proof\nSHA-256: {content_hash}\n\nAny change to the original document produces a different SHA-256 fingerprint.\n\nVerify online: {verify_url}"
        ),
    };

    let x1 = (PAGE_W_MM - MARGIN_MM - pt_to_mm(20.0)) * 72.0 / 25.4;
    let x2 = (PAGE_W_MM - MARGIN_MM - pt_to_mm(8.0)) * 72.0 / 25.4;
    let y_top = (verification_top_mm - pt_to_mm(10.0)) * 72.0 / 25.4;
    let y_bottom = (verification_top_mm - verification_card_h_mm + pt_to_mm(10.0)) * 72.0 / 25.4;
    let y1 = y_bottom.max(y_top - 24.0);
    let y2 = y_top;

    let annotation_id = doc.add_object(dictionary! {
        "Type" => "Annot",
        "Subtype" => "Text",
        "Rect" => vec![x1.into(), y1.into(), x2.into(), y2.into()],
        "Contents" => LoObject::string_literal(note_text),
        "T" => LoObject::string_literal("Proofmark"),
        "Subj" => LoObject::string_literal("Verification"),
        "NM" => LoObject::string_literal("proofmark-verification-note"),
        "Name" => "Help",
        "Open" => false,
        "C" => vec![ACCENT.0.into(), ACCENT.1.into(), ACCENT.2.into()],
        "F" => 4,
    });

    append_page_annotation(&mut doc, page_id, annotation_id)?;

    let mut out = Vec::new();
    doc.save_to(&mut out)?;
    Ok(out)
}

#[derive(Debug, Clone)]
struct InlineFieldDef {
    id: String,
    field_type: String,
    label: String,
}

#[derive(Debug, Clone)]
enum DocToken {
    Heading(String),
    Subheading(String),
    Text(String),
    Field(InlineFieldDef),
    ListItem(String),
    Break,
    SignatureBlock { label: String, signer_idx: usize },
}

#[derive(Debug, Deserialize)]
struct FieldMarkerPayload {
    id: Option<String>,
    #[serde(rename = "type")]
    field_type: Option<String>,
    label: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SignatureMarkerPayload {
    label: Option<String>,
    #[serde(rename = "signerIdx")]
    signer_idx: Option<i64>,
}

#[derive(Debug, Clone)]
struct FieldValueEntry {
    value: String,
    signer: String,
    hand_signature_data: Option<String>,
}

fn is_image_data_url(value: &str) -> bool {
    IMAGE_DATA_URL_RE.is_match(value.trim())
}

fn is_signature_placeholder_value(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "signed" | "(user signed this)" | "user signed this"
    )
}

fn resolve_signature_display_value(raw_value: &str, fallback_signature_data: Option<&str>) -> String {
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

fn format_calendar_date(raw_value: &str) -> String {
    if let Ok(date) = chrono::NaiveDate::parse_from_str(raw_value, "%Y-%m-%d") {
        return date.format("%B %-d, %Y").to_string();
    }
    if let Ok(date_time) = chrono::DateTime::parse_from_rfc3339(raw_value) {
        return date_time.format("%B %-d, %Y").to_string();
    }
    raw_value.to_string()
}

fn format_field_value(raw_value: &str, field_type: &str, fallback_signature_data: Option<&str>) -> String {
    if raw_value.is_empty() {
        return String::new();
    }

    if field_type == "signature" {
        let resolved = resolve_signature_display_value(raw_value, fallback_signature_data);
        if is_image_data_url(&resolved) {
            return "Handwritten signature on file".to_string();
        }
        return if resolved.is_empty() { "Signed".to_string() } else { resolved };
    }

    if field_type == "checkbox" {
        return if raw_value == "true" { "Yes".to_string() } else { "No".to_string() };
    }

    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw_value) {
        if field_type == "file-attachment" && parsed.get("kind").and_then(|v| v.as_str()) == Some("attachment") {
            if let Some(original_name) = parsed.get("originalName").and_then(|v| v.as_str()) {
                return original_name.to_string();
            }
        }

        if field_type == "payment-request" && parsed.get("kind").and_then(|v| v.as_str()) == Some("payment") {
            let currency = parsed
                .get("currency")
                .and_then(|v| v.as_str())
                .unwrap_or("USD")
                .to_ascii_uppercase();
            let amount = parsed.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
            return format!("{currency} {amount:.2} paid");
        }

        if field_type == "id-verification" && parsed.get("kind").and_then(|v| v.as_str()) == Some("id-verification") {
            let score = parsed.get("score").and_then(|v| v.as_i64()).unwrap_or(0);
            let threshold = parsed.get("threshold").and_then(|v| v.as_i64()).unwrap_or(0);
            return format!("Verified ({score}/{threshold})");
        }
    }

    if matches!(field_type, "date" | "effective-date") {
        return format_calendar_date(raw_value);
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

fn guess_field_type(label: &str, line_context: &str) -> String {
    let label_lower = label.to_ascii_lowercase();
    let context_lower = line_context.to_ascii_lowercase();
    let both = format!("{label_lower} {context_lower}");

    let contains_any = |haystack: &str, needles: &[&str]| needles.iter().any(|needle| haystack.contains(needle));

    if contains_any(&both, &["signature", "sign here", "autograph"]) || label_lower.contains("initial") {
        return "signature".to_string();
    }
    if label_lower.contains("date") || contains_any(&context_lower, &["effective date", "dated this", "date of", "on the date"]) {
        return "date".to_string();
    }
    if contains_any(&both, &["e-mail", "email", "electronic mail", "@"]) {
        return "email".to_string();
    }
    if contains_any(&both, &["phone", "telephone", "tel", "fax", "mobile", "cell"]) {
        return "email".to_string();
    }
    if label_lower.contains("address")
        || contains_any(&context_lower, &["mailing address", "street", "address of", "with a mailing address"])
        || contains_any(&both, &["suite", "apt", "city", "state", "zip", "postal", "county", "country", "residence", "domicile", "p.o. box"])
    {
        return "address".to_string();
    }
    if contains_any(&both, &["company", "corporation", "corp", "llc", "inc", "entity", "organization", "firm", "employer", "business", "enterprise"]) {
        return "company".to_string();
    }
    if contains_any(&label_lower, &["title", "role", "position", "designation", "occupation", "department", "authorized representative"]) {
        return "title".to_string();
    }
    if contains_any(&label_lower, &["name", "printed name", "typed", "full name", "legal name"])
        || (label_lower.contains("party") && label_lower.contains("information"))
        || contains_any(&label_lower, &["principal", "recipient", "beneficiary", "witness", "notary", "landlord", "tenant", "lessor", "lessee", "buyer", "seller", "client", "vendor", "contractor"])
    {
        return "name".to_string();
    }
    if both.contains("wallet") || both.contains("0x") {
        return "other".to_string();
    }
    if contains_any(&both, &["amount", "price", "fee", "cost", "payment", "compensation", "salary", "$"]) {
        return "other".to_string();
    }
    if label_lower.contains("term") || label_lower.contains("duration") || label_lower.contains("period") {
        return "date".to_string();
    }
    if context_lower.contains("date") {
        return "date".to_string();
    }
    if context_lower.contains("address") || context_lower.contains("mailing") {
        return "address".to_string();
    }

    "other".to_string()
}

fn string_value(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::Null => None,
        serde_json::Value::String(text) if text.is_empty() => None,
        serde_json::Value::String(text) => Some(text.clone()),
        other => Some(other.to_string()),
    }
}

fn parse_canonical_line(
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

fn process_inline_fields(
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

fn tokenize_document(content: &str, signer_count: usize) -> (Vec<DocToken>, Vec<InlineFieldDef>) {
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

fn parse_content_to_segments(content: &str, signers: &[SignerInfo]) -> (Vec<Vec<ContentSegment>>, Vec<FieldSummaryEntry>) {
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

// ══════════════════════════════════════════════════════════════════════════════
// Main PDF generator
// ══════════════════════════════════════════════════════════════════════════════

pub fn generate_signed_pdf(req: &PdfGenerateRequest) -> Result<Vec<u8>, anyhow::Error> {
    let (doc, page, layer) =
        PdfDocument::new(&req.title, Mm(PAGE_W_MM), Mm(PAGE_H_MM), "Cover");

    let font_regular = doc.add_builtin_font(BuiltinFont::Helvetica)?;
    let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold)?;
    let font_mono = doc.add_builtin_font(BuiltinFont::Courier)?;

    let mut ctx = PdfCtx {
        doc,
        current_page: page,
        current_layer: layer,
        pages: vec![(page, layer)],
        y: PAGE_H_MM - MARGIN_MM - pt_to_mm(10.0),
        page_count: 1,
        font_regular,
        font_bold,
        font_mono,
    };

    // Draw accent bar on first page
    {
        let l = ctx.layer();
        draw_rect(&l, 0.0, PAGE_H_MM - pt_to_mm(4.0), PAGE_W_MM, pt_to_mm(4.0), ACCENT);
    }

    let all_signed = req.signers.iter().all(|s| s.status == "SIGNED");
    let signed_count = req.signers.iter().filter(|s| s.status == "SIGNED").count();
    let (content_lines, field_summary) = match (&req.content_lines, &req.field_summary) {
        (Some(lines), Some(summary)) => (lines.clone(), summary.clone()),
        _ => parse_content_to_segments(&req.content, &req.signers),
    };

    // ═══ COVER PAGE ══════════════════════════════════════════════════════════

    ctx.draw_text("Proofmark", MARGIN_MM, ctx.y, 11.0, &ctx.font_bold.clone(), ACCENT);
    ctx.y -= pt_to_mm(40.0);

    // Title
    let title_lines = wrap_text(&req.title, CONTENT_W_MM, 18.0);
    for line in &title_lines {
        ctx.draw_text(line, MARGIN_MM, ctx.y, 18.0, &ctx.font_bold.clone(), TEXT_CLR);
        ctx.y -= pt_to_mm(18.0 * 1.3);
    }
    ctx.y -= pt_to_mm(8.0);

    // Status pill
    let status_text = if all_signed {
        format!("FULLY SIGNED")
    } else {
        format!("{signed_count} OF {} SIGNED", req.signers.len())
    };
    let pill_color = if all_signed { SUCCESS } else { PENDING };
    {
        let l = ctx.layer();
        draw_rect(&l, MARGIN_MM, ctx.y - pt_to_mm(3.0), pt_to_mm(100.0), pt_to_mm(16.0), pill_color);
    }
    ctx.draw_text(&status_text, MARGIN_MM + pt_to_mm(7.0), ctx.y + pt_to_mm(1.0), 7.0, &ctx.font_bold.clone(), WHITE);
    ctx.y -= pt_to_mm(32.0);

    // Meta grid
    let meta = [
        ("Created", req.created_at.as_str()),
        ("Signers", &format!("{} parties", req.signers.len())),
        ("Document ID", &req.document_id[..20.min(req.document_id.len())]),
        ("Status", if all_signed { "Complete" } else { "In Progress" }),
    ];
    for pair in meta.chunks(2) {
        let fb = ctx.font_bold.clone();
        let fr = ctx.font_regular.clone();
        ctx.draw_text(pair[0].0, MARGIN_MM, ctx.y, 8.0, &fb, MUTED);
        ctx.draw_text(pair[0].1, MARGIN_MM, ctx.y - pt_to_mm(13.0), 9.5, &fr, TEXT_CLR);
        if let Some(right) = pair.get(1) {
            let x2 = MARGIN_MM + CONTENT_W_MM / 2.0;
            ctx.draw_text(right.0, x2, ctx.y, 8.0, &fb, MUTED);
            ctx.draw_text(right.1, x2, ctx.y - pt_to_mm(13.0), 9.5, &fr, TEXT_CLR);
        }
        ctx.y -= pt_to_mm(30.0);
    }

    ctx.y -= pt_to_mm(4.0);
    { let l = ctx.layer(); draw_hline(&l, ctx.y, BORDER); }
    ctx.y -= pt_to_mm(16.0);

    let fb = ctx.font_bold.clone();
    let fm = ctx.font_mono.clone();
    let compact_verify = compact_verify_url(&req.verify_url, &req.content_hash);
    let hash_lines = wrap_long_text(&req.content_hash, CONTENT_W_MM - pt_to_mm(58.0), 6.0, true);
    let show_encrypted_ipfs = req.encrypted_at_rest && req.ipfs_cid.is_some();
    let ipfs_lines = req
        .ipfs_cid
        .as_deref()
        .filter(|_| show_encrypted_ipfs)
        .map(|cid| wrap_long_text(cid, CONTENT_W_MM - pt_to_mm(58.0), 6.15, true))
        .unwrap_or_default();
    let verify_lines = wrap_long_text(&compact_verify, CONTENT_W_MM - pt_to_mm(58.0), 6.0, true);
    let verification_card_h =
        pt_to_mm(32.0 + hash_lines.len() as f32 * 9.5 + ipfs_lines.len() as f32 * 10.0 + verify_lines.len() as f32 * 9.5 + 16.0);
    let verification_top = ctx.y;

    {
        let layer = ctx.layer();
        draw_rect(&layer, MARGIN_MM, verification_top - verification_card_h, CONTENT_W_MM, verification_card_h, SUBTLE_BG);
        draw_rect(&layer, MARGIN_MM, verification_top - verification_card_h, pt_to_mm(3.0), verification_card_h, ACCENT);
    }

    let note_hint = "Open the note icon for proof details";
    let note_hint_width = measure_text_mm(note_hint, 5.5, false);
    let mut info_y = verification_top - pt_to_mm(11.0);
    ctx.draw_text("Verification", MARGIN_MM + pt_to_mm(12.0), info_y, 8.5, &fb, TEXT_CLR);
    ctx.draw_text(
        note_hint,
        PAGE_W_MM - MARGIN_MM - note_hint_width - pt_to_mm(18.0),
        info_y,
        5.5,
        &ctx.font_regular.clone(),
        MUTED,
    );
    info_y -= pt_to_mm(14.0);
    ctx.draw_text("SHA-256", MARGIN_MM + pt_to_mm(12.0), info_y, 5.5, &fb, MUTED);
    let mut hash_y = info_y - pt_to_mm(0.5);
    for line in &hash_lines {
        ctx.draw_text(line, MARGIN_MM + pt_to_mm(54.0), hash_y, 6.0, &fm, SECONDARY);
        hash_y -= pt_to_mm(9.0);
    }
    info_y = hash_y - pt_to_mm(2.0);
    if show_encrypted_ipfs {
        if let Some(ipfs_cid) = &req.ipfs_cid {
            ctx.draw_text("ENCRYPTED IPFS", MARGIN_MM + pt_to_mm(12.0), info_y, 5.5, &fb, MUTED);
            let mut ipfs_y = info_y - pt_to_mm(0.5);
            for line in wrap_long_text(ipfs_cid, CONTENT_W_MM - pt_to_mm(58.0), 6.15, true) {
                ctx.draw_text(&line, MARGIN_MM + pt_to_mm(54.0), ipfs_y, 6.15, &fm, ACCENT);
                ipfs_y -= pt_to_mm(9.5);
            }
            info_y = ipfs_y - pt_to_mm(2.0);
        }
    }
    ctx.draw_text("VERIFY", MARGIN_MM + pt_to_mm(12.0), info_y, 5.5, &fb, MUTED);
    let mut verify_y = info_y - pt_to_mm(0.5);
    for line in &verify_lines {
        ctx.draw_text(line, MARGIN_MM + pt_to_mm(54.0), verify_y, 6.0, &fm, SECONDARY);
        verify_y -= pt_to_mm(9.0);
    }
    ctx.y = verification_top - verification_card_h - pt_to_mm(12.0);

    // ═══ DOCUMENT CONTENT ════════════════════════════════════════════════════

    ctx.ensure_space(pt_to_mm(56.0));
    { let l = ctx.layer(); draw_hline(&l, ctx.y, BORDER); }
    ctx.y -= pt_to_mm(18.0);
    let fb = ctx.font_bold.clone();
    ctx.draw_text("Document Content", MARGIN_MM, ctx.y, 12.0, &fb, TEXT_CLR);
    ctx.y -= pt_to_mm(20.0);

    let fr = ctx.font_regular.clone();
    let fb = ctx.font_bold.clone();
    for line in &content_lines {
            if line.is_empty() {
                ctx.y -= pt_to_mm(8.0);
                continue;
            }

            let full_text = line.iter().filter_map(|segment| match segment {
                ContentSegment::Text { text } => Some(text.as_str()),
                _ => None,
            }).collect::<String>();
            let trimmed = full_text.trim();
            let all_text = line.iter().all(|segment| matches!(segment, ContentSegment::Text { .. }));

            if all_text && !trimmed.is_empty() {
                let is_heading = Regex::new(r"^\d+\.\s+\S").unwrap().is_match(trimmed)
                    || Regex::new(r"^(?:SECTION|ARTICLE|CLAUSE)\s").unwrap().is_match(trimmed)
                    || (trimmed == trimmed.to_uppercase() && trimmed.len() > 3 && trimmed.len() < 80);
                let is_bullet = Regex::new(r"^[-*•(]").unwrap().is_match(trimmed);
                if is_heading {
                    ctx.ensure_space(pt_to_mm(20.0));
                    ctx.y -= pt_to_mm(6.0);
                    for wrapped in wrap_text(trimmed, CONTENT_W_MM, 12.0) {
                        ctx.draw_text(&wrapped, MARGIN_MM, ctx.y, 12.0, &fb, TEXT_CLR);
                        ctx.y -= pt_to_mm(12.0 * 1.45);
                    }
                    ctx.y -= pt_to_mm(4.0);
                } else {
                    let x = if is_bullet { MARGIN_MM + pt_to_mm(14.0) } else { MARGIN_MM };
                    let width = if is_bullet { CONTENT_W_MM - pt_to_mm(14.0) } else { CONTENT_W_MM };
                    for wrapped in wrap_text(trimmed, width, 9.5) {
                        ctx.ensure_space(pt_to_mm(14.0));
                        ctx.draw_text(&wrapped, x, ctx.y, 9.5, &fr, SECONDARY);
                        ctx.y -= pt_to_mm(9.5 * 1.45);
                    }
                }
            } else {
                render_structured_content_line(&mut ctx, line);
            }
        }
    if !field_summary.is_empty() {
        render_completed_fields(&mut ctx, &field_summary, req.field_summary_style.as_deref().unwrap_or("hybrid"));
    }

    // ═══ SIGNATURES ══════════════════════════════════════════════════════════

    ctx.ensure_space(pt_to_mm(120.0));
    { let l = ctx.layer(); draw_hline(&l, ctx.y, BORDER); }
    ctx.y -= pt_to_mm(18.0);
    let fb = ctx.font_bold.clone();
    let fr = ctx.font_regular.clone();
    let fm = ctx.font_mono.clone();
    ctx.draw_text("Signatures", MARGIN_MM, ctx.y, 12.0, &fb, TEXT_CLR);
    ctx.y -= pt_to_mm(6.0);
    ctx.draw_text("Cryptographic wallet signatures from all parties", MARGIN_MM, ctx.y, 8.0, &fr, MUTED);
    ctx.y -= pt_to_mm(20.0);

    for signer in &req.signers {
        let is_signed = signer.status == "SIGNED";
        let has_hand_signature = signer
            .hand_signature_data
            .as_deref()
            .map(is_svg_data_url)
            .unwrap_or(false);
        let card_h = if is_signed {
            if has_hand_signature {
                pt_to_mm(152.0)
            } else {
                pt_to_mm(96.0)
            }
        } else {
            pt_to_mm(58.0)
        };

        ctx.ensure_space(card_h + pt_to_mm(12.0));

        {
            let l = ctx.layer();
            draw_rect(&l, MARGIN_MM, ctx.y - card_h + pt_to_mm(14.0), CONTENT_W_MM, card_h, SUBTLE_BG);
            let bar_color = if is_signed { SUCCESS } else { PENDING };
            draw_rect(&l, MARGIN_MM, ctx.y - card_h + pt_to_mm(14.0), pt_to_mm(3.0), card_h, bar_color);
        }

        let mut cy = ctx.y;

        // Name
        ctx.draw_text(&signer.label, MARGIN_MM + pt_to_mm(14.0), cy, 12.0, &fb, TEXT_CLR);

        // Status pill
        let (pill_text, pill_color) = if is_signed { ("SIGNED", SUCCESS) } else { ("PENDING", PENDING) };
        let pill_width = measure_text_mm(pill_text, 7.0, false) + pt_to_mm(16.0);
        let pill_x = PAGE_W_MM - MARGIN_MM - pill_width - pt_to_mm(10.0);
        {
            let l = ctx.layer();
            draw_rect(&l, pill_x, cy - pt_to_mm(6.0), pill_width, pt_to_mm(14.0), pill_color);
        }
        ctx.draw_text(pill_text, pill_x + pt_to_mm(8.0), cy - pt_to_mm(4.0), 7.0, &fb, WHITE);
        cy -= pt_to_mm(18.0);

        // Chain + address
        let chain = signer.chain.as_deref().unwrap_or("\u{2014}");
        let addr = signer.address.as_ref().map(|a| {
            if a.len() > 22 { format!("{}\u{00B7}\u{00B7}\u{00B7}{}", &a[..12], &a[a.len()-10..]) }
            else { a.clone() }
        }).unwrap_or_else(|| "Not connected".into());
        ctx.draw_text(&format!("{chain}  {addr}"), MARGIN_MM + pt_to_mm(14.0), cy, 8.0, &fm, SECONDARY);
        cy -= pt_to_mm(16.0);

        if is_signed {
            let scheme = signer.scheme.as_deref().unwrap_or("\u{2014}");
            let at = signer.signed_at.as_deref().unwrap_or("\u{2014}");
            ctx.draw_text(&format!("Scheme: {scheme}"), MARGIN_MM + pt_to_mm(14.0), cy, 7.0, &fr, MUTED);
            ctx.draw_text(&format!("Signed: {at}"), MARGIN_MM + pt_to_mm(14.0) + CONTENT_W_MM / 2.0, cy, 7.0, &fr, MUTED);
            cy -= pt_to_mm(14.0);

            if let Some(sig) = &signer.signature {
                let preview = if sig.len() > 70 {
                    format!("{}...{}", &sig[..32], &sig[sig.len()-32..])
                } else { sig.clone() };
                ctx.draw_text(&preview, MARGIN_MM + pt_to_mm(14.0), cy, 5.5, &fm, MUTED);
                cy -= pt_to_mm(14.0);
            }

            if let Some(hand_sig) = &signer.hand_signature_data {
                if is_svg_data_url(hand_sig) {
                    let layer = ctx.layer();
                    ctx.draw_text("Handwritten signature", MARGIN_MM + pt_to_mm(14.0), cy, 6.75, &fr, MUTED);
                    cy -= pt_to_mm(8.0);
                    if let Some((draw_w, draw_h)) = draw_signature_svg(
                        &layer,
                        hand_sig,
                        MARGIN_MM + pt_to_mm(14.0),
                        cy + pt_to_mm(12.0),
                        pt_to_mm(164.0),
                        pt_to_mm(42.0),
                    ) {
                        layer.set_outline_color(rgb_color(BORDER));
                        layer.set_outline_thickness(0.35);
                        layer.add_line(Line {
                            points: vec![
                                (Point::new(Mm(MARGIN_MM + pt_to_mm(14.0)), Mm(cy - draw_h - pt_to_mm(2.0))), false),
                                (Point::new(Mm(MARGIN_MM + pt_to_mm(14.0) + draw_w.max(pt_to_mm(86.0))), Mm(cy - draw_h - pt_to_mm(2.0))), false),
                            ],
                            is_closed: false,
                        });
                        cy -= draw_h + pt_to_mm(14.0);
                    }
                }
            }

            if let Some(ink_hash) = &signer.hand_signature_hash {
                ctx.draw_text(&format!("Ink SHA-256: {ink_hash}"), MARGIN_MM + pt_to_mm(14.0), cy, 5.5, &fm, MUTED);
            }
        }

        ctx.y -= card_h + pt_to_mm(8.0);
    }

    // ═══ FORENSIC EVIDENCE ═══════════════════════════════════════════════════

    let forensic_signers: Vec<&SignerInfo> = req.signers.iter()
        .filter(|s| s.status == "SIGNED" && s.forensic_evidence.is_some())
        .collect();

    if !forensic_signers.is_empty() {
        ctx.ensure_space(pt_to_mm(60.0));
        { let l = ctx.layer(); draw_hline(&l, ctx.y, BORDER); }
        ctx.y -= pt_to_mm(18.0);
        ctx.draw_text("Forensic Evidence", MARGIN_MM, ctx.y, 12.0, &fb, TEXT_CLR);
        ctx.y -= pt_to_mm(6.0);
        ctx.draw_text("Device fingerprint, geolocation & behavioral data", MARGIN_MM, ctx.y, 8.0, &fr, MUTED);
        ctx.y -= pt_to_mm(20.0);

        for signer in &forensic_signers {
            if let Some(fe) = &signer.forensic_evidence {
                let lines = extract_forensic_lines(fe);
                let card_h = pt_to_mm(26.0 + lines.len() as f32 * 11.0);

                ctx.ensure_space(card_h + pt_to_mm(12.0));

                {
                    let l = ctx.layer();
                    draw_rect(&l, MARGIN_MM, ctx.y - card_h + pt_to_mm(10.0), CONTENT_W_MM, card_h, SUBTLE_BG);
                    draw_rect(&l, MARGIN_MM, ctx.y - card_h + pt_to_mm(10.0), pt_to_mm(3.0), card_h, SUCCESS);
                }

                ctx.draw_text(&signer.label, MARGIN_MM + pt_to_mm(14.0), ctx.y, 10.0, &fb, TEXT_CLR);
                ctx.y -= pt_to_mm(18.0);

                for line in &lines {
                    ctx.draw_text(line, MARGIN_MM + pt_to_mm(14.0), ctx.y, 7.0, &fm, SECONDARY);
                    ctx.y -= pt_to_mm(11.0);
                }
                ctx.y -= pt_to_mm(8.0);
            }
        }
    }

    // ═══ VERIFICATION ════════════════════════════════════════════════════════

    ctx.ensure_space(pt_to_mm(90.0));
    { let l = ctx.layer(); draw_hline(&l, ctx.y, BORDER); }
    ctx.y -= pt_to_mm(18.0);
    ctx.draw_text("Verification", MARGIN_MM, ctx.y, 12.0, &fb, TEXT_CLR);
    ctx.y -= pt_to_mm(20.0);

    for line in [
        if show_encrypted_ipfs {
            "This document is signed with cryptographic wallet signatures and verified by its SHA-256 fingerprint."
        } else {
            "This document was signed using cryptographic wallet signatures."
        },
        if show_encrypted_ipfs {
            "The IPFS CID below identifies the encrypted payload only. The document itself is verified with SHA-256."
        } else {
            "Each signature is independently verifiable using the wallet address and proof record."
        },
    ] {
        ctx.draw_text(line, MARGIN_MM, ctx.y, 8.0, &fr, SECONDARY);
        ctx.y -= pt_to_mm(14.0);
    }
    ctx.y -= pt_to_mm(4.0);
    ctx.draw_text("Verify online:", MARGIN_MM, ctx.y, 8.0, &fb, MUTED);
    ctx.y -= pt_to_mm(13.0);
    ctx.draw_text(&compact_verify_url(&req.verify_url, &req.content_hash), MARGIN_MM, ctx.y, 8.0, &fm, ACCENT);
    ctx.y -= pt_to_mm(14.0);
    ctx.draw_text("SHA-256:", MARGIN_MM, ctx.y, 7.0, &fb, MUTED);
    ctx.y -= pt_to_mm(11.0);
    for line in wrap_long_text(&req.content_hash, CONTENT_W_MM, 6.25, true) {
        ctx.draw_text(&line, MARGIN_MM, ctx.y, 6.25, &fm, MUTED);
        ctx.y -= pt_to_mm(9.0);
    }
    if show_encrypted_ipfs {
        if let Some(ipfs_cid) = &req.ipfs_cid {
            ctx.y -= pt_to_mm(6.0);
            ctx.draw_text("Encrypted payload IPFS CID:", MARGIN_MM, ctx.y, 7.0, &fb, MUTED);
            ctx.y -= pt_to_mm(11.0);
            for line in wrap_long_text(ipfs_cid, CONTENT_W_MM, 6.25, true) {
                ctx.draw_text(&line, MARGIN_MM, ctx.y, 6.25, &fm, MUTED);
                ctx.y -= pt_to_mm(9.0);
            }
        }
    }

    // ═══ SAVE ════════════════════════════════════════════════════════════════

    stamp_footers(&ctx, &req.content_hash);

    let mut buf = BufWriter::new(Vec::new());
    ctx.doc.save(&mut buf)?;
    attach_cover_verification_note(
        buf.into_inner()?,
        &req.content_hash,
        req.encrypted_at_rest,
        req.ipfs_cid.as_deref(),
        &req.verify_url,
        verification_top,
        verification_card_h,
    )
}

fn extract_forensic_lines(fe: &serde_json::Value) -> Vec<String> {
    if let Some(summary) = fe.get("pdfSummary").and_then(|value| value.get("lines")).and_then(|value| value.as_array()) {
        let lines: Vec<String> = summary
            .iter()
            .filter_map(|line| line.as_str().map(|line| line.to_string()))
            .collect();
        if !lines.is_empty() {
            return lines;
        }
    }

    let mut lines = Vec::new();
    if let Some(fp) = fe.get("fingerprint") {
        if let Some(vid) = fp.get("visitorId").and_then(|v| v.as_str()) {
            lines.push(format!("Device ID: {vid}"));
        }
        if let Some(pid) = fp.get("persistentId").and_then(|v| v.as_str()) {
            lines.push(format!("Persistent ID: {pid}"));
        }
    }
    if let Some(geo) = fe.get("geo") {
        let parts: Vec<&str> = ["city", "region", "country"].iter()
            .filter_map(|k| geo.get(k).and_then(|v| v.as_str()))
            .collect();
        if !parts.is_empty() { lines.push(format!("Location: {}", parts.join(", "))); }
        if let Some(isp) = geo.get("isp").and_then(|v| v.as_str()) {
            lines.push(format!("ISP: {isp}"));
        }
    }
    if let Some(rdns) = fe.get("reverseDns").and_then(|v| v.as_str()) {
        lines.push(format!("Reverse DNS: {rdns}"));
    }
    if let Some(beh) = fe.get("behavioral") {
        if let Some(top) = beh.get("timeOnPage").and_then(|v| v.as_f64()) {
            let scroll = beh.get("maxScrollDepth").and_then(|v| v.as_f64()).unwrap_or(0.0);
            lines.push(format!("Time on page: {}s, Scroll: {scroll}%", (top / 1000.0).round()));
        }
    }
    if let Some(eh) = fe.get("evidenceHash").and_then(|v| v.as_str()) {
        lines.push(format!("Evidence SHA-256: {eh}"));
    }
    lines
}
