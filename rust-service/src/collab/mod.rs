//! Real-time collaboration engine — Yrs CRDT, WebSocket gateway, presence tracking.

pub mod awareness;
pub mod crdt;
pub mod protocol;
pub mod room;
pub mod sync;
pub mod ws;

pub use room::{RoomManager, RoomStats};
pub use ws::collab_ws_handler;
