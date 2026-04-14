use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

use crate::format::{
    ReplayClipboardAction, ReplayNavDirection, ReplayOp, REPLAY_TIME_QUANTUM_MS,
    SIGNATURE_TEXT_ENCODING,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimedSignaturePoint {
    pub x: f64,
    pub y: f64,
    pub t: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force: Option<f64>,
}

pub type TimedSignatureStroke = Vec<TimedSignaturePoint>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ReplayEncodedEvent {
    Scroll {
        delta: u32,
        scroll_y: u32,
        scroll_max: u32,
    },
    Click {
        delta: u32,
        target_id: u32,
        x: u32,
        y: u32,
        button: u32,
    },
    Key {
        delta: u32,
        target_id: u32,
        key_id: u32,
        modifiers: u32,
    },
    Focus {
        delta: u32,
        target_id: u32,
    },
    Blur {
        delta: u32,
        target_id: u32,
    },
    Visibility {
        delta: u32,
        hidden: bool,
    },
    Highlight {
        delta: u32,
        target_id: u32,
        label_id: u32,
    },
    Navigation {
        delta: u32,
        direction: String,
        target_id: u32,
        index: u32,
    },
    Page {
        delta: u32,
        page: u32,
        total_pages: u32,
    },
    Modal {
        delta: u32,
        name_id: u32,
        open: bool,
    },
    SignatureStart {
        delta: u32,
        target_id: u32,
        stroke_id: u32,
        x: u32,
        y: u32,
        pressure: u8,
    },
    SignaturePoint {
        delta: u32,
        stroke_id: u32,
        x: u32,
        y: u32,
        pressure: u8,
    },
    SignatureEnd {
        delta: u32,
        stroke_id: u32,
    },
    SignatureCommit {
        delta: u32,
        target_id: u32,
        signature_id: u32,
    },
    SignatureClear {
        delta: u32,
        target_id: u32,
    },
    FieldCommit {
        delta: u32,
        target_id: u32,
        value_id: u32,
    },
    Clipboard {
        delta: u32,
        action: String,
        target_id: u32,
        summary_id: u32,
    },
    ContextMenu {
        delta: u32,
        target_id: u32,
        x: u32,
        y: u32,
    },
    // v2: packed mouse move — dx/dy as i16 deltas from last known position
    MouseMove {
        delta: u32,
        dx: i32,
        dy: i32,
    },
    HoverDwell {
        delta: u32,
        target_id: u32,
        duration_ms: u32,
    },
    ViewportResize {
        delta: u32,
        width: u32,
        height: u32,
    },
    TouchStart {
        delta: u32,
        x: u32,
        y: u32,
        radius: u8,
        force: u8,
    },
    TouchMove {
        delta: u32,
        dx: i32,
        dy: i32,
        radius: u8,
        force: u8,
    },
    TouchEnd {
        delta: u32,
    },
    FieldCorrection {
        delta: u32,
        target_id: u32,
        correction_kind: u8,
        count: u32,
    },
    ScrollMomentum {
        delta: u32,
        velocity: i32,
        deceleration: u32,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayEncodedPayload {
    pub tape_base64: String,
    pub byte_length: usize,
}

fn round_to_u32(value: f64) -> u32 {
    if !value.is_finite() || value <= 0.0 {
        0
    } else {
        value.round() as u32
    }
}

fn round_to_u8(value: f64) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

fn write_var_uint(bytes: &mut Vec<u8>, value: u32) {
    let mut next = value;
    while next >= 0x80 {
        bytes.push(((next & 0x7f) as u8) | 0x80);
        next >>= 7;
    }
    bytes.push(next as u8);
}

fn write_var_int(bytes: &mut Vec<u8>, value: i32) {
    let zigzag = ((value << 1) ^ (value >> 31)) as u32;
    write_var_uint(bytes, zigzag);
}

fn read_var_uint(bytes: &[u8], offset: &mut usize) -> Option<u32> {
    let mut result = 0u32;
    let mut shift = 0u32;
    while *offset < bytes.len() {
        let byte = bytes[*offset];
        *offset += 1;
        result |= ((byte & 0x7f) as u32) << shift;
        if (byte & 0x80) == 0 {
            return Some(result);
        }
        shift += 7;
    }
    None
}

fn read_var_int(bytes: &[u8], offset: &mut usize) -> Option<i32> {
    let zigzag = read_var_uint(bytes, offset)? as i32;
    Some(if (zigzag & 1) == 1 {
        -((zigzag + 1) >> 1)
    } else {
        zigzag >> 1
    })
}

fn nav_direction_code(direction: &str) -> u32 {
    match direction {
        "prev" => ReplayNavDirection::Prev as u32,
        "next" => ReplayNavDirection::Next as u32,
        _ => ReplayNavDirection::Jump as u32,
    }
}

fn nav_direction_name(code: u32) -> String {
    match code {
        1 => "prev",
        2 => "next",
        _ => "jump",
    }
    .to_string()
}

fn clipboard_action_code(action: &str) -> u32 {
    match action {
        "copy" => ReplayClipboardAction::Copy as u32,
        "cut" => ReplayClipboardAction::Cut as u32,
        _ => ReplayClipboardAction::Paste as u32,
    }
}

fn clipboard_action_name(code: u32) -> String {
    match code {
        1 => "copy",
        2 => "cut",
        _ => "paste",
    }
    .to_string()
}

pub fn encode_signature(strokes: &[TimedSignatureStroke]) -> String {
    let mut bytes = Vec::new();
    write_var_uint(&mut bytes, strokes.len() as u32);
    for stroke in strokes {
        write_var_uint(&mut bytes, stroke.len() as u32);
        let mut last_x = 0u32;
        let mut last_y = 0u32;
        let mut last_t = 0u32;
        for (index, point) in stroke.iter().enumerate() {
            let x = round_to_u32(point.x);
            let y = round_to_u32(point.y);
            let t = round_to_u32(point.t / REPLAY_TIME_QUANTUM_MS as f64);
            if index == 0 {
                write_var_uint(&mut bytes, x);
                write_var_uint(&mut bytes, y);
                write_var_uint(&mut bytes, t);
            } else {
                write_var_int(&mut bytes, x as i32 - last_x as i32);
                write_var_int(&mut bytes, y as i32 - last_y as i32);
                write_var_uint(&mut bytes, t.saturating_sub(last_t));
            }
            bytes.push(round_to_u8(point.force.unwrap_or(0.0) * 255.0));
            last_x = x;
            last_y = y;
            last_t = t;
        }
    }
    format!("{}:{}", SIGNATURE_TEXT_ENCODING, STANDARD.encode(bytes))
}

pub fn decode_signature(encoded: &str) -> Vec<TimedSignatureStroke> {
    let prefix = format!("{}:", SIGNATURE_TEXT_ENCODING);
    if !encoded.starts_with(&prefix) {
        return Vec::new();
    }
    let Ok(bytes) = STANDARD.decode(&encoded[prefix.len()..]) else {
        return Vec::new();
    };
    let mut offset = 0usize;
    let Some(stroke_count) = read_var_uint(&bytes, &mut offset) else {
        return Vec::new();
    };
    let mut strokes = Vec::with_capacity(stroke_count as usize);
    for _ in 0..stroke_count {
        let Some(point_count) = read_var_uint(&bytes, &mut offset) else {
            return Vec::new();
        };
        let mut stroke = Vec::with_capacity(point_count as usize);
        let mut last_x = 0u32;
        let mut last_y = 0u32;
        let mut last_t = 0u32;
        for point_index in 0..point_count {
            let (x, y, t) = if point_index == 0 {
                let Some(x) = read_var_uint(&bytes, &mut offset) else {
                    return Vec::new();
                };
                let Some(y) = read_var_uint(&bytes, &mut offset) else {
                    return Vec::new();
                };
                let Some(t) = read_var_uint(&bytes, &mut offset) else {
                    return Vec::new();
                };
                (x, y, t)
            } else {
                let Some(dx) = read_var_int(&bytes, &mut offset) else {
                    return Vec::new();
                };
                let Some(dy) = read_var_int(&bytes, &mut offset) else {
                    return Vec::new();
                };
                let Some(dt) = read_var_uint(&bytes, &mut offset) else {
                    return Vec::new();
                };
                (
                    (last_x as i32 + dx).max(0) as u32,
                    (last_y as i32 + dy).max(0) as u32,
                    last_t + dt,
                )
            };
            let Some(force) = bytes.get(offset) else {
                return Vec::new();
            };
            offset += 1;
            stroke.push(TimedSignaturePoint {
                x: x as f64,
                y: y as f64,
                t: (t * REPLAY_TIME_QUANTUM_MS as u32) as f64,
                force: Some(*force as f64 / 255.0),
            });
            last_x = x;
            last_y = y;
            last_t = t;
        }
        strokes.push(stroke);
    }
    strokes
}

pub fn encode_replay_events(events: &[ReplayEncodedEvent]) -> ReplayEncodedPayload {
    let mut bytes = Vec::new();
    let mut signature_points: HashMap<u32, (u32, u32)> = HashMap::new();

    for event in events {
        match event {
            ReplayEncodedEvent::Scroll {
                delta,
                scroll_y,
                scroll_max,
            } => {
                bytes.push(ReplayOp::Scroll as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *scroll_y);
                write_var_uint(&mut bytes, *scroll_max);
            }
            ReplayEncodedEvent::Click {
                delta,
                target_id,
                x,
                y,
                button,
            } => {
                bytes.push(ReplayOp::Click as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *target_id);
                write_var_uint(&mut bytes, *x);
                write_var_uint(&mut bytes, *y);
                write_var_uint(&mut bytes, *button);
            }
            ReplayEncodedEvent::Key {
                delta,
                target_id,
                key_id,
                modifiers,
            } => {
                bytes.push(ReplayOp::Key as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *target_id);
                write_var_uint(&mut bytes, *key_id);
                write_var_uint(&mut bytes, *modifiers);
            }
            ReplayEncodedEvent::Focus { delta, target_id } => {
                bytes.push(ReplayOp::Focus as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *target_id);
            }
            ReplayEncodedEvent::Blur { delta, target_id } => {
                bytes.push(ReplayOp::Blur as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *target_id);
            }
            ReplayEncodedEvent::Visibility { delta, hidden } => {
                bytes.push(ReplayOp::Visibility as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, if *hidden { 1 } else { 0 });
            }
            ReplayEncodedEvent::Highlight {
                delta,
                target_id,
                label_id,
            } => {
                bytes.push(ReplayOp::Highlight as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *target_id);
                write_var_uint(&mut bytes, *label_id);
            }
            ReplayEncodedEvent::Navigation {
                delta,
                direction,
                target_id,
                index,
            } => {
                bytes.push(ReplayOp::Navigation as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, nav_direction_code(direction));
                write_var_uint(&mut bytes, *target_id);
                write_var_uint(&mut bytes, *index);
            }
            ReplayEncodedEvent::Page {
                delta,
                page,
                total_pages,
            } => {
                bytes.push(ReplayOp::Page as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *page);
                write_var_uint(&mut bytes, *total_pages);
            }
            ReplayEncodedEvent::Modal {
                delta,
                name_id,
                open,
            } => {
                bytes.push(ReplayOp::Modal as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *name_id);
                write_var_uint(&mut bytes, if *open { 1 } else { 0 });
            }
            ReplayEncodedEvent::SignatureStart {
                delta,
                target_id,
                stroke_id,
                x,
                y,
                pressure,
            } => {
                signature_points.insert(*stroke_id, (*x, *y));
                bytes.push(ReplayOp::SignatureStart as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *target_id);
                write_var_uint(&mut bytes, *stroke_id);
                write_var_uint(&mut bytes, *x);
                write_var_uint(&mut bytes, *y);
                write_var_uint(&mut bytes, *pressure as u32);
            }
            ReplayEncodedEvent::SignaturePoint {
                delta,
                stroke_id,
                x,
                y,
                pressure,
            } => {
                let (last_x, last_y) = signature_points
                    .get(stroke_id)
                    .copied()
                    .unwrap_or((0, 0));
                signature_points.insert(*stroke_id, (*x, *y));
                bytes.push(ReplayOp::SignaturePoint as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *stroke_id);
                write_var_int(&mut bytes, *x as i32 - last_x as i32);
                write_var_int(&mut bytes, *y as i32 - last_y as i32);
                write_var_uint(&mut bytes, *pressure as u32);
            }
            ReplayEncodedEvent::SignatureEnd { delta, stroke_id } => {
                signature_points.remove(stroke_id);
                bytes.push(ReplayOp::SignatureEnd as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *stroke_id);
            }
            ReplayEncodedEvent::SignatureCommit {
                delta,
                target_id,
                signature_id,
            } => {
                bytes.push(ReplayOp::SignatureCommit as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *target_id);
                write_var_uint(&mut bytes, *signature_id);
            }
            ReplayEncodedEvent::SignatureClear { delta, target_id } => {
                bytes.push(ReplayOp::SignatureClear as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *target_id);
            }
            ReplayEncodedEvent::FieldCommit {
                delta,
                target_id,
                value_id,
            } => {
                bytes.push(ReplayOp::FieldCommit as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *target_id);
                write_var_uint(&mut bytes, *value_id);
            }
            ReplayEncodedEvent::Clipboard {
                delta,
                action,
                target_id,
                summary_id,
            } => {
                bytes.push(ReplayOp::Clipboard as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, clipboard_action_code(action));
                write_var_uint(&mut bytes, *target_id);
                write_var_uint(&mut bytes, *summary_id);
            }
            ReplayEncodedEvent::ContextMenu {
                delta,
                target_id,
                x,
                y,
            } => {
                bytes.push(ReplayOp::ContextMenu as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *target_id);
                write_var_uint(&mut bytes, *x);
                write_var_uint(&mut bytes, *y);
            }
            ReplayEncodedEvent::MouseMove { delta, dx, dy } => {
                bytes.push(ReplayOp::MouseMove as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_int(&mut bytes, *dx);
                write_var_int(&mut bytes, *dy);
            }
            ReplayEncodedEvent::HoverDwell { delta, target_id, duration_ms } => {
                bytes.push(ReplayOp::HoverDwell as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *target_id);
                write_var_uint(&mut bytes, *duration_ms);
            }
            ReplayEncodedEvent::ViewportResize { delta, width, height } => {
                bytes.push(ReplayOp::ViewportResize as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *width);
                write_var_uint(&mut bytes, *height);
            }
            ReplayEncodedEvent::TouchStart { delta, x, y, radius, force } => {
                bytes.push(ReplayOp::TouchStart as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *x);
                write_var_uint(&mut bytes, *y);
                bytes.push(*radius);
                bytes.push(*force);
            }
            ReplayEncodedEvent::TouchMove { delta, dx, dy, radius, force } => {
                bytes.push(ReplayOp::TouchMove as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_int(&mut bytes, *dx);
                write_var_int(&mut bytes, *dy);
                bytes.push(*radius);
                bytes.push(*force);
            }
            ReplayEncodedEvent::TouchEnd { delta } => {
                bytes.push(ReplayOp::TouchEnd as u8);
                write_var_uint(&mut bytes, *delta);
            }
            ReplayEncodedEvent::FieldCorrection { delta, target_id, correction_kind, count } => {
                bytes.push(ReplayOp::FieldCorrection as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_uint(&mut bytes, *target_id);
                bytes.push(*correction_kind);
                write_var_uint(&mut bytes, *count);
            }
            ReplayEncodedEvent::ScrollMomentum { delta, velocity, deceleration } => {
                bytes.push(ReplayOp::ScrollMomentum as u8);
                write_var_uint(&mut bytes, *delta);
                write_var_int(&mut bytes, *velocity);
                write_var_uint(&mut bytes, *deceleration);
            }
        }
    }

    ReplayEncodedPayload {
        tape_base64: STANDARD.encode(&bytes),
        byte_length: bytes.len(),
    }
}

pub fn decode_replay_events(tape_base64: &str) -> Vec<ReplayEncodedEvent> {
    let Ok(bytes) = STANDARD.decode(tape_base64) else {
        return Vec::new();
    };
    let mut offset = 0usize;
    let mut events = Vec::new();
    let mut signature_points: HashMap<u32, (u32, u32)> = HashMap::new();

    while offset < bytes.len() {
        let op = bytes[offset];
        offset += 1;
        let Some(delta) = read_var_uint(&bytes, &mut offset) else {
            return Vec::new();
        };
        let event = match op {
            x if x == ReplayOp::Scroll as u8 => {
                let (Some(scroll_y), Some(scroll_max)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::Scroll {
                    delta,
                    scroll_y,
                    scroll_max,
                }
            }
            x if x == ReplayOp::Click as u8 => {
                let (Some(target_id), Some(x), Some(y), Some(button)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::Click {
                    delta,
                    target_id,
                    x,
                    y,
                    button,
                }
            }
            x if x == ReplayOp::Key as u8 => {
                let (Some(target_id), Some(key_id), Some(modifiers)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::Key {
                    delta,
                    target_id,
                    key_id,
                    modifiers,
                }
            }
            x if x == ReplayOp::Focus as u8 => {
                let Some(target_id) = read_var_uint(&bytes, &mut offset) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::Focus { delta, target_id }
            }
            x if x == ReplayOp::Blur as u8 => {
                let Some(target_id) = read_var_uint(&bytes, &mut offset) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::Blur { delta, target_id }
            }
            x if x == ReplayOp::Visibility as u8 => {
                let Some(hidden) = read_var_uint(&bytes, &mut offset) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::Visibility {
                    delta,
                    hidden: hidden == 1,
                }
            }
            x if x == ReplayOp::Highlight as u8 => {
                let (Some(target_id), Some(label_id)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::Highlight {
                    delta,
                    target_id,
                    label_id,
                }
            }
            x if x == ReplayOp::Navigation as u8 => {
                let (Some(direction), Some(target_id), Some(index)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::Navigation {
                    delta,
                    direction: nav_direction_name(direction),
                    target_id,
                    index,
                }
            }
            x if x == ReplayOp::Page as u8 => {
                let (Some(page), Some(total_pages)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::Page {
                    delta,
                    page,
                    total_pages,
                }
            }
            x if x == ReplayOp::Modal as u8 => {
                let (Some(name_id), Some(open)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::Modal {
                    delta,
                    name_id,
                    open: open == 1,
                }
            }
            x if x == ReplayOp::SignatureStart as u8 => {
                let (Some(target_id), Some(stroke_id), Some(x), Some(y), Some(pressure)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                signature_points.insert(stroke_id, (x, y));
                ReplayEncodedEvent::SignatureStart {
                    delta,
                    target_id,
                    stroke_id,
                    x,
                    y,
                    pressure: pressure as u8,
                }
            }
            x if x == ReplayOp::SignaturePoint as u8 => {
                let Some(stroke_id) = read_var_uint(&bytes, &mut offset) else {
                    return Vec::new();
                };
                let (last_x, last_y) = signature_points
                    .get(&stroke_id)
                    .copied()
                    .unwrap_or((0, 0));
                let (Some(dx), Some(dy), Some(pressure)) = (
                    read_var_int(&bytes, &mut offset),
                    read_var_int(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                let x = (last_x as i32 + dx).max(0) as u32;
                let y = (last_y as i32 + dy).max(0) as u32;
                signature_points.insert(stroke_id, (x, y));
                ReplayEncodedEvent::SignaturePoint {
                    delta,
                    stroke_id,
                    x,
                    y,
                    pressure: pressure as u8,
                }
            }
            x if x == ReplayOp::SignatureEnd as u8 => {
                let Some(stroke_id) = read_var_uint(&bytes, &mut offset) else {
                    return Vec::new();
                };
                signature_points.remove(&stroke_id);
                ReplayEncodedEvent::SignatureEnd { delta, stroke_id }
            }
            x if x == ReplayOp::SignatureCommit as u8 => {
                let (Some(target_id), Some(signature_id)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::SignatureCommit {
                    delta,
                    target_id,
                    signature_id,
                }
            }
            x if x == ReplayOp::SignatureClear as u8 => {
                let Some(target_id) = read_var_uint(&bytes, &mut offset) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::SignatureClear { delta, target_id }
            }
            x if x == ReplayOp::FieldCommit as u8 => {
                let (Some(target_id), Some(value_id)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::FieldCommit {
                    delta,
                    target_id,
                    value_id,
                }
            }
            x if x == ReplayOp::Clipboard as u8 => {
                let (Some(action), Some(target_id), Some(summary_id)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::Clipboard {
                    delta,
                    action: clipboard_action_name(action),
                    target_id,
                    summary_id,
                }
            }
            x if x == ReplayOp::ContextMenu as u8 => {
                let (Some(target_id), Some(x), Some(y)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else {
                    return Vec::new();
                };
                ReplayEncodedEvent::ContextMenu {
                    delta,
                    target_id,
                    x,
                    y,
                }
            }
            x if x == ReplayOp::MouseMove as u8 => {
                let (Some(dx), Some(dy)) = (
                    read_var_int(&bytes, &mut offset),
                    read_var_int(&bytes, &mut offset),
                ) else { return Vec::new(); };
                ReplayEncodedEvent::MouseMove { delta, dx, dy }
            }
            x if x == ReplayOp::HoverDwell as u8 => {
                let (Some(target_id), Some(duration_ms)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else { return Vec::new(); };
                ReplayEncodedEvent::HoverDwell { delta, target_id, duration_ms }
            }
            x if x == ReplayOp::ViewportResize as u8 => {
                let (Some(width), Some(height)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else { return Vec::new(); };
                ReplayEncodedEvent::ViewportResize { delta, width, height }
            }
            x if x == ReplayOp::TouchStart as u8 => {
                let (Some(x), Some(y)) = (
                    read_var_uint(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else { return Vec::new(); };
                if offset + 2 > bytes.len() { return Vec::new(); }
                let radius = bytes[offset]; offset += 1;
                let force = bytes[offset]; offset += 1;
                ReplayEncodedEvent::TouchStart { delta, x, y, radius, force }
            }
            x if x == ReplayOp::TouchMove as u8 => {
                let (Some(dx), Some(dy)) = (
                    read_var_int(&bytes, &mut offset),
                    read_var_int(&bytes, &mut offset),
                ) else { return Vec::new(); };
                if offset + 2 > bytes.len() { return Vec::new(); }
                let radius = bytes[offset]; offset += 1;
                let force = bytes[offset]; offset += 1;
                ReplayEncodedEvent::TouchMove { delta, dx, dy, radius, force }
            }
            x if x == ReplayOp::TouchEnd as u8 => {
                ReplayEncodedEvent::TouchEnd { delta }
            }
            x if x == ReplayOp::FieldCorrection as u8 => {
                let Some(target_id) = read_var_uint(&bytes, &mut offset) else { return Vec::new(); };
                if offset >= bytes.len() { return Vec::new(); }
                let correction_kind = bytes[offset]; offset += 1;
                let Some(count) = read_var_uint(&bytes, &mut offset) else { return Vec::new(); };
                ReplayEncodedEvent::FieldCorrection { delta, target_id, correction_kind, count }
            }
            x if x == ReplayOp::ScrollMomentum as u8 => {
                let (Some(velocity), Some(deceleration)) = (
                    read_var_int(&bytes, &mut offset),
                    read_var_uint(&bytes, &mut offset),
                ) else { return Vec::new(); };
                ReplayEncodedEvent::ScrollMomentum { delta, velocity, deceleration }
            }
            _ => break,
        };
        events.push(event);
    }

    events
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_roundtrip_is_deterministic() {
        let strokes = vec![vec![
            TimedSignaturePoint {
                x: 12.0,
                y: 18.0,
                t: 0.0,
                force: Some(0.4),
            },
            TimedSignaturePoint {
                x: 19.0,
                y: 22.0,
                t: 16.0,
                force: Some(0.6),
            },
        ]];

        let encoded_a = encode_signature(&strokes);
        let encoded_b = encode_signature(&strokes);
        let decoded = decode_signature(&encoded_a);

        assert_eq!(encoded_a, encoded_b);
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].len(), 2);
        assert_eq!(decoded[0][0].x as u32, 12);
        assert_eq!(decoded[0][1].y as u32, 22);
    }

    #[test]
    fn v2_events_roundtrip() {
        let events = vec![
            ReplayEncodedEvent::MouseMove { delta: 1, dx: 5, dy: -3 },
            ReplayEncodedEvent::MouseMove { delta: 1, dx: -12, dy: 8 },
            ReplayEncodedEvent::HoverDwell { delta: 10, target_id: 3, duration_ms: 1200 },
            ReplayEncodedEvent::ViewportResize { delta: 0, width: 1920, height: 1080 },
            ReplayEncodedEvent::TouchStart { delta: 2, x: 300, y: 400, radius: 12, force: 180 },
            ReplayEncodedEvent::TouchMove { delta: 1, dx: 5, dy: -2, radius: 14, force: 200 },
            ReplayEncodedEvent::TouchEnd { delta: 1 },
            ReplayEncodedEvent::FieldCorrection { delta: 3, target_id: 2, correction_kind: 1, count: 4 },
            ReplayEncodedEvent::ScrollMomentum { delta: 0, velocity: -800, deceleration: 120 },
        ];

        let encoded = encode_replay_events(&events);
        let decoded = decode_replay_events(&encoded.tape_base64);
        assert_eq!(decoded, events);
        // v2 events are very compact — 9 events should be well under 100 bytes
        assert!(encoded.byte_length < 100, "v2 events should be compact: {} bytes", encoded.byte_length);
    }

    #[test]
    fn mouse_move_is_tiny() {
        // A single mouse move should be ~4-6 bytes (opcode + delta + dx + dy)
        let events = vec![
            ReplayEncodedEvent::MouseMove { delta: 1, dx: 3, dy: -2 },
        ];
        let encoded = encode_replay_events(&events);
        assert!(encoded.byte_length <= 6, "single mouse move: {} bytes", encoded.byte_length);
    }

    #[test]
    fn replay_events_roundtrip() {
        let events = vec![
            ReplayEncodedEvent::Navigation {
                delta: 0,
                direction: "next".into(),
                target_id: 1,
                index: 1,
            },
            ReplayEncodedEvent::FieldCommit {
                delta: 3,
                target_id: 2,
                value_id: 3,
            },
            ReplayEncodedEvent::SignatureStart {
                delta: 30,
                target_id: 4,
                stroke_id: 1,
                x: 10,
                y: 20,
                pressure: 128,
            },
            ReplayEncodedEvent::SignaturePoint {
                delta: 2,
                stroke_id: 1,
                x: 18,
                y: 26,
                pressure: 153,
            },
            ReplayEncodedEvent::SignatureEnd {
                delta: 2,
                stroke_id: 1,
            },
        ];

        let encoded = encode_replay_events(&events);
        let decoded = decode_replay_events(&encoded.tape_base64);

        assert_eq!(decoded, events);
        assert!(encoded.byte_length > 0);
        assert!(!encoded.tape_base64.is_empty());
    }
}
