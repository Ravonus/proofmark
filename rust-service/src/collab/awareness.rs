//! Presence/awareness tracking — manages cursor positions, selections,
//! activity states, and stale cleanup for all connected users.

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Awareness state for a single user in a session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwarenessState {
    pub user_id: String,
    pub display_name: String,
    pub color: String,
    pub role: String,
    pub cursor: Option<CursorPosition>,
    pub selection: Option<SelectionRange>,
    pub activity: Activity,
    pub last_active_at: u64, // unix millis
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorPosition {
    pub token_index: usize,
    pub char_offset: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionRange {
    pub anchor: CursorPosition,
    pub head: CursorPosition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Activity {
    Idle,
    Typing,
    Selecting,
    Highlighting,
    AiChatting,
}

/// Per-session awareness tracker.
pub struct SessionAwareness {
    /// client_id → awareness state
    states: DashMap<u64, AwarenessState>,
    /// client_id → last seen instant (for stale detection)
    last_seen: DashMap<u64, Instant>,
}

impl SessionAwareness {
    pub fn new() -> Self {
        Self {
            states: DashMap::new(),
            last_seen: DashMap::new(),
        }
    }

    /// Update a client's awareness state.
    pub fn update(&self, client_id: u64, state: AwarenessState) {
        self.states.insert(client_id, state);
        self.last_seen.insert(client_id, Instant::now());
    }

    /// Remove a client from awareness.
    pub fn remove(&self, client_id: u64) {
        self.states.remove(&client_id);
        self.last_seen.remove(&client_id);
    }

    /// Get all current awareness states (excluding a specific client).
    pub fn get_remote_states(&self, exclude_client: u64) -> Vec<(u64, AwarenessState)> {
        self.states
            .iter()
            .filter(|entry| *entry.key() != exclude_client)
            .map(|entry| (*entry.key(), entry.value().clone()))
            .collect()
    }

    /// Get all states as a serializable JSON blob (for initial sync).
    pub fn get_all_states(&self) -> Vec<(u64, AwarenessState)> {
        self.states
            .iter()
            .map(|entry| (*entry.key(), entry.value().clone()))
            .collect()
    }

    /// Get the current state for a specific client.
    pub fn get_state(&self, client_id: u64) -> Option<AwarenessState> {
        self.states.get(&client_id).map(|v| v.clone())
    }

    /// Clean up stale clients that haven't sent updates within the threshold.
    /// Returns the client IDs that were removed.
    pub fn clean_stale(&self, threshold: Duration) -> Vec<u64> {
        let now = Instant::now();
        let stale: Vec<u64> = self
            .last_seen
            .iter()
            .filter(|entry| now.duration_since(*entry.value()) > threshold)
            .map(|entry| *entry.key())
            .collect();

        for client_id in &stale {
            self.states.remove(client_id);
            self.last_seen.remove(client_id);
        }

        stale
    }

    /// Number of active clients.
    pub fn client_count(&self) -> usize {
        self.states.len()
    }
}

/// Global awareness manager across all sessions.
pub struct AwarenessManager {
    /// session_id → per-session awareness
    sessions: DashMap<String, Arc<SessionAwareness>>,
}

impl AwarenessManager {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }

    /// Get or create awareness for a session.
    pub fn get_or_create(&self, session_id: &str) -> Arc<SessionAwareness> {
        self.sessions
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(SessionAwareness::new()))
            .clone()
    }

    /// Remove a session's awareness (when last client leaves).
    pub fn remove_session(&self, session_id: &str) {
        self.sessions.remove(session_id);
    }

    /// Clean stale clients across all sessions. Returns total removed.
    pub fn clean_all_stale(&self, threshold: Duration) -> usize {
        let mut total = 0;
        let mut empty_sessions = Vec::new();

        for entry in self.sessions.iter() {
            let removed = entry.value().clean_stale(threshold);
            total += removed.len();
            if entry.value().client_count() == 0 {
                empty_sessions.push(entry.key().clone());
            }
        }

        // Remove empty sessions
        for session_id in empty_sessions {
            self.sessions.remove(&session_id);
        }

        total
    }

    /// Get stats.
    pub fn stats(&self) -> (usize, usize) {
        let sessions = self.sessions.len();
        let clients: usize = self.sessions.iter().map(|e| e.value().client_count()).sum();
        (sessions, clients)
    }
}
