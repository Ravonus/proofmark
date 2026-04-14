pub mod codec;
pub mod analysis;
pub mod format;
pub mod playback;
pub mod scene;
pub mod container;
pub mod controller;

pub use codec::{
    decode_replay_events, decode_signature, encode_replay_events, encode_signature,
    ReplayEncodedEvent, ReplayEncodedPayload, TimedSignaturePoint, TimedSignatureStroke,
};
pub use analysis::{
    analyze_replay_signature_activity, analyze_replay_signature_tape, analyze_signature_strokes,
    extract_signature_strokes_from_replay_events, SignatureBounds, SignatureMotionMetrics,
    SignatureStrokeMetrics,
};
pub use playback::{
    build_replay_lane_from_events, build_replay_lane_from_tape, build_replay_timeline_from_events,
    build_replay_timeline_from_tape, event_at_ms, event_lane, merge_replay_lanes,
    ReplayPlaybackEvent, ReplayPlaybackLane, ReplayPlaybackTimeline,
};
pub use scene::{
    FieldGeometry, FieldType, PageGeometry, Rect, SceneModel, SignaturePadGeometry,
    StringEntry, TargetEntry, Viewport,
};
pub use container::{
    decode_container, encode_container, find_checkpoint_for_ms, Checkpoint, ChunkHash,
    IntegrityFooter, ReplayContainer, SessionHeader,
};
pub use controller::{
    ActiveStroke, MultiSignerController, PlaybackController, PlaybackState, SceneSnapshot,
    StrokePoint,
};

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm")]
fn wasm_error(message: impl Into<String>) -> JsValue {
    JsValue::from_str(&message.into())
}

// ── Existing WASM bindings ──────────────────────────────────

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = encode_signature)]
pub fn encode_signature_js(strokes: JsValue) -> Result<String, JsValue> {
    let strokes: Vec<TimedSignatureStroke> =
        serde_wasm_bindgen::from_value(strokes).map_err(|err| wasm_error(err.to_string()))?;
    Ok(encode_signature(&strokes))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = decode_signature)]
pub fn decode_signature_js(encoded: &str) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&decode_signature(encoded))
        .map_err(|err| wasm_error(err.to_string()))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = encode_replay_events)]
pub fn encode_replay_events_js(events: JsValue) -> Result<JsValue, JsValue> {
    let events: Vec<ReplayEncodedEvent> =
        serde_wasm_bindgen::from_value(events).map_err(|err| wasm_error(err.to_string()))?;
    serde_wasm_bindgen::to_value(&encode_replay_events(&events))
        .map_err(|err| wasm_error(err.to_string()))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = decode_replay_events)]
pub fn decode_replay_events_js(tape_base64: &str) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&decode_replay_events(tape_base64))
        .map_err(|err| wasm_error(err.to_string()))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = build_replay_timeline)]
pub fn build_replay_timeline_js(
    tape_base64: &str,
    lane: u32,
    label: Option<String>,
) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&build_replay_timeline_from_tape(tape_base64, lane, label))
        .map_err(|err| wasm_error(err.to_string()))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = merge_replay_timelines)]
pub fn merge_replay_timelines_js(timelines: JsValue) -> Result<JsValue, JsValue> {
    let lanes: Vec<ReplayPlaybackLane> =
        serde_wasm_bindgen::from_value(timelines).map_err(|err| wasm_error(err.to_string()))?;
    serde_wasm_bindgen::to_value(&merge_replay_lanes(lanes)).map_err(|err| wasm_error(err.to_string()))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = analyze_signature_strokes)]
pub fn analyze_signature_strokes_js(strokes: JsValue) -> Result<JsValue, JsValue> {
    let strokes: Vec<TimedSignatureStroke> =
        serde_wasm_bindgen::from_value(strokes).map_err(|err| wasm_error(err.to_string()))?;
    serde_wasm_bindgen::to_value(&analyze_signature_strokes(&strokes))
        .map_err(|err| wasm_error(err.to_string()))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = analyze_replay_signature_activity)]
pub fn analyze_replay_signature_activity_js(tape_base64: &str) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&analyze_replay_signature_tape(tape_base64))
        .map_err(|err| wasm_error(err.to_string()))
}

// ── New WASM bindings: Container ────────────────────────────

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = encode_container)]
pub fn encode_container_js(
    header: JsValue,
    scene: JsValue,
    events: JsValue,
) -> Result<JsValue, JsValue> {
    let header: SessionHeader =
        serde_wasm_bindgen::from_value(header).map_err(|err| wasm_error(err.to_string()))?;
    let scene: SceneModel =
        serde_wasm_bindgen::from_value(scene).map_err(|err| wasm_error(err.to_string()))?;
    let events: Vec<ReplayEncodedEvent> =
        serde_wasm_bindgen::from_value(events).map_err(|err| wasm_error(err.to_string()))?;
    let bytes = encode_container(&header, &scene, &events);
    serde_wasm_bindgen::to_value(&bytes).map_err(|err| wasm_error(err.to_string()))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen(js_name = decode_container)]
