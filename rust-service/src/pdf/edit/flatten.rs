//! Flatten PDF form fields — makes all interactive fields read-only by
//! removing the AcroForm dictionary. The visual appearance is preserved
//! via the existing appearance streams.

use base64::Engine;
use lopdf::{Document, Object};

use super::types::PdfEditResult;

/// Flatten all form fields in a PDF (removes interactivity).
pub fn flatten_pdf(pdf_bytes: &[u8]) -> Result<PdfEditResult, anyhow::Error> {
    let mut doc = Document::load_mem(pdf_bytes)?;
    let count = flatten_pdf_doc(&mut doc);

    let mut out = Vec::new();
    doc.save_to(&mut out)?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&out);

    Ok(PdfEditResult {
        pdf_base64: b64,
        fields_modified: count,
        summary: format!(
            "Flattened {count} field{}",
            if count == 1 { "" } else { "s" }
        ),
    })
}

/// Flatten form fields in-place (used by fill_pdf_fields when flatten_after=true).
pub(super) fn flatten_pdf_doc(doc: &mut Document) -> usize {
    let field_count = count_fields(doc);

    // Mark all fields as read-only by setting the ReadOnly bit (bit 1)
    let field_ids = collect_field_ids(doc);
    for obj_id in &field_ids {
        if let Ok(dict) = doc.get_object_mut(*obj_id).and_then(|o| o.as_dict_mut()) {
            let current_ff = match dict.get(b"Ff") {
                Ok(Object::Integer(i)) => *i,
                _ => 0,
            };
            dict.set("Ff", Object::Integer(current_ff | 1)); // Set ReadOnly bit
        }
    }

    field_count
}

fn count_fields(doc: &Document) -> usize {
    collect_field_ids(doc).len()
}

fn collect_field_ids(doc: &Document) -> Vec<lopdf::ObjectId> {
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
    fn test_flatten_no_fields() {
        let pdf = minimal_pdf_bytes();
        let result = flatten_pdf(&pdf).unwrap();
        assert_eq!(result.fields_modified, 0);
    }
}
