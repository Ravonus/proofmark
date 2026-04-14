use serde::{Deserialize, Serialize};

use crate::codec::{decode_replay_events, ReplayEncodedEvent};
use crate::format::{ReplayOp, REPLAY_TIME_QUANTUM_MS};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayPlaybackLane {
    pub lane: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub duration_ms: u32,
    pub event_count: usize,
    pub events: Vec<ReplayPlaybackEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayPlaybackTimeline {
    pub duration_ms: u32,
    pub lane_count: usize,
    pub event_count: usize,
    pub lanes: Vec<ReplayPlaybackLane>,
    pub events: Vec<ReplayPlaybackEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ReplayPlaybackEvent {
    Scroll {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        scroll_y: u32,
        scroll_max: u32,
    },
    Click {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        target_id: u32,
        x: u32,
        y: u32,
        button: u32,
    },
    Key {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        target_id: u32,
        key_id: u32,
        modifiers: u32,
    },
    Focus {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        target_id: u32,
    },
    Blur {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        target_id: u32,
    },
    Visibility {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        hidden: bool,
    },
    Highlight {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        target_id: u32,
        label_id: u32,
    },
    Navigation {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        direction: String,
        target_id: u32,
        index: u32,
    },
    Page {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        page: u32,
        total_pages: u32,
    },
    Modal {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        name_id: u32,
        open: bool,
    },
    SignatureStart {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        target_id: u32,
        stroke_id: u32,
        x: u32,
        y: u32,
        pressure: u8,
    },
    SignaturePoint {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        stroke_id: u32,
        x: u32,
        y: u32,
        pressure: u8,
    },
    SignatureEnd {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        stroke_id: u32,
    },
    SignatureCommit {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        target_id: u32,
        signature_id: u32,
    },
    SignatureClear {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        target_id: u32,
    },
    FieldCommit {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        target_id: u32,
        value_id: u32,
    },
    Clipboard {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        action: String,
        target_id: u32,
        summary_id: u32,
    },
    ContextMenu {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        target_id: u32,
        x: u32,
        y: u32,
    },
    MouseMove {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        dx: i32,
        dy: i32,
    },
    HoverDwell {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        target_id: u32,
        duration_ms: u32,
    },
    ViewportResize {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        width: u32,
        height: u32,
    },
    TouchStart {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        x: u32,
        y: u32,
        radius: u8,
        force: u8,
    },
    TouchMove {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        dx: i32,
        dy: i32,
        radius: u8,
        force: u8,
    },
    TouchEnd {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
    },
    FieldCorrection {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        target_id: u32,
        correction_kind: u8,
        count: u32,
    },
    ScrollMomentum {
        lane: u32,
        at_ms: u32,
        delta_ms: u32,
        velocity: i32,
        deceleration: u32,
    },
}

fn event_delta_ms(delta_units: u32) -> u32 {
    delta_units.saturating_mul(REPLAY_TIME_QUANTUM_MS as u32)
}

fn nav_direction_name(code: &str) -> String {
    match code {
        "prev" => "prev".to_string(),
        "next" => "next".to_string(),
        _ => "jump".to_string(),
    }
}

fn clipboard_action_name(code: &str) -> String {
    match code {
        "copy" => "copy".to_string(),
        "cut" => "cut".to_string(),
        _ => "paste".to_string(),
    }
}

fn convert_event(
    lane: u32,
    at_ms: u32,
    delta_ms: u32,
    event: ReplayEncodedEvent,
) -> ReplayPlaybackEvent {
    match event {
        ReplayEncodedEvent::Scroll {
            scroll_y,
            scroll_max,
            ..
        } => ReplayPlaybackEvent::Scroll {
            lane,
            at_ms,
            delta_ms,
            scroll_y,
            scroll_max,
        },
        ReplayEncodedEvent::Click {
            target_id,
            x,
            y,
            button,
            ..
        } => ReplayPlaybackEvent::Click {
            lane,
            at_ms,
            delta_ms,
            target_id,
            x,
            y,
            button,
        },
        ReplayEncodedEvent::Key {
            target_id,
            key_id,
            modifiers,
            ..
        } => ReplayPlaybackEvent::Key {
            lane,
            at_ms,
            delta_ms,
            target_id,
            key_id,
            modifiers,
        },
        ReplayEncodedEvent::Focus { target_id, .. } => ReplayPlaybackEvent::Focus {
            lane,
            at_ms,
            delta_ms,
            target_id,
        },
        ReplayEncodedEvent::Blur { target_id, .. } => ReplayPlaybackEvent::Blur {
            lane,
            at_ms,
            delta_ms,
            target_id,
        },
        ReplayEncodedEvent::Visibility { hidden, .. } => ReplayPlaybackEvent::Visibility {
            lane,
            at_ms,
            delta_ms,
            hidden,
        },
        ReplayEncodedEvent::Highlight {
            target_id,
            label_id,
            ..
        } => ReplayPlaybackEvent::Highlight {
            lane,
            at_ms,
            delta_ms,
            target_id,
            label_id,
        },
        ReplayEncodedEvent::Navigation {
            direction,
            target_id,
            index,
            ..
        } => ReplayPlaybackEvent::Navigation {
            lane,
            at_ms,
            delta_ms,
            direction: nav_direction_name(&direction),
            target_id,
            index,
        },
        ReplayEncodedEvent::Page {
            page,
            total_pages,
            ..
        } => ReplayPlaybackEvent::Page {
            lane,
            at_ms,
            delta_ms,
            page,
            total_pages,
        },
        ReplayEncodedEvent::Modal { name_id, open, .. } => ReplayPlaybackEvent::Modal {
            lane,
            at_ms,
            delta_ms,
            name_id,
            open,
        },
        ReplayEncodedEvent::SignatureStart {
            target_id,
            stroke_id,
            x,
            y,
            pressure,
            ..
        } => ReplayPlaybackEvent::SignatureStart {
            lane,
            at_ms,
            delta_ms,
            target_id,
            stroke_id,
            x,
            y,
            pressure,
        },
        ReplayEncodedEvent::SignaturePoint {
            stroke_id,
            x,
            y,
            pressure,
            ..
        } => ReplayPlaybackEvent::SignaturePoint {
            lane,
            at_ms,
            delta_ms,
            stroke_id,
            x,
            y,
            pressure,
        },
        ReplayEncodedEvent::SignatureEnd { stroke_id, .. } => ReplayPlaybackEvent::SignatureEnd {
            lane,
            at_ms,
            delta_ms,
            stroke_id,
        },
        ReplayEncodedEvent::SignatureCommit {
            target_id,
            signature_id,
            ..
        } => ReplayPlaybackEvent::SignatureCommit {
            lane,
            at_ms,
            delta_ms,
            target_id,
            signature_id,
        },
        ReplayEncodedEvent::SignatureClear { target_id, .. } => ReplayPlaybackEvent::SignatureClear {
            lane,
            at_ms,
            delta_ms,
            target_id,
        },
        ReplayEncodedEvent::FieldCommit {
            target_id,
            value_id,
            ..
        } => ReplayPlaybackEvent::FieldCommit {
            lane,
            at_ms,
            delta_ms,
            target_id,
            value_id,
        },
        ReplayEncodedEvent::Clipboard {
            action,
            target_id,
            summary_id,
            ..
        } => ReplayPlaybackEvent::Clipboard {
            lane,
            at_ms,
            delta_ms,
            action: clipboard_action_name(&action),
            target_id,
            summary_id,
        },
        ReplayEncodedEvent::ContextMenu { target_id, x, y, .. } => ReplayPlaybackEvent::ContextMenu {
            lane, at_ms, delta_ms, target_id, x, y,
        },
        ReplayEncodedEvent::MouseMove { dx, dy, .. } => ReplayPlaybackEvent::MouseMove {
            lane, at_ms, delta_ms, dx, dy,
        },
        ReplayEncodedEvent::HoverDwell { target_id, duration_ms, .. } => ReplayPlaybackEvent::HoverDwell {
            lane, at_ms, delta_ms, target_id, duration_ms,
        },
        ReplayEncodedEvent::ViewportResize { width, height, .. } => ReplayPlaybackEvent::ViewportResize {
            lane, at_ms, delta_ms, width, height,
        },
        ReplayEncodedEvent::TouchStart { x, y, radius, force, .. } => ReplayPlaybackEvent::TouchStart {
            lane, at_ms, delta_ms, x, y, radius, force,
        },
        ReplayEncodedEvent::TouchMove { dx, dy, radius, force, .. } => ReplayPlaybackEvent::TouchMove {
            lane, at_ms, delta_ms, dx, dy, radius, force,
        },
        ReplayEncodedEvent::TouchEnd { .. } => ReplayPlaybackEvent::TouchEnd {
            lane, at_ms, delta_ms,
        },
        ReplayEncodedEvent::FieldCorrection { target_id, correction_kind, count, .. } => ReplayPlaybackEvent::FieldCorrection {
            lane, at_ms, delta_ms, target_id, correction_kind, count,
        },
        ReplayEncodedEvent::ScrollMomentum { velocity, deceleration, .. } => ReplayPlaybackEvent::ScrollMomentum {
            lane, at_ms, delta_ms, velocity, deceleration,
        },
    }
}

pub fn build_replay_lane_from_events(
    events: &[ReplayEncodedEvent],
    lane: u32,
    label: Option<String>,
) -> ReplayPlaybackLane {
    let mut at_ms = 0u32;
    let mut playback_events = Vec::with_capacity(events.len());

    for event in events {
        let delta_ms = event_delta_ms(match event {
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
        });
        at_ms = at_ms.saturating_add(delta_ms);
        playback_events.push(convert_event(lane, at_ms, delta_ms, event.clone()));
    }

    let duration_ms = playback_events.last().map(|event| event_at_ms(event)).unwrap_or(0);

    ReplayPlaybackLane {
        lane,
        label,
        duration_ms,
        event_count: playback_events.len(),
        events: playback_events,
    }
}

pub fn build_replay_lane_from_tape(
    tape_base64: &str,
    lane: u32,
    label: Option<String>,
) -> ReplayPlaybackLane {
    let events = decode_replay_events(tape_base64);
    build_replay_lane_from_events(&events, lane, label)
}

pub fn merge_replay_lanes(mut lanes: Vec<ReplayPlaybackLane>) -> ReplayPlaybackTimeline {
    let mut events = Vec::new();
    let mut duration_ms = 0u32;

    lanes.sort_by_key(|lane| lane.lane);
    for lane in &lanes {
        duration_ms = duration_ms.max(lane.duration_ms);
        events.extend(lane.events.iter().cloned());
    }

    events.sort_by_key(|event| {
        (
            event_at_ms(event),
            event_lane(event),
            event_order_key(event),
        )
    });

    ReplayPlaybackTimeline {
        duration_ms,
        lane_count: lanes.len(),
        event_count: events.len(),
        lanes,
        events,
    }
}

pub fn build_replay_timeline_from_tape(
    tape_base64: &str,
    lane: u32,
    label: Option<String>,
) -> ReplayPlaybackTimeline {
    merge_replay_lanes(vec![build_replay_lane_from_tape(tape_base64, lane, label)])
}

pub fn build_replay_timeline_from_events(
    events: &[ReplayEncodedEvent],
    lane: u32,
    label: Option<String>,
) -> ReplayPlaybackTimeline {
    merge_replay_lanes(vec![build_replay_lane_from_events(events, lane, label)])
}

pub fn event_at_ms(event: &ReplayPlaybackEvent) -> u32 {
    match event {
        ReplayPlaybackEvent::Scroll { at_ms, .. }
        | ReplayPlaybackEvent::Click { at_ms, .. }
        | ReplayPlaybackEvent::Key { at_ms, .. }
        | ReplayPlaybackEvent::Focus { at_ms, .. }
        | ReplayPlaybackEvent::Blur { at_ms, .. }
        | ReplayPlaybackEvent::Visibility { at_ms, .. }
        | ReplayPlaybackEvent::Highlight { at_ms, .. }
        | ReplayPlaybackEvent::Navigation { at_ms, .. }
        | ReplayPlaybackEvent::Page { at_ms, .. }
        | ReplayPlaybackEvent::Modal { at_ms, .. }
        | ReplayPlaybackEvent::SignatureStart { at_ms, .. }
        | ReplayPlaybackEvent::SignaturePoint { at_ms, .. }
        | ReplayPlaybackEvent::SignatureEnd { at_ms, .. }
        | ReplayPlaybackEvent::SignatureCommit { at_ms, .. }
        | ReplayPlaybackEvent::SignatureClear { at_ms, .. }
        | ReplayPlaybackEvent::FieldCommit { at_ms, .. }
        | ReplayPlaybackEvent::Clipboard { at_ms, .. }
        | ReplayPlaybackEvent::ContextMenu { at_ms, .. }
        | ReplayPlaybackEvent::MouseMove { at_ms, .. }
        | ReplayPlaybackEvent::HoverDwell { at_ms, .. }
        | ReplayPlaybackEvent::ViewportResize { at_ms, .. }
        | ReplayPlaybackEvent::TouchStart { at_ms, .. }
        | ReplayPlaybackEvent::TouchMove { at_ms, .. }
        | ReplayPlaybackEvent::TouchEnd { at_ms, .. }
        | ReplayPlaybackEvent::FieldCorrection { at_ms, .. }
        | ReplayPlaybackEvent::ScrollMomentum { at_ms, .. } => *at_ms,
    }
}

pub fn event_lane(event: &ReplayPlaybackEvent) -> u32 {
    match event {
        ReplayPlaybackEvent::Scroll { lane, .. }
        | ReplayPlaybackEvent::Click { lane, .. }
        | ReplayPlaybackEvent::Key { lane, .. }
        | ReplayPlaybackEvent::Focus { lane, .. }
        | ReplayPlaybackEvent::Blur { lane, .. }
        | ReplayPlaybackEvent::Visibility { lane, .. }
        | ReplayPlaybackEvent::Highlight { lane, .. }
        | ReplayPlaybackEvent::Navigation { lane, .. }
        | ReplayPlaybackEvent::Page { lane, .. }
        | ReplayPlaybackEvent::Modal { lane, .. }
        | ReplayPlaybackEvent::SignatureStart { lane, .. }
        | ReplayPlaybackEvent::SignaturePoint { lane, .. }
        | ReplayPlaybackEvent::SignatureEnd { lane, .. }
        | ReplayPlaybackEvent::SignatureCommit { lane, .. }
        | ReplayPlaybackEvent::SignatureClear { lane, .. }
        | ReplayPlaybackEvent::FieldCommit { lane, .. }
        | ReplayPlaybackEvent::Clipboard { lane, .. }
        | ReplayPlaybackEvent::ContextMenu { lane, .. }
        | ReplayPlaybackEvent::MouseMove { lane, .. }
        | ReplayPlaybackEvent::HoverDwell { lane, .. }
        | ReplayPlaybackEvent::ViewportResize { lane, .. }
        | ReplayPlaybackEvent::TouchStart { lane, .. }
        | ReplayPlaybackEvent::TouchMove { lane, .. }
        | ReplayPlaybackEvent::TouchEnd { lane, .. }
        | ReplayPlaybackEvent::FieldCorrection { lane, .. }
        | ReplayPlaybackEvent::ScrollMomentum { lane, .. } => *lane,
    }
}

fn event_order_key(event: &ReplayPlaybackEvent) -> u32 {
    match event {
        ReplayPlaybackEvent::Scroll { .. } => ReplayOp::Scroll as u32,
        ReplayPlaybackEvent::Click { .. } => ReplayOp::Click as u32,
        ReplayPlaybackEvent::Key { .. } => ReplayOp::Key as u32,
        ReplayPlaybackEvent::Focus { .. } => ReplayOp::Focus as u32,
        ReplayPlaybackEvent::Blur { .. } => ReplayOp::Blur as u32,
        ReplayPlaybackEvent::Visibility { .. } => ReplayOp::Visibility as u32,
        ReplayPlaybackEvent::Highlight { .. } => ReplayOp::Highlight as u32,
        ReplayPlaybackEvent::Navigation { .. } => ReplayOp::Navigation as u32,
        ReplayPlaybackEvent::Page { .. } => ReplayOp::Page as u32,
        ReplayPlaybackEvent::Modal { .. } => ReplayOp::Modal as u32,
        ReplayPlaybackEvent::SignatureStart { .. } => ReplayOp::SignatureStart as u32,
        ReplayPlaybackEvent::SignaturePoint { .. } => ReplayOp::SignaturePoint as u32,
        ReplayPlaybackEvent::SignatureEnd { .. } => ReplayOp::SignatureEnd as u32,
        ReplayPlaybackEvent::SignatureCommit { .. } => ReplayOp::SignatureCommit as u32,
        ReplayPlaybackEvent::SignatureClear { .. } => ReplayOp::SignatureClear as u32,
        ReplayPlaybackEvent::FieldCommit { .. } => ReplayOp::FieldCommit as u32,
        ReplayPlaybackEvent::Clipboard { .. } => ReplayOp::Clipboard as u32,
        ReplayPlaybackEvent::ContextMenu { .. } => ReplayOp::ContextMenu as u32,
        ReplayPlaybackEvent::MouseMove { .. } => ReplayOp::MouseMove as u32,
        ReplayPlaybackEvent::HoverDwell { .. } => ReplayOp::HoverDwell as u32,
        ReplayPlaybackEvent::ViewportResize { .. } => ReplayOp::ViewportResize as u32,
        ReplayPlaybackEvent::TouchStart { .. } => ReplayOp::TouchStart as u32,
        ReplayPlaybackEvent::TouchMove { .. } => ReplayOp::TouchMove as u32,
        ReplayPlaybackEvent::TouchEnd { .. } => ReplayOp::TouchEnd as u32,
        ReplayPlaybackEvent::FieldCorrection { .. } => ReplayOp::FieldCorrection as u32,
        ReplayPlaybackEvent::ScrollMomentum { .. } => ReplayOp::ScrollMomentum as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::ReplayEncodedEvent;

    #[test]
    fn lane_timeline_has_absolute_timestamps() {
        let lane = build_replay_lane_from_events(
            &[
                ReplayEncodedEvent::Navigation {
                    delta: 0,
                    direction: "next".into(),
                    target_id: 7,
                    index: 1,
                },
                ReplayEncodedEvent::Click {
                    delta: 3,
                    target_id: 9,
                    x: 10,
                    y: 20,
                    button: 0,
                },
                ReplayEncodedEvent::SignatureStart {
                    delta: 2,
                    target_id: 4,
                    stroke_id: 11,
                    x: 14,
                    y: 22,
                    pressure: 128,
                },
            ],
            2,
            Some("Signer B".into()),
        );

        assert_eq!(lane.lane, 2);
        assert_eq!(lane.duration_ms, 40);
        assert_eq!(lane.events.len(), 3);
        assert_eq!(event_at_ms(&lane.events[1]), 24);
        assert_eq!(event_at_ms(&lane.events[2]), 40);
    }

    #[test]
    fn merged_timeline_orders_by_time_then_lane() {
        let first = build_replay_lane_from_events(
            &[ReplayEncodedEvent::Click {
                delta: 2,
                target_id: 1,
                x: 1,
                y: 1,
                button: 0,
            }],
            1,
            Some("A".into()),
        );
        let second = build_replay_lane_from_events(
            &[ReplayEncodedEvent::Click {
                delta: 2,
                target_id: 2,
                x: 2,
                y: 2,
                button: 0,
            }],
            0,
            Some("B".into()),
        );
        let merged = merge_replay_lanes(vec![first, second]);

        assert_eq!(merged.lane_count, 2);
        assert_eq!(merged.event_count, 2);
        assert_eq!(event_lane(&merged.events[0]), 0);
        assert_eq!(event_lane(&merged.events[1]), 1);
    }
}
