"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { tokenizeDocument } from "~/lib/document/document-tokens";
import { decodeReplayEventsSync } from "~/lib/forensic/replay-codec";
import type { InteractionClassification } from "~/lib/forensic/session";
import { trpc } from "~/lib/platform/trpc";
import type { SignerInfo } from "../signing/sign-document-helpers";
import { buildStateAt, classifyFromTape, TQ } from "./replay-document-helpers";
import {
  projectGazePoint,
  type ServerAutomationReview,
  type ServerForensicSession,
  type ServerSessionProfile,
  type SignerData,
  useShareLookup,
  type VisibleReplayState,
} from "./replay-document-parts";

const SPEEDS = [0.5, 1, 2, 4, 8];

export function useReplayData(documentId: string | undefined, shareToken: string | undefined) {
  const { resolvedDocumentId, shareLookupPending, shareLookupError } = useShareLookup(documentId, shareToken);

  const query = trpc.document.getForensicReplay.useQuery(
    { id: resolvedDocumentId ?? "" },
    { enabled: Boolean(resolvedDocumentId) },
  );

  const data = query.data;

  const signers: SignerData[] = useMemo(() => {
    if (!data?.signers) return [];
    return data.signers.map((signer, index) => {
      const tape = signer.replay ?? null;
      const events = tape?.tapeBase64 ? decodeReplayEventsSync(tape.tapeBase64) : [];
      const durationMs = events.reduce((total, event) => total + event.delta * TQ, 0);
      const { classification, interactions } = tape
        ? classifyFromTape(tape, events)
        : {
            classification: null,
            interactions: [] as InteractionClassification[],
          };
      const signerExt = signer as typeof signer & {
        automationReview?: ServerAutomationReview;
        sessionProfile?: ServerSessionProfile;
        forensicSessions?: ServerForensicSession[];
        documentViewingStartedMs?: number;
      };
      const serverReview = signerExt.automationReview ?? null;
      const sessionProfile = signerExt.sessionProfile ?? null;
      const forensicSessions = signerExt.forensicSessions ?? [];
      return {
        id: signer.id,
        label: signer.label,
        status: signer.status,
        index,
        tape,
        events,
        durationMs,
        classification,
        interactions,
        serverReview,
        sessionProfile,
        forensicSessions,
        fieldValues: signer.fieldValues ?? null,
        handSignatureData: signer.handSignatureData ?? null,
        signedAt: signer.signedAt,
        address: signer.address ?? null,
        chain: signer.chain ?? null,
        email: signer.email ?? null,
        role: signer.role ?? "SIGNER",
        canSign: signer.canSign ?? false,
        documentViewingStartedMs: signerExt.documentViewingStartedMs ?? 0,
      };
    });
  }, [data]);

  const tokens = useMemo(() => {
    if (!data?.content) return [];
    return tokenizeDocument(data.content, data.signers.length).tokens;
  }, [data?.content, data?.signers.length]);

  const signerListItems: SignerInfo[] = useMemo(() => {
    return signers.map((signer) => ({
      id: signer.id,
      label: signer.label,
      address: signer.address,
      chain: signer.chain,
      status: signer.status,
      signedAt: signer.signedAt ? new Date(signer.signedAt) : null,
      scheme: null,
      isYou: false,
      isClaimed: Boolean(signer.address || signer.email),
      email: signer.email ?? null,
      role: signer.role ?? "SIGNER",
      canSign: signer.canSign ?? false,
      fieldValues: signer.fieldValues,
    }));
  }, [signers]);

  return {
    data,
    signers,
    tokens,
    signerListItems,
    shareLookupPending,
    shareLookupError,
    queryError: query.error,
    queryLoading: query.isLoading,
  };
}

function useAutoFollowScroll(opts: {
  playing: boolean;
  followEnabled: boolean;
  paperRef: React.RefObject<HTMLDivElement | null>;
  activeSignerIndex: number | null;
  states: VisibleReplayState[];
  visibleStates: VisibleReplayState[];
  effectiveCursorMs: number;
}) {
  const followTargetRef = useRef(0);

  useEffect(() => {
    if (!opts.playing || !opts.followEnabled || !opts.paperRef.current) return;

    const activeLane =
      opts.activeSignerIndex !== null
        ? opts.states[opts.activeSignerIndex]
        : (opts.visibleStates.find(({ state }) => state?.gaze.current) ?? opts.visibleStates[0]);
    if (!activeLane?.state) return;

    const paper = opts.paperRef.current;
    const paperRect = paper.getBoundingClientRect();
    const paperTop = window.scrollY + paperRect.top;
    const paperBottom = paperTop + paper.offsetHeight;
    const gazePoint = activeLane.state.gaze.current;

    let target: number;
    if (gazePoint) {
      const projected = projectGazePoint(paper, gazePoint);
      if (projected && projected.top >= 0 && projected.top <= paper.offsetHeight) {
        target = paperTop + projected.top - window.innerHeight / 2;
      } else {
        target = paperTop + activeLane.state.scrollRatio * paper.offsetHeight - window.innerHeight / 2;
      }
    } else {
      target = paperTop + activeLane.state.scrollRatio * paper.offsetHeight - window.innerHeight / 2;
    }

    target = Math.max(0, Math.min(target, paperBottom - window.innerHeight));
    const current = followTargetRef.current || window.scrollY;
    const diff = target - current;
    if (Math.abs(diff) < 20) return;
    const smoothed = current + diff * 0.25;
    followTargetRef.current = smoothed;
    window.scrollTo({ top: Math.max(0, smoothed) });
  }, [
    opts.activeSignerIndex,
    opts.effectiveCursorMs,
    opts.followEnabled,
    opts.paperRef,
    opts.playing,
    opts.states,
    opts.visibleStates,
  ]);
}

