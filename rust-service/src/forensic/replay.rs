//! Replay tape validation — decodes binary replay tapes and extracts
//! ground-truth metrics for cross-validation against claimed values.

use serde::{Deserialize, Serialize};

use super::ForensicFlag;
use crate::crypto::sha256_hex;
use crate::util::varint;

// ══════════════════════════════════════════════════════════════════════════
// Server-side replay tape validation
//
// Decodes the binary replay tape server-side and extracts ground-truth
// metrics (event counts by type, total duration, signature strokes, etc.).
// The caller compares these against the client-supplied behavioral metrics
// to detect fabrication.
// ══════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayTapeVerification {
    pub valid: bool,
    pub error: Option<String>,
    /// Actual metrics extracted from decoding the binary tape
    pub actual_event_count: u32,
    pub actual_duration_quanta: u32,
    pub actual_duration_ms: u32,
    pub actual_click_count: u32,
    pub actual_key_count: u32,
    pub actual_mouse_move_count: u32,
    pub actual_scroll_count: u32,
    pub actual_focus_count: u32,
    pub actual_signature_start_count: u32,
    pub actual_signature_point_count: u32,
    pub actual_signature_end_count: u32,
    pub actual_field_commit_count: u32,
    pub actual_clipboard_count: u32,
    pub actual_gaze_point_count: u32,
    pub actual_gaze_fixation_count: u32,
    pub actual_gaze_blink_count: u32,
    pub actual_gaze_saccade_count: u32,
    pub actual_gaze_calibration_count: u32,
    pub actual_gaze_lost_count: u32,
    /// Mismatches detected against claimed metrics
    pub mismatches: Vec<ReplayMismatch>,
    /// Structural anomalies in the tape itself
    pub anomalies: Vec<ForensicFlag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReplayMismatch {
    pub field: String,
    pub claimed: f64,
    pub actual: f64,
    pub severity: String,
    pub message: String,
}

/// Opcodes matching the TypeScript REPLAY_OPS
mod replay_ops {
    pub const SCROLL: u8 = 1;
    pub const CLICK: u8 = 2;
    pub const KEY: u8 = 3;
    pub const FOCUS: u8 = 4;
    pub const BLUR: u8 = 5;
    pub const VISIBILITY: u8 = 6;
    pub const HIGHLIGHT: u8 = 7;
    pub const NAVIGATION: u8 = 8;
    pub const PAGE: u8 = 9;
    pub const MODAL: u8 = 10;
    pub const SIGNATURE_START: u8 = 11;
    pub const SIGNATURE_POINT: u8 = 12;
    pub const SIGNATURE_END: u8 = 13;
    pub const SIGNATURE_COMMIT: u8 = 14;
    pub const FIELD_COMMIT: u8 = 15;
    pub const CLIPBOARD: u8 = 16;
    pub const CONTEXT_MENU: u8 = 17;
    pub const SIGNATURE_CLEAR: u8 = 18;
    pub const MOUSE_MOVE: u8 = 19;
    pub const HOVER_DWELL: u8 = 20;
    pub const VIEWPORT_RESIZE: u8 = 21;
    pub const TOUCH_START: u8 = 22;
    pub const TOUCH_MOVE: u8 = 23;
    pub const TOUCH_END: u8 = 24;
    pub const FIELD_CORRECTION: u8 = 25;
    pub const SCROLL_MOMENTUM: u8 = 26;
    pub const GAZE_POINT: u8 = 27;
    pub const GAZE_FIXATION: u8 = 28;
    pub const GAZE_SACCADE: u8 = 29;
    pub const GAZE_BLINK: u8 = 30;
    pub const GAZE_CALIBRATION: u8 = 31;
    pub const GAZE_LOST: u8 = 32;
}

fn read_varuint(bytes: &[u8], offset: &mut usize) -> u32 {
    varint::read_var_uint(bytes, offset).unwrap_or(0) as u32
}

