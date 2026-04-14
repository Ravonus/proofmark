"use client";

import { Download, Pause, Play, RotateCcw, SplitSquareVertical, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "~/lib/platform/trpc";
import { drawReplayOverview } from "./forensic-replay-canvas";
import { LaneSnapshotCard } from "./forensic-replay-lane-card";
import {
  buildReplayLaneSnapshot,
  describeReplayEvent,
  formatReplayKey,
  type PreparedReplaySession,
  prepareReplaySession,
  type ReplayLaneEvent,
  type ReplayParticipantSummary,
} from "./replay-runtime";

type Props = {
  documentId: string;
};

type ReplayMode = "sync" | "solo";

const SPEED_OPTIONS = [0.5, 1, 2];

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useReplaySession(participants: ReplayParticipantSummary[]) {
  const [prepared, setPrepared] = useState<PreparedReplaySession | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (participants.length === 0) {
      setPrepared({ source: "ts", durationMs: 0, lanes: [], mergedEvents: [] });
      return;
    }

    void prepareReplaySession(participants).then((value) => {
      if (!cancelled) {
        setPrepared(value);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [participants]);

  return prepared;
}

function usePlaybackLoop(
  playing: boolean,
  activeDuration: number,
  speed: number,
  setCurrentMs: React.Dispatch<React.SetStateAction<number>>,
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>,
) {
  useEffect(() => {
    if (!playing || activeDuration <= 0) return;
    let raf = 0;
    let lastFrame = performance.now();

    const tick = (now: number) => {
      const elapsed = (now - lastFrame) * speed;
      lastFrame = now;
      setCurrentMs((value) => {
        const next = Math.min(activeDuration, value + elapsed);
        if (next >= activeDuration) {
          setPlaying(false);
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeDuration, playing, speed, setCurrentMs, setPlaying]);
}

type ExportParams = {
  prepared: PreparedReplaySession;
  visibleLanes: PreparedReplaySession["lanes"];
  activeDuration: number;
  title: string;
  mode: ReplayMode;
  documentId: string;
};

async function exportReplayVideoToBlob(params: ExportParams) {
  const { prepared, visibleLanes, activeDuration, title, mode, documentId } = params;
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  canvas.style.width = "1280px";
  canvas.style.height = "720px";

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const stream = canvas.captureStream(30);
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType });
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error("Failed to export replay video"));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });

  const exportRate = 2;
  const frameDuration = 1000 / 30;
  const frameCount = Math.max(1, Math.ceil(activeDuration / (frameDuration * exportRate)));

  recorder.start(250);
  for (let frame = 0; frame <= frameCount; frame += 1) {
    const frameMs = Math.min(activeDuration, frame * frameDuration * exportRate);
    drawReplayOverview(canvas, {
      title,
      mode,
      source: prepared.source,
      durationMs: activeDuration,
      currentMs: frameMs,
      lanes: visibleLanes.map((lane) => ({
        lane,
        snapshot: buildReplayLaneSnapshot(lane, frameMs),
      })),
    });
    await new Promise((resolve) => setTimeout(resolve, frameDuration));
  }
  recorder.stop();

  const blob = await done;
  downloadBlob(blob, `proofmark-forensic-${documentId}-${mode}.webm`);
}

function useCanvasOverview(params: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  prepared: PreparedReplaySession | null;
  title: string;
  mode: ReplayMode;
  activeDuration: number;
  effectiveCurrentMs: number;
  snapshots: Array<{
    lane: PreparedReplaySession["lanes"][number];
    snapshot: ReturnType<typeof buildReplayLaneSnapshot>;
  }>;
}) {
  const { canvasRef, prepared, title, mode, activeDuration, effectiveCurrentMs, snapshots } = params;
  useEffect(() => {
    if (!canvasRef.current || !prepared) return;
    drawReplayOverview(canvasRef.current, {
      title,
      mode,
      source: prepared.source,
      durationMs: activeDuration,
      currentMs: effectiveCurrentMs,
      lanes: snapshots,
    });
  }, [canvasRef, activeDuration, effectiveCurrentMs, mode, prepared, title, snapshots]);
}

function useLaneSelection(prepared: PreparedReplaySession | null, mode: ReplayMode, selectedSignerId: string | null) {
  const effectiveSelectedSignerId = useMemo(() => {
    if (!prepared?.lanes.length) return "";
    if (selectedSignerId && prepared.lanes.some((lane) => lane.signerId === selectedSignerId)) {
      return selectedSignerId;
    }
    return prepared.lanes[0]?.signerId ?? "";
  }, [prepared, selectedSignerId]);

  const selectedLane = useMemo(
    () => prepared?.lanes.find((lane) => lane.signerId === effectiveSelectedSignerId) ?? prepared?.lanes[0] ?? null,
    [effectiveSelectedSignerId, prepared],
  );

  const visibleLanes = useMemo(() => {
    if (!prepared) return [];
    if (mode === "sync") return prepared.lanes.slice(0, 2);
    return selectedLane ? [selectedLane] : [];
  }, [mode, prepared, selectedLane]);

  const activeDuration =
    mode === "sync" ? (prepared?.durationMs ?? 0) : (selectedLane?.durationMs ?? prepared?.durationMs ?? 0);

  return { selectedLane, visibleLanes, activeDuration };
}

function ReplayToolbar({
  mode,
  setMode,
  selectedLane,
  setSelectedSignerId,
  prepared,
  playing,
  setPlaying,
  setCurrentMs,
  speed,
  setSpeed,
}: {
  mode: ReplayMode;
  setMode: (m: ReplayMode) => void;
  selectedLane: { signerId: string } | null;
  setSelectedSignerId: (id: string) => void;
  prepared: PreparedReplaySession;
  playing: boolean;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentMs: React.Dispatch<React.SetStateAction<number>>;
  speed: number;
  setSpeed: (s: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => setMode("sync")}
        className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${mode === "sync" ? "bg-sky-500/15 text-sky-200" : "bg-surface-hover text-secondary hover:bg-surface-elevated"}`}
      >
        <SplitSquareVertical className="h-3.5 w-3.5" />
        Dual Replay
      </button>
      <button
        onClick={() => setMode("solo")}
        className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${mode === "solo" ? "bg-sky-500/15 text-sky-200" : "bg-surface-hover text-secondary hover:bg-surface-elevated"}`}
      >
        <UserRound className="h-3.5 w-3.5" />
        Solo Replay
      </button>
      {mode === "solo" && (
        <select
          value={selectedLane?.signerId ?? ""}
          onChange={(event) => setSelectedSignerId(event.target.value)}
          className="rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-primary outline-none"
        >
          {prepared.lanes.map((lane) => (
            <option key={lane.signerId} value={lane.signerId}>
              {lane.label}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={() => setPlaying((value) => !value)}
        className="bg-accent/15 hover:bg-accent/25 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-accent transition-colors"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        {playing ? "Pause" : "Play"}
      </button>
      <button
        onClick={() => {
          setPlaying(false);
          setCurrentMs(0);
        }}
        className="inline-flex items-center gap-2 rounded-lg bg-surface-hover px-3 py-2 text-xs text-secondary transition-colors hover:bg-surface-elevated"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Restart
      </button>
      <div className="ml-auto flex items-center gap-2">
        {SPEED_OPTIONS.map((option) => (
          <button
            key={option}
            onClick={() => setSpeed(option)}
            className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${speed === option ? "bg-surface-elevated text-primary" : "bg-surface-hover text-muted hover:bg-surface-elevated"}`}
          >
            {option}x
          </button>
        ))}
      </div>
    </div>
  );
}

function ActivityRail({ recentActivity }: { recentActivity: ReplayLaneEvent[] }) {
  return (
    <aside className="rounded-2xl border border-border bg-surface-card p-5">
      <h3 className="text-sm font-semibold text-primary">Activity Rail</h3>
      <p className="mt-1 text-xs text-muted">Merged forensic timeline at the current playhead.</p>
      <div className="mt-4 space-y-3">
        {recentActivity.map((event, index) => (
          <div
            key={`${event.lane}-${event.atMs}-${index}`}
            className="rounded-xl border border-border bg-surface-card p-3"
          >
            <div className="flex items-center justify-between gap-3 text-[10px] uppercase tracking-wider text-muted">
              <span>Lane {event.lane}</span>
              <span>{formatDuration(event.atMs)}</span>
            </div>
            <p className="mt-2 text-sm text-secondary">{describeReplayEvent(event)}</p>
            {event.type === "key" && (
              <p className="mt-2 text-xs text-muted">{formatReplayKey(event.modifiers, event.key)}</p>
            )}
          </div>
        ))}
        {recentActivity.length === 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-6 text-sm text-muted">
            No activity at this playhead yet.
          </div>
        )}
      </div>
    </aside>
  );
}

export function ForensicReplayPanel({ documentId }: Props) {
  const replayQuery = trpc.document.getForensicReplay.useQuery({ id: documentId }, { refetchOnWindowFocus: false });

  const participants = useMemo(() => {
    return (replayQuery.data?.signers ?? []).filter((signer) => signer.replay) as unknown as ReplayParticipantSummary[];
  }, [replayQuery.data]);

  const prepared = useReplaySession(participants);
  const [mode, setMode] = useState<ReplayMode>("sync");
  const [selectedSignerId, setSelectedSignerId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentMs, setCurrentMs] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { selectedLane, visibleLanes, activeDuration } = useLaneSelection(prepared, mode, selectedSignerId);
  const effectiveCurrentMs = Math.min(currentMs, activeDuration);

  usePlaybackLoop(playing, activeDuration, speed, setCurrentMs, setPlaying);

  const snapshots = useMemo(() => {
    return visibleLanes.map((lane) => ({
      lane,
      snapshot: buildReplayLaneSnapshot(lane, effectiveCurrentMs),
    }));
  }, [effectiveCurrentMs, visibleLanes]);

  useCanvasOverview({
    canvasRef,
    prepared,
    title: replayQuery.data?.title ?? "Forensic Replay",
    mode,
    activeDuration,
    effectiveCurrentMs,
    snapshots,
  });

  const recentActivity = useMemo(() => {
    const visibleLaneIds = new Set(visibleLanes.map((lane) => lane.lane));
    const source = prepared?.mergedEvents ?? [];
    return source
      .filter((event) => event.atMs <= effectiveCurrentMs && visibleLaneIds.has(event.lane))
      .slice(-6)
      .reverse();
  }, [effectiveCurrentMs, prepared?.mergedEvents, visibleLanes]);

  const exportReplayVideo = async () => {
    if (!prepared || visibleLanes.length === 0) return;
    if (typeof MediaRecorder === "undefined") {
      setExportError("Video export is not available in this browser.");
      return;
    }
    setExportError(null);
    setExporting(true);
    try {
      await exportReplayVideoToBlob({
        prepared,
        visibleLanes,
        activeDuration,
        title: replayQuery.data?.title ?? "Forensic Replay",
        mode,
        documentId,
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Failed to export replay video");
    } finally {
      setExporting(false);
    }
  };

  if (replayQuery.isLoading || !prepared) {
    return (
      <div className="rounded-2xl border border-border bg-surface-card p-6">
        <div className="h-7 w-40 animate-pulse rounded bg-surface-elevated" />
        <div className="bg-surface-hover/30 mt-4 h-64 animate-pulse rounded-xl" />
      </div>
    );
  }

  if (!replayQuery.data || prepared.lanes.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface-card p-6">
        <p className="text-sm text-secondary">
          {!replayQuery.data
            ? "Creator session required to load full forensic replay data."
            : "No deterministic replay tape was stored for this document yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5 rounded-2xl border border-border bg-surface-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-primary">Forensic Replay</h2>
          <p className="mt-1 text-sm text-muted">
            Rust-backed deterministic playback for the captured signer session lanes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${prepared.source === "wasm" ? "border-sky-400/25 bg-sky-500/10 text-sky-200" : "border-amber-400/25 bg-amber-500/10 text-amber-200"}`}
          >
            {prepared.source === "wasm" ? "Rust/WASM active" : "TS fallback active"}
          </span>
          <button
            onClick={exportReplayVideo}
            disabled={exporting}
            className="inline-flex items-center gap-2 rounded-lg bg-surface-hover px-3 py-2 text-xs text-secondary transition-colors hover:bg-surface-elevated disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Exporting..." : "Export WebM"}
          </button>
        </div>
      </div>

      <ReplayToolbar
        mode={mode}
        setMode={setMode}
        selectedLane={selectedLane}
        setSelectedSignerId={setSelectedSignerId}
        prepared={prepared}
        playing={playing}
        setPlaying={setPlaying}
        setCurrentMs={setCurrentMs}
        speed={speed}
        setSpeed={setSpeed}
      />

      <div className="space-y-3">
        <canvas ref={canvasRef} className="h-[420px] w-full rounded-2xl border border-border bg-surface-card" />
        <div className="flex items-center gap-3">
          <span className="min-w-20 text-xs font-medium text-muted">{formatDuration(effectiveCurrentMs)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, activeDuration)}
            value={Math.min(effectiveCurrentMs, Math.max(1, activeDuration))}
            onChange={(event) => {
              setPlaying(false);
              setCurrentMs(Number(event.target.value));
            }}
            className="h-2 w-full accent-[var(--accent)]"
          />
          <span className="min-w-20 text-right text-xs font-medium text-muted">{formatDuration(activeDuration)}</span>
        </div>
      </div>

      {exportError && (
        <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {exportError}
        </div>
      )}

      <div className={`grid gap-4 ${mode === "sync" ? "lg:grid-cols-2" : "lg:grid-cols-[minmax(0,1fr)_320px]"}`}>
        <div className="space-y-4">
          {snapshots.map(({ lane, snapshot }) => (
            <LaneSnapshotCard key={lane.signerId} lane={lane} snapshot={snapshot} />
          ))}
        </div>

        <ActivityRail recentActivity={recentActivity} />
      </div>
    </div>
  );
}
