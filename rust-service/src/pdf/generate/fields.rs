//! Completed-field rendering (cards, table, hybrid) and field value formatting.

use super::content::{is_image_data_url, resolve_signature_display_value};
use super::draw::*;
use super::theme::*;
use super::types::*;




pub(super) fn format_calendar_date(raw_value: &str) -> String {
    if let Ok(date) = chrono::NaiveDate::parse_from_str(raw_value, "%Y-%m-%d") {
        return date.format("%B %-d, %Y").to_string();
    }
    if let Ok(date_time) = chrono::DateTime::parse_from_rfc3339(raw_value) {
        return date_time.format("%B %-d, %Y").to_string();
    }
    raw_value.to_string()
}

pub(super) fn format_field_value(raw_value: &str, field_type: &str, fallback_signature_data: Option<&str>) -> String {
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

pub(super) fn guess_field_type(label: &str, line_context: &str) -> String {
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




pub(super) fn render_completed_field_cards(ctx: &mut PdfCtx, field_summary: &[FieldSummaryEntry]) {
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

pub(super) fn render_completed_field_table(ctx: &mut PdfCtx, field_summary: &[FieldSummaryEntry]) {
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

pub(super) fn render_completed_field_hybrid(ctx: &mut PdfCtx, field_summary: &[FieldSummaryEntry]) {
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

pub(super) fn render_completed_fields(ctx: &mut PdfCtx, field_summary: &[FieldSummaryEntry], style: &str) {
    match style {
        "cards" => render_completed_field_cards(ctx, field_summary),
        "table" => render_completed_field_table(ctx, field_summary),
        _ => render_completed_field_hybrid(ctx, field_summary),
    }
}
