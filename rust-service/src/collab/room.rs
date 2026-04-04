//! Room manager — lock-free concurrent rooms via DashMap.
//!
//! Each room corresponds to a collaboration session and holds:
//!   - The Yrs document state (binary, compacted periodically)
//!   - Connected client IDs
//!   - Dirty flag for flush scheduling
//!   - Per-session awareness

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use parking_lot::RwLock;
use serde::Serialize;
use tokio::sync::broadcast;

use super::awareness::{AwarenessManager, SessionAwareness};
use super::crdt;

/// A connected client in a room.
#[derive(Debug, Clone)]
pub struct ClientInfo {
    pub client_id: u64,
    pub user_id: String,
    pub session_id: String,
}

/// Per-room state.
pub struct Room {
    pub session_id: String,
    pub document_id: Option<String>,
    /// The current Yrs document state (binary).
    state: RwLock<Vec<u8>>,
    /// Broadcast channel for messages to all clients in this room.
    pub tx: broadcast::Sender<(u64, Vec<u8>)>, // (sender_client_id, encoded_message)
    /// Connected client IDs.
    clients: DashMap<u64, ClientInfo>,
    /// Whether the state has unsaved changes.
    dirty: AtomicBool,
    /// Last flush time.
    last_flush: RwLock<Instant>,
    /// Creation time.
    pub created_at: Instant,
}

impl Room {
    pub fn new(session_id: String, document_id: Option<String>, initial_state: Vec<u8>) -> Self {
        let (tx, _) = broadcast::channel(256);
        Self {
            session_id,
            document_id,
            state: RwLock::new(initial_state),
            tx,
            clients: DashMap::new(),
            dirty: AtomicBool::new(false),
            last_flush: RwLock::new(Instant::now()),
            created_at: Instant::now(),
        }
    }

    /// Apply a Yjs update to the room's document state.
    pub fn apply_update(&self, update: &[u8]) -> anyhow::Result<()> {
        let mut state = self.state.write();
        *state = crdt::apply_update(&state, update)?;
        self.dirty.store(true, Ordering::Release);
        Ok(())
    }

    /// Get the current document state (for initial sync).
    pub fn get_state(&self) -> Vec<u8> {
        self.state.read().clone()
    }

    /// Get the state vector (for sync protocol).
    pub fn get_state_vector(&self) -> anyhow::Result<Vec<u8>> {
        let state = self.state.read();
        crdt::get_state_vector(&state)
    }

    /// Encode state relative to a remote state vector.
    pub fn encode_state_from_sv(&self, remote_sv: &[u8]) -> anyhow::Result<Vec<u8>> {
        let state = self.state.read();
        crdt::encode_state_from_sv(&state, remote_sv)
    }

    /// Compact the document state (remove tombstones).
    pub fn compact(&self) -> anyhow::Result<usize> {
        let mut state = self.state.write();
        let before = state.len();
        *state = crdt::compact_state(&state)?;
        let after = state.len();
        Ok(before.saturating_sub(after))
    }

    /// Add a client to this room.
    pub fn add_client(&self, info: ClientInfo) {
        self.clients.insert(info.client_id, info);
    }

    /// Remove a client from this room.
    pub fn remove_client(&self, client_id: u64) {
        self.clients.remove(&client_id);
    }

    /// Number of connected clients.
    pub fn client_count(&self) -> usize {
        self.clients.len()
    }

    /// Check if room is empty.
    pub fn is_empty(&self) -> bool {
        self.clients.is_empty()
    }

    /// Check and clear the dirty flag. Returns true if it was dirty.
    pub fn take_dirty(&self) -> bool {
        self.dirty.swap(false, Ordering::AcqRel)
    }

    /// Mark last flush time.
    pub fn mark_flushed(&self) {
        *self.last_flush.write() = Instant::now();
    }

    /// Time since last flush.
    pub fn time_since_flush(&self) -> Duration {
        Instant::now().duration_since(*self.last_flush.read())
    }

    /// Broadcast a message to all clients (except sender).
    pub fn broadcast(&self, sender_client_id: u64, encoded_message: Vec<u8>) {
        // Ignore send errors (no receivers is fine)
        let _ = self.tx.send((sender_client_id, encoded_message));
    }

