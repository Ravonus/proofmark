//! Variable-length integer encoding — LEB128 (lib0 / Yjs compatible).
//!
//! MSB continuation bit, 7 data bits per byte. Used by Yjs sync protocol,
//! collab wire format, and forensic replay tapes.

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
        // zigzag: 0->0, 1->-1, 2->1, 3->-2, 4->2
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
