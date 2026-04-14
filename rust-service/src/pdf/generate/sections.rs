//! Footer stamping, page annotation, cover verification note, forensic evidence extraction.

use ::lopdf::{dictionary, Document as LoDocument, Object as LoObject, ObjectId as LoObjectId};
use printpdf::Mm;

use super::draw::*;
use super::theme::*;




pub(super) fn stamp_footers(ctx: &PdfCtx, content_hash: &str) {
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




pub(super) fn append_page_annotation(
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

pub(super) fn attach_cover_verification_note(
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




pub(super) fn extract_forensic_lines(fe: &serde_json::Value) -> Vec<String> {
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
