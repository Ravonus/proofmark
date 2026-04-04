# Forensic Replay Tape Format

This document defines the high-efficiency replay format for signing forensics.
The goal is a single deterministic wire format that can be produced by:

- Rust compiled to WASM in the browser
- Native Rust on the server
- A TypeScript fallback in the browser when WASM is unavailable

The fallback is a hard requirement. Performance may change across implementations, but the emitted forensic tape must not.

## Design Goals

- Very small footprint for long signing sessions
- Deterministic encoding for identical logical input
- Shared codec between browser and server
- Replayable signatures, navigation, scroll, highlights, clicks, field edits, and clipboard actions
- Fast seek and integrity verification for large contracts
- Browser-friendly capture with Rust/WASM for the hot path

## System Split

### 1. JS Capture Shell

Owns browser-only work:

- DOM listeners
- clipboard access
- focus and blur observation
- scroll and click capture
- canvas pointer collection
- stable target-ID assignment

The capture shell must normalize raw browser events into compact semantic events before handing them to the encoder.

### 2. Forensic Core (Rust/WASM + Native Rust)

Owns deterministic logic:

- opcode encoding
- varint and zigzag packing
- delta timestamps
- coordinate quantization
- string interning
- target hashing
- signature stroke compression
- chunk hashing
- replay decoding

### 3. TS Fallback Core

Used only if WASM fails to load, panics, or is disabled.

It must:

- use the same opcode table
- use the same quantization constants
- use the same chunk order
- use the same hash rules
- emit byte-for-byte compatible payloads for the same logical event stream

If this cannot be guaranteed for a feature, that feature should not ship in the fallback path.

## Container

Target container magic: `PMRP`

Fixed header:

1. `magic[4]`
2. `version_u8`
3. `flags_u16`
4. `time_quantum_ms_u16`
5. `chunk_count_u16`
6. `session_id_hash_u64`
7. `document_hash_prefix_u64`

All integers are little-endian unless otherwise stated.

The current browser implementation still wraps metadata in JSON plus a base64 event tape. That is the stepping stone. The target shared core format is the chunked binary container below.

## Chunks

Each chunk has:

1. `chunk_type_u8`
2. `stream_id_u8`
3. `flags_u16`
4. `payload_len_u32`
5. `payload[payload_len]`
6. `chunk_hash_u128` or `chunk_hash_u256` depending on deployment mode

Recommended chunk order:

1. `SessionHeader`
2. `TargetDictionary`
3. `StringDictionary`
4. `MainEventStream`
5. `SignatureStream`
6. `EditStream`
7. `IntegrityFooter`

## Dictionaries

### Target Dictionary

Each target gets a stable numeric ID for the session.

Target entry:

1. `target_id_varuint`
2. `target_hash_u64`
3. `target_kind_u8`
4. `descriptor_len_varuint`
5. `descriptor_bytes`

Descriptor bytes are for audit visibility, not replay logic. Replay uses the numeric target ID.

Target examples:

- field IDs
- page anchors
- `next`
- `prev`
- `confirm`
- `signature_pad`
- `mobile_sign_qr`

### String Dictionary

String entry:

1. `string_id_varuint`
2. `string_kind_u8`
3. `string_hash_u64`
4. `string_len_varuint`
5. `string_bytes`

Kinds:

- key
- label
- value
- signature
- clipboard

Rules:

- labels and UI strings are normalized and deduped
- field values are snapshot-limited
- clipboard stores `len + hash + short preview` by default
- very large values should be replaced with `len + hash` tokens unless exact replay requires the full value

## Streams

### Main Event Stream

Used for:

- scroll
- click
- key
- focus
- blur
- visibility
- highlight
- navigation
- page
- modal
- context menu
- clipboard summary events

Event frame:

1. `opcode_u8`
2. `delta_t_varuint`
3. `payload...`

Time is quantized to 8ms buckets.

### Signature Stream

Used only for drawn signatures and highlight drags that need real motion.

Signature stroke:

1. `stroke_id_varuint`
2. `point_count_varuint`
3. first point: `x_varuint y_varuint dt_varuint pressure_u8`
4. next points: `dx_varint dy_varint ddt_varuint pressure_u8`

Rules:

- coordinates are integer pixels in canvas-local space
- time is quantized to the shared quantum
- pressure is bucketed to 0-255
- this stream should preserve visible motion, not sub-pixel noise

### Edit Stream

Used for semantic field edits, not raw DOM noise.

Preferred edit ops:

- insert
- delete
- replace
- clear
- paste
- commit

This is much smaller and more replayable than storing every keydown as the source of truth.

Raw key events may still be stored in the main stream for behavioral evidence, but the edit stream is authoritative for text reconstruction.

## Opcode Table

Main opcodes:

- `1` scroll
- `2` click
- `3` key
- `4` focus
- `5` blur
- `6` visibility
- `7` highlight
- `8` navigation
- `9` page
- `10` modal
- `16` clipboard
- `17` context menu

Signature opcodes:

- `11` signature_start
- `12` signature_point
- `13` signature_end
- `14` signature_commit
- `18` signature_clear

Edit opcode:

- `15` field_commit

The current `field_commit` opcode is a coarse value snapshot. The shared Rust core should extend this into dedicated edit ops while preserving backward decoding for v1 captures.

## Quantization Rules

- time: 8ms
- coordinates: 1px
- pressure: 256 buckets
- scroll: sample only meaningful deltas
- mouse movement outside signatures: aggregate, do not raw-log

If two implementations see the same normalized event stream, they must quantize identically.

## Chunking Strategy

For large sessions, chunk event streams every 256 logical events or earlier when payload size exceeds a target threshold.

Recommended thresholds:

- main stream chunk: 8-16KB
- signature stream chunk: 4-8KB
- edit stream chunk: 4-8KB

Benefits:

- partial verification
- seeking into long sessions
- lower peak memory
- easier resumable upload

## Integrity

Each chunk hash is computed over:

- container version
- chunk type
- stream ID
- chunk flags
- chunk payload
- previous chunk hash in the same stream

The footer stores:

- final main-stream hash
- final signature-stream hash
- final edit-stream hash
- overall session hash

This gives tamper evidence without forcing a single monolithic hash over the whole blob.

## Fallback Contract

The fallback path is valid only if all of these are true:

1. Same opcode numbers
2. Same quantization constants
3. Same target and string hashing
4. Same chunk order
5. Same edit semantics
6. Same signature stroke packing

If the WASM encoder fails:

- the app must continue capturing
- the TS fallback must emit the same logical wire format
- forensic metadata should record `encoder_impl=ts_fallback`

If both WASM and fallback fail:

- do not block signing
- store summary behavioral metrics only
- attach a forensic flag that replay capture degraded

## Performance Priorities

To keep the system small and fast:

- prefer semantic edits over raw key logs
- keep signatures in a dedicated stream
- hash and dedupe everything possible
- never store selectors as replay primitives
- use numeric IDs everywhere
- chunk early for large contracts
- keep JS capture thin and move packing into WASM

## Current Repo Mapping

Current implementation status:

- browser replay semantics exist in `src/lib/forensic/replay.ts`
- behavioral tracker integration exists in `src/lib/forensic/fingerprint.ts`
- signature motion capture exists in `src/components/signature-pad.tsx`
- proof packet summary exists in `src/server/proof-packet.ts`

Next migration step:

- move the encoder and decoder into a shared Rust crate
- compile that crate to WASM for the browser
- keep the TS path only as a strict compatibility fallback
