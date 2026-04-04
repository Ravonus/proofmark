//! Yjs sync protocol implementation — mirrors y-protocols/sync.
//!
//! The sync protocol has 3 message types:
//!   Step 1 (type 0): Client sends its state vector → server responds with missing updates
//!   Step 2 (type 1): Server sends missing updates (or client responds to step 1)
//!   Update  (type 2): Incremental update broadcast
//!
//! Wire format within a MSG_SYNC envelope:
//!   [sync_type: VarUint][payload: VarUint8Array]

use yrs::{
    updates::decoder::Decode, updates::encoder::Encode, Doc, ReadTxn, StateVector, Transact,
    Update,
};

pub const SYNC_STEP1: u64 = 0;
pub const SYNC_STEP2: u64 = 1;
pub const SYNC_UPDATE: u64 = 2;

/// Read a VarUint from a buffer at position.
fn read_var_uint(buf: &[u8], pos: &mut usize) -> Option<u64> {
    let mut result: u64 = 0;
    let mut shift = 0u32;
    loop {
        if *pos >= buf.len() {
            return None;
        }
        let byte = buf[*pos];
        *pos += 1;
        result |= ((byte & 0x7F) as u64) << shift;
        if byte & 0x80 == 0 {
            return Some(result);
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
}

/// Write a VarUint to a buffer.
fn write_var_uint(buf: &mut Vec<u8>, mut value: u64) {
    loop {
        let mut byte = (value & 0x7F) as u8;
        value >>= 7;
        if value > 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if value == 0 {
            break;
        }
    }
}

/// Read a VarUint8Array (length-prefixed bytes).
fn read_var_bytes(buf: &[u8], pos: &mut usize) -> Option<Vec<u8>> {
    let len = read_var_uint(buf, pos)? as usize;
    if *pos + len > buf.len() {
        return None;
    }
    let data = buf[*pos..*pos + len].to_vec();
    *pos += len;
    Some(data)
}

/// Write a VarUint8Array (length-prefixed bytes).
fn write_var_bytes(buf: &mut Vec<u8>, data: &[u8]) {
    write_var_uint(buf, data.len() as u64);
    buf.extend_from_slice(data);
}

/// Encode a sync step 1 message (send our state vector so peer knows what to send us).
pub fn encode_sync_step1(doc: &Doc) -> Vec<u8> {
    let txn = doc.transact();
    let sv = txn.state_vector().encode_v1();
    let mut buf = Vec::new();
    write_var_uint(&mut buf, SYNC_STEP1);
    write_var_bytes(&mut buf, &sv);
    buf
}

/// Encode a sync step 2 message (send updates the peer is missing, based on their state vector).
pub fn encode_sync_step2(doc: &Doc, remote_sv: &[u8]) -> Option<Vec<u8>> {
    let sv = StateVector::decode_v1(remote_sv).ok()?;
    let txn = doc.transact();
    let update = txn.encode_state_as_update_v1(&sv);
    let mut buf = Vec::new();
    write_var_uint(&mut buf, SYNC_STEP2);
    write_var_bytes(&mut buf, &update);
    Some(buf)
}

/// Encode a sync update message (incremental update).
pub fn encode_sync_update(update: &[u8]) -> Vec<u8> {
    let mut buf = Vec::new();
    write_var_uint(&mut buf, SYNC_UPDATE);
    write_var_bytes(&mut buf, update);
    buf
}

/// Result of reading a sync message — tells the caller what happened and what to respond with.
pub enum SyncAction {
    /// Peer sent step 1 (their state vector). We should respond with step 2.
    RespondWithStep2(Vec<u8>), // the encoded step 2 response
    /// Peer sent step 2 or an update. We applied it. Broadcast the update to others.
    BroadcastUpdate(Vec<u8>), // the raw update bytes to broadcast
    /// Nothing to do (e.g., empty update).
    None,
}

/// Read and process a sync message from a peer. Returns the action to take.
///
/// This mirrors `syncProtocol.readSyncMessage()` from y-protocols.
pub fn read_sync_message(doc: &Doc, sync_payload: &[u8]) -> SyncAction {
    let mut pos = 0;
    let sync_type = match read_var_uint(sync_payload, &mut pos) {
        Some(t) => t,
        None => return SyncAction::None,
    };

    match sync_type {
        SYNC_STEP1 => {
            // Peer sent their state vector — respond with our missing updates
            let remote_sv = match read_var_bytes(sync_payload, &mut pos) {
                Some(sv) => sv,
                None => return SyncAction::None,
            };
            match encode_sync_step2(doc, &remote_sv) {
                Some(response) => SyncAction::RespondWithStep2(response),
                None => SyncAction::None,
            }
        }
        SYNC_STEP2 | SYNC_UPDATE => {
            // Peer sent updates — apply them to our doc
            let update_bytes = match read_var_bytes(sync_payload, &mut pos) {
                Some(u) => u,
                None => return SyncAction::None,
            };
            if update_bytes.is_empty() {
                return SyncAction::None;
            }
            match Update::decode_v1(&update_bytes) {
                Ok(update) => {
                    let mut txn = doc.transact_mut();
                    if txn.apply_update(update).is_ok() {
                        SyncAction::BroadcastUpdate(update_bytes)
                    } else {
                        SyncAction::None
                    }
                }
                Err(_) => SyncAction::None,
            }
        }
        _ => SyncAction::None,
    }
}

/// Encode a sync step 1 from an already-encoded state vector (convenience for room).
pub fn encode_sync_step1_from_sv(sv: &[u8]) -> Vec<u8> {
    let mut buf = Vec::new();
    write_var_uint(&mut buf, SYNC_STEP1);
    write_var_bytes(&mut buf, sv);
    buf
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::Text;

    #[test]
    fn test_sync_step1_step2_roundtrip() {
        // Doc A has some content
        let doc_a = Doc::new();
        {
            let text = doc_a.get_or_insert_text("content");
            let mut txn = doc_a.transact_mut();
            text.insert(&mut txn, 0, "hello world");
        }

        // Doc B is empty
        let doc_b = Doc::new();

        // B sends step 1 (its state vector)
        let step1 = encode_sync_step1(&doc_b);

        // A processes step 1, gets step 2 response
        let action = read_sync_message(&doc_a, &step1);
        let step2 = match action {
            SyncAction::RespondWithStep2(data) => data,
            _ => panic!("Expected RespondWithStep2"),
        };

        // B processes step 2 (applies updates from A)
        let action = read_sync_message(&doc_b, &step2);
        match action {
            SyncAction::BroadcastUpdate(_) => {} // B got the update
            SyncAction::None => {} // Empty is ok too
            _ => panic!("Expected BroadcastUpdate or None"),
        }
    }
}
