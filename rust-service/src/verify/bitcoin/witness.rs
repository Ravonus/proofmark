use super::super::varint::btc_read_varint;

pub fn parse_witness_stack(buf: &[u8], debug: &mut Vec<String>) -> Option<Vec<Vec<u8>>> {
    let mut offset = 0;
    let (num_items, bytes_read) = btc_read_varint(buf, offset)?;
    offset += bytes_read;

    let mut items = Vec::with_capacity(num_items);
    for i in 0..num_items {
        let (len, len_bytes) = btc_read_varint(buf, offset)?;
        offset += len_bytes;
        if offset + len > buf.len() {
            debug.push(format!(
                "witness: item {i} overflow (need {len} at offset {offset}, have {})",
                buf.len()
            ));
            return None;
        }
        items.push(buf[offset..offset + len].to_vec());
        offset += len;
    }

    debug.push(format!(
        "witness: parsed {} items, sizes=[{}], consumed={}/{}",
        items.len(),
        items.iter().map(|i| i.len().to_string()).collect::<Vec<_>>().join(","),
        offset,
        buf.len()
    ));

    Some(items)
}

pub fn decode_bech32m_witness(address: &str) -> Option<Vec<u8>> {
    let pos = address.rfind('1')?;
    let data_part = &address[pos + 1..];
    let charset = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";

    let mut values = Vec::new();
    for ch in data_part.chars() {
        let idx = charset.iter().position(|&c| c as char == ch)?;
        values.push(idx as u8);
    }

    if values.len() < 7 {
        return None;
    }

    let data_5bit = &values[1..values.len() - 6];

    let mut acc = 0u32;
    let mut acc_bits = 0u32;
    let mut result = Vec::new();
    for &val in data_5bit {
        acc = (acc << 5) | val as u32;
        acc_bits += 5;
        if acc_bits >= 8 {
            acc_bits -= 8;
            result.push((acc >> acc_bits) as u8);
        }
    }

    Some(result)
}
