//! WebSocket handler — multi-threaded connection handling with actix-ws.
//!
//! Implements the full y-protocols sync protocol:
//!   1. On connect: send sync step 1 (our state vector)
//!   2. Client responds with step 2 (missing updates)
//!   3. Incremental updates broadcast via sync update messages
//!
//! Each connection gets its own async task on the actix-web thread pool.

use std::sync::Arc;
use std::time::{Duration, Instant};

use actix_web::{web, HttpRequest, HttpResponse};
use actix_ws::Message;
use futures_util::StreamExt;

use super::awareness::AwarenessState;
use super::protocol;
use super::room::{ClientInfo, RoomManager};
use super::sync;
use crate::util::b64;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
const CLIENT_TIMEOUT: Duration = Duration::from_secs(30);

/// HTTP upgrade handler — upgrades to WebSocket and spawns the client task.
pub async fn collab_ws_handler(
    req: HttpRequest,
    body: web::Payload,
    room_mgr: web::Data<RoomManager>,
    path: web::Path<String>,
) -> actix_web::Result<HttpResponse> {
    let session_id = path.into_inner();

    // Extract auth from query params (Node bridge or direct client passes these)
    let query_string = req.query_string();
    let get_param = |key: &str| -> Option<String> {
        for pair in query_string.split('&') {
            let mut parts = pair.splitn(2, '=');
            if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
                if k == key {
                    return Some(v.to_string());
                }
            }
        }
        None
    };

    let user_id = get_param("userId").unwrap_or_else(|| "anonymous".into());
    let display_name = get_param("displayName").unwrap_or_else(|| "Anonymous".into());
    let color = get_param("color").unwrap_or_else(|| "#3B82F6".into());
    let role = get_param("role").unwrap_or_else(|| "editor".into());

    // Optional: validate auth token against Node API
    if let Some(token) = get_param("token") {
        let auth_url = std::env::var("AUTH_CALLBACK_URL").ok();
        if let Some(url) = auth_url {
            let valid = validate_token(&url, &token, &session_id).await;
            if !valid {
                return Ok(HttpResponse::Unauthorized().body("Invalid token"));
            }
        }
    }

    // Upgrade to WebSocket
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, body)?;

    let client_id = room_mgr.next_client_id();
    let room = room_mgr.get_or_create_room(&session_id, None, Vec::new());
    let awareness = room_mgr.get_awareness(&session_id);

    // Register client
    room.add_client(ClientInfo {
        client_id,
        user_id: user_id.clone(),
        session_id: session_id.clone(),
    });

    // Set initial awareness
    awareness.update(
        client_id,
        AwarenessState {
            user_id: user_id.clone(),
            display_name: display_name.clone(),
            color: color.clone(),
            role: role.clone(),
            cursor: None,
            selection: None,
            activity: super::awareness::Activity::Idle,
            last_active_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        },
    );

    // ── SYNC STEP 1: Send our state vector so client knows what to send us ──
    {
        let sv = room.get_state_vector().unwrap_or_default();
        let step1_payload = sync::encode_sync_step1_from_sv(&sv);
        let msg = protocol::encode_sync_message(&step1_payload);
        let _ = session.binary(msg).await;
    }

    // ── Also send our full state as step 2 so client gets current doc immediately ──
    {
        let state = room.get_state();
        if !state.is_empty() {
            let step2_payload = sync::encode_sync_update(&state);
            let msg = protocol::encode_sync_message(&step2_payload);
            let _ = session.binary(msg).await;
        }
    }

    // ── Broadcast join event ──
    {
        let join_msg = serde_json::json!({
            "type": "participant-joined",
            "sessionId": session_id,
            "payload": {
                "userId": user_id,
                "displayName": display_name,
                "color": color,
                "role": role,
            }
        });
        let encoded = protocol::encode_custom_message(&join_msg.to_string());
        room.broadcast(client_id, encoded);
    }

    tracing::info!(
        session_id = %session_id,
        client_id = client_id,
        user_id = %user_id,
        clients = room.client_count(),
        "Client connected"
    );

    // Subscribe to broadcast channel
    let mut rx = room.tx.subscribe();

    // Spawn the client handler task
    let room_clone = room.clone();
    let awareness_clone = awareness.clone();
    let room_mgr_clone = room_mgr.clone();
    let session_id_clone = session_id.clone();
    let user_id_clone = user_id.clone();
    let display_name_clone = display_name.clone();

    actix_rt::spawn(async move {
        let mut last_heartbeat = Instant::now();
        let mut heartbeat_interval = tokio::time::interval(HEARTBEAT_INTERVAL);

        loop {
            tokio::select! {
                // Incoming message from this client
                Some(msg) = msg_stream.next() => {
                    match msg {
                        Ok(Message::Binary(data)) => {
                            last_heartbeat = Instant::now();
                            handle_client_message(
                                client_id,
                                &data,
                                &room_clone,
                                &awareness_clone,
                                &mut session,
                            ).await;
                        }
                        Ok(Message::Ping(data)) => {
                            last_heartbeat = Instant::now();
                            let _ = session.pong(&data).await;
                        }
                        Ok(Message::Pong(_)) => {
                            last_heartbeat = Instant::now();
                        }
                        Ok(Message::Close(_)) | Err(_) => break,
                        _ => {}
                    }
                }

                // Broadcast message from another client in the room
                Ok((sender_id, data)) = rx.recv() => {
                    if sender_id != client_id {
                        if session.binary(data).await.is_err() {
                            break;
                        }
                    }
                }

                // Heartbeat check
                _ = heartbeat_interval.tick() => {
                    if Instant::now().duration_since(last_heartbeat) > CLIENT_TIMEOUT {
                        tracing::debug!(client_id, "Client timed out");
                        break;
                    }
                    if session.ping(b"").await.is_err() {
                        break;
                    }
                }
            }
        }

        // ── Cleanup on disconnect ──
        room_clone.remove_client(client_id);
        awareness_clone.remove(client_id);

        // Broadcast leave event
        let leave_msg = serde_json::json!({
            "type": "participant-left",
            "sessionId": session_id_clone,
            "payload": {
                "userId": user_id_clone,
                "displayName": display_name_clone,
            }
        });
        let encoded = protocol::encode_custom_message(&leave_msg.to_string());
        room_clone.broadcast(client_id, encoded);

        tracing::info!(
            session_id = %session_id_clone,
            client_id = client_id,
            remaining = room_clone.client_count(),
            "Client disconnected"
        );

        // If room is empty, schedule cleanup after grace period
        if room_clone.is_empty() {
            let mgr = room_mgr_clone;
            let sid = session_id_clone;
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_secs(60)).await;
                if let Some(room) = mgr.get_room(&sid) {
                    if room.is_empty() {
                        // Flush state to persistence callback before removing
                        let state = room.get_state();
                        if !state.is_empty() {
                            flush_room_state(&sid, &state).await;
                        }
                        tracing::info!(session_id = %sid, "Removing empty room");
                        mgr.remove_room(&sid);
                    }
                }
            });
        }

        let _ = session.close(None).await;
    });

    Ok(response)
}

