//! PdfCtx struct, drawing primitives, text measurement/wrapping, SVG parsing,
//! inline atom building, and structured content line rendering.

use base64::Engine;
use printpdf::*;
use printpdf::path::{PaintMode, WindingOrder};
use regex::Regex;

use super::theme::*;
use super::types::*;

// ══════════════════════════════════════════════════════════════════════════════
// PDF Context
// ══════════════════════════════════════════════════════════════════════════════

pub(super) struct PdfCtx {
    pub doc: PdfDocumentReference,
    pub current_page: PdfPageIndex,
    pub current_layer: PdfLayerIndex,
    pub pages: Vec<(PdfPageIndex, PdfLayerIndex)>,
    pub y: f32, // mm from bottom
    pub page_count: usize,
    pub font_regular: IndirectFontRef,
    pub font_bold: IndirectFontRef,
    pub font_mono: IndirectFontRef,
}

impl PdfCtx {
    pub fn new_page(&mut self) {
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

    pub fn ensure_space(&mut self, needed_mm: f32) {
        if self.y < FOOTER_Y_MM + needed_mm {
            self.new_page();
        }
    }

    pub fn layer(&self) -> PdfLayerReference {
        self.doc
            .get_page(self.current_page)
            .get_layer(self.current_layer)
    }

    pub fn draw_text(
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

pub(super) fn draw_rect(
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

pub(super) fn draw_hline(layer: &PdfLayerReference, y_mm: f32, color: (f32, f32, f32)) {
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
pub(super) fn wrap_text(text: &str, max_width_mm: f32, font_size_pt: f32) -> Vec<String> {
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

pub(super) fn wrap_long_text(text: &str, max_width_mm: f32, size_pt: f32, mono: bool) -> Vec<String> {
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

pub(super) fn measure_text_mm(text: &str, size_pt: f32, mono: bool) -> f32 {
    let count = text.chars().count() as f32;
    let factor = if mono { 0.215 } else { 0.19 };
    count * size_pt * factor
}

pub(super) fn truncate_to_width(text: &str, size_pt: f32, max_width_mm: f32, mono: bool) -> String {
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

pub(super) fn compact_identifier(value: &str, prefix: usize, suffix: usize) -> String {
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

pub(super) fn compact_verify_url(url: &str, content_hash: &str) -> String {
    let hash_tail = compact_identifier(content_hash, 6, 6);
    if url.contains(content_hash) {
        return url.replace(content_hash, &hash_tail);
    }
    compact_identifier(url, 30, 16)
}

pub(super) fn split_preserve_whitespace(text: &str) -> Vec<String> {
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

pub(super) fn get_empty_field_placeholder(field_type: &str, label: &str) -> String {
    let text = if label.trim().is_empty() { field_type } else { label }.trim();
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= 28 {
        text.to_string()
    } else {
        format!("{}…", chars[..27].iter().collect::<String>())
    }
}

pub(super) fn is_svg_data_url(value: &str) -> bool {
    value.trim_start().starts_with("data:image/svg+xml;base64,")
}

pub(super) fn parse_signature_svg(data_url: &str) -> Option<ParsedSignatureSvg> {
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

pub(super) fn draw_signature_svg(
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

pub(super) fn build_inline_atoms(line: &[ContentSegment]) -> (Vec<InlineAtom>, f32) {
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

pub(super) fn draw_pill(
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

pub(super) fn render_structured_content_line(ctx: &mut PdfCtx, line: &[ContentSegment]) {
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
