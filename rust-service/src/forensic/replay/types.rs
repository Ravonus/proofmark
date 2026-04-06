//! Replay tape types, opcodes, and default implementations.

use serde::{Deserialize, Serialize};

use crate::forensic::ForensicFlag;

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
pub(crate) mod replay_ops {
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

pub(crate) const TIME_QUANTUM_MS: u32 = 8;

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
