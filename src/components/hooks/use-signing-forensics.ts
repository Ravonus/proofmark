"use client";

import { useCallback, useEffect, useRef } from "react";
import type { BehavioralSignals } from "~/lib/forensic";
import { BehavioralTracker, warmForensicReplayCore } from "~/lib/forensic";
import { trpc } from "~/lib/platform/trpc";

/** Fallback behavioral signals when the tracker fails or is absent. */
export const EMPTY_BEHAVIORAL: BehavioralSignals = Object.freeze({
  timeOnPage: 0,
  scrolledToBottom: false,
  maxScrollDepth: 0,
  mouseMoveCount: 0,
  clickCount: 0,
  keyPressCount: 0,
  pageWasHidden: false,
  hiddenDuration: 0,
  interactionTimeline: [],
  typingCadence: [],
  mouseVelocityAvg: 0,
  mouseAccelerationPattern: "",
  touchPressureAvg: null,
  scrollPattern: [],
  focusChanges: 0,
  pasteEvents: 0,
  copyEvents: 0,
  cutEvents: 0,
  rightClicks: 0,
  gazeTrackingActive: false,
  gazePointCount: 0,
  gazeFixationCount: 0,
  gazeFixationAvgMs: 0,
  gazeBlinkCount: 0,
  gazeBlinkRate: 0,
  gazeTrackingCoverage: 0,
  gazeLiveness: null,
  replay: null,
});

/**
 * Manages forensic behavioral tracking: starts the tracker on mount,
 * saves a forensic session on unmount, and exposes refs for the tracker
 * plus timers used by other signing sub-hooks.
 */
export function useSigningForensics(documentId: string, claimToken: string | null) {
  const behavioralTracker = useRef<BehavioralTracker | null>(null);
  const visitIndexRef = useRef(0);
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socialPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveSessionMutation = trpc.document.saveForensicSession.useMutation();

  useEffect(() => {
    warmForensicReplayCore();

    // Load visit count from sessionStorage so we track multiple visits
    const visitKey = `pm_visit_${documentId}`;
    const prevVisits = parseInt(sessionStorage.getItem(visitKey) ?? "0", 10);
    visitIndexRef.current = prevVisits;
    sessionStorage.setItem(visitKey, String(prevVisits + 1));

    const tracker = new BehavioralTracker(prevVisits);
    tracker.start();
    behavioralTracker.current = tracker;

    return () => {
      if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
      if (socialPollRef.current) clearInterval(socialPollRef.current);

      // Best-effort: save forensic session before the user leaves the page
      if (claimToken && tracker) {
        void (async () => {
          try {
            const behavioral = await tracker.collect();
            saveSessionMutation.mutate({
              documentId,
              claimToken,
              session: {
                sessionId: tracker.sessionId,
                visitIndex: tracker.visitIndex,
                startedAt: tracker.startedAt,
                endedAt: new Date().toISOString(),
                durationMs: behavioral.timeOnPage,
                behavioral: behavioral as unknown as Record<string, unknown>,
                replay: behavioral.replay as unknown as Record<string, unknown> | null,
              },
            });
          } catch {
            // Best-effort — don't block navigation
          }
        })();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: tracker init + cleanup must not re-run
  }, []);

  const recordModal = useCallback((name: string, open: boolean) => {
    behavioralTracker.current?.recordModal(name, open);
  }, []);

  return {
    behavioralTracker,
    visitIndexRef,
    serverSaveTimer,
    socialPollRef,
    recordModal,
  };
}
