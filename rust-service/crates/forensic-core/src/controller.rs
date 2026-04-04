use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::codec::{decode_replay_events, ReplayEncodedEvent};
use crate::container::{find_checkpoint_for_ms, Checkpoint, ReplayContainer};
use crate::format::REPLAY_TIME_QUANTUM_MS;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackState {
    Idle,
    Playing,
    Paused,
    Ended,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SceneSnapshot {
    pub at_ms: u32,
    pub event_index: u32,
    pub scroll_y: u32,
    pub scroll_max: u32,
    pub page: u32,
    pub total_pages: u32,
    pub hidden: bool,
    pub focused_target_id: u32,
    pub current_target_id: u32,
    pub modal_name_id: u32,
    pub modal_open: bool,
    pub active_strokes: Vec<ActiveStroke>,
    pub committed_signature_ids: Vec<u32>,
    pub field_values: Vec<(u32, u32)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActiveStroke {
    pub stroke_id: u32,
    pub target_id: u32,
    pub points: Vec<StrokePoint>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StrokePoint {
    pub x: u32,
    pub y: u32,
    pub pressure: u8,
    pub at_ms: u32,
}

impl SceneSnapshot {
    pub fn empty() -> Self {
        Self {
            at_ms: 0,
            event_index: 0,
            scroll_y: 0,
            scroll_max: 0,
            page: 0,
            total_pages: 0,
            hidden: false,
            focused_target_id: 0,
            current_target_id: 0,
            modal_name_id: 0,
            modal_open: false,
            active_strokes: Vec::new(),
            committed_signature_ids: Vec::new(),
            field_values: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackController {
    events: Vec<ReplayEncodedEvent>,
    checkpoints: Vec<Checkpoint>,
    duration_ms: u32,
    state: PlaybackState,
    cursor_ms: u32,
    event_cursor: usize,
    speed: f32,
    lane: u32,
}

fn event_delta(event: &ReplayEncodedEvent) -> u32 {
    match event {
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
    }
}

fn delta_to_ms(delta: u32) -> u32 {
    delta.saturating_mul(REPLAY_TIME_QUANTUM_MS as u32)
}

impl PlaybackController {
    pub fn from_container(container: &ReplayContainer, lane: u32) -> Self {
        let events = decode_replay_events(&container.tape.tape_base64);
        Self {
            checkpoints: container.footer.checkpoints.clone(),
            duration_ms: container.footer.total_duration_ms,
            events,
            state: PlaybackState::Idle,
            cursor_ms: 0,
            event_cursor: 0,
            speed: 1.0,
            lane,
        }
    }

    pub fn from_events(events: Vec<ReplayEncodedEvent>, lane: u32) -> Self {
        let quantum = REPLAY_TIME_QUANTUM_MS as u32;
        let duration_ms = events
            .iter()
            .fold(0u32, |acc, e| acc.saturating_add(event_delta(e).saturating_mul(quantum)));

        Self {
            checkpoints: Vec::new(),
            duration_ms,
            events,
            state: PlaybackState::Idle,
            cursor_ms: 0,
            event_cursor: 0,
            speed: 1.0,
            lane,
        }
    }

    pub fn from_tape(tape_base64: &str, lane: u32) -> Self {
        Self::from_events(decode_replay_events(tape_base64), lane)
    }

    pub fn state(&self) -> PlaybackState {
        self.state
    }

    pub fn cursor_ms(&self) -> u32 {
        self.cursor_ms
    }

    pub fn duration_ms(&self) -> u32 {
        self.duration_ms
    }

    pub fn speed(&self) -> f32 {
        self.speed
    }

    pub fn event_count(&self) -> usize {
        self.events.len()
    }

    pub fn progress(&self) -> f32 {
        if self.duration_ms == 0 {
            return 0.0;
        }
        (self.cursor_ms as f32 / self.duration_ms as f32).min(1.0)
    }

    pub fn play(&mut self) {
        if self.state == PlaybackState::Ended {
            self.seek(0);
        }
        self.state = PlaybackState::Playing;
    }

    pub fn pause(&mut self) {
        if self.state == PlaybackState::Playing {
            self.state = PlaybackState::Paused;
        }
    }

    pub fn resume(&mut self) {
        if self.state == PlaybackState::Paused {
            self.state = PlaybackState::Playing;
        }
    }

    pub fn set_speed(&mut self, speed: f32) {
        self.speed = speed.max(0.1).min(16.0);
    }

    pub fn seek(&mut self, target_ms: u32) {
        let target_ms = target_ms.min(self.duration_ms);
        self.cursor_ms = target_ms;

        // Use checkpoint for fast seek if available
        if let Some(cp) = find_checkpoint_for_ms(&self.checkpoints, target_ms) {
            self.event_cursor = cp.event_index as usize;
        } else {
            self.event_cursor = 0;
        }

        // Walk from checkpoint to exact position
        let mut at_ms = if self.event_cursor > 0 {
            // Re-accumulate time from start to checkpoint event
            self.events[..self.event_cursor]
                .iter()
                .fold(0u32, |acc, e| acc.saturating_add(delta_to_ms(event_delta(e))))
        } else {
            0
        };

        while self.event_cursor < self.events.len() {
            let next_delta = delta_to_ms(event_delta(&self.events[self.event_cursor]));
            if at_ms + next_delta > target_ms {
                break;
            }
            at_ms = at_ms.saturating_add(next_delta);
            self.event_cursor += 1;
        }

        if target_ms >= self.duration_ms {
            self.state = PlaybackState::Ended;
        } else if self.state == PlaybackState::Ended {
            self.state = PlaybackState::Paused;
        }
    }

    /// Advance by `real_elapsed_ms` of wall-clock time (scaled by speed).
    /// Returns events that fire during this tick.
    pub fn tick(&mut self, real_elapsed_ms: u32) -> Vec<(u32, &ReplayEncodedEvent)> {
        if self.state != PlaybackState::Playing {
            return Vec::new();
        }

        let advance_ms = (real_elapsed_ms as f32 * self.speed) as u32;
        let end_ms = (self.cursor_ms + advance_ms).min(self.duration_ms);
        let mut fired = Vec::new();

        let mut at_ms = self.events[..self.event_cursor]
            .iter()
            .fold(0u32, |acc, e| acc.saturating_add(delta_to_ms(event_delta(e))));

        while self.event_cursor < self.events.len() {
            let next_delta = delta_to_ms(event_delta(&self.events[self.event_cursor]));
            let next_ms = at_ms.saturating_add(next_delta);
            if next_ms > end_ms {
                break;
            }
            at_ms = next_ms;
            fired.push((at_ms, &self.events[self.event_cursor]));
            self.event_cursor += 1;
        }

        self.cursor_ms = end_ms;

        if self.cursor_ms >= self.duration_ms {
            self.state = PlaybackState::Ended;
        }

        fired
    }

    /// Build a complete scene snapshot at the current cursor position.
    pub fn snapshot(&self) -> SceneSnapshot {
        self.snapshot_at(self.cursor_ms)
    }

    /// Build a scene snapshot at an arbitrary timestamp.
    pub fn snapshot_at(&self, target_ms: u32) -> SceneSnapshot {
        let mut snap = SceneSnapshot::empty();
        snap.at_ms = target_ms;

        let mut at_ms = 0u32;
        let mut active_strokes: BTreeMap<u32, ActiveStroke> = BTreeMap::new();
        let mut stroke_order: Vec<u32> = Vec::new();

        for (i, event) in self.events.iter().enumerate() {
            let delta = delta_to_ms(event_delta(event));
            at_ms = at_ms.saturating_add(delta);
            if at_ms > target_ms {
                break;
            }

            snap.event_index = i as u32 + 1;

            match event {
                ReplayEncodedEvent::Scroll { scroll_y, scroll_max, .. } => {
                    snap.scroll_y = *scroll_y;
                    snap.scroll_max = *scroll_max;
                }
                ReplayEncodedEvent::Click { target_id, .. } => {
                    snap.current_target_id = *target_id;
                }
                ReplayEncodedEvent::Key { target_id, .. } => {
                    snap.current_target_id = *target_id;
                }
                ReplayEncodedEvent::Focus { target_id, .. } => {
                    snap.focused_target_id = *target_id;
                    snap.current_target_id = *target_id;
                }
                ReplayEncodedEvent::Blur { target_id, .. } => {
                    if snap.focused_target_id == *target_id {
                        snap.focused_target_id = 0;
                    }
                    snap.current_target_id = *target_id;
                }
                ReplayEncodedEvent::Visibility { hidden, .. } => {
                    snap.hidden = *hidden;
                }
                ReplayEncodedEvent::Highlight { target_id, .. } => {
                    snap.current_target_id = *target_id;
                }
                ReplayEncodedEvent::Navigation { target_id, .. } => {
                    snap.current_target_id = *target_id;
                }
                ReplayEncodedEvent::Page { page, total_pages, .. } => {
                    snap.page = *page;
                    snap.total_pages = *total_pages;
                }
                ReplayEncodedEvent::Modal { name_id, open, .. } => {
                    snap.modal_name_id = *name_id;
                    snap.modal_open = *open;
                }
                ReplayEncodedEvent::SignatureStart { target_id, stroke_id, x, y, pressure, .. } => {
                    snap.current_target_id = *target_id;
                    if !active_strokes.contains_key(stroke_id) {
                        stroke_order.push(*stroke_id);
                    }
                    active_strokes.insert(*stroke_id, ActiveStroke {
                        stroke_id: *stroke_id,
                        target_id: *target_id,
                        points: vec![StrokePoint { x: *x, y: *y, pressure: *pressure, at_ms }],
                    });
                }
                ReplayEncodedEvent::SignaturePoint { stroke_id, x, y, pressure, .. } => {
                    if let Some(stroke) = active_strokes.get_mut(stroke_id) {
                        stroke.points.push(StrokePoint { x: *x, y: *y, pressure: *pressure, at_ms });
                    }
                }
                ReplayEncodedEvent::SignatureEnd { .. } => {}
                ReplayEncodedEvent::SignatureCommit { target_id, signature_id, .. } => {
                    snap.current_target_id = *target_id;
                    snap.committed_signature_ids.push(*signature_id);
                }
                ReplayEncodedEvent::SignatureClear { target_id, .. } => {
                    snap.current_target_id = *target_id;
                    active_strokes.clear();
                    stroke_order.clear();
                }
                ReplayEncodedEvent::FieldCommit { target_id, value_id, .. } => {
                    snap.current_target_id = *target_id;
                    if let Some(existing) = snap.field_values.iter_mut().find(|(tid, _)| *tid == *target_id) {
                        existing.1 = *value_id;
                    } else {
                        snap.field_values.push((*target_id, *value_id));
                    }
                }
                ReplayEncodedEvent::Clipboard { target_id, .. } => {
                    snap.current_target_id = *target_id;
                }
                ReplayEncodedEvent::ContextMenu { target_id, .. } => {
                    snap.current_target_id = *target_id;
                }
                // v2 events — don't affect core scene state
                ReplayEncodedEvent::MouseMove { .. }
                | ReplayEncodedEvent::HoverDwell { .. }
                | ReplayEncodedEvent::ViewportResize { .. }
                | ReplayEncodedEvent::TouchStart { .. }
                | ReplayEncodedEvent::TouchMove { .. }
                | ReplayEncodedEvent::TouchEnd { .. }
                | ReplayEncodedEvent::FieldCorrection { .. }
                | ReplayEncodedEvent::ScrollMomentum { .. } => {}
            }
        }

        snap.active_strokes = stroke_order
            .iter()
            .filter_map(|sid| active_strokes.remove(sid))
            .collect();

        snap
    }

    /// Events from start to the given ms, as absolute-time tuples.
    pub fn events_up_to(&self, target_ms: u32) -> Vec<(u32, ReplayEncodedEvent)> {
        let mut result = Vec::new();
        let mut at_ms = 0u32;
        for event in &self.events {
            at_ms = at_ms.saturating_add(delta_to_ms(event_delta(event)));
            if at_ms > target_ms {
                break;
            }
            result.push((at_ms, event.clone()));
        }
        result
    }
}

/// Merge multiple controllers into a synchronized multi-signer timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiSignerController {
    pub controllers: Vec<PlaybackController>,
    pub duration_ms: u32,
    pub state: PlaybackState,
    pub cursor_ms: u32,
    pub speed: f32,
}

impl MultiSignerController {
    pub fn new(controllers: Vec<PlaybackController>) -> Self {
        let duration_ms = controllers
            .iter()
            .map(|c| c.duration_ms)
            .max()
            .unwrap_or(0);
        Self {
            controllers,
            duration_ms,
            state: PlaybackState::Idle,
            cursor_ms: 0,
            speed: 1.0,
        }
    }

    pub fn play(&mut self) {
        if self.state == PlaybackState::Ended {
            self.seek(0);
        }
        self.state = PlaybackState::Playing;
        for c in &mut self.controllers {
            c.play();
        }
    }

    pub fn pause(&mut self) {
        self.state = PlaybackState::Paused;
        for c in &mut self.controllers {
            c.pause();
        }
    }

    pub fn resume(&mut self) {
        self.state = PlaybackState::Playing;
        for c in &mut self.controllers {
            c.resume();
        }
    }

    pub fn set_speed(&mut self, speed: f32) {
        self.speed = speed.max(0.1).min(16.0);
        for c in &mut self.controllers {
            c.set_speed(self.speed);
        }
    }

    pub fn seek(&mut self, target_ms: u32) {
        let target_ms = target_ms.min(self.duration_ms);
        self.cursor_ms = target_ms;
        for c in &mut self.controllers {
            c.seek(target_ms);
        }
        if target_ms >= self.duration_ms {
            self.state = PlaybackState::Ended;
        } else if self.state == PlaybackState::Ended {
            self.state = PlaybackState::Paused;
        }
    }

    pub fn tick(&mut self, real_elapsed_ms: u32) -> Vec<(u32, u32, ReplayEncodedEvent)> {
        if self.state != PlaybackState::Playing {
            return Vec::new();
        }

        let advance_ms = (real_elapsed_ms as f32 * self.speed) as u32;
        self.cursor_ms = (self.cursor_ms + advance_ms).min(self.duration_ms);

        let mut all_events: Vec<(u32, u32, ReplayEncodedEvent)> = Vec::new();
        for c in &mut self.controllers {
            let lane = c.lane;
            let fired = c.tick(real_elapsed_ms);
            for (at_ms, event) in fired {
                all_events.push((at_ms, lane, event.clone()));
            }
        }

        all_events.sort_by_key(|(at_ms, lane, _)| (*at_ms, *lane));

        if self.cursor_ms >= self.duration_ms {
            self.state = PlaybackState::Ended;
        }

        all_events
    }

    pub fn snapshots(&self) -> Vec<(u32, SceneSnapshot)> {
        self.controllers
            .iter()
            .map(|c| (c.lane, c.snapshot()))
            .collect()
    }

    pub fn progress(&self) -> f32 {
        if self.duration_ms == 0 {
            return 0.0;
        }
        (self.cursor_ms as f32 / self.duration_ms as f32).min(1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_events() -> Vec<ReplayEncodedEvent> {
        vec![
            ReplayEncodedEvent::Scroll { delta: 0, scroll_y: 0, scroll_max: 2000 },
            ReplayEncodedEvent::Click { delta: 5, target_id: 1, x: 100, y: 200, button: 0 },
            ReplayEncodedEvent::Page { delta: 3, page: 2, total_pages: 5 },
            ReplayEncodedEvent::SignatureStart {
                delta: 2, target_id: 3, stroke_id: 1, x: 10, y: 20, pressure: 128,
            },
            ReplayEncodedEvent::SignaturePoint {
                delta: 1, stroke_id: 1, x: 15, y: 25, pressure: 140,
            },
            ReplayEncodedEvent::SignatureEnd { delta: 1, stroke_id: 1 },
            ReplayEncodedEvent::FieldCommit { delta: 5, target_id: 2, value_id: 7 },
        ]
    }

    #[test]
    fn controller_play_and_tick() {
        let mut ctrl = PlaybackController::from_events(sample_events(), 0);
        assert_eq!(ctrl.state(), PlaybackState::Idle);
        assert_eq!(ctrl.event_count(), 7);

        ctrl.play();
        assert_eq!(ctrl.state(), PlaybackState::Playing);

        // Tick forward enough to cover all events
        let fired = ctrl.tick(200);
        assert!(!fired.is_empty());
    }

    #[test]
    fn controller_pause_resume() {
        let mut ctrl = PlaybackController::from_events(sample_events(), 0);
        ctrl.play();
        ctrl.tick(10);
        ctrl.pause();
        assert_eq!(ctrl.state(), PlaybackState::Paused);

        let fired = ctrl.tick(10);
        assert!(fired.is_empty()); // paused, no events

        ctrl.resume();
        assert_eq!(ctrl.state(), PlaybackState::Playing);
    }

    #[test]
    fn controller_seek() {
        let mut ctrl = PlaybackController::from_events(sample_events(), 0);
        ctrl.play();
        ctrl.seek(64); // 64ms = past click (40ms) and page (64ms)

        let snap = ctrl.snapshot();
        assert_eq!(snap.page, 2);
        assert_eq!(snap.total_pages, 5);
    }

    #[test]
    fn controller_speed() {
        let mut ctrl = PlaybackController::from_events(sample_events(), 0);
        ctrl.set_speed(2.0);
        assert!((ctrl.speed() - 2.0).abs() < 0.001);

        ctrl.play();
        let fired = ctrl.tick(100); // 100ms * 2x = 200ms equivalent
        assert!(!fired.is_empty());
    }

    #[test]
    fn snapshot_at_captures_stroke_state() {
        let ctrl = PlaybackController::from_events(sample_events(), 0);
        // After signature start + point, before end
        let snap = ctrl.snapshot_at(88); // 80 + 8 = after sig point
        assert_eq!(snap.active_strokes.len(), 1);
        assert_eq!(snap.active_strokes[0].points.len(), 2);
    }

    #[test]
    fn snapshot_at_captures_field_values() {
        let ctrl = PlaybackController::from_events(sample_events(), 0);
        let snap = ctrl.snapshot_at(200);
        assert_eq!(snap.field_values.len(), 1);
        assert_eq!(snap.field_values[0], (2, 7));
    }

    #[test]
    fn multi_signer_controller_sync() {
        let events_a = vec![
            ReplayEncodedEvent::Click { delta: 5, target_id: 1, x: 10, y: 20, button: 0 },
        ];
        let events_b = vec![
            ReplayEncodedEvent::Click { delta: 3, target_id: 2, x: 30, y: 40, button: 0 },
        ];

        let ca = PlaybackController::from_events(events_a, 0);
        let cb = PlaybackController::from_events(events_b, 1);
        let mut multi = MultiSignerController::new(vec![ca, cb]);

        assert_eq!(multi.duration_ms, 40); // max of 40 and 24
        multi.play();
        let fired = multi.tick(50);
        assert_eq!(fired.len(), 2);
        // Lane 1 event (24ms) should come before lane 0 event (40ms)
        assert_eq!(fired[0].1, 1);
        assert_eq!(fired[1].1, 0);
    }

    #[test]
    fn multi_signer_seek_syncs_all() {
        let ca = PlaybackController::from_events(
            vec![ReplayEncodedEvent::Page { delta: 5, page: 3, total_pages: 10 }],
            0,
        );
        let cb = PlaybackController::from_events(
            vec![ReplayEncodedEvent::Scroll { delta: 2, scroll_y: 500, scroll_max: 2000 }],
            1,
        );
        let mut multi = MultiSignerController::new(vec![ca, cb]);
        multi.seek(50);

        let snaps = multi.snapshots();
        assert_eq!(snaps.len(), 2);
        assert_eq!(snaps[0].1.page, 3);
        assert_eq!(snaps[1].1.scroll_y, 500);
    }

    #[test]
    fn controller_ends_when_past_duration() {
        let mut ctrl = PlaybackController::from_events(sample_events(), 0);
        ctrl.play();
        ctrl.tick(500);
        assert_eq!(ctrl.state(), PlaybackState::Ended);
    }

    #[test]
    fn play_after_ended_resets() {
        let mut ctrl = PlaybackController::from_events(sample_events(), 0);
        ctrl.play();
        ctrl.tick(500);
        assert_eq!(ctrl.state(), PlaybackState::Ended);

        ctrl.play();
        assert_eq!(ctrl.state(), PlaybackState::Playing);
        assert_eq!(ctrl.cursor_ms(), 0);
    }
}
