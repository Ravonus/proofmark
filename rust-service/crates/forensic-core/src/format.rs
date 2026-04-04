//! Shared forensic replay wire-format constants for the Rust/WASM codec.

#![allow(dead_code)]

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ReplayChunkKind {
    SessionHeader = 1,
    TargetDictionary = 2,
    StringDictionary = 3,
    MainEventStream = 4,
    SignatureStream = 5,
    EditStream = 6,
    IntegrityFooter = 7,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ReplayStreamId {
    Main = 1,
    Signature = 2,
    Edit = 3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ReplayOp {
    Scroll = 1,
    Click = 2,
    Key = 3,
    Focus = 4,
    Blur = 5,
    Visibility = 6,
    Highlight = 7,
    Navigation = 8,
    Page = 9,
    Modal = 10,
    SignatureStart = 11,
    SignaturePoint = 12,
    SignatureEnd = 13,
    SignatureCommit = 14,
    FieldCommit = 15,
    Clipboard = 16,
    ContextMenu = 17,
    SignatureClear = 18,
    // v2 opcodes — new measurements
    MouseMove = 19,
    HoverDwell = 20,
    ViewportResize = 21,
    TouchStart = 22,
    TouchMove = 23,
    TouchEnd = 24,
    FieldCorrection = 25,
    ScrollMomentum = 26,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ReplayNavDirection {
    Prev = 1,
    Next = 2,
    Jump = 3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ReplayClipboardAction {
    Copy = 1,
    Cut = 2,
    Paste = 3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum ReplayStringKind {
    Key = 1,
    Label = 2,
    Value = 3,
    Signature = 4,
    Clipboard = 5,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum CorrectionKind {
    Backspace = 1,
    Delete = 2,
    SelectAllReplace = 3,
    Undo = 4,
}

pub const REPLAY_CONTAINER_MAGIC: &[u8; 4] = b"PMRP";
pub const REPLAY_TEXT_ENCODING: &str = "pm-replay-v1";
pub const SIGNATURE_TEXT_ENCODING: &str = "pm-sig-v1";

pub const REPLAY_CONTAINER_VERSION: u8 = 2;
pub const CONTAINER_FLAG_DEFLATE: u8 = 0x01;
pub const REPLAY_TIME_QUANTUM_MS: u16 = 8;
pub const REPLAY_COORDINATE_QUANTIZATION_PX: u16 = 1;
pub const REPLAY_PRESSURE_BUCKETS: u16 = 256;

pub const MAX_STORED_STRING_LENGTH: usize = 2048;
pub const MAX_FIELD_SNAPSHOT_LENGTH: usize = 1024;
pub const MAX_CLIPBOARD_PREVIEW: usize = 48;
pub const MAX_TARGET_DESCRIPTOR_LENGTH: usize = 256;
pub const MAX_TARGET_ANCESTORS: usize = 4;

pub const TARGET_CHUNK_EVENT_COUNT: usize = 256;
pub const TARGET_MAIN_CHUNK_BYTES: usize = 16 * 1024;
pub const TARGET_SIGNATURE_CHUNK_BYTES: usize = 8 * 1024;
pub const TARGET_EDIT_CHUNK_BYTES: usize = 8 * 1024;
pub const CHUNK_HASH_EVERY: usize = 4;

pub const fn recommended_chunk_order() -> [ReplayChunkKind; 7] {
    [
        ReplayChunkKind::SessionHeader,
        ReplayChunkKind::TargetDictionary,
        ReplayChunkKind::StringDictionary,
        ReplayChunkKind::MainEventStream,
        ReplayChunkKind::SignatureStream,
        ReplayChunkKind::EditStream,
        ReplayChunkKind::IntegrityFooter,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_magic_is_stable() {
        assert_eq!(REPLAY_CONTAINER_MAGIC, b"PMRP");
        assert_eq!(REPLAY_CONTAINER_VERSION, 2);
        assert_eq!(REPLAY_TIME_QUANTUM_MS, 8);
    }

    #[test]
    fn replay_opcodes_match_browser_contract() {
        assert_eq!(ReplayOp::Scroll as u8, 1);
        assert_eq!(ReplayOp::FieldCommit as u8, 15);
        assert_eq!(ReplayOp::SignatureClear as u8, 18);
        assert_eq!(ReplayOp::MouseMove as u8, 19);
        assert_eq!(ReplayOp::ScrollMomentum as u8, 26);
        assert_eq!(ReplayClipboardAction::Paste as u8, 3);
        assert_eq!(ReplayNavDirection::Jump as u8, 3);
    }

    #[test]
    fn chunk_order_is_stable() {
        let order = recommended_chunk_order();
        assert_eq!(order[0], ReplayChunkKind::SessionHeader);
        assert_eq!(order[6], ReplayChunkKind::IntegrityFooter);
    }
}
