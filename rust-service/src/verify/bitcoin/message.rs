use crate::crypto::double_sha256;
use super::super::varint::btc_encode_varint;

const BITCOIN_MESSAGE_MAGIC: &str = "Bitcoin Signed Message:\n";

pub fn bitcoin_message_hash(message: &str) -> [u8; 32] {
    let prefix = BITCOIN_MESSAGE_MAGIC.as_bytes();
    let body = message.as_bytes();

    let mut data = Vec::new();
    data.extend_from_slice(&btc_encode_varint(prefix.len()));
    data.extend_from_slice(prefix);
    data.extend_from_slice(&btc_encode_varint(body.len()));
    data.extend_from_slice(body);

    double_sha256(&data)
}