function usePlaybackLoop(opts: {
  playing: boolean;
  speed: number;
  durationMs: number;
  setCursorMs: React.Dispatch<React.SetStateAction<number>>;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const lastTickRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!opts.playing) return;
    lastTickRef.current = performance.now();

    const loop = () => {
      const now = performance.now();
      const delta = now - lastTickRef.current;
      lastTickRef.current = now;
      opts.setCursorMs((current) => {
        const next = Math.min(current + delta * opts.speed, opts.durationMs);
        if (next >= opts.durationMs) opts.setPlaying(false);
        return next;
      });
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [opts.durationMs, opts.playing, opts.speed, opts.setCursorMs, opts.setPlaying]);
}

function useReplayUIState() {
  const [cursorMs, setCursorMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [followIndex, setFollowIndex] = useState<number | null>(null);
  const [followEnabled, setFollowEnabled] = useState(true);
  const [soloIndex, setSoloIndex] = useState<number | null>(null);
  const [hiddenSigners, setHiddenSigners] = useState<Set<number>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [expandedSigners, setExpandedSigners] = useState<Set<number>>(new Set());
  const [barMinimized, setBarMinimized] = useState(false);
  const paperRef = useRef<HTMLDivElement>(null);
  return {
    cursorMs,
    setCursorMs,
    playing,
    setPlaying,
    speedIndex,
    setSpeedIndex,
    followIndex,
    setFollowIndex,
    followEnabled,
    setFollowEnabled,
    soloIndex,
    setSoloIndex,
    hiddenSigners,
    setHiddenSigners,
    drawerOpen,
    setDrawerOpen,
    expandedSigners,
    setExpandedSigners,
    barMinimized,
    setBarMinimized,
    paperRef,
  };
}

function useDerivedReplayState(signers: SignerData[], ui: ReturnType<typeof useReplayUIState>) {
  const speed = SPEEDS[ui.speedIndex] ?? 1;
  const totalDurationMs = Math.max(...signers.map((s) => s.durationMs), 0);
  const durationMs = ui.soloIndex !== null ? (signers[ui.soloIndex]?.durationMs ?? 0) : totalDurationMs;
  const effectiveCursorMs = Math.min(ui.cursorMs, durationMs);

  const visibleSigners = useMemo(
    () => signers.filter((s) => (ui.soloIndex !== null ? s.index === ui.soloIndex : !ui.hiddenSigners.has(s.index))),
    [ui.hiddenSigners, signers, ui.soloIndex],
  );

  const states: VisibleReplayState[] = useMemo(
    () =>
      signers.map((signer) => ({
        signer,
        state: signer.tape
          ? buildStateAt(signer.tape, signer.events, effectiveCursorMs, signer.documentViewingStartedMs)
          : null,
      })),
    [effectiveCursorMs, signers],
  );

  const visibleStates: VisibleReplayState[] = useMemo(
    () =>
      states.filter(({ signer }) =>
        ui.soloIndex !== null ? signer.index === ui.soloIndex : !ui.hiddenSigners.has(signer.index),
      ),
    [ui.hiddenSigners, ui.soloIndex, states],
  );

  const mergedFieldValues = useMemo(() => {
    const values: Record<string, string> = {};
    for (const { signer } of visibleStates) {
      if (signer.fieldValues) Object.assign(values, signer.fieldValues);
    }
    for (const { state } of visibleStates) {
      if (state) Object.assign(values, state.fieldTexts);
    }
    return values;
  }, [visibleStates]);

  const activeSignerIndex = !ui.followEnabled
    ? null
    : ui.followIndex !== null
      ? ui.followIndex
      : (visibleStates.find(({ state }) => state?.gaze.current)?.signer.index ?? visibleSigners[0]?.index ?? null);
  const activeState = activeSignerIndex !== null ? (states[activeSignerIndex]?.state ?? null) : null;

  return {
    speed,
    durationMs,
    effectiveCursorMs,
    visibleSigners,
    states,
    visibleStates,
    mergedFieldValues,
    activeSignerIndex,
    activeState,
  };
}

export function useReplayPlayback(signers: SignerData[]) {
  const ui = useReplayUIState();
  const derived = useDerivedReplayState(signers, ui);

  useAutoFollowScroll({
    playing: ui.playing,
    followEnabled: ui.followEnabled,
    paperRef: ui.paperRef,
    activeSignerIndex: derived.activeSignerIndex,
    states: derived.states,
    visibleStates: derived.visibleStates,
    effectiveCursorMs: derived.effectiveCursorMs,
  });
  usePlaybackLoop({
    playing: ui.playing,
    speed: derived.speed,
    durationMs: derived.durationMs,
    setCursorMs: ui.setCursorMs,
    setPlaying: ui.setPlaying,
  });

  const handlePlayPause = () => {
    if (ui.playing) {
      ui.setPlaying(false);
      return;
    }
    if (derived.effectiveCursorMs >= derived.durationMs) ui.setCursorMs(0);
    ui.setPlaying(true);
  };

  const handleSeek = (nextMs: number) => ui.setCursorMs(Math.max(0, Math.min(nextMs, derived.durationMs)));

  const handleToggleSigner = (index: number) => {
    ui.setHiddenSigners((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else {
        next.add(index);
        if (ui.followIndex === index) ui.setFollowIndex(null);
      }
      return next;
    });
  };

  const handleSoloSigner = (index: number) => {
    ui.setSoloIndex((current) => (current === index ? null : index));
    ui.setHiddenSigners(new Set());
    ui.setFollowIndex(index);
  };

  return {
    ...ui,
    ...derived,
    handlePlayPause,
    handleSeek,
    handleToggleSigner,
    handleSoloSigner,
  };
}