/// Handle an incoming binary message from a client.
async fn handle_client_message(
    client_id: u64,
    data: &[u8],
    room: &Arc<super::room::Room>,
    awareness: &Arc<super::awareness::SessionAwareness>,
    session: &mut actix_ws::Session,
) {
    let msg = match protocol::decode_message(data) {
        Some(m) => m,
        None => {
            tracing::warn!(client_id, "Failed to decode message");
            return;
        }
    };

    match msg {
        protocol::CollabMessage::Sync(sync_payload) => {
            // Process through the full sync protocol
            let action = room.process_sync_message(&sync_payload);

            match action {
                sync::SyncAction::RespondWithStep2(step2_data) => {
                    // Send step 2 back to this client only
                    let encoded = protocol::encode_sync_message(&step2_data);
                    let _ = session.binary(encoded).await;
                }
                sync::SyncAction::BroadcastUpdate(update_bytes) => {
                    // Broadcast the update to all other clients
                    let update_msg = sync::encode_sync_update(&update_bytes);
                    let encoded = protocol::encode_sync_message(&update_msg);
                    room.broadcast(client_id, encoded);
                }
                sync::SyncAction::None => {}
            }
        }
        protocol::CollabMessage::Awareness(awareness_data) => {
            // Parse and update awareness state if possible
            if let Ok(state) = serde_json::from_slice::<AwarenessState>(&awareness_data) {
                awareness.update(client_id, state);
            }
            // Always broadcast raw awareness to other clients
            room.broadcast(client_id, data.to_vec());
        }
        protocol::CollabMessage::Custom(_json) => {
            // Custom messages (annotations, AI, events) — broadcast as-is
            room.broadcast(client_id, data.to_vec());
        }
    }
}

/// Validate an auth token by calling back to the Node.js API.
async fn validate_token(auth_url: &str, token: &str, session_id: &str) -> bool {
    match reqwest::Client::new()
        .post(auth_url)
        .json(&serde_json::json!({
            "token": token,
            "sessionId": session_id,
        }))
        .timeout(Duration::from_secs(3))
        .send()
        .await
    {
        Ok(res) => res.status().is_success(),
        Err(_) => false,
    }
}

/// Flush room state to persistence (calls back to Node.js API).
async fn flush_room_state(session_id: &str, state: &[u8]) {
    let flush_url = std::env::var("FLUSH_CALLBACK_URL").ok();
    if let Some(url) = flush_url {
        let encoded = b64::encode(state);
        let _ = reqwest::Client::new()
            .post(&url)
            .json(&serde_json::json!({
                "sessionId": session_id,
                "yjsState": encoded,
            }))
            .timeout(Duration::from_secs(5))
            .send()
            .await;
    }
}
