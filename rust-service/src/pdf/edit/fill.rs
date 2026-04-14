//! Fill AcroForm fields in an existing PDF.

use base64::Engine;
use lopdf::{Document, Object};

use super::types::{FieldValuePair, PdfEditResult};
use super::flatten::flatten_pdf_doc;

/// Fill form fields in a PDF and return the modified document.
pub fn fill_pdf_fields(
    pdf_bytes: &[u8],
    field_values: &[FieldValuePair],
    flatten_after: bool,
) -> Result<PdfEditResult, anyhow::Error> {
    let mut doc = Document::load_mem(pdf_bytes)?;
    let mut modified = 0usize;

    // Get AcroForm field object IDs
    let field_ids = collect_field_ids(&doc)?;

    for pair in field_values {
        if let Some(&obj_id) = field_ids.iter().find(|&&id| {
            field_name_matches(&doc, id, &pair.name)
        }) {
            if set_field_value(&mut doc, obj_id, &pair.value).is_ok() {
                modified += 1;
            }
        }
    }

    if flatten_after && modified > 0 {
        flatten_pdf_doc(&mut doc);
    }

    let mut out = Vec::new();
    doc.save_to(&mut out)?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(&out);

    Ok(PdfEditResult {
        pdf_base64: b64,
        fields_modified: modified,
        summary: format!(
            "Filled {modified} field{}{}",
            if modified == 1 { "" } else { "s" },
            if flatten_after { " and flattened" } else { "" }
        ),
    })
}

fn collect_field_ids(doc: &Document) -> Result<Vec<lopdf::ObjectId>, anyhow::Error> {
    let root_ref = doc.trailer.get(b"Root")?;
    let root_id = match root_ref {
        Object::Reference(id) => *id,
        _ => return Ok(Vec::new()),
    };

    let root = doc.get_object(root_id)?.as_dict()?;
    let acroform_ref = match root.get(b"AcroForm") {
        Ok(obj) => obj,
        Err(_) => return Ok(Vec::new()),
    };

    let acroform = match acroform_ref {
        Object::Reference(id) => doc.get_object(*id)?.as_dict()?,
        Object::Dictionary(d) => d,
        _ => return Ok(Vec::new()),
    };

    let fields = match acroform.get(b"Fields") {
        Ok(Object::Array(arr)) => arr.clone(),
        _ => return Ok(Vec::new()),
    };

    let mut ids = Vec::new();
    for field in &fields {
        collect_field_ids_recursive(doc, field, &mut ids);
    }

    Ok(ids)
}

fn collect_field_ids_recursive(
    doc: &Document,
    obj: &Object,
    ids: &mut Vec<lopdf::ObjectId>,
) {
    let id = match obj {
        Object::Reference(id) => *id,
        _ => return,
    };

    ids.push(id);

    // Check for Kids
    if let Ok(dict) = doc.get_object(id).and_then(|o| o.as_dict()) {
        if let Ok(Object::Array(kids)) = dict.get(b"Kids") {
            let kids = kids.clone();
            for kid in &kids {
                collect_field_ids_recursive(doc, kid, ids);
            }
        }
    }
}

fn field_name_matches(doc: &Document, obj_id: lopdf::ObjectId, target_name: &str) -> bool {
    let dict = match doc.get_object(obj_id).and_then(|o| o.as_dict()) {
        Ok(d) => d,
        Err(_) => return false,
    };

    if let Ok(Object::String(bytes, _)) = dict.get(b"T") {
        if let Ok(name) = String::from_utf8(bytes.clone()) {
            return name == target_name;
        }
    }

    false
}

fn set_field_value(
    doc: &mut Document,
    obj_id: lopdf::ObjectId,
    value: &str,
) -> Result<(), anyhow::Error> {
    let dict = doc.get_object_mut(obj_id)?.as_dict_mut()?;

    // Set /V (value)
    dict.set(
        "V",
        Object::String(value.as_bytes().to_vec(), lopdf::StringFormat::Literal),
    );

    // Remove existing appearance to force PDF viewer to regenerate
    dict.remove(b"AP");

    // Set NeedAppearances on AcroForm (dict borrow ends here)
    let _ = dict;
    set_need_appearances(doc);

    Ok(())
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
        // Generate a minimal valid PDF using printpdf
        let (doc, _page, _layer) =
            printpdf::PdfDocument::new("Test", printpdf::Mm(210.0), printpdf::Mm(297.0), "Layer");
        let mut buf = std::io::BufWriter::new(Vec::new());
        doc.save(&mut buf).unwrap();
        buf.into_inner().unwrap()
    }

    #[test]
    fn test_fill_fields_no_acroform() {
        let pdf = minimal_pdf_bytes();
        let result = fill_pdf_fields(&pdf, &[], false).unwrap();
        assert_eq!(result.fields_modified, 0);
    }
}