    /// Process a sync protocol message against this room's document.
    /// Returns the action to take (respond to sender, broadcast, or nothing).
    pub fn process_sync_message(&self, sync_payload: &[u8]) -> super::sync::SyncAction {
        // We need a Doc to run the sync protocol against.
        // Build a temporary doc from our state, run the protocol, then save back.
        use yrs::{updates::decoder::Decode, Doc, ReadTxn, StateVector, Transact, Update};

        let doc = Doc::new();
        {
            let state = self.state.read();
            if !state.is_empty() {
                if let Ok(update) = Update::decode_v1(&state) {
                    let mut txn = doc.transact_mut();
                    let _ = txn.apply_update(update);
                }
            }
        }

        let action = super::sync::read_sync_message(&doc, sync_payload);

        // If an update was applied, save the new state
        match &action {
            super::sync::SyncAction::BroadcastUpdate(_) => {
                let txn = doc.transact();
                let new_state = txn.encode_state_as_update_v1(&StateVector::default());
                *self.state.write() = new_state;
                self.dirty.store(true, std::sync::atomic::Ordering::Release);
            }
            _ => {}
        }

        action
    }

    /// Get state size in bytes.
    pub fn state_size(&self) -> usize {
        self.state.read().len()
    }

    /// Get all connected client IDs.
    pub fn client_ids(&self) -> Vec<u64> {
        self.clients.iter().map(|e| *e.key()).collect()
    }
}

// ══════════════════════════════════════════════════════════════════════════════
// Room Manager
// ══════════════════════════════════════════════════════════════════════════════

/// Global room manager — manages all active collaboration rooms.
pub struct RoomManager {
    rooms: DashMap<String, Arc<Room>>,
    awareness: AwarenessManager,
    next_client_id: AtomicU64,
}

#[derive(Debug, Serialize)]
pub struct RoomStats {
    pub active_rooms: usize,
    pub total_clients: usize,
    pub total_state_bytes: usize,
    pub awareness_sessions: usize,
    pub awareness_clients: usize,
}

impl RoomManager {
    pub fn new() -> Self {
        Self {
            rooms: DashMap::new(),
            awareness: AwarenessManager::new(),
            next_client_id: AtomicU64::new(1),
        }
    }

    /// Generate a unique client ID.
    pub fn next_client_id(&self) -> u64 {
        self.next_client_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Get or create a room for a session.
    pub fn get_or_create_room(
        &self,
        session_id: &str,
        document_id: Option<String>,
        initial_state: Vec<u8>,
    ) -> Arc<Room> {
        self.rooms
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(Room::new(session_id.to_string(), document_id, initial_state)))
            .clone()
    }

    /// Get an existing room (returns None if not found).
    pub fn get_room(&self, session_id: &str) -> Option<Arc<Room>> {
        self.rooms.get(session_id).map(|r| r.clone())
    }

    /// Remove a room (when last client leaves and state is flushed).
    pub fn remove_room(&self, session_id: &str) {
        self.rooms.remove(session_id);
        self.awareness.remove_session(session_id);
    }

    /// Get awareness for a session.
    pub fn get_awareness(&self, session_id: &str) -> Arc<SessionAwareness> {
        self.awareness.get_or_create(session_id)
    }

    /// Clean stale awareness across all sessions.
    pub fn clean_stale_awareness(&self, threshold: Duration) -> usize {
        self.awareness.clean_all_stale(threshold)
    }

    /// Get all rooms that need flushing (dirty + debounce elapsed).
    pub fn rooms_needing_flush(&self, debounce: Duration) -> Vec<(String, Vec<u8>)> {
        let mut to_flush = Vec::new();
        for entry in self.rooms.iter() {
            let room = entry.value();
            if room.take_dirty() && room.time_since_flush() >= debounce {
                to_flush.push((entry.key().clone(), room.get_state()));
                room.mark_flushed();
            }
        }
        to_flush
    }

    /// Get all room states for graceful shutdown flush.
    pub fn all_dirty_states(&self) -> Vec<(String, Vec<u8>)> {
        let mut states = Vec::new();
        for entry in self.rooms.iter() {
            if entry.value().take_dirty() {
                states.push((entry.key().clone(), entry.value().get_state()));
            }
        }
        states
    }

    /// Compact all rooms. Returns total bytes saved.
    pub fn compact_all(&self) -> usize {
        let mut saved = 0;
        for entry in self.rooms.iter() {
            if let Ok(s) = entry.value().compact() {
                saved += s;
            }
        }
        saved
    }

    /// Get statistics.
    pub fn stats(&self) -> RoomStats {
        let active_rooms = self.rooms.len();
        let total_clients: usize = self.rooms.iter().map(|e| e.value().client_count()).sum();
        let total_state_bytes: usize = self.rooms.iter().map(|e| e.value().state_size()).sum();
        let (awareness_sessions, awareness_clients) = self.awareness.stats();

        RoomStats {
            active_rooms,
            total_clients,
            total_state_bytes,
            awareness_sessions,
            awareness_clients,
        }
    }
}
