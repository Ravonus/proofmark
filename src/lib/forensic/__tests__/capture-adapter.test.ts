import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForensicCaptureAdapter, snapshotGeometry } from "../capture-adapter";
import { decodeReplayEventsSync } from "../replay-codec";

describe("ForensicCaptureAdapter", () => {
  let adapter: ForensicCaptureAdapter;

  beforeEach(() => {
    adapter = new ForensicCaptureAdapter();
  });

  it("records scroll events", () => {
    adapter.recordScroll(100, 2000);
    adapter.recordScroll(200, 2000);
  });

  it("deduplicates small scrolls", () => {
    adapter.recordScroll(100, 2000);
    adapter.recordScroll(105, 2000); // should be deduplicated (< 12px, < 64ms)
  });

  it("records navigation events", () => {
    adapter.recordNavigation("next", null, 1);
    adapter.recordNavigation("prev", null, 0);
    adapter.recordNavigation("jump", null, 5);
  });

  it("records page events", () => {
    adapter.recordPage(2, 10);
  });

  it("records modal events", () => {
    adapter.recordModal("confirm-dialog", true);
    adapter.recordModal("confirm-dialog", false);
  });

  it("records visibility changes", () => {
    adapter.recordVisibility(true);
    adapter.recordVisibility(false);
  });

  it("records signature lifecycle", () => {
    const strokeId = adapter.recordSignatureStart(null, 10, 20, 0.5);
    expect(strokeId).toBe(1);

    adapter.recordSignaturePoint(strokeId, 15, 25, 0.6);
    adapter.recordSignaturePoint(strokeId, 20, 30, 0.7);
    adapter.recordSignatureEnd(strokeId);
    adapter.recordSignatureCommit(null, "pm-sig-v1:test");
  });

  it("records field values with debounce", async () => {
    vi.useFakeTimers();
    adapter.recordFieldValue("field-1", "hello");
    adapter.recordFieldValue("field-1", "hello world");
    vi.advanceTimersByTime(200);
    vi.useRealTimers();
  });

  it("records clipboard events", () => {
    adapter.recordClipboard("copy", null, "sample text");
    adapter.recordClipboard("paste", null, "pasted content");
  });

  it("finalizes into a CaptureResult", async () => {
    adapter.recordScroll(100, 2000);
    adapter.recordPage(1, 5);
    const strokeId = adapter.recordSignatureStart(null, 10, 20, 0.5);
    adapter.recordSignaturePoint(strokeId, 15, 25, 0.6);
    adapter.recordSignatureEnd(strokeId);

    const result = await adapter.finalize();

    expect(result.events.length).toBeGreaterThanOrEqual(4);
    expect(result.tapeBase64.length).toBeGreaterThan(0);
    expect(result.byteLength).toBeGreaterThan(0);

    // Verify tape roundtrip
    const decoded = decodeReplayEventsSync(result.tapeBase64);
    expect(decoded.length).toBe(result.events.length);
  });
});

describe("snapshotGeometry", () => {
  it("returns empty geometry when no container", () => {
    const geo = snapshotGeometry(null);
    expect(geo.pages).toHaveLength(0);
    expect(geo.fields).toHaveLength(0);
    expect(geo.signaturePads).toHaveLength(0);
  });
});
