import { describe, expect, it } from "vitest";
import type { CapturedGeometry, CaptureResult, CaptureString, CaptureTarget } from "../capture-adapter";
import { encodeReplayEventsSync, type ForensicReplayEncodedEvent } from "../replay-codec";
import {
  buildEmbeddedPayload,
  buildExternalPointer,
  EXTERNALIZE_THRESHOLD_BYTES,
  estimateEmbeddedSize,
  shouldExternalize,
} from "../storage";

function makeCaptureResult(eventCount: number): CaptureResult {
  const events: ForensicReplayEncodedEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    events.push({
      type: "click",
      delta: 1,
      targetId: 1,
      x: i * 10,
      y: i * 5,
      button: 0,
    });
  }
  const { tapeBase64, byteLength } = encodeReplayEventsSync(events);
  const targets: CaptureTarget[] = [{ id: 1, hash: "abc123", descriptor: "tag:button|id:submit" }];
  const strings: CaptureString[] = [];
  const geometry: CapturedGeometry = {
    viewport: {
      width: 1024,
      height: 768,
      devicePixelRatio: 2,
      scrollWidth: 1024,
      scrollHeight: 3000,
    },
    pages: [],
    fields: [],
    signaturePads: [],
  };

  return {
    events,
    targets,
    strings,
    geometry,
    tapeBase64,
    byteLength,
    durationMs: eventCount * 8,
  };
}

describe("storage", () => {
  it("builds embedded payload", () => {
    const capture = makeCaptureResult(10);
    const result = buildEmbeddedPayload(capture, {
      tapeHash: "abc123",
      viewport: capture.geometry.viewport,
    });

    expect(result.pointer.mode).toBe("embedded");
    expect(result.pointer.eventCount).toBe(10);
    expect(result.tape.tapeBase64).toBe(capture.tapeBase64);
    expect(result.tape.metrics.eventCount).toBe(10);
    expect(result.tape.capabilities).toContain("click");
  });

  it("builds external pointer", () => {
    const capture = makeCaptureResult(5);
    const result = buildExternalPointer(capture, {
      tapeHash: "def456",
      objectCid: "bafybeiabc123",
      storageProvider: "ipfs",
    });

    expect(result.pointer.mode).toBe("external");
    expect(result.pointer.objectCid).toBe("bafybeiabc123");
    expect(result.pointer.storageProvider).toBe("ipfs");
  });

  it("estimates embedded size", () => {
    const capture = makeCaptureResult(10);
    const size = estimateEmbeddedSize(capture);
    expect(size).toBeGreaterThan(capture.byteLength);
    expect(size).toBeLessThan(capture.byteLength + 10000); // reasonable overhead
  });

  it("shouldExternalize returns false for small payloads", () => {
    const capture = makeCaptureResult(10);
    expect(shouldExternalize(capture)).toBe(false);
  });

  it("shouldExternalize returns true for large payloads", () => {
    // Create a capture result with artificially inflated byte length
    const capture = makeCaptureResult(10);
    // Simulate a huge tape
    (capture as { byteLength: number }).byteLength = EXTERNALIZE_THRESHOLD_BYTES + 1;
    expect(shouldExternalize(capture)).toBe(true);
  });
});
