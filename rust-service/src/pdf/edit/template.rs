//! Create blank templates from filled PDFs — clears field values while
//! preserving the document structure and field definitions.

use base64::Engine;
use lopdf::{Document, Object};

use super::types::PdfEditResult;

/// Create a blank template by clearing all (or specified) field values.
pub fn create_blank_template(
    pdf_bytes: &[u8],
    fields_to_clear: &[String],
) -> Result<PdfEditResult, anyhow::Error> {
    let mut doc = Document::load_mem(pdf_bytes)?;
    let clear_all = fields_to_clear.is_empty();
    let mut cleared = 0usize;

    let field_ids = collect_all_field_ids(&doc);

    for obj_id in &field_ids {
        let should_clear = if clear_all {
            true
        } else {
            match get_field_name(&doc, *obj_id) {
                Some(name) => fields_to_clear.iter().any(|f| f == &name),
                None => false,
            }
        };

        if should_clear && clear_field(&mut doc, *obj_id) {
            cleared += 1;
        }
    }

    // Set NeedAppearances so viewers regenerate field displays
    set_need_appearances(&mut doc);

    let mut out = Vec::new();
    doc.save_to(&mut out)?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&out);

    Ok(PdfEditResult {
        pdf_base64: b64,
        fields_modified: cleared,
        summary: format!(
            "Created blank template: cleared {cleared} field{}",
            if cleared == 1 { "" } else { "s" }
        ),
    })
}

fn collect_all_field_ids(doc: &Document) -> Vec<lopdf::ObjectId> {
    let mut ids = Vec::new();

    let root_ref = match doc.trailer.get(b"Root") {
        Ok(obj) => obj.clone(),
        Err(_) => return ids,
    };

    let root = match &root_ref {
        Object::Reference(id) => match doc.get_object(*id).and_then(|o| o.as_dict()) {
            Ok(d) => d,
            Err(_) => return ids,
        },
        _ => return ids,
    };

    let acroform = match root.get(b"AcroForm") {
        Ok(Object::Reference(id)) => match doc.get_object(*id).and_then(|o| o.as_dict()) {
            Ok(d) => d,
            Err(_) => return ids,
        },
        Ok(Object::Dictionary(d)) => d,
        _ => return ids,
    };

    let fields = match acroform.get(b"Fields") {
        Ok(Object::Array(arr)) => arr.clone(),
        _ => return ids,
    };

    for field in &fields {
        collect_recursive(doc, field, &mut ids);
    }

    ids
}

fn collect_recursive(doc: &Document, obj: &Object, ids: &mut Vec<lopdf::ObjectId>) {
    let id = match obj {
        Object::Reference(id) => *id,
        _ => return,
    };
    ids.push(id);

    if let Ok(dict) = doc.get_object(id).and_then(|o| o.as_dict()) {
        if let Ok(Object::Array(kids)) = dict.get(b"Kids") {
            let kids = kids.clone();
            for kid in &kids {
                collect_recursive(doc, kid, ids);
            }
        }
    }
}

fn get_field_name(doc: &Document, obj_id: lopdf::ObjectId) -> Option<String> {
    let dict = doc.get_object(obj_id).ok()?.as_dict().ok()?;
    match dict.get(b"T") {
        Ok(Object::String(bytes, _)) => String::from_utf8(bytes.clone()).ok(),
        _ => None,
    }
}

fn clear_field(doc: &mut Document, obj_id: lopdf::ObjectId) -> bool {
    let dict = match doc.get_object_mut(obj_id).and_then(|o| o.as_dict_mut()) {
        Ok(d) => d,
        Err(_) => return false,
    };

    // Check if read-only — don't clear
    if let Ok(Object::Integer(ff)) = dict.get(b"Ff") {
        if *ff & 1 != 0 {
            return false;
        }
    }

    let had_value = dict.get(b"V").is_ok();
    dict.remove(b"V");
    dict.remove(b"AP"); // Remove appearance stream

    had_value
}

fn set_need_appearances(doc: &mut Document) {
    let root_id = match doc.trailer.get(b"Root") {
        Ok(Object::Reference(id)) => *id,
        _ => return,
    };

    let acroform_ref = match doc.get_object(root_id).and_then(|o| o.as_dict()) {
        Ok(root) => match root.get(b"AcroForm") {
            Ok(Object::Reference(id)) => Some(*id),
            _ => None,
        },
        Err(_) => None,
    };

    if let Some(af_id) = acroform_ref {
        if let Ok(af_dict) = doc.get_object_mut(af_id).and_then(|o| o.as_dict_mut()) {
            af_dict.set("NeedAppearances", Object::Boolean(true));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minimal_pdf_bytes() -> Vec<u8> {
        let (doc, _page, _layer) =
            printpdf::PdfDocument::new("Test", printpdf::Mm(210.0), printpdf::Mm(297.0), "Layer");
        let mut buf = std::io::BufWriter::new(Vec::new());
        doc.save(&mut buf).unwrap();
        buf.into_inner().unwrap()
    }

    #[test]
    fn test_create_template_no_fields() {
        let pdf = minimal_pdf_bytes();
        let result = create_blank_template(&pdf, &[]).unwrap();
        assert_eq!(result.fields_modified, 0);
        assert!(result.summary.contains("cleared 0"));
    }
}
