//! PDF generation engine — produces signed document PDFs with cover page,
//! content, field summaries, signature cards, forensic evidence, and verification.
//!
//! Uses printpdf for PDF construction — optimized for speed over pixel-perfect
//! layout matching (the JS version uses pdf-lib).

mod content;
mod draw;
mod fields;
mod sections;
mod theme;
mod types;

// Re-export the public API
pub use types::PdfGenerateRequest;

use printpdf::*;
use regex::Regex;
use std::io::BufWriter;

use content::parse_content_to_segments;
use draw::*;
use fields::render_completed_fields;
use sections::*;
use theme::*;
use types::*;

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
