use serde::{Deserialize, Serialize};

use crate::codec::{ReplayEncodedEvent, TimedSignaturePoint, TimedSignatureStroke};
use crate::format::REPLAY_TIME_QUANTUM_MS;

const SIGNATURE_PAUSE_THRESHOLD_MS: f64 = 48.0;
const SIGNATURE_TURN_THRESHOLD_DEG: f64 = 35.0;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SignatureBounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
    pub width: f64,
    pub height: f64,
}

impl SignatureBounds {
    fn empty() -> Self {
        Self {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 0.0,
            max_y: 0.0,
            width: 0.0,
            height: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SignatureStrokeMetrics {
    pub stroke_index: usize,
    pub point_count: usize,
    pub duration_ms: f64,
    pub path_length_px: f64,
    pub straight_line_distance_px: f64,
    pub path_efficiency: f64,
    pub average_speed_px_per_ms: f64,
    pub speed_std_dev_px_per_ms: f64,
    pub max_speed_px_per_ms: f64,
    pub average_interval_ms: f64,
    pub interval_std_dev_ms: f64,
    pub average_pressure: f64,
    pub pressure_std_dev: f64,
    pub pressure_min: f64,
    pub pressure_max: f64,
    pub direction_changes: usize,
    pub pause_count: usize,
    pub pause_duration_ms: f64,
    pub bounds: SignatureBounds,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SignatureMotionMetrics {
    pub stroke_count: usize,
    pub point_count: usize,
    pub segment_count: usize,
    pub total_duration_ms: f64,
    pub total_path_length_px: f64,
    pub total_straight_line_distance_px: f64,
    pub path_efficiency: f64,
    pub average_speed_px_per_ms: f64,
    pub speed_std_dev_px_per_ms: f64,
    pub max_speed_px_per_ms: f64,
    pub average_interval_ms: f64,
    pub interval_std_dev_ms: f64,
    pub average_pressure: f64,
    pub pressure_std_dev: f64,
    pub pressure_min: f64,
    pub pressure_max: f64,
    pub direction_changes: usize,
    pub pause_count: usize,
    pub pause_duration_ms: f64,
    pub bounding_box: SignatureBounds,
    pub aspect_ratio: f64,
    pub strokes: Vec<SignatureStrokeMetrics>,
}

fn hypot(dx: f64, dy: f64) -> f64 {
    (dx * dx + dy * dy).sqrt()
}

fn clamp_non_negative(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        0.0
    }
}

fn angle_between(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    let left = hypot(ax, ay);
    let right = hypot(bx, by);
    if left == 0.0 || right == 0.0 {
        return 0.0;
    }
    let dot = ax * bx + ay * by;
    let cos_theta = (dot / (left * right)).clamp(-1.0, 1.0);
    cos_theta.acos().to_degrees()
}

fn variance(values: &[f64], mean: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().map(|value| (value - mean).powi(2)).sum::<f64>() / values.len() as f64
}

fn mean(values: &[f64]) -> f64 {
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

fn stroke_bounds(stroke: &TimedSignatureStroke) -> SignatureBounds {
    let mut bounds = SignatureBounds::empty();
    let mut initialized = false;
    for point in stroke {
        if !initialized {
            bounds.min_x = point.x;
            bounds.max_x = point.x;
            bounds.min_y = point.y;
            bounds.max_y = point.y;
            initialized = true;
            continue;
        }
        bounds.min_x = bounds.min_x.min(point.x);
        bounds.min_y = bounds.min_y.min(point.y);
        bounds.max_x = bounds.max_x.max(point.x);
        bounds.max_y = bounds.max_y.max(point.y);
    }

    if initialized {
        bounds.width = bounds.max_x - bounds.min_x;
        bounds.height = bounds.max_y - bounds.min_y;
    }

    bounds
}

pub fn analyze_signature_strokes(strokes: &[TimedSignatureStroke]) -> SignatureMotionMetrics {
    let mut point_count = 0usize;
    let mut segment_count = 0usize;
    let mut total_duration_ms = 0.0;
    let mut total_path_length_px = 0.0;
    let mut total_straight_line_distance_px = 0.0;
    let mut speed_samples = Vec::new();
    let mut interval_samples = Vec::new();
    let mut pressure_samples = Vec::new();
    let mut direction_changes = 0usize;
    let mut pause_count = 0usize;
    let mut pause_duration_ms = 0.0;
    let mut bounding_box = SignatureBounds::empty();
    let mut bounding_box_initialized = false;
    let mut stroke_metrics = Vec::with_capacity(strokes.len());
    let mut overall_start = None::<f64>;
    let mut overall_end = None::<f64>;

    for (stroke_index, stroke) in strokes.iter().enumerate() {
        let metrics = analyze_single_stroke(stroke_index, stroke);
        point_count += metrics.point_count;
        segment_count += metrics.point_count.saturating_sub(1);
        total_duration_ms += metrics.duration_ms;
        total_path_length_px += metrics.path_length_px;
        total_straight_line_distance_px += metrics.straight_line_distance_px;
        speed_samples.extend(metrics_speed_samples(stroke));
        interval_samples.extend(metrics_interval_samples(stroke));
        pressure_samples.extend(stroke.iter().filter_map(|point| point.force));
        direction_changes += metrics.direction_changes;
        pause_count += metrics.pause_count;
        pause_duration_ms += metrics.pause_duration_ms;

        if let Some(first) = stroke.first() {
            overall_start = Some(overall_start.map_or(first.t, |current| current.min(first.t)));
        }
        if let Some(last) = stroke.last() {
            overall_end = Some(overall_end.map_or(last.t, |current| current.max(last.t)));
        }

        if !bounding_box_initialized && metrics.point_count > 0 {
            bounding_box = metrics.bounds;
            bounding_box_initialized = true;
        } else if metrics.point_count > 0 {
            bounding_box.min_x = bounding_box.min_x.min(metrics.bounds.min_x);
            bounding_box.min_y = bounding_box.min_y.min(metrics.bounds.min_y);
            bounding_box.max_x = bounding_box.max_x.max(metrics.bounds.max_x);
            bounding_box.max_y = bounding_box.max_y.max(metrics.bounds.max_y);
            bounding_box.width = bounding_box.max_x - bounding_box.min_x;
            bounding_box.height = bounding_box.max_y - bounding_box.min_y;
        }

        stroke_metrics.push(metrics);
    }

    let total_duration_ms = match (overall_start, overall_end) {
        (Some(start), Some(end)) if end >= start => end - start,
        _ => total_duration_ms,
    };
    let average_speed_px_per_ms = if total_duration_ms > 0.0 {
        total_path_length_px / total_duration_ms
    } else {
        0.0
    };
    let speed_mean = mean(&speed_samples);
    let interval_mean = mean(&interval_samples);
    let pressure_mean = mean(&pressure_samples);
    let speed_std_dev_px_per_ms = variance(&speed_samples, speed_mean).sqrt();
    let interval_std_dev_ms = variance(&interval_samples, interval_mean).sqrt();
    let pressure_std_dev = variance(&pressure_samples, pressure_mean).sqrt();
    let path_efficiency = if total_path_length_px > 0.0 {
        total_straight_line_distance_px / total_path_length_px
    } else {
        0.0
    };
    let aspect_ratio = if bounding_box.height > 0.0 {
        bounding_box.width / bounding_box.height
    } else {
        bounding_box.width
    };

    let pressure_min = pressure_samples
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    let pressure_max = pressure_samples
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);

    SignatureMotionMetrics {
        stroke_count: strokes.len(),
        point_count,
        segment_count,
        total_duration_ms,
        total_path_length_px,
        total_straight_line_distance_px,
        path_efficiency,
        average_speed_px_per_ms,
        speed_std_dev_px_per_ms,
        max_speed_px_per_ms: speed_samples.iter().copied().fold(0.0, f64::max),
        average_interval_ms: interval_mean,
        interval_std_dev_ms,
        average_pressure: pressure_mean,
        pressure_std_dev,
        pressure_min: if pressure_samples.is_empty() {
            0.0
        } else {
            pressure_min
        },
        pressure_max: if pressure_samples.is_empty() {
            0.0
        } else {
            pressure_max
        },
        direction_changes,
        pause_count,
        pause_duration_ms,
        bounding_box,
        aspect_ratio,
        strokes: stroke_metrics,
    }
}

fn metrics_speed_samples(stroke: &TimedSignatureStroke) -> Vec<f64> {
    let mut speeds = Vec::new();
    for pair in stroke.windows(2) {
        let a = &pair[0];
        let b = &pair[1];
        let dt = clamp_non_negative(b.t - a.t);
        if dt > 0.0 {
            speeds.push(hypot(b.x - a.x, b.y - a.y) / dt);
        }
    }
    speeds
}

fn metrics_interval_samples(stroke: &TimedSignatureStroke) -> Vec<f64> {
    stroke
        .windows(2)
        .map(|pair| clamp_non_negative(pair[1].t - pair[0].t))
        .collect()
}

fn analyze_single_stroke(stroke_index: usize, stroke: &TimedSignatureStroke) -> SignatureStrokeMetrics {
    if stroke.is_empty() {
        return SignatureStrokeMetrics {
            stroke_index,
            point_count: 0,
            duration_ms: 0.0,
            path_length_px: 0.0,
            straight_line_distance_px: 0.0,
            path_efficiency: 0.0,
            average_speed_px_per_ms: 0.0,
            speed_std_dev_px_per_ms: 0.0,
            max_speed_px_per_ms: 0.0,
            average_interval_ms: 0.0,
            interval_std_dev_ms: 0.0,
            average_pressure: 0.0,
            pressure_std_dev: 0.0,
            pressure_min: 0.0,
            pressure_max: 0.0,
            direction_changes: 0,
            pause_count: 0,
            pause_duration_ms: 0.0,
            bounds: SignatureBounds::empty(),
        };
    }

    let mut path_length_px = 0.0;
    let mut speed_samples = Vec::new();
    let mut interval_samples = Vec::new();
    let mut pressure_samples = Vec::new();
    let mut direction_changes = 0usize;
    let mut pause_count = 0usize;
    let mut pause_duration_ms = 0.0;
    let bounds = stroke_bounds(stroke);

    for point in stroke {
        if let Some(force) = point.force {
            pressure_samples.push(force);
        }
    }

    for pair in stroke.windows(2) {
        let a = &pair[0];
        let b = &pair[1];
        let dt = clamp_non_negative(b.t - a.t);
        let dist = hypot(b.x - a.x, b.y - a.y);
        path_length_px += dist;
        interval_samples.push(dt);
        if dt > 0.0 {
            let speed = dist / dt;
            speed_samples.push(speed);
            if dt >= SIGNATURE_PAUSE_THRESHOLD_MS {
                pause_count += 1;
                pause_duration_ms += dt;
            }
        }
    }

    for trio in stroke.windows(3) {
        let a = &trio[0];
        let b = &trio[1];
        let c = &trio[2];
        let angle = angle_between(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y);
        if angle >= SIGNATURE_TURN_THRESHOLD_DEG {
            direction_changes += 1;
        }
    }

    let duration_ms = clamp_non_negative(stroke.last().unwrap().t - stroke.first().unwrap().t);
    let straight_line_distance_px = hypot(
        stroke.last().unwrap().x - stroke.first().unwrap().x,
        stroke.last().unwrap().y - stroke.first().unwrap().y,
    );
    let average_speed_px_per_ms = if duration_ms > 0.0 {
        path_length_px / duration_ms
    } else {
        0.0
    };
    let speed_mean = mean(&speed_samples);
    let interval_mean = mean(&interval_samples);
    let pressure_mean = mean(&pressure_samples);
    let speed_std_dev_px_per_ms = variance(&speed_samples, speed_mean).sqrt();
    let interval_std_dev_ms = variance(&interval_samples, interval_mean).sqrt();
    let pressure_std_dev = variance(&pressure_samples, pressure_mean).sqrt();
    let path_efficiency = if path_length_px > 0.0 {
        straight_line_distance_px / path_length_px
    } else {
        0.0
    };

    SignatureStrokeMetrics {
        stroke_index,
        point_count: stroke.len(),
        duration_ms,
        path_length_px,
        straight_line_distance_px,
        path_efficiency,
        average_speed_px_per_ms,
        speed_std_dev_px_per_ms,
        max_speed_px_per_ms: speed_samples.iter().copied().fold(0.0, f64::max),
        average_interval_ms: interval_mean,
        interval_std_dev_ms,
        average_pressure: pressure_mean,
        pressure_std_dev,
        pressure_min: pressure_samples.iter().copied().fold(f64::INFINITY, f64::min),
        pressure_max: pressure_samples
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max),
        direction_changes,
        pause_count,
        pause_duration_ms,
        bounds,
    }
}

pub fn extract_signature_strokes_from_replay_events(
    events: &[ReplayEncodedEvent],
) -> Vec<TimedSignatureStroke> {
    let mut at_ms = 0u32;
    let mut active: std::collections::BTreeMap<u32, TimedSignatureStroke> =
        std::collections::BTreeMap::new();
    let mut order: Vec<u32> = Vec::new();

    for event in events {
        let delta_ms = match event {
            ReplayEncodedEvent::Scroll { delta, .. }
            | ReplayEncodedEvent::Click { delta, .. }
            | ReplayEncodedEvent::Key { delta, .. }
            | ReplayEncodedEvent::Focus { delta, .. }
            | ReplayEncodedEvent::Blur { delta, .. }
            | ReplayEncodedEvent::Visibility { delta, .. }
            | ReplayEncodedEvent::Highlight { delta, .. }
            | ReplayEncodedEvent::Navigation { delta, .. }
            | ReplayEncodedEvent::Page { delta, .. }
            | ReplayEncodedEvent::Modal { delta, .. }
            | ReplayEncodedEvent::SignatureStart { delta, .. }
            | ReplayEncodedEvent::SignaturePoint { delta, .. }
            | ReplayEncodedEvent::SignatureEnd { delta, .. }
            | ReplayEncodedEvent::SignatureCommit { delta, .. }
            | ReplayEncodedEvent::SignatureClear { delta, .. }
            | ReplayEncodedEvent::FieldCommit { delta, .. }
            | ReplayEncodedEvent::Clipboard { delta, .. }
            | ReplayEncodedEvent::ContextMenu { delta, .. }
            | ReplayEncodedEvent::MouseMove { delta, .. }
            | ReplayEncodedEvent::HoverDwell { delta, .. }
            | ReplayEncodedEvent::ViewportResize { delta, .. }
            | ReplayEncodedEvent::TouchStart { delta, .. }
            | ReplayEncodedEvent::TouchMove { delta, .. }
            | ReplayEncodedEvent::TouchEnd { delta, .. }
            | ReplayEncodedEvent::FieldCorrection { delta, .. }
            | ReplayEncodedEvent::ScrollMomentum { delta, .. } => *delta,
        };
        at_ms = at_ms.saturating_add(delta_ms.saturating_mul(REPLAY_TIME_QUANTUM_MS as u32));

        match event {
            ReplayEncodedEvent::SignatureStart {
                stroke_id,
                x,
                y,
                pressure,
                ..
            } => {
                if !active.contains_key(stroke_id) {
                    order.push(*stroke_id);
                }
                active.insert(
                    *stroke_id,
                    vec![TimedSignaturePoint {
                        x: *x as f64,
                        y: *y as f64,
                        t: at_ms as f64,
                        force: Some(*pressure as f64 / 255.0),
                    }],
                );
            }
            ReplayEncodedEvent::SignaturePoint {
                stroke_id,
                x,
                y,
                pressure,
                ..
            } => {
                if !active.contains_key(stroke_id) {
                    order.push(*stroke_id);
                    active.insert(*stroke_id, Vec::new());
                }
                if let Some(stroke) = active.get_mut(stroke_id) {
                    stroke.push(TimedSignaturePoint {
                        x: *x as f64,
                        y: *y as f64,
                        t: at_ms as f64,
                        force: Some(*pressure as f64 / 255.0),
                    });
                }
            }
            ReplayEncodedEvent::SignatureEnd { .. } => {}
            ReplayEncodedEvent::SignatureCommit { .. }
            | ReplayEncodedEvent::SignatureClear { .. }
            | ReplayEncodedEvent::Scroll { .. }
            | ReplayEncodedEvent::Click { .. }
            | ReplayEncodedEvent::Key { .. }
            | ReplayEncodedEvent::Focus { .. }
            | ReplayEncodedEvent::Blur { .. }
            | ReplayEncodedEvent::Visibility { .. }
            | ReplayEncodedEvent::Highlight { .. }
            | ReplayEncodedEvent::Navigation { .. }
            | ReplayEncodedEvent::Page { .. }
            | ReplayEncodedEvent::Modal { .. }
            | ReplayEncodedEvent::FieldCommit { .. }
            | ReplayEncodedEvent::Clipboard { .. }
            | ReplayEncodedEvent::ContextMenu { .. }
            | ReplayEncodedEvent::MouseMove { .. }
            | ReplayEncodedEvent::HoverDwell { .. }
            | ReplayEncodedEvent::ViewportResize { .. }
            | ReplayEncodedEvent::TouchStart { .. }
            | ReplayEncodedEvent::TouchMove { .. }
            | ReplayEncodedEvent::TouchEnd { .. }
            | ReplayEncodedEvent::FieldCorrection { .. }
            | ReplayEncodedEvent::ScrollMomentum { .. } => {}
        }
    }

    order
        .into_iter()
        .filter_map(|stroke_id| active.remove(&stroke_id))
        .collect()
}

pub fn analyze_replay_signature_activity(events: &[ReplayEncodedEvent]) -> SignatureMotionMetrics {
    let strokes = extract_signature_strokes_from_replay_events(events);
    analyze_signature_strokes(&strokes)
}

pub fn analyze_replay_signature_tape(tape_base64: &str) -> SignatureMotionMetrics {
    let events = crate::codec::decode_replay_events(tape_base64);
    analyze_replay_signature_activity(&events)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::ReplayEncodedEvent;

    #[test]
    fn signature_analysis_captures_motion_variation() {
        let strokes = vec![vec![
            TimedSignaturePoint {
                x: 10.0,
                y: 10.0,
                t: 0.0,
                force: Some(0.3),
            },
            TimedSignaturePoint {
                x: 18.0,
                y: 14.0,
                t: 12.0,
                force: Some(0.5),
            },
            TimedSignaturePoint {
                x: 24.0,
                y: 22.0,
                t: 36.0,
                force: Some(0.7),
            },
        ]];

        let metrics = analyze_signature_strokes(&strokes);
        assert_eq!(metrics.stroke_count, 1);
        assert_eq!(metrics.point_count, 3);
        assert_eq!(metrics.bounding_box.min_x as u32, 10);
        assert_eq!(metrics.bounding_box.max_y as u32, 22);
        assert!(metrics.total_path_length_px > 0.0);
        assert!(metrics.path_efficiency > 0.0);
        assert!(metrics.average_pressure > 0.0);
        assert!(metrics.direction_changes <= 1);
    }

    #[test]
    fn replay_signature_analysis_extracts_strokes() {
        let events = vec![
            ReplayEncodedEvent::SignatureStart {
                delta: 0,
                target_id: 1,
                stroke_id: 7,
                x: 5,
                y: 6,
                pressure: 128,
            },
            ReplayEncodedEvent::SignaturePoint {
                delta: 2,
                stroke_id: 7,
                x: 11,
                y: 12,
                pressure: 140,
            },
            ReplayEncodedEvent::SignatureEnd {
                delta: 1,
                stroke_id: 7,
            },
        ];

        let strokes = extract_signature_strokes_from_replay_events(&events);
        assert_eq!(strokes.len(), 1);
        assert_eq!(strokes[0].len(), 2);
        assert_eq!(strokes[0][1].t as u32, 16);

        let metrics = analyze_replay_signature_activity(&events);
        assert_eq!(metrics.stroke_count, 1);
        assert_eq!(metrics.point_count, 2);
    }
}