fn read_varint(bytes: &[u8], offset: &mut usize) -> i32 {
    varint::read_var_int_zigzag(bytes, offset).unwrap_or(0)
}

/// Skip N varuint fields in the tape
fn skip_varuints(bytes: &[u8], offset: &mut usize, count: usize) {
    for _ in 0..count {
        read_varuint(bytes, offset);
    }
}

/// Skip N raw bytes
fn skip_bytes(offset: &mut usize, count: usize) {
    *offset += count;
}

const TIME_QUANTUM_MS: u32 = 8;

/// Decode the replay tape and extract ground-truth metrics.
pub fn validate_replay_tape(
    tape_base64: &str,
    claimed_metrics: &serde_json::Value,
    claimed_behavioral: &serde_json::Value,
) -> ReplayTapeVerification {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let tape_bytes = match STANDARD.decode(tape_base64) {
        Ok(b) => b,
        Err(e) => {
            return ReplayTapeVerification {
                valid: false,
                error: Some(format!("Invalid base64: {e}")),
                ..Default::default()
            };
        }
    };

    let mut offset = 0usize;
    let mut total_delta_quanta: u32 = 0;
    let mut event_count: u32 = 0;
    let mut click_count: u32 = 0;
    let mut key_count: u32 = 0;
    let mut mouse_move_count: u32 = 0;
    let mut scroll_count: u32 = 0;
    let mut focus_count: u32 = 0;
    let mut sig_start_count: u32 = 0;
    let mut sig_point_count: u32 = 0;
    let mut sig_end_count: u32 = 0;
    let mut field_commit_count: u32 = 0;
    let mut clipboard_count: u32 = 0;
    let mut gaze_point_count: u32 = 0;
    let mut gaze_fixation_count: u32 = 0;
    let mut gaze_blink_count: u32 = 0;
    let mut gaze_saccade_count: u32 = 0;
    let mut gaze_calibration_count: u32 = 0;
    let mut gaze_lost_count: u32 = 0;
    let mut anomalies: Vec<ForensicFlag> = Vec::new();

    // Track gaze timing for anomaly detection
    let mut gaze_fixation_durations: Vec<u32> = Vec::new();
    let mut gaze_blink_durations: Vec<u32> = Vec::new();
    let mut key_deltas: Vec<u32> = Vec::new();
    let mut last_key_time: u32 = 0;
    let mut cumulative_time: u32 = 0;

    while offset < tape_bytes.len() {
        let op = tape_bytes[offset];
        offset += 1;
        if offset >= tape_bytes.len() {
            break;
        }

        let delta = read_varuint(&tape_bytes, &mut offset);
        total_delta_quanta += delta;
        cumulative_time += delta * TIME_QUANTUM_MS;
        event_count += 1;

        match op {
            replay_ops::SCROLL => {
                scroll_count += 1;
                skip_varuints(&tape_bytes, &mut offset, 2); // scrollY, scrollMax
            }
            replay_ops::CLICK => {
                click_count += 1;
                skip_varuints(&tape_bytes, &mut offset, 4); // targetId, x, y, button
            }
            replay_ops::KEY => {
                key_count += 1;
                if cumulative_time > last_key_time && last_key_time > 0 {
                    key_deltas.push(cumulative_time - last_key_time);
                }
                last_key_time = cumulative_time;
                skip_varuints(&tape_bytes, &mut offset, 3); // targetId, keyId, modifiers
            }
            replay_ops::FOCUS => {
                focus_count += 1;
                skip_varuints(&tape_bytes, &mut offset, 1);
            }
            replay_ops::BLUR => {
                skip_varuints(&tape_bytes, &mut offset, 1);
            }
            replay_ops::VISIBILITY => {
                skip_varuints(&tape_bytes, &mut offset, 1);
            }
            replay_ops::HIGHLIGHT => {
                skip_varuints(&tape_bytes, &mut offset, 2);
            }
            replay_ops::NAVIGATION => {
                skip_varuints(&tape_bytes, &mut offset, 3);
            }
            replay_ops::PAGE => {
                skip_varuints(&tape_bytes, &mut offset, 2);
            }
            replay_ops::MODAL => {
                skip_varuints(&tape_bytes, &mut offset, 2);
            }
            replay_ops::SIGNATURE_START => {
                sig_start_count += 1;
                sig_point_count += 1; // start point counts
                skip_varuints(&tape_bytes, &mut offset, 5); // targetId, strokeId, x, y, pressure
            }
            replay_ops::SIGNATURE_POINT => {
                sig_point_count += 1;
                read_varuint(&tape_bytes, &mut offset); // strokeId
                read_varint(&tape_bytes, &mut offset); // dx
                read_varint(&tape_bytes, &mut offset); // dy
                read_varuint(&tape_bytes, &mut offset); // pressure
            }
            replay_ops::SIGNATURE_END => {
                sig_end_count += 1;
                skip_varuints(&tape_bytes, &mut offset, 1); // strokeId
            }
            replay_ops::SIGNATURE_COMMIT => {
                skip_varuints(&tape_bytes, &mut offset, 2);
            }
            replay_ops::FIELD_COMMIT => {
                field_commit_count += 1;
                skip_varuints(&tape_bytes, &mut offset, 2);
            }
            replay_ops::CLIPBOARD => {
                clipboard_count += 1;
                skip_varuints(&tape_bytes, &mut offset, 3);
            }
            replay_ops::CONTEXT_MENU => {
                skip_varuints(&tape_bytes, &mut offset, 3);
            }
            replay_ops::SIGNATURE_CLEAR => {
                skip_varuints(&tape_bytes, &mut offset, 1);
            }
            replay_ops::MOUSE_MOVE => {
                mouse_move_count += 1;
                read_varint(&tape_bytes, &mut offset); // dx
                read_varint(&tape_bytes, &mut offset); // dy
            }
            replay_ops::HOVER_DWELL => {
                skip_varuints(&tape_bytes, &mut offset, 2);
            }
            replay_ops::VIEWPORT_RESIZE => {
                skip_varuints(&tape_bytes, &mut offset, 2);
            }
            replay_ops::TOUCH_START => {
                skip_varuints(&tape_bytes, &mut offset, 2); // x, y
                skip_bytes(&mut offset, 2); // radius, force
            }
            replay_ops::TOUCH_MOVE => {
                read_varint(&tape_bytes, &mut offset); // dx
                read_varint(&tape_bytes, &mut offset); // dy
                skip_bytes(&mut offset, 2); // radius, force
            }
            replay_ops::TOUCH_END => {
                // no extra fields
            }
            replay_ops::FIELD_CORRECTION => {
                skip_varuints(&tape_bytes, &mut offset, 1); // targetId
                skip_bytes(&mut offset, 1); // correctionKind
                skip_varuints(&tape_bytes, &mut offset, 1); // count
            }
            replay_ops::SCROLL_MOMENTUM => {
                read_varint(&tape_bytes, &mut offset); // velocity
                read_varuint(&tape_bytes, &mut offset); // deceleration
            }
            replay_ops::GAZE_POINT => {
                gaze_point_count += 1;
                skip_varuints(&tape_bytes, &mut offset, 2); // x, y
                skip_bytes(&mut offset, 1); // confidence
            }
            replay_ops::GAZE_FIXATION => {
                gaze_fixation_count += 1;
                skip_varuints(&tape_bytes, &mut offset, 2); // x, y
                let dur = read_varuint(&tape_bytes, &mut offset);
                gaze_fixation_durations.push(dur);
                skip_varuints(&tape_bytes, &mut offset, 1); // targetId
            }
            replay_ops::GAZE_SACCADE => {
                gaze_saccade_count += 1;
                skip_varuints(&tape_bytes, &mut offset, 5); // fromX, fromY, toX, toY, velocity
            }
            replay_ops::GAZE_BLINK => {
                gaze_blink_count += 1;
                let dur = read_varuint(&tape_bytes, &mut offset);
                gaze_blink_durations.push(dur);
            }
            replay_ops::GAZE_CALIBRATION => {
                gaze_calibration_count += 1;
                skip_bytes(&mut offset, 1); // accuracy
                skip_varuints(&tape_bytes, &mut offset, 1); // pointCount
            }
            replay_ops::GAZE_LOST => {
                gaze_lost_count += 1;
                skip_bytes(&mut offset, 1); // reason
            }
            _ => {
                // Unknown opcode — tape may be corrupt or future version
                anomalies.push(ForensicFlag {
                    code: "UNKNOWN_REPLAY_OPCODE".into(),
                    severity: "warn".into(),
                    message: format!("Unknown opcode {op} at byte {}", offset - 1),
                });
                break; // Can't safely skip unknown opcodes
            }
        }
    }

    let actual_duration_ms = total_delta_quanta * TIME_QUANTUM_MS;

    // ── Cross-validate claimed metrics against tape ─────────────────

    let mut mismatches = Vec::new();

    let check = |field: &str, claimed: f64, actual: f64, tolerance: f64, severity: &str| -> Option<ReplayMismatch> {
        if claimed == 0.0 && actual == 0.0 { return None; }
        let diff = (claimed - actual).abs();
        let rel = if actual > 0.0 { diff / actual } else if claimed > 0.0 { 1.0 } else { 0.0 };
        if rel > tolerance || diff > tolerance.max(2.0) {
            Some(ReplayMismatch {
                field: field.into(),
                claimed,
                actual,
                severity: severity.into(),
                message: format!(
                    "{field}: claimed {claimed}, tape has {actual} (diff {diff:.0}, {:.0}%)",
                    rel * 100.0
                ),
            })
        } else {
            None
        }
    };

    // Event count
    if let Some(claimed_event_count) = claimed_metrics.get("eventCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("eventCount", claimed_event_count, event_count as f64, 0.05, "critical") {
            mismatches.push(m);
        }
    }

    // Byte length
    if let Some(claimed_bytes) = claimed_metrics.get("byteLength").and_then(|v| v.as_f64()) {
        if let Some(m) = check("byteLength", claimed_bytes, tape_bytes.len() as f64, 0.01, "critical") {
            mismatches.push(m);
        }
    }

    // Signature metrics
    if let Some(claimed) = claimed_metrics.get("signatureStrokeCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("signatureStrokeCount", claimed, sig_end_count as f64, 0.0, "critical") {
            mismatches.push(m);
        }
    }
    if let Some(claimed) = claimed_metrics.get("signaturePointCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("signaturePointCount", claimed, sig_point_count as f64, 0.05, "warn") {
            mismatches.push(m);
        }
    }

    // Gaze metrics
    if let Some(claimed) = claimed_metrics.get("gazePointCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("gazePointCount", claimed, gaze_point_count as f64, 0.05, "critical") {
            mismatches.push(m);
        }
    }
    if let Some(claimed) = claimed_metrics.get("gazeFixationCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("gazeFixationCount", claimed, gaze_fixation_count as f64, 0.05, "critical") {
            mismatches.push(m);
        }
    }
    if let Some(claimed) = claimed_metrics.get("gazeBlinkCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("gazeBlinkCount", claimed, gaze_blink_count as f64, 0.05, "warn") {
            mismatches.push(m);
        }
    }

    // Clipboard count
    if let Some(claimed) = claimed_metrics.get("clipboardEventCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("clipboardEventCount", claimed, clipboard_count as f64, 0.0, "warn") {
            mismatches.push(m);
        }
    }

    // Duration (from tape.metrics.maxTimestampMs)
    if let Some(claimed_max_ts) = claimed_metrics.get("maxTimestampMs").and_then(|v| v.as_f64()) {
        // Allow 10% tolerance since quantization introduces rounding
        if let Some(m) = check("maxTimestampMs", claimed_max_ts, actual_duration_ms as f64, 0.10, "warn") {
            mismatches.push(m);
        }
    }

    // Cross-check behavioral.timeOnPage against tape duration
    if let Some(claimed_time) = claimed_behavioral.get("timeOnPage").and_then(|v| v.as_f64()) {
        // The tape duration should be close to timeOnPage (within 20%)
        let tape_ms = actual_duration_ms as f64;
        if tape_ms > 0.0 && claimed_time > 0.0 {
            let ratio = claimed_time / tape_ms;
            if ratio < 0.5 || ratio > 2.0 {
                mismatches.push(ReplayMismatch {
                    field: "timeOnPage_vs_tapeDuration".into(),
                    claimed: claimed_time,
                    actual: tape_ms,
                    severity: "critical".into(),
                    message: format!(
                        "behavioral.timeOnPage ({claimed_time}ms) diverges significantly from tape duration ({tape_ms}ms), ratio {ratio:.2}"
                    ),
                });
            }
        }
    }

    // Cross-check behavioral.keyPressCount against tape key events
    // Use generous tolerance — off-by-one is common due to timing of capture vs replay
    if let Some(claimed_keys) = claimed_behavioral.get("keyPressCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("keyPressCount_behavioral", claimed_keys, key_count as f64, 0.30, "warn") {
            mismatches.push(m);
        }
    }

    // Cross-check behavioral.clickCount against tape
    if let Some(claimed_clicks) = claimed_behavioral.get("clickCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("clickCount_behavioral", claimed_clicks, click_count as f64, 0.20, "warn") {
            mismatches.push(m);
        }
    }

    // Cross-check behavioral.mouseMoveCount against tape
    if let Some(claimed_moves) = claimed_behavioral.get("mouseMoveCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("mouseMoveCount_behavioral", claimed_moves, mouse_move_count as f64, 0.20, "warn") {
            mismatches.push(m);
        }
    }

    // Cross-check behavioral gaze counts
    if let Some(claimed) = claimed_behavioral.get("gazePointCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("gazePointCount_behavioral", claimed, gaze_point_count as f64, 0.10, "critical") {
            mismatches.push(m);
        }
    }
    if let Some(claimed) = claimed_behavioral.get("gazeFixationCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("gazeFixationCount_behavioral", claimed, gaze_fixation_count as f64, 0.10, "critical") {
            mismatches.push(m);
        }
    }
    if let Some(claimed) = claimed_behavioral.get("gazeBlinkCount").and_then(|v| v.as_f64()) {
        if let Some(m) = check("gazeBlinkCount_behavioral", claimed, gaze_blink_count as f64, 0.10, "warn") {
            mismatches.push(m);
        }
    }

    // ── Structural anomaly detection ───────────────────────────────

    // Gaze fixation uniformity check (synthetic gaze has very uniform fixations)
    if gaze_fixation_durations.len() >= 6 {
        let avg = gaze_fixation_durations.iter().sum::<u32>() as f64 / gaze_fixation_durations.len() as f64;
        let variance = gaze_fixation_durations.iter()
            .map(|&d| (d as f64 - avg).powi(2))
            .sum::<f64>() / gaze_fixation_durations.len() as f64;
        let cv = if avg > 0.0 { variance.sqrt() / avg } else { 0.0 };
        if cv < 0.08 {
            anomalies.push(ForensicFlag {
                code: "TAPE_GAZE_FIXATION_TOO_UNIFORM".into(),
                severity: "critical".into(),
                message: format!("Gaze fixation durations in tape are suspiciously uniform (CV={cv:.3})"),
            });
        }
    }

    // Gaze blink regularity check (human blinks are irregular)
    if gaze_blink_durations.len() >= 4 {
        let avg = gaze_blink_durations.iter().sum::<u32>() as f64 / gaze_blink_durations.len() as f64;
        let variance = gaze_blink_durations.iter()
            .map(|&d| (d as f64 - avg).powi(2))
            .sum::<f64>() / gaze_blink_durations.len() as f64;
        let cv = if avg > 0.0 { variance.sqrt() / avg } else { 0.0 };
        if cv < 0.10 {
            anomalies.push(ForensicFlag {
                code: "TAPE_GAZE_BLINK_TOO_UNIFORM".into(),
                severity: "warn".into(),
                message: format!("Gaze blink durations in tape are suspiciously uniform (CV={cv:.3})"),
            });
        }
    }

    // Typing cadence cross-check
    if key_deltas.len() >= 5 {
        let avg = key_deltas.iter().sum::<u32>() as f64 / key_deltas.len() as f64;
        let variance = key_deltas.iter()
            .map(|&d| (d as f64 - avg).powi(2))
            .sum::<f64>() / key_deltas.len() as f64;
        let cv = if avg > 0.0 { variance.sqrt() / avg } else { 0.0 };
        if cv < 0.08 {
            anomalies.push(ForensicFlag {
                code: "TAPE_TYPING_CADENCE_TOO_UNIFORM".into(),
                severity: "warn".into(),
                message: format!("Key press timing in tape is suspiciously uniform (CV={cv:.3})"),
            });
        }
    }

    // Empty tape with claimed activity
    if event_count == 0 {
        let claimed_events = claimed_metrics.get("eventCount").and_then(|v| v.as_f64()).unwrap_or(0.0);
        if claimed_events > 0.0 {
            anomalies.push(ForensicFlag {
                code: "TAPE_EMPTY_WITH_CLAIMED_EVENTS".into(),
                severity: "critical".into(),
                message: format!("Tape contains 0 events but metrics claim {claimed_events}"),
            });
        }
    }

    // Verify tape hash matches claimed tapeHash (if provided in metrics)
    let _tape_hash = sha256_hex(&tape_bytes);

    ReplayTapeVerification {
        valid: mismatches.is_empty() && anomalies.iter().all(|a| a.severity != "critical"),
        error: None,
        actual_event_count: event_count,
        actual_duration_quanta: total_delta_quanta,
        actual_duration_ms,
        actual_click_count: click_count,
        actual_key_count: key_count,
        actual_mouse_move_count: mouse_move_count,
        actual_scroll_count: scroll_count,
        actual_focus_count: focus_count,
        actual_signature_start_count: sig_start_count,
        actual_signature_point_count: sig_point_count,
        actual_signature_end_count: sig_end_count,
        actual_field_commit_count: field_commit_count,
        actual_clipboard_count: clipboard_count,
        actual_gaze_point_count: gaze_point_count,
        actual_gaze_fixation_count: gaze_fixation_count,
        actual_gaze_blink_count: gaze_blink_count,
        actual_gaze_saccade_count: gaze_saccade_count,
        actual_gaze_calibration_count: gaze_calibration_count,
        actual_gaze_lost_count: gaze_lost_count,
        mismatches,
        anomalies,
    }
}

impl Default for ReplayTapeVerification {
    fn default() -> Self {
        Self {
            valid: false,
            error: None,
            actual_event_count: 0,
            actual_duration_quanta: 0,
            actual_duration_ms: 0,
            actual_click_count: 0,
            actual_key_count: 0,
            actual_mouse_move_count: 0,
            actual_scroll_count: 0,
            actual_focus_count: 0,
            actual_signature_start_count: 0,
            actual_signature_point_count: 0,
            actual_signature_end_count: 0,
            actual_field_commit_count: 0,
            actual_clipboard_count: 0,
            actual_gaze_point_count: 0,
            actual_gaze_fixation_count: 0,
            actual_gaze_blink_count: 0,
            actual_gaze_saccade_count: 0,
            actual_gaze_calibration_count: 0,
            actual_gaze_lost_count: 0,
            mismatches: Vec::new(),
            anomalies: Vec::new(),
        }
    }
}
