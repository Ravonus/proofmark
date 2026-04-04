use flate2::write::{DeflateDecoder, DeflateEncoder};
use flate2::Compression;
use std::io::Write;

use crate::codec::{ReplayEncodedEvent, ReplayEncodedPayload};
use crate::format::{
    ReplayChunkKind, CHUNK_HASH_EVERY, CONTAINER_FLAG_DEFLATE, REPLAY_CONTAINER_MAGIC,
    REPLAY_CONTAINER_VERSION, REPLAY_TIME_QUANTUM_MS,
};
use crate::scene::{
    FieldGeometry, FieldType, PageGeometry, Rect, SceneModel, SignaturePadGeometry, StringEntry,
    TargetEntry, Viewport,
};
use serde::{Deserialize, Serialize};

const CHECKPOINT_INTERVAL_MS: u32 = 5000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionHeader {
    pub version: u8,
    pub time_quantum_ms: u16,
    pub signer_id: String,
    pub session_id: String,
    pub started_at_epoch_ms: u64,
    pub viewport: Viewport,
    pub page_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub event_index: u32,
    pub at_ms: u32,
    pub scroll_y: u32,
    pub page: u32,
    pub byte_offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChunkHash {
    pub chunk_index: u32,
    pub hash: [u8; 32],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IntegrityFooter {
    pub event_count: u32,
    pub total_duration_ms: u32,
    pub tape_byte_length: u32,
    pub container_hash: [u8; 32],
    pub chunk_hashes: Vec<ChunkHash>,
    pub checkpoints: Vec<Checkpoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayContainer {
    pub header: SessionHeader,
    pub scene: SceneModel,
    pub tape: ReplayEncodedPayload,
    pub footer: IntegrityFooter,
}

fn sha256(data: &[u8]) -> [u8; 32] {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    // Lightweight hash for container integrity — not cryptographic.
    // Real deployment should use ring/sha2 crate; this avoids adding deps.
    let mut result = [0u8; 32];
    let mut hasher = DefaultHasher::new();
    data.hash(&mut hasher);
    let h = hasher.finish();
    result[..8].copy_from_slice(&h.to_le_bytes());
    // Second pass with offset to fill more bytes
    let mut hasher2 = DefaultHasher::new();
    h.hash(&mut hasher2);
    data.len().hash(&mut hasher2);
    let h2 = hasher2.finish();
    result[8..16].copy_from_slice(&h2.to_le_bytes());
    let mut hasher3 = DefaultHasher::new();
    h2.hash(&mut hasher3);
    let h3 = hasher3.finish();
    result[16..24].copy_from_slice(&h3.to_le_bytes());
    let mut hasher4 = DefaultHasher::new();
    h3.hash(&mut hasher4);
    let h4 = hasher4.finish();
    result[24..32].copy_from_slice(&h4.to_le_bytes());
    result
}

fn write_u8(buf: &mut Vec<u8>, v: u8) {
    buf.push(v);
}

fn write_u16(buf: &mut Vec<u8>, v: u16) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_u64(buf: &mut Vec<u8>, v: u64) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_f32(buf: &mut Vec<u8>, v: f32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_str(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    write_u16(buf, bytes.len().min(u16::MAX as usize) as u16);
    buf.extend_from_slice(&bytes[..bytes.len().min(u16::MAX as usize)]);
}

fn read_u8(data: &[u8], off: &mut usize) -> Option<u8> {
    if *off >= data.len() { return None; }
    let v = data[*off];
    *off += 1;
    Some(v)
}

fn read_u16(data: &[u8], off: &mut usize) -> Option<u16> {
    if *off + 2 > data.len() { return None; }
    let v = u16::from_le_bytes([data[*off], data[*off + 1]]);
    *off += 2;
    Some(v)
}

fn read_u32(data: &[u8], off: &mut usize) -> Option<u32> {
    if *off + 4 > data.len() { return None; }
    let v = u32::from_le_bytes(data[*off..*off + 4].try_into().ok()?);
    *off += 4;
    Some(v)
}

fn read_u64(data: &[u8], off: &mut usize) -> Option<u64> {
    if *off + 8 > data.len() { return None; }
    let v = u64::from_le_bytes(data[*off..*off + 8].try_into().ok()?);
    *off += 8;
    Some(v)
}

fn read_f32(data: &[u8], off: &mut usize) -> Option<f32> {
    if *off + 4 > data.len() { return None; }
    let v = f32::from_le_bytes(data[*off..*off + 4].try_into().ok()?);
    *off += 4;
    Some(v)
}

fn read_str(data: &[u8], off: &mut usize) -> Option<String> {
    let len = read_u16(data, off)? as usize;
    if *off + len > data.len() { return None; }
    let s = std::str::from_utf8(&data[*off..*off + len]).ok()?.to_string();
    *off += len;
    Some(s)
}

fn encode_chunk(buf: &mut Vec<u8>, kind: ReplayChunkKind, payload: &[u8]) {
    write_u8(buf, kind as u8);
    write_u32(buf, payload.len() as u32);
    buf.extend_from_slice(payload);
}

fn encode_session_header(header: &SessionHeader) -> Vec<u8> {
    let mut buf = Vec::with_capacity(128);
    write_u8(&mut buf, header.version);
    write_u16(&mut buf, header.time_quantum_ms);
    write_str(&mut buf, &header.signer_id);
    write_str(&mut buf, &header.session_id);
    write_u64(&mut buf, header.started_at_epoch_ms);
    write_u32(&mut buf, header.viewport.width);
    write_u32(&mut buf, header.viewport.height);
    write_f32(&mut buf, header.viewport.device_pixel_ratio);
    write_u32(&mut buf, header.viewport.scroll_width);
    write_u32(&mut buf, header.viewport.scroll_height);
    write_u32(&mut buf, header.page_count);
    buf
}

fn decode_session_header(data: &[u8]) -> Option<SessionHeader> {
    let mut off = 0;
    let version = read_u8(data, &mut off)?;
    let time_quantum_ms = read_u16(data, &mut off)?;
    let signer_id = read_str(data, &mut off)?;
    let session_id = read_str(data, &mut off)?;
    let started_at_epoch_ms = read_u64(data, &mut off)?;
    let width = read_u32(data, &mut off)?;
    let height = read_u32(data, &mut off)?;
    let dpr = read_f32(data, &mut off)?;
    let sw = read_u32(data, &mut off)?;
    let sh = read_u32(data, &mut off)?;
    let page_count = read_u32(data, &mut off)?;
    Some(SessionHeader {
        version,
        time_quantum_ms,
        signer_id,
        session_id,
        started_at_epoch_ms,
        viewport: Viewport { width, height, device_pixel_ratio: dpr, scroll_width: sw, scroll_height: sh },
        page_count,
    })
}

fn encode_target_dictionary(scene: &SceneModel) -> Vec<u8> {
    let mut buf = Vec::new();
    // Pages
    write_u32(&mut buf, scene.pages.len() as u32);
    for pg in &scene.pages {
        write_u32(&mut buf, pg.page_index);
        write_f32(&mut buf, pg.width);
        write_f32(&mut buf, pg.height);
        write_f32(&mut buf, pg.offset_y);
    }
    // Fields
    write_u32(&mut buf, scene.fields.len() as u32);
    for f in &scene.fields {
        write_u32(&mut buf, f.target_id);
        write_u32(&mut buf, f.page_index);
        write_f32(&mut buf, f.rect.x);
        write_f32(&mut buf, f.rect.y);
        write_f32(&mut buf, f.rect.w);
        write_f32(&mut buf, f.rect.h);
        write_u8(&mut buf, f.field_type as u8);
    }
    // Signature pads
    write_u32(&mut buf, scene.signature_pads.len() as u32);
    for sp in &scene.signature_pads {
        write_u32(&mut buf, sp.target_id);
        write_u32(&mut buf, sp.page_index);
        write_f32(&mut buf, sp.rect.x);
        write_f32(&mut buf, sp.rect.y);
        write_f32(&mut buf, sp.rect.w);
        write_f32(&mut buf, sp.rect.h);
        write_u32(&mut buf, sp.canvas_width);
        write_u32(&mut buf, sp.canvas_height);
    }
    // Targets
    write_u32(&mut buf, scene.targets.len() as u32);
    for t in &scene.targets {
        write_u32(&mut buf, t.id);
        write_u64(&mut buf, t.hash);
        write_str(&mut buf, &t.descriptor);
    }
    buf
}

fn decode_target_dictionary(data: &[u8]) -> Option<(Vec<PageGeometry>, Vec<FieldGeometry>, Vec<SignaturePadGeometry>, Vec<TargetEntry>)> {
    let mut off = 0;
    // Pages
    let page_count = read_u32(data, &mut off)? as usize;
    let mut pages = Vec::with_capacity(page_count);
    for _ in 0..page_count {
        pages.push(PageGeometry {
            page_index: read_u32(data, &mut off)?,
            width: read_f32(data, &mut off)?,
            height: read_f32(data, &mut off)?,
            offset_y: read_f32(data, &mut off)?,
        });
    }
    // Fields
    let field_count = read_u32(data, &mut off)? as usize;
    let mut fields = Vec::with_capacity(field_count);
    for _ in 0..field_count {
        fields.push(FieldGeometry {
            target_id: read_u32(data, &mut off)?,
            page_index: read_u32(data, &mut off)?,
            rect: Rect {
                x: read_f32(data, &mut off)?,
                y: read_f32(data, &mut off)?,
                w: read_f32(data, &mut off)?,
                h: read_f32(data, &mut off)?,
            },
            field_type: FieldType::from_u8(read_u8(data, &mut off)?),
        });
    }
    // Signature pads
    let sp_count = read_u32(data, &mut off)? as usize;
    let mut signature_pads = Vec::with_capacity(sp_count);
    for _ in 0..sp_count {
        signature_pads.push(SignaturePadGeometry {
            target_id: read_u32(data, &mut off)?,
            page_index: read_u32(data, &mut off)?,
            rect: Rect {
                x: read_f32(data, &mut off)?,
                y: read_f32(data, &mut off)?,
                w: read_f32(data, &mut off)?,
                h: read_f32(data, &mut off)?,
            },
            canvas_width: read_u32(data, &mut off)?,
            canvas_height: read_u32(data, &mut off)?,
        });
    }
    // Targets
    let target_count = read_u32(data, &mut off)? as usize;
    let mut targets = Vec::with_capacity(target_count);
    for _ in 0..target_count {
        targets.push(TargetEntry {
            id: read_u32(data, &mut off)?,
            hash: read_u64(data, &mut off)?,
            descriptor: read_str(data, &mut off)?,
        });
    }
    Some((pages, fields, signature_pads, targets))
}

fn encode_string_dictionary(strings: &[StringEntry]) -> Vec<u8> {
    let mut buf = Vec::new();
    write_u32(&mut buf, strings.len() as u32);
    for s in strings {
        write_u32(&mut buf, s.id);
        write_u8(&mut buf, s.kind);
        write_u64(&mut buf, s.hash);
        write_str(&mut buf, &s.value);
    }
    buf
}

fn decode_string_dictionary(data: &[u8]) -> Option<Vec<StringEntry>> {
    let mut off = 0;
    let count = read_u32(data, &mut off)? as usize;
    let mut strings = Vec::with_capacity(count);
    for _ in 0..count {
        strings.push(StringEntry {
            id: read_u32(data, &mut off)?,
            kind: read_u8(data, &mut off)?,
            hash: read_u64(data, &mut off)?,
            value: read_str(data, &mut off)?,
        });
    }
    Some(strings)
}

fn build_checkpoints(events: &[ReplayEncodedEvent]) -> Vec<Checkpoint> {
    let mut checkpoints = Vec::new();
    let mut at_ms = 0u32;
    let mut scroll_y = 0u32;
    let mut page = 0u32;
    let mut last_checkpoint_ms = 0u32;
    let quantum = REPLAY_TIME_QUANTUM_MS as u32;

    for (i, event) in events.iter().enumerate() {
        let delta = match event {
            ReplayEncodedEvent::Scroll { delta, .. }
            | ReplayEncodedEvent::Click { delta, .. }
            | ReplayEncodedEvent::Key { delta, .. }
            | ReplayEncodedEvent::Focus { delta, .. }
            | ReplayEncodedEvent::Blur { delta, .. }
            | ReplayEncodedEvent::Visibility { delta, .. }
            | ReplayEncodedEvent::Highlight { delta, .. }
            | ReplayEncodedEvent::Navigation { delta, .. }
            | ReplayEncodedEvent::Page { delta, .. }
            | ReplayEncodedEvent::Modal { delta, .. }
            | ReplayEncodedEvent::SignatureStart { delta, .. }
            | ReplayEncodedEvent::SignaturePoint { delta, .. }
            | ReplayEncodedEvent::SignatureEnd { delta, .. }
            | ReplayEncodedEvent::SignatureCommit { delta, .. }
            | ReplayEncodedEvent::SignatureClear { delta, .. }
            | ReplayEncodedEvent::FieldCommit { delta, .. }
            | ReplayEncodedEvent::Clipboard { delta, .. }
            | ReplayEncodedEvent::ContextMenu { delta, .. }
            | ReplayEncodedEvent::MouseMove { delta, .. }
            | ReplayEncodedEvent::HoverDwell { delta, .. }
            | ReplayEncodedEvent::ViewportResize { delta, .. }
            | ReplayEncodedEvent::TouchStart { delta, .. }
            | ReplayEncodedEvent::TouchMove { delta, .. }
            | ReplayEncodedEvent::TouchEnd { delta, .. }
            | ReplayEncodedEvent::FieldCorrection { delta, .. }
            | ReplayEncodedEvent::ScrollMomentum { delta, .. } => *delta,
        };
        at_ms = at_ms.saturating_add(delta.saturating_mul(quantum));

        match event {
            ReplayEncodedEvent::Scroll { scroll_y: sy, .. } => scroll_y = *sy,
            ReplayEncodedEvent::Page { page: pg, .. } => page = *pg,
            _ => {}
        }

        if at_ms >= last_checkpoint_ms + CHECKPOINT_INTERVAL_MS || i == 0 {
            checkpoints.push(Checkpoint {
                event_index: i as u32,
                at_ms,
                scroll_y,
                page,
                byte_offset: 0, // filled later if needed
            });
            last_checkpoint_ms = at_ms;
        }
    }

    checkpoints
}

fn encode_integrity_footer(footer: &IntegrityFooter) -> Vec<u8> {
    let mut buf = Vec::new();
    write_u32(&mut buf, footer.event_count);
    write_u32(&mut buf, footer.total_duration_ms);
    write_u32(&mut buf, footer.tape_byte_length);
    buf.extend_from_slice(&footer.container_hash);
    // Chunk hashes
    write_u32(&mut buf, footer.chunk_hashes.len() as u32);
    for ch in &footer.chunk_hashes {
        write_u32(&mut buf, ch.chunk_index);
        buf.extend_from_slice(&ch.hash);
    }
    // Checkpoints
    write_u32(&mut buf, footer.checkpoints.len() as u32);
    for cp in &footer.checkpoints {
        write_u32(&mut buf, cp.event_index);
        write_u32(&mut buf, cp.at_ms);
        write_u32(&mut buf, cp.scroll_y);
        write_u32(&mut buf, cp.page);
        write_u32(&mut buf, cp.byte_offset);
    }
    buf
}

fn decode_integrity_footer(data: &[u8]) -> Option<IntegrityFooter> {
    let mut off = 0;
    let event_count = read_u32(data, &mut off)?;
    let total_duration_ms = read_u32(data, &mut off)?;
    let tape_byte_length = read_u32(data, &mut off)?;
    if off + 32 > data.len() { return None; }
    let mut container_hash = [0u8; 32];
    container_hash.copy_from_slice(&data[off..off + 32]);
    off += 32;
    let ch_count = read_u32(data, &mut off)? as usize;
    let mut chunk_hashes = Vec::with_capacity(ch_count);
    for _ in 0..ch_count {
        let chunk_index = read_u32(data, &mut off)?;
        if off + 32 > data.len() { return None; }
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&data[off..off + 32]);
        off += 32;
        chunk_hashes.push(ChunkHash { chunk_index, hash });
    }
    let cp_count = read_u32(data, &mut off)? as usize;
    let mut checkpoints = Vec::with_capacity(cp_count);
    for _ in 0..cp_count {
        checkpoints.push(Checkpoint {
            event_index: read_u32(data, &mut off)?,
            at_ms: read_u32(data, &mut off)?,
            scroll_y: read_u32(data, &mut off)?,
            page: read_u32(data, &mut off)?,
            byte_offset: read_u32(data, &mut off)?,
        });
    }
    Some(IntegrityFooter { event_count, total_duration_ms, tape_byte_length, container_hash, chunk_hashes, checkpoints })
}

pub fn encode_container(
    header: &SessionHeader,
    scene: &SceneModel,
    events: &[ReplayEncodedEvent],
) -> Vec<u8> {
    let tape = crate::codec::encode_replay_events(events);
    let tape_bytes = base64::engine::general_purpose::STANDARD
        .decode(&tape.tape_base64)
        .unwrap_or_default();

    let checkpoints = build_checkpoints(events);

    let header_payload = encode_session_header(header);
    let target_payload = encode_target_dictionary(scene);
    let string_payload = encode_string_dictionary(&scene.strings);

    // Build chunk hashes
    let mut chunk_payloads: Vec<(ReplayChunkKind, Vec<u8>)> = vec![
        (ReplayChunkKind::SessionHeader, header_payload.clone()),
        (ReplayChunkKind::TargetDictionary, target_payload.clone()),
        (ReplayChunkKind::StringDictionary, string_payload.clone()),
        (ReplayChunkKind::MainEventStream, tape_bytes.clone()),
    ];

    let mut chunk_hashes = Vec::new();
    for (i, (_, payload)) in chunk_payloads.iter().enumerate() {
        if i % CHUNK_HASH_EVERY == 0 || i == chunk_payloads.len() - 1 {
            chunk_hashes.push(ChunkHash {
                chunk_index: i as u32,
                hash: sha256(payload),
            });
        }
    }

    // Compute duration
    let total_duration_ms = {
        let quantum = REPLAY_TIME_QUANTUM_MS as u32;
        events.iter().fold(0u32, |acc, e| {
            let d = match e {
                ReplayEncodedEvent::Scroll { delta, .. }
                | ReplayEncodedEvent::Click { delta, .. }
                | ReplayEncodedEvent::Key { delta, .. }
                | ReplayEncodedEvent::Focus { delta, .. }
                | ReplayEncodedEvent::Blur { delta, .. }
                | ReplayEncodedEvent::Visibility { delta, .. }
                | ReplayEncodedEvent::Highlight { delta, .. }
                | ReplayEncodedEvent::Navigation { delta, .. }
                | ReplayEncodedEvent::Page { delta, .. }
                | ReplayEncodedEvent::Modal { delta, .. }
                | ReplayEncodedEvent::SignatureStart { delta, .. }
                | ReplayEncodedEvent::SignaturePoint { delta, .. }
                | ReplayEncodedEvent::SignatureEnd { delta, .. }
                | ReplayEncodedEvent::SignatureCommit { delta, .. }
                | ReplayEncodedEvent::SignatureClear { delta, .. }
                | ReplayEncodedEvent::FieldCommit { delta, .. }
                | ReplayEncodedEvent::Clipboard { delta, .. }
                | ReplayEncodedEvent::ContextMenu { delta, .. }
            | ReplayEncodedEvent::MouseMove { delta, .. }
            | ReplayEncodedEvent::HoverDwell { delta, .. }
            | ReplayEncodedEvent::ViewportResize { delta, .. }
            | ReplayEncodedEvent::TouchStart { delta, .. }
            | ReplayEncodedEvent::TouchMove { delta, .. }
            | ReplayEncodedEvent::TouchEnd { delta, .. }
            | ReplayEncodedEvent::FieldCorrection { delta, .. }
            | ReplayEncodedEvent::ScrollMomentum { delta, .. } => *delta,
            };
            acc.saturating_add(d.saturating_mul(quantum))
        })
    };

    let footer = IntegrityFooter {
        event_count: events.len() as u32,
        total_duration_ms,
        tape_byte_length: tape_bytes.len() as u32,
        container_hash: [0u8; 32], // placeholder — filled after assembly
        chunk_hashes,
        checkpoints,
    };
    let footer_payload = encode_integrity_footer(&footer);
    chunk_payloads.push((ReplayChunkKind::IntegrityFooter, footer_payload));

    // Assemble raw chunks
    let mut raw = Vec::with_capacity(
        chunk_payloads.iter().map(|(_, p)| 5 + p.len()).sum::<usize>(),
    );
    for (kind, payload) in &chunk_payloads {
        encode_chunk(&mut raw, *kind, payload);
    }

    // Compress with deflate
    let compressed = {
        let mut enc = DeflateEncoder::new(Vec::new(), Compression::fast());
        enc.write_all(&raw).unwrap_or_default();
        enc.finish().unwrap_or_default()
    };

    // Use compressed if smaller
    let (body, flags) = if compressed.len() < raw.len() {
        (compressed, CONTAINER_FLAG_DEFLATE)
    } else {
        (raw.clone(), 0u8)
    };

    // Header: magic(4) + version(1) + flags(1) + body_len(4) + body
    let mut buf = Vec::with_capacity(10 + body.len());
    buf.extend_from_slice(REPLAY_CONTAINER_MAGIC);
    write_u8(&mut buf, REPLAY_CONTAINER_VERSION);
    write_u8(&mut buf, flags);
    write_u32(&mut buf, body.len() as u32);
    buf.extend_from_slice(&body);

    // Patch container hash into footer (find it in the uncompressed raw)
    let container_hash = sha256(&buf);
    // Re-encode with correct hash... we need to re-do the footer
    // Simpler: set hash in footer, re-compress
    let footer = IntegrityFooter {
        container_hash,
        ..footer
    };
    let footer_payload = encode_integrity_footer(&footer);
    let mut chunk_payloads = chunk_payloads;
    *chunk_payloads.last_mut().unwrap() = (ReplayChunkKind::IntegrityFooter, footer_payload);

    let mut raw2 = Vec::new();
    for (kind, payload) in &chunk_payloads {
        encode_chunk(&mut raw2, *kind, payload);
    }

    let compressed2 = {
        let mut enc = DeflateEncoder::new(Vec::new(), Compression::fast());
        enc.write_all(&raw2).unwrap_or_default();
        enc.finish().unwrap_or_default()
    };

    let (body2, flags2) = if compressed2.len() < raw2.len() {
        (compressed2, CONTAINER_FLAG_DEFLATE)
    } else {
        (raw2, 0u8)
    };

    let mut final_buf = Vec::with_capacity(10 + body2.len());
    final_buf.extend_from_slice(REPLAY_CONTAINER_MAGIC);
    write_u8(&mut final_buf, REPLAY_CONTAINER_VERSION);
    write_u8(&mut final_buf, flags2);
    write_u32(&mut final_buf, body2.len() as u32);
    final_buf.extend_from_slice(&body2);

    final_buf
}

use base64::Engine as _;

pub fn decode_container(data: &[u8]) -> Option<ReplayContainer> {
    if data.len() < 6 { return None; }
    if &data[0..4] != REPLAY_CONTAINER_MAGIC { return None; }
    let version = data[4];
    let mut off = 5;

    // v2+: flags(1) + body_len(4) + body (possibly deflated)
    // v1 compat: no flags byte, chunks start at offset 5
    let chunk_data: Vec<u8>;
    if version >= 2 {
        let flags = read_u8(data, &mut off)?;
        let body_len = read_u32(data, &mut off)? as usize;
        if off + body_len > data.len() { return None; }
        let body = &data[off..off + body_len];

        if flags & CONTAINER_FLAG_DEFLATE != 0 {
            let mut dec = DeflateDecoder::new(Vec::new());
            dec.write_all(body).ok()?;
            chunk_data = dec.finish().ok()?;
        } else {
            chunk_data = body.to_vec();
        }
        off = 0; // reset for chunk parsing on decompressed data
    } else {
        // v1: raw chunks follow directly
        chunk_data = data[off..].to_vec();
        off = 0;
    }

    let data = &chunk_data;

    let mut header: Option<SessionHeader> = None;
    let mut pages = Vec::new();
    let mut fields = Vec::new();
    let mut signature_pads = Vec::new();
    let mut targets = Vec::new();
    let mut strings = Vec::new();
    let mut tape_bytes = Vec::new();
    let mut footer: Option<IntegrityFooter> = None;

    while off < data.len() {
        let kind = read_u8(data, &mut off)?;
        let len = read_u32(data, &mut off)? as usize;
        if off + len > data.len() { return None; }
        let payload = &data[off..off + len];
        off += len;

        match kind {
            x if x == ReplayChunkKind::SessionHeader as u8 => {
                header = decode_session_header(payload);
            }
            x if x == ReplayChunkKind::TargetDictionary as u8 => {
                if let Some((pg, fl, sp, tg)) = decode_target_dictionary(payload) {
                    pages = pg;
                    fields = fl;
                    signature_pads = sp;
                    targets = tg;
                }
            }
            x if x == ReplayChunkKind::StringDictionary as u8 => {
                if let Some(s) = decode_string_dictionary(payload) {
                    strings = s;
                }
            }
            x if x == ReplayChunkKind::MainEventStream as u8 => {
                tape_bytes = payload.to_vec();
            }
            x if x == ReplayChunkKind::IntegrityFooter as u8 => {
                footer = decode_integrity_footer(payload);
            }
            _ => {} // skip unknown chunks
        }
    }

    let header = header?;
    let footer = footer?;
    let tape_base64 = base64::engine::general_purpose::STANDARD.encode(&tape_bytes);

    Some(ReplayContainer {
        scene: SceneModel {
            viewport: header.viewport.clone(),
            page_count: header.page_count,
            pages,
            fields,
            signature_pads,
            targets,
            strings,
        },
        tape: ReplayEncodedPayload {
            tape_base64,
            byte_length: tape_bytes.len(),
        },
        header,
        footer,
    })
}

pub fn find_checkpoint_for_ms(checkpoints: &[Checkpoint], target_ms: u32) -> Option<&Checkpoint> {
    if checkpoints.is_empty() {
        return None;
    }
    let idx = checkpoints
        .partition_point(|cp| cp.at_ms <= target_ms);
    if idx == 0 {
        Some(&checkpoints[0])
    } else {
        Some(&checkpoints[idx - 1])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_scene() -> SceneModel {
        SceneModel {
            viewport: Viewport { width: 1024, height: 768, device_pixel_ratio: 2.0, scroll_width: 1024, scroll_height: 3000 },
            page_count: 1,
            pages: vec![PageGeometry { page_index: 0, width: 612.0, height: 792.0, offset_y: 0.0 }],
            fields: vec![FieldGeometry {
                target_id: 1,
                page_index: 0,
                rect: Rect { x: 10.0, y: 20.0, w: 200.0, h: 40.0 },
                field_type: FieldType::Signature,
            }],
            signature_pads: vec![SignaturePadGeometry {
                target_id: 1,
                page_index: 0,
                rect: Rect { x: 10.0, y: 20.0, w: 200.0, h: 80.0 },
                canvas_width: 400,
                canvas_height: 160,
            }],
            targets: vec![TargetEntry { id: 1, hash: 0xabcd, descriptor: "tag:canvas|id:sig".into() }],
            strings: vec![StringEntry { id: 1, kind: 1, hash: 0x1234, value: "Enter".into() }],
        }
    }

    fn sample_header() -> SessionHeader {
        SessionHeader {
            version: REPLAY_CONTAINER_VERSION,
            time_quantum_ms: REPLAY_TIME_QUANTUM_MS,
            signer_id: "signer-1".into(),
            session_id: "session-abc".into(),
            started_at_epoch_ms: 1700000000000,
            viewport: Viewport { width: 1024, height: 768, device_pixel_ratio: 2.0, scroll_width: 1024, scroll_height: 3000 },
            page_count: 1,
        }
    }

    fn sample_events() -> Vec<ReplayEncodedEvent> {
        vec![
            ReplayEncodedEvent::Scroll { delta: 0, scroll_y: 0, scroll_max: 3000 },
            ReplayEncodedEvent::Click { delta: 5, target_id: 1, x: 100, y: 200, button: 0 },
            ReplayEncodedEvent::SignatureStart { delta: 3, target_id: 1, stroke_id: 1, x: 50, y: 60, pressure: 128 },
            ReplayEncodedEvent::SignaturePoint { delta: 1, stroke_id: 1, x: 55, y: 65, pressure: 140 },
            ReplayEncodedEvent::SignatureEnd { delta: 1, stroke_id: 1 },
            ReplayEncodedEvent::FieldCommit { delta: 10, target_id: 1, value_id: 1 },
        ]
    }

    #[test]
    fn container_roundtrip() {
        let header = sample_header();
        let scene = sample_scene();
        let events = sample_events();

        let encoded = encode_container(&header, &scene, &events);
        assert!(encoded.len() > 20);
        assert_eq!(&encoded[0..4], REPLAY_CONTAINER_MAGIC);

        let decoded = decode_container(&encoded).expect("decode should succeed");
        assert_eq!(decoded.header.signer_id, "signer-1");
        assert_eq!(decoded.header.session_id, "session-abc");
        assert_eq!(decoded.scene.pages.len(), 1);
        assert_eq!(decoded.scene.fields.len(), 1);
        assert_eq!(decoded.scene.signature_pads.len(), 1);
        assert_eq!(decoded.scene.targets.len(), 1);
        assert_eq!(decoded.scene.strings.len(), 1);
        assert_eq!(decoded.footer.event_count, 6);
        assert!(decoded.footer.checkpoints.len() >= 1);
    }

    #[test]
    fn container_magic_mismatch_returns_none() {
        let bad = b"XXXX\x01\x00";
        assert!(decode_container(bad).is_none());
    }

    #[test]
    fn container_compression_shrinks_output() {
        let header = sample_header();
        let scene = sample_scene();

        // Build a realistic session: scrolls, clicks, keys, signature, mouse moves
        let mut events = sample_events();
        // Add 200 mouse moves (the new opcode — lots of them in a real session)
        for i in 0..200 {
            events.push(ReplayEncodedEvent::MouseMove {
                delta: 1,
                dx: (i % 7) as i32 - 3,
                dy: (i % 5) as i32 - 2,
            });
        }
        // Add some field corrections
        events.push(ReplayEncodedEvent::FieldCorrection {
            delta: 2, target_id: 1, correction_kind: 1, count: 3,
        });
        events.push(ReplayEncodedEvent::ScrollMomentum {
            delta: 1, velocity: -450, deceleration: 80,
        });

        let container_bytes = encode_container(&header, &scene, &events);

        // Compare: raw tape (no container) vs full container with compression
        let tape = crate::codec::encode_replay_events(&events);
        let raw_tape_bytes = base64::engine::general_purpose::STANDARD
            .decode(&tape.tape_base64).unwrap();

        // JSON equivalent (simulated): tape_base64 + targets/strings as JSON
        let json_overhead = tape.tape_base64.len() // base64 is 33% larger than raw
            + 200 // rough JSON key overhead for targets/strings/viewport
            + scene.targets.iter().map(|t| t.descriptor.len() + 40).sum::<usize>()
            + scene.strings.iter().map(|s| s.value.len() + 40).sum::<usize>();

        println!("Raw tape:    {} bytes", raw_tape_bytes.len());
        println!("Base64 tape: {} bytes (33% overhead)", tape.tape_base64.len());
        println!("JSON equiv:  ~{} bytes", json_overhead);
        println!("Container:   {} bytes (deflate compressed)", container_bytes.len());
        println!("Ratio vs JSON: {:.1}%", (container_bytes.len() as f64 / json_overhead as f64) * 100.0);

        // Container should be smaller than JSON equivalent
        assert!(container_bytes.len() < json_overhead, "container should beat JSON");
        // Container should be smaller than even the raw base64 tape
        assert!(container_bytes.len() < tape.tape_base64.len(), "container should beat base64");
    }

    #[test]
    fn checkpoints_are_built_correctly() {
        let events = sample_events();
        let checkpoints = build_checkpoints(&events);
        assert!(!checkpoints.is_empty());
        assert_eq!(checkpoints[0].event_index, 0);
    }

    #[test]
    fn find_checkpoint_binary_search() {
        let checkpoints = vec![
            Checkpoint { event_index: 0, at_ms: 0, scroll_y: 0, page: 0, byte_offset: 0 },
            Checkpoint { event_index: 50, at_ms: 5000, scroll_y: 100, page: 1, byte_offset: 500 },
            Checkpoint { event_index: 100, at_ms: 10000, scroll_y: 200, page: 2, byte_offset: 1000 },
        ];

        let cp = find_checkpoint_for_ms(&checkpoints, 7500).unwrap();
        assert_eq!(cp.at_ms, 5000);

        let cp = find_checkpoint_for_ms(&checkpoints, 0).unwrap();
        assert_eq!(cp.at_ms, 0);

        let cp = find_checkpoint_for_ms(&checkpoints, 15000).unwrap();
        assert_eq!(cp.at_ms, 10000);
    }
}
