import { describe, it, expect } from "vitest";
import { TSPlaybackController, TSMultiSignerController } from "../playback-controller";
import { encodeReplayEventsSync, type ForensicReplayEncodedEvent } from "../replay-codec";

function sampleEvents(): ForensicReplayEncodedEvent[] {
  return [
    { type: "scroll", delta: 0, scrollY: 0, scrollMax: 2000 },
    { type: "click", delta: 5, targetId: 1, x: 100, y: 200, button: 0 },
    { type: "page", delta: 3, page: 2, totalPages: 5 },
    { type: "signatureStart", delta: 2, targetId: 3, strokeId: 1, x: 10, y: 20, pressure: 128 },
    { type: "signaturePoint", delta: 1, strokeId: 1, x: 15, y: 25, pressure: 140 },
    { type: "signatureEnd", delta: 1, strokeId: 1 },
    { type: "fieldCommit", delta: 5, targetId: 2, valueId: 7 },
  ];
}

describe("TSPlaybackController", () => {
  it("initializes with correct state", () => {
    const ctrl = new TSPlaybackController(sampleEvents(), 0);
    expect(ctrl.state).toBe("idle");
    expect(ctrl.eventCount).toBe(7);
    expect(ctrl.durationMs).toBeGreaterThan(0);
    expect(ctrl.cursorMs).toBe(0);
    expect(ctrl.progress).toBe(0);
  });

  it("play/pause/resume lifecycle", () => {
    const ctrl = new TSPlaybackController(sampleEvents(), 0);
    ctrl.play();
    expect(ctrl.state).toBe("playing");

    ctrl.tick(10);
    ctrl.pause();
    expect(ctrl.state).toBe("paused");

    // No events fire when paused
    const fired = ctrl.tick(10);
    expect(fired).toHaveLength(0);

    ctrl.resume();
    expect(ctrl.state).toBe("playing");
  });

  it("fires events during tick", () => {
    const ctrl = new TSPlaybackController(sampleEvents(), 0);
    ctrl.play();
    const fired = ctrl.tick(200);
    expect(fired.length).toBeGreaterThan(0);
  });

  it("seek to specific timestamp", () => {
    const ctrl = new TSPlaybackController(sampleEvents(), 0);
    ctrl.play();
    ctrl.seek(64); // past click (40ms) and page (64ms)

    const snap = ctrl.snapshot();
    expect(snap.page).toBe(2);
    expect(snap.totalPages).toBe(5);
  });

  it("speed control scales tick", () => {
    const ctrl = new TSPlaybackController(sampleEvents(), 0);
    ctrl.setSpeed(2.0);
    expect(ctrl.speed).toBe(2.0);

    ctrl.play();
    const fired = ctrl.tick(100); // 100ms * 2x = 200ms equivalent
    expect(fired.length).toBeGreaterThan(0);
  });

  it("snapshot captures stroke state", () => {
    const ctrl = new TSPlaybackController(sampleEvents(), 0);
    // After signature start + point (80ms + 8ms = 88ms)
    const snap = ctrl.snapshotAt(88);
    expect(snap.activeStrokes.length).toBe(1);
    expect(snap.activeStrokes[0]!.points.length).toBe(2);
  });

  it("snapshot captures field values", () => {
    const ctrl = new TSPlaybackController(sampleEvents(), 0);
    const snap = ctrl.snapshotAt(200);
    expect(snap.fieldValues.length).toBe(1);
    expect(snap.fieldValues[0]).toEqual([2, 7]);
  });

  it("ends when past duration", () => {
    const ctrl = new TSPlaybackController(sampleEvents(), 0);
    ctrl.play();
    ctrl.tick(500);
    expect(ctrl.state).toBe("ended");
  });

  it("play after ended resets", () => {
    const ctrl = new TSPlaybackController(sampleEvents(), 0);
    ctrl.play();
    ctrl.tick(500);
    expect(ctrl.state).toBe("ended");

    ctrl.play();
    expect(ctrl.state).toBe("playing");
    expect(ctrl.cursorMs).toBe(0);
  });

  it("fromTape creates controller from base64 tape", () => {
    const { tapeBase64 } = encodeReplayEventsSync(sampleEvents());
    const ctrl = TSPlaybackController.fromTape(tapeBase64, 1);
    expect(ctrl.lane).toBe(1);
    expect(ctrl.eventCount).toBe(7);
  });
});

describe("TSMultiSignerController", () => {
  it("synchronizes multiple signers", () => {
    const eventsA: ForensicReplayEncodedEvent[] = [{ type: "click", delta: 5, targetId: 1, x: 10, y: 20, button: 0 }];
    const eventsB: ForensicReplayEncodedEvent[] = [{ type: "click", delta: 3, targetId: 2, x: 30, y: 40, button: 0 }];

    const ca = new TSPlaybackController(eventsA, 0);
    const cb = new TSPlaybackController(eventsB, 1);
    const multi = new TSMultiSignerController([ca, cb]);

    expect(multi.durationMs).toBe(40); // max of 40 and 24
    multi.play();
    const fired = multi.tick(50);
    expect(fired.length).toBe(2);
    // Lane 1 (24ms) fires before lane 0 (40ms)
    expect(fired[0]![1]).toBe(1);
    expect(fired[1]![1]).toBe(0);
  });

  it("seek syncs all controllers", () => {
    const ca = new TSPlaybackController([{ type: "page", delta: 5, page: 3, totalPages: 10 }], 0);
    const cb = new TSPlaybackController([{ type: "scroll", delta: 2, scrollY: 500, scrollMax: 2000 }], 1);
    const multi = new TSMultiSignerController([ca, cb]);
    multi.seek(50);

    const snaps = multi.snapshots();
    expect(snaps.length).toBe(2);
    expect(snaps[0]![1].page).toBe(3);
    expect(snaps[1]![1].scrollY).toBe(500);
  });

  it("speed control propagates to all controllers", () => {
    const ca = new TSPlaybackController(sampleEvents(), 0);
    const cb = new TSPlaybackController(sampleEvents(), 1);
    const multi = new TSMultiSignerController([ca, cb]);
    multi.setSpeed(4);
    expect(ca.speed).toBe(4);
    expect(cb.speed).toBe(4);
  });
});
