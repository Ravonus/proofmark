use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
    pub device_pixel_ratio: f32,
    pub scroll_width: u32,
    pub scroll_height: u32,
}

impl Default for Viewport {
    fn default() -> Self {
        Self {
            width: 0,
            height: 0,
            device_pixel_ratio: 1.0,
            scroll_width: 0,
            scroll_height: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub fn zero() -> Self {
        Self { x: 0.0, y: 0.0, w: 0.0, h: 0.0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageGeometry {
    pub page_index: u32,
    pub width: f32,
    pub height: f32,
    pub offset_y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FieldGeometry {
    pub target_id: u32,
    pub page_index: u32,
    pub rect: Rect,
    pub field_type: FieldType,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[repr(u8)]
pub enum FieldType {
    Text = 1,
    Signature = 2,
    Initials = 3,
    Checkbox = 4,
    Radio = 5,
    Date = 6,
    Dropdown = 7,
}

impl FieldType {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Text,
            2 => Self::Signature,
            3 => Self::Initials,
            4 => Self::Checkbox,
            5 => Self::Radio,
            6 => Self::Date,
            7 => Self::Dropdown,
            _ => Self::Text,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SignaturePadGeometry {
    pub target_id: u32,
    pub page_index: u32,
    pub rect: Rect,
    pub canvas_width: u32,
    pub canvas_height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TargetEntry {
    pub id: u32,
    pub hash: u64,
    pub descriptor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StringEntry {
    pub id: u32,
    pub kind: u8,
    pub hash: u64,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneModel {
    pub viewport: Viewport,
    pub page_count: u32,
    pub pages: Vec<PageGeometry>,
    pub fields: Vec<FieldGeometry>,
    pub signature_pads: Vec<SignaturePadGeometry>,
    pub targets: Vec<TargetEntry>,
    pub strings: Vec<StringEntry>,
}

impl SceneModel {
    pub fn empty() -> Self {
        Self {
            viewport: Viewport::default(),
            page_count: 0,
            pages: Vec::new(),
            fields: Vec::new(),
            signature_pads: Vec::new(),
            targets: Vec::new(),
            strings: Vec::new(),
        }
    }

    pub fn target_descriptor(&self, id: u32) -> Option<&str> {
        self.targets
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.descriptor.as_str())
    }

    pub fn string_value(&self, id: u32) -> Option<&str> {
        self.strings
            .iter()
            .find(|s| s.id == id)
            .map(|s| s.value.as_str())
    }

    pub fn field_at(&self, target_id: u32) -> Option<&FieldGeometry> {
        self.fields.iter().find(|f| f.target_id == target_id)
    }

    pub fn signature_pad_at(&self, target_id: u32) -> Option<&SignaturePadGeometry> {
        self.signature_pads.iter().find(|s| s.target_id == target_id)
    }

    pub fn page_at(&self, index: u32) -> Option<&PageGeometry> {
        self.pages.iter().find(|p| p.page_index == index)
    }

    pub fn total_document_height(&self) -> f32 {
        self.pages
            .iter()
            .map(|p| p.offset_y + p.height)
            .fold(0.0f32, f32::max)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_model_lookups() {
        let scene = SceneModel {
            viewport: Viewport { width: 1024, height: 768, device_pixel_ratio: 2.0, scroll_width: 1024, scroll_height: 3000 },
            page_count: 2,
            pages: vec![
                PageGeometry { page_index: 0, width: 612.0, height: 792.0, offset_y: 0.0 },
                PageGeometry { page_index: 1, width: 612.0, height: 792.0, offset_y: 800.0 },
            ],
            fields: vec![FieldGeometry {
                target_id: 3,
                page_index: 0,
                rect: Rect { x: 100.0, y: 200.0, w: 300.0, h: 40.0 },
                field_type: FieldType::Signature,
            }],
            signature_pads: vec![SignaturePadGeometry {
                target_id: 3,
                page_index: 0,
                rect: Rect { x: 100.0, y: 200.0, w: 300.0, h: 100.0 },
                canvas_width: 600,
                canvas_height: 200,
            }],
            targets: vec![
                TargetEntry { id: 1, hash: 0xabcd, descriptor: "tag:div|id:main".into() },
                TargetEntry { id: 3, hash: 0x1234, descriptor: "tag:canvas|id:sig-pad-1".into() },
            ],
            strings: vec![StringEntry { id: 1, kind: 1, hash: 0x5678, value: "Enter".into() }],
        };

        assert_eq!(scene.target_descriptor(3), Some("tag:canvas|id:sig-pad-1"));
        assert_eq!(scene.string_value(1), Some("Enter"));
        assert!(scene.field_at(3).is_some());
        assert!(scene.signature_pad_at(3).is_some());
        assert_eq!(scene.page_at(1).unwrap().offset_y, 800.0);
        assert!((scene.total_document_height() - 1592.0).abs() < 0.01);
    }

    #[test]
    fn field_type_roundtrip() {
        for v in 1..=7 {
            let ft = FieldType::from_u8(v);
            assert_eq!(ft as u8, v);
        }
        assert_eq!(FieldType::from_u8(255), FieldType::Text);
    }
}
