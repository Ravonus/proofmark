// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BehavioralTracker } from "../fingerprint";

function dispatchClipboardEvent(type: "paste" | "copy" | "cut", target: HTMLElement, text: string) {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: () => text,
    },
  });
  target.dispatchEvent(event);
}

describe("BehavioralTracker (browser)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T00:00:00.000Z"));
    document.body.innerHTML = `<textarea id="notes"></textarea>`;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("captures key, clipboard, focus, and replay events in a browser-like flow", async () => {
    const tracker = new BehavioralTracker();
    tracker.start();

    const field = document.getElementById("notes") as HTMLTextAreaElement;
    field.focus();
    field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    vi.advanceTimersByTime(20);

    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 10, clientY: 20 }));
    vi.advanceTimersByTime(16);
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 30, clientY: 35 }));
    document.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 30, clientY: 35 }));
    vi.advanceTimersByTime(24);

    field.value = "A";
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "A" }));
    vi.advanceTimersByTime(120);
    field.value = "Al";
    field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "l" }));
    tracker.recordFieldValue("notes", field.value);

    dispatchClipboardEvent("paste", field, "Alice");
    dispatchClipboardEvent("copy", field, "Alice");
    dispatchClipboardEvent("cut", field, "A");

    field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));

    const behavioral = await tracker.collect();

    expect(behavioral.mouseMoveCount).toBe(2);
    expect(behavioral.clickCount).toBe(1);
    expect(behavioral.keyPressCount).toBe(2);
    expect(behavioral.pasteEvents).toBe(1);
    expect(behavioral.copyEvents).toBe(1);
    expect(behavioral.cutEvents).toBe(1);
    expect(behavioral.focusChanges).toBeGreaterThanOrEqual(1);
    expect(behavioral.typingCadence.length).toBe(1);
    expect(behavioral.replay?.metrics.eventCount).toBeGreaterThanOrEqual(6);
    expect(behavioral.replay?.metrics.clipboardEventCount).toBe(3);
  });
});
