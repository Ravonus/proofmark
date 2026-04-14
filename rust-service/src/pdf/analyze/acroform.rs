//! AcroForm field extraction — reads interactive form fields from PDFs using lopdf.
//!
//! Extracts text fields, checkboxes, dropdowns, radio groups, and signature fields
//! from PDF AcroForm dictionaries. Handles both filled and blank forms.

use lopdf::{Document, Object};

use super::types::{AcroFormField, AcroFormFieldType};

/// Extract all AcroForm fields from a PDF document.
pub fn extract_acroform_fields(doc: &Document) -> Vec<AcroFormField> {
    let mut fields = Vec::new();

    let acroform = match doc.trailer.get(b"Root") {
        Ok(root_ref) => match resolve_object(doc, root_ref) {
            Some(Object::Dictionary(root)) => match root.get(b"AcroForm") {
                Ok(af_ref) => resolve_object(doc, af_ref),
                Err(_) => None,
            },
            _ => None,
        },
        Err(_) => None,
    };

    let acroform_dict = match acroform {
        Some(Object::Dictionary(dict)) => dict,
        _ => return fields,
    };

    let field_refs = match acroform_dict.get(b"Fields") {
        Ok(Object::Array(arr)) => arr.clone(),
        Ok(obj) => match resolve_object(doc, obj) {
            Some(Object::Array(arr)) => arr,
            _ => return fields,
        },
        Err(_) => return fields,
    };

    for field_ref in &field_refs {
        collect_fields(doc, field_ref, &mut fields, None);
    }

    fields
}

fn collect_fields(
    doc: &Document,
    obj: &Object,
    fields: &mut Vec<AcroFormField>,
    parent_name: Option<&str>,
) {
    let dict = match resolve_object(doc, obj) {
        Some(Object::Dictionary(d)) => d,
        _ => return,
    };

    let partial_name = get_string(doc, dict.get(b"T").ok());
    let full_name = match (&parent_name, &partial_name) {
        (Some(parent), Some(child)) => format!("{parent}.{child}"),
        (None, Some(child)) => child.clone(),
        (Some(parent), None) => parent.to_string(),
        (None, None) => String::new(),
    };

    // Check for Kids (hierarchical fields)
    if let Ok(Object::Array(kids)) = dict.get(b"Kids") {
        let kids = kids.clone();
        for kid in &kids {
            collect_fields(doc, kid, fields, Some(&full_name));
        }
        return;
    }

    // Determine field type from /FT
    let ft = get_name_str(doc, dict.get(b"FT").ok());
    let field_type = match ft.as_deref() {
        Some("Tx") => AcroFormFieldType::Text,
        Some("Btn") => {
            let ff = get_flags(&dict);
            if ff & (1 << 15) != 0 {
                // Radio button
                AcroFormFieldType::Radio
            } else if ff & (1 << 16) != 0 {
                // Pushbutton — skip
                return;
            } else {
                AcroFormFieldType::Checkbox
            }
        }
        Some("Ch") => AcroFormFieldType::Dropdown, // Dropdown & listbox treated identically
        Some("Sig") => AcroFormFieldType::Signature,
        _ => AcroFormFieldType::Text,
    };

    // Get value
    let value = get_string(doc, dict.get(b"V").ok())
        .or_else(|| get_string(doc, dict.get(b"DV").ok()));

    // Check if read-only
    let flags = get_flags(&dict);
    let read_only = flags & 1 != 0;

    // Get options for dropdowns
    let options = if matches!(field_type, AcroFormFieldType::Dropdown) {
        get_options(doc, &dict)
    } else {
        Vec::new()
    };

    // Determine if field is filled
    let filled = value.as_ref().is_some_and(|v| !v.is_empty());

    // Get page index from widget annotation
    let page = get_field_page(doc, obj);

    fields.push(AcroFormField {
        name: full_name,
        field_type,
        value,
        filled,
        read_only,
        options,
        page,
    });
}

fn resolve_object<'a>(doc: &'a Document, obj: &'a Object) -> Option<Object> {
    match obj {
        Object::Reference(id) => doc.get_object(*id).ok().cloned(),
        other => Some(other.clone()),
    }
}

fn get_string(doc: &Document, obj: Option<&Object>) -> Option<String> {
    let obj = obj?;
    match obj {
        Object::String(bytes, _) => String::from_utf8(bytes.clone())
            .ok()
            .or_else(|| Some(bytes.iter().map(|&b| b as char).collect())),
        Object::Name(name) => String::from_utf8(name.clone()).ok(),
        Object::Reference(id) => {
            let resolved = doc.get_object(*id).ok()?;
            get_string(doc, Some(resolved))
        }
        _ => None,
    }
}

fn get_name_str(doc: &Document, obj: Option<&Object>) -> Option<String> {
    let obj = obj?;
    match obj {
        Object::Name(name) => String::from_utf8(name.clone()).ok(),
        Object::Reference(id) => {
            let resolved = doc.get_object(*id).ok()?;
            get_name_str(doc, Some(resolved))
        }
        _ => None,
    }
}

fn get_flags(dict: &lopdf::Dictionary) -> u32 {
    match dict.get(b"Ff") {
        Ok(Object::Integer(i)) => *i as u32,
        _ => 0,
    }
}

fn get_options(doc: &Document, dict: &lopdf::Dictionary) -> Vec<String> {
    let arr = match dict.get(b"Opt") {
        Ok(Object::Array(arr)) => arr.clone(),
        Ok(obj) => match resolve_object(doc, obj) {
            Some(Object::Array(arr)) => arr,
            _ => return Vec::new(),
        },
        Err(_) => return Vec::new(),
    };

    arr.iter()
        .filter_map(|item| match item {
            Object::String(bytes, _) => String::from_utf8(bytes.clone()).ok(),
            Object::Array(pair) if pair.len() >= 2 => get_string(doc, Some(&pair[1])),
            _ => get_string(doc, Some(item)),
        })
        .collect()
}

fn get_field_page(doc: &Document, obj: &Object) -> Option<usize> {
    let dict = match resolve_object(doc, obj) {
        Some(Object::Dictionary(d)) => d,
        _ => return None,
    };

    // Check for /P (page reference)
    let page_ref = match dict.get(b"P") {
        Ok(Object::Reference(id)) => *id,
        _ => return None,
    };

    // Find page index
    let pages = doc.get_pages();
    for (page_num, page_id) in &pages {
        if *page_id == page_ref {
            return Some(*page_num as usize);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_empty_doc() {
        // A minimal valid PDF with no forms should return empty
        let doc = Document::new();
        let fields = extract_acroform_fields(&doc);
        assert!(fields.is_empty());
    }
}
