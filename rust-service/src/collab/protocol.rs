//! Binary wire protocol — matches the existing Node.js collaboration protocol.
//!
//! Wire format: [MessageType: VarUint][Payload: variable]
//!   MSG_SYNC      (0) → Yjs sync update (raw bytes)
//!   MSG_AWARENESS (1) → Awareness update (raw bytes)
//!   MSG_CUSTOM    (2) → JSON string (length-prefixed)


use crate::util::varint::{read_var_uint, write_var_uint, read_var_string};

pub const MSG_SYNC: u8 = 0;
pub const MSG_AWARENESS: u8 = 1;
pub const MSG_CUSTOM: u8 = 2;

/// Decoded message from the wire.
#[derive(Debug, Clone)]
pub enum CollabMessage {
    /// Yjs document sync update (binary).
    Sync(Vec<u8>),
    /// Awareness/presence update (binary).
    Awareness(Vec<u8>),
    /// Custom JSON message (annotations, AI, events).
    Custom(String),
}




/// Encode a CollabMessage to wire format.
pub fn encode_message(msg: &CollabMessage) -> Vec<u8> {
    let mut buf = Vec::new();
    match msg {
        CollabMessage::Sync(data) => {
            write_var_uint(&mut buf, MSG_SYNC as u64);
            buf.extend_from_slice(data);
        }
        CollabMessage::Awareness(data) => {
            write_var_uint(&mut buf, MSG_AWARENESS as u64);
            buf.extend_from_slice(data);
        }
        CollabMessage::Custom(json) => {
            write_var_uint(&mut buf, MSG_CUSTOM as u64);
            let bytes = json.as_bytes();
            write_var_uint(&mut buf, bytes.len() as u64);
            buf.extend_from_slice(bytes);
        }
    }
    buf
}

/// Decode a wire message into a CollabMessage.
pub fn decode_message(buf: &[u8]) -> Option<CollabMessage> {
    let mut pos = 0;
    let msg_type = read_var_uint(buf, &mut pos)? as u8;

    match msg_type {
        MSG_SYNC => {
            // Rest of buffer is the Yjs sync payload
            let data = buf[pos..].to_vec();
            Some(CollabMessage::Sync(data))
        }
        MSG_AWARENESS => {
            let data = buf[pos..].to_vec();
            Some(CollabMessage::Awareness(data))
        }
        MSG_CUSTOM => {
            let json = read_var_string(buf, &mut pos)?;
            Some(CollabMessage::Custom(json))
        }
        _ => None,
    }
}

/// Encode a sync update message (convenience).
pub fn encode_sync_update(update: &[u8]) -> Vec<u8> {
    encode_message(&CollabMessage::Sync(update.to_vec()))
}

/// Encode a sync protocol message (step1/step2/update wrapped in MSG_SYNC).
pub fn encode_sync_message(sync_payload: &[u8]) -> Vec<u8> {
    encode_message(&CollabMessage::Sync(sync_payload.to_vec()))
}

/// Encode an awareness update message (convenience).
pub fn encode_awareness_update(data: &[u8]) -> Vec<u8> {
    encode_message(&CollabMessage::Awareness(data.to_vec()))
}

/// Encode a custom JSON message (convenience).
pub fn encode_custom_message(json: &str) -> Vec<u8> {
    encode_message(&CollabMessage::Custom(json.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_varuint_roundtrip() {
        for val in [0, 1, 127, 128, 255, 256, 16383, 16384, u64::MAX >> 1] {
            let mut buf = Vec::new();
            write_var_uint(&mut buf, val);
            let mut pos = 0;
            let decoded = read_var_uint(&buf, &mut pos).unwrap();
            assert_eq!(val, decoded, "failed for {val}");
        }
    }

    #[test]
    fn test_sync_message_roundtrip() {
        let original = CollabMessage::Sync(vec![1, 2, 3, 4, 5]);
        let encoded = encode_message(&original);
        let decoded = decode_message(&encoded).unwrap();
        match decoded {
            CollabMessage::Sync(data) => assert_eq!(data, vec![1, 2, 3, 4, 5]),
            _ => panic!("wrong message type"),
        }
    }

    #[test]
    fn test_custom_message_roundtrip() {
        let json = r#"{"type":"annotation","id":"123"}"#;
        let original = CollabMessage::Custom(json.to_string());
        let encoded = encode_message(&original);
        let decoded = decode_message(&encoded).unwrap();
        match decoded {
            CollabMessage::Custom(s) => assert_eq!(s, json),
            _ => panic!("wrong message type"),
        }
    }
}
