/// Encode a length as a Bitcoin-style VarInt.
/// Prefix byte determines width: < 0xFD = 1 byte, 0xFD = 3, 0xFE = 5.
pub fn btc_encode_varint(length: usize) -> Vec<u8> {
    if length < 0xfd {
        vec![length as u8]
    } else if length <= 0xffff {
        let mut buf = vec![0xfd];
        buf.extend_from_slice(&(length as u16).to_le_bytes());
        buf
    } else {
        let mut buf = vec![0xfe];
        buf.extend_from_slice(&(length as u32).to_le_bytes());
        buf
    }
}

/// Read a Bitcoin-style VarInt from `buf` at `offset`.
/// Returns `(value, bytes_consumed)`.
pub fn btc_read_varint(buf: &[u8], offset: usize) -> Option<(usize, usize)> {
    let first = *buf.get(offset)?;
    if first < 0xfd {
        Some((first as usize, 1))
    } else if first == 0xfd {
        if offset + 3 > buf.len() {
            return None;
        }
        let val = u16::from_le_bytes([buf[offset + 1], buf[offset + 2]]) as usize;
        Some((val, 3))
    } else if first == 0xfe {
        if offset + 5 > buf.len() {
            return None;
        }
        let val = u32::from_le_bytes([
            buf[offset + 1],
            buf[offset + 2],
            buf[offset + 3],
            buf[offset + 4],
        ]) as usize;
        Some((val, 5))
    } else {
        None // 64-bit varint not supported
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn btc_varint_roundtrip() {
        for &val in &[0usize, 1, 0xfc, 0xfd, 0xffff, 0x10000] {
            let encoded = btc_encode_varint(val);
            let (decoded, _) = btc_read_varint(&encoded, 0).unwrap();
            assert_eq!(val, decoded);
        }
    }
}
