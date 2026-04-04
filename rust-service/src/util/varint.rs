//! Variable-length integer encoding — two standard formats.
//!
//! **Bitcoin VarInt**: prefix byte determines width (< 0xFD = 1 byte, 0xFD = 3, 0xFE = 5).
//! Used for Bitcoin message hashing and witness stack parsing.
//!
//! **LEB128 VarUint** (lib0 compatible): MSB continuation bit, 7 data bits per byte.
//! Used by Yjs sync protocol, collab wire format, and forensic replay tapes.

// ── Bitcoin VarInt ──────────────────────────────────────────────────────────────

/// Encode a length as a Bitcoin-style VarInt.
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

// ── LEB128 VarUint (lib0 / Yjs compatible) ─────────────────────────────────────

/// Read a variable-length unsigned integer (LEB128 / lib0 format).
pub fn read_var_uint(buf: &[u8], pos: &mut usize) -> Option<u64> {
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

/// Write a variable-length unsigned integer (LEB128 / lib0 format).
pub fn write_var_uint(buf: &mut Vec<u8>, mut value: u64) {
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

/// Read a VarUint8Array (length-prefixed bytes, lib0 format).
pub fn read_var_bytes(buf: &[u8], pos: &mut usize) -> Option<Vec<u8>> {
    let len = read_var_uint(buf, pos)? as usize;
    if *pos + len > buf.len() {
        return None;
    }
    let data = buf[*pos..*pos + len].to_vec();
    *pos += len;
    Some(data)
}

/// Write a VarUint8Array (length-prefixed bytes, lib0 format).
pub fn write_var_bytes(buf: &mut Vec<u8>, data: &[u8]) {
    write_var_uint(buf, data.len() as u64);
    buf.extend_from_slice(data);
}

/// Read a variable-length UTF-8 string (lib0 format: varuint length + bytes).
pub fn read_var_string(buf: &[u8], pos: &mut usize) -> Option<String> {
    let bytes = read_var_bytes(buf, pos)?;
    String::from_utf8(bytes).ok()
}

// ── Zigzag-encoded signed VarInt (forensic replay tapes) ────────────────────────

/// Read a zigzag-encoded signed integer (used by forensic replay tapes).
pub fn read_var_int_zigzag(buf: &[u8], pos: &mut usize) -> Option<i32> {
    let zigzag = read_var_uint(buf, pos)? as u32;
    if zigzag & 1 == 1 {
        Some(-(((zigzag + 1) >> 1) as i32))
    } else {
        Some((zigzag >> 1) as i32)
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

    #[test]
    fn leb128_varuint_roundtrip() {
        for &val in &[0u64, 1, 127, 128, 255, 16384, u64::MAX >> 1] {
            let mut buf = Vec::new();
            write_var_uint(&mut buf, val);
            let mut pos = 0;
            let decoded = read_var_uint(&buf, &mut pos).unwrap();
            assert_eq!(val, decoded);
            assert_eq!(pos, buf.len());
        }
    }

    #[test]
    fn var_bytes_roundtrip() {
        let data = b"hello world";
        let mut buf = Vec::new();
        write_var_bytes(&mut buf, data);
        let mut pos = 0;
        let decoded = read_var_bytes(&buf, &mut pos).unwrap();
        assert_eq!(data.as_slice(), decoded.as_slice());
    }

    #[test]
    fn zigzag_decode() {
        // zigzag: 0→0, 1→-1, 2→1, 3→-2, 4→2
        let cases: &[(u64, i32)] = &[(0, 0), (1, -1), (2, 1), (3, -2), (4, 2)];
        for &(encoded_val, expected) in cases {
            let mut buf = Vec::new();
            write_var_uint(&mut buf, encoded_val);
            let mut pos = 0;
            let decoded = read_var_int_zigzag(&buf, &mut pos).unwrap();
            assert_eq!(expected, decoded);
        }
    }
}