pub fn decode_container_js(data: &[u8]) -> Result<JsValue, JsValue> {
    match decode_container(data) {
        Some(container) => serde_wasm_bindgen::to_value(&container)
            .map_err(|err| wasm_error(err.to_string())),
        None => Err(wasm_error("invalid container")),
    }
}

// ── New WASM bindings: Controller ───────────────────────────

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub struct WasmPlaybackController {
    inner: PlaybackController,
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
impl WasmPlaybackController {
    #[wasm_bindgen(constructor)]
    pub fn new(tape_base64: &str, lane: u32) -> Self {
        Self {
            inner: PlaybackController::from_tape(tape_base64, lane),
        }
    }

    pub fn play(&mut self) {
        self.inner.play();
    }

    pub fn pause(&mut self) {
        self.inner.pause();
    }

    pub fn resume(&mut self) {
        self.inner.resume();
    }

    pub fn seek(&mut self, target_ms: u32) {
        self.inner.seek(target_ms);
    }

    #[wasm_bindgen(js_name = setSpeed)]
    pub fn set_speed(&mut self, speed: f32) {
        self.inner.set_speed(speed);
    }

    pub fn tick(&mut self, real_elapsed_ms: u32) -> Result<JsValue, JsValue> {
        let fired: Vec<(u32, ReplayEncodedEvent)> = self
            .inner
            .tick(real_elapsed_ms)
            .into_iter()
            .map(|(at, e)| (at, e.clone()))
            .collect();
        serde_wasm_bindgen::to_value(&fired).map_err(|err| wasm_error(err.to_string()))
    }

    pub fn snapshot(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.snapshot())
            .map_err(|err| wasm_error(err.to_string()))
    }

    #[wasm_bindgen(js_name = snapshotAt)]
    pub fn snapshot_at(&self, target_ms: u32) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.snapshot_at(target_ms))
            .map_err(|err| wasm_error(err.to_string()))
    }

    pub fn state(&self) -> String {
        match self.inner.state() {
            PlaybackState::Idle => "idle".into(),
            PlaybackState::Playing => "playing".into(),
            PlaybackState::Paused => "paused".into(),
            PlaybackState::Ended => "ended".into(),
        }
    }

    #[wasm_bindgen(getter, js_name = cursorMs)]
    pub fn cursor_ms(&self) -> u32 {
        self.inner.cursor_ms()
    }

    #[wasm_bindgen(getter, js_name = durationMs)]
    pub fn duration_ms(&self) -> u32 {
        self.inner.duration_ms()
    }

    #[wasm_bindgen(getter)]
    pub fn progress(&self) -> f32 {
        self.inner.progress()
    }

    #[wasm_bindgen(getter, js_name = eventCount)]
    pub fn event_count(&self) -> usize {
        self.inner.event_count()
    }
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub struct WasmMultiSignerController {
    inner: MultiSignerController,
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
impl WasmMultiSignerController {
    #[wasm_bindgen(constructor)]
    pub fn new(tapes: JsValue) -> Result<WasmMultiSignerController, JsValue> {
        let tape_configs: Vec<(String, u32)> =
            serde_wasm_bindgen::from_value(tapes).map_err(|err| wasm_error(err.to_string()))?;
        let controllers: Vec<PlaybackController> = tape_configs
            .into_iter()
            .map(|(tape, lane)| PlaybackController::from_tape(&tape, lane))
            .collect();
        Ok(Self {
            inner: MultiSignerController::new(controllers),
        })
    }

    pub fn play(&mut self) {
        self.inner.play();
    }

    pub fn pause(&mut self) {
        self.inner.pause();
    }

    pub fn resume(&mut self) {
        self.inner.resume();
    }

    pub fn seek(&mut self, target_ms: u32) {
        self.inner.seek(target_ms);
    }

    #[wasm_bindgen(js_name = setSpeed)]
    pub fn set_speed(&mut self, speed: f32) {
        self.inner.set_speed(speed);
    }

    pub fn tick(&mut self, real_elapsed_ms: u32) -> Result<JsValue, JsValue> {
        let fired = self.inner.tick(real_elapsed_ms);
        serde_wasm_bindgen::to_value(&fired).map_err(|err| wasm_error(err.to_string()))
    }

    pub fn snapshots(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.inner.snapshots())
            .map_err(|err| wasm_error(err.to_string()))
    }

    #[wasm_bindgen(getter, js_name = cursorMs)]
    pub fn cursor_ms(&self) -> u32 {
        self.inner.cursor_ms
    }

    #[wasm_bindgen(getter, js_name = durationMs)]
    pub fn duration_ms(&self) -> u32 {
        self.inner.duration_ms
    }

    #[wasm_bindgen(getter)]
    pub fn progress(&self) -> f32 {
        self.inner.progress()
    }
}
