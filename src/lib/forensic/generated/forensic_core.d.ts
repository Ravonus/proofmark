/* tslint:disable */
/* eslint-disable */

export function analyze_replay_signature_activity(tape_base64: string): any;

export function analyze_signature_strokes(strokes: any): any;

export function build_replay_timeline(tape_base64: string, lane: number, label?: string | null): any;

export function decode_replay_events(tape_base64: string): any;

export function decode_signature(encoded: string): any;

export function encode_replay_events(events: any): any;

export function encode_signature(strokes: any): string;

export function merge_replay_timelines(timelines: any): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly analyze_replay_signature_activity: (a: number, b: number) => [number, number, number];
  readonly analyze_signature_strokes: (a: any) => [number, number, number];
  readonly build_replay_timeline: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly decode_replay_events: (a: number, b: number) => [number, number, number];
  readonly decode_signature: (a: number, b: number) => [number, number, number];
  readonly encode_replay_events: (a: any) => [number, number, number];
  readonly encode_signature: (a: any) => [number, number, number, number];
  readonly merge_replay_timelines: (a: any) => [number, number, number];
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init(
  module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>,
): Promise<InitOutput>;
