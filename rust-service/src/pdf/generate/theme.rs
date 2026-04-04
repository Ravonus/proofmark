//! Color constants, layout constants, regex statics, and unit conversion helpers.

use once_cell::sync::Lazy;
use printpdf::*;
use regex::Regex;

// ══════════════════════════════════════════════════════════════════════════════
// Layout constants
// ══════════════════════════════════════════════════════════════════════════════

pub(super) const PAGE_W_MM: f32 = 215.9; // Letter width
pub(super) const PAGE_H_MM: f32 = 279.4; // Letter height
pub(super) const MARGIN_MM: f32 = 17.64; // ~50pt
pub(super) const CONTENT_W_MM: f32 = PAGE_W_MM - 2.0 * MARGIN_MM;
pub(super) const FOOTER_Y_MM: f32 = 14.0;

// ══════════════════════════════════════════════════════════════════════════════
// Colors (RGB 0-1 as f32)
// ══════════════════════════════════════════════════════════════════════════════

pub(super) const ACCENT: (f32, f32, f32) = (0.28, 0.25, 0.85);
pub(super) const TEXT_CLR: (f32, f32, f32) = (0.12, 0.12, 0.14);
pub(super) const SECONDARY: (f32, f32, f32) = (0.35, 0.35, 0.42);
pub(super) const MUTED: (f32, f32, f32) = (0.55, 0.55, 0.60);
pub(super) const SUCCESS: (f32, f32, f32) = (0.10, 0.60, 0.25);
pub(super) const PENDING: (f32, f32, f32) = (0.85, 0.55, 0.10);
pub(super) const BORDER: (f32, f32, f32) = (0.85, 0.85, 0.88);
pub(super) const SUBTLE_BG: (f32, f32, f32) = (0.97, 0.97, 0.98);
pub(super) const WHITE: (f32, f32, f32) = (1.0, 1.0, 1.0);

// ══════════════════════════════════════════════════════════════════════════════
// Regex statics
// ══════════════════════════════════════════════════════════════════════════════

pub(super) static MARKER_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\{\{W3S_(FIELD|SIGNATURE):([^}]+)\}\}").unwrap());
pub(super) static SIGNATURE_MARKER_EXACT_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\{\{W3S_SIGNATURE:([^}]+)\}\}$").unwrap());
pub(super) static PAGE_NUM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^--\s*\d+\s*of\s*\d+\s*--$").unwrap());
pub(super) static PARTY_ALPHA_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"party\s+([a-z])\b").unwrap());
pub(super) static NUMBERED_HEADING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d+\.\s+\S").unwrap());
pub(super) static SECTION_HEADING_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^(?:section|article|clause|part|schedule|exhibit|appendix|recital)\s+[\dIVXivx]+").unwrap());
pub(super) static SUBHEADING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^\d+\.\d+\.?\d*\s+\S").unwrap());
pub(super) static ALL_CAPS_HEADING_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^[A-Z][A-Z &/,().-]+$").unwrap());
pub(super) static LIST_ITEM_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^\([a-z]\)\s|^\([ivx]+\)\s|^\(\d+\)\s|^[-*•]\s|^[a-z]\)\s|^[ivx]+\)\s").unwrap());
pub(super) static SIGNATURE_LINE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"signature\s*:").unwrap());
pub(super) static UNDERSCORE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"_{3,}").unwrap());
pub(super) static INLINE_FIELD_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?:([A-Za-z\s]+?)\s*:\s*)?_{3,}").unwrap());
pub(super) static IMAGE_DATA_URL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^data:image/[A-Za-z0-9.+-]+;base64,").unwrap());

// ══════════════════════════════════════════════════════════════════════════════
// Unit conversion helpers
// ══════════════════════════════════════════════════════════════════════════════

pub(super) fn pt_to_mm(pt: f32) -> f32 {
    pt * 0.3528
}

pub(super) fn rgb_color(c: (f32, f32, f32)) -> Color {
    Color::Rgb(Rgb::new(c.0, c.1, c.2, None))
}
