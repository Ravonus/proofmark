//! Tape decoding helpers for reading varint-encoded fields.

use crate::util::varint;

pub(crate) fn read_varuint(bytes: &[u8], offset: &mut usize) -> u32 {
    varint::read_var_uint(bytes, offset).unwrap_or(0) as u32
}

pub(crate) fn read_varint(bytes: &[u8], offset: &mut usize) -> i32 {
    varint::read_var_int_zigzag(bytes, offset).unwrap_or(0)
}

/// Skip N varuint fields in the tape
pub(crate) fn skip_varuints(bytes: &[u8], offset: &mut usize, count: usize) {
    for _ in 0..count {
        read_varuint(bytes, offset);
    }
}

/// Skip N raw bytes
pub(crate) fn skip_bytes(offset: &mut usize, count: usize) {
    *offset += count;
}
