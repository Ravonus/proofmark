//! Real-time collaboration engine — multi-threaded WebSocket gateway with
//! Yrs (Rust Yjs) CRDT operations for document merging, compaction, and
//! conflict resolution.
//!
//! Architecture:
//!   - Room manager: lock-free concurrent rooms via DashMap
//!   - Yrs documents: native CRDT merge/compact/diff
//!   - Binary protocol: compatible with existing MSG_SYNC/MSG_AWARENESS/MSG_CUSTOM
//!   - Awareness: presence tracking with stale cleanup
//!   - WebSocket: actix-ws for multi-threaded connection handling

pub mod awareness;
pub mod crdt;
pub mod protocol;
pub mod room;
pub mod sync;
pub mod ws;

pub use room::{RoomManager, RoomStats};
pub use ws::collab_ws_handler;
