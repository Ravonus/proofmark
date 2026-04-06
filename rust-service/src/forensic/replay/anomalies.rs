//! Structural anomaly detection for replay tapes.

use crate::forensic::ForensicFlag;

pub fn detect_structural_anomalies(
    gaze_fixation_durations: &[u32],
    gaze_blink_durations: &[u32],
    key_deltas: &[u32],
    event_count: u32,
    claimed_events: f64,
) -> Vec<ForensicFlag> {
    let mut anomalies = Vec::new();

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
    if event_count == 0 && claimed_events > 0.0 {
        anomalies.push(ForensicFlag {
            code: "TAPE_EMPTY_WITH_CLAIMED_EVENTS".into(),
            severity: "critical".into(),
            message: format!("Tape contains 0 events but metrics claim {claimed_events}"),
        });
    }

    anomalies
}
