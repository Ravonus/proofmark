"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Download,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  SplitSquareVertical,
  UserRound,
} from "lucide-react";
import { trpc } from "~/lib/trpc";
import {
  buildReplayLaneSnapshot,
  describeReplayEvent,
  formatReplayKey,
  prepareReplaySession,
  type PreparedReplayLane,
  type PreparedReplaySession,
  type ReplayLaneSnapshot,
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

function trim(value: string | null | undefined, max = 52) {
  if (!value) return null;
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function verdictTone(verdict?: string | null) {
  const normalized = (verdict ?? "").toLowerCase();
  if (normalized === "agent") return "text-red-300 bg-red-500/10 border-red-400/20";
  if (normalized === "mixed") return "text-amber-300 bg-amber-500/10 border-amber-400/20";
  if (normalized === "human") return "text-emerald-300 bg-emerald-500/10 border-emerald-400/20";
  return "text-secondary bg-surface-hover border-border";
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawGazeOverlay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  snapshot: ReplayLaneSnapshot,
) {
  if (!snapshot.gazeActive || snapshot.gazeTrail.length === 0) return;

  ctx.save();

  // Draw gaze trail as fading dots
  const trail = snapshot.gazeTrail;
  for (let i = 0; i < trail.length; i += 1) {
    const point = trail[i]!;
    const age = i / trail.length;
    const alpha = age * 0.5 * (point.confidence / 255);
    const radius = 2 + age * 4;
    const px = x + (point.x / 1000) * width;
    const py = y + (point.y / 1000) * height;

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(59, 130, 246, ${alpha})`;
    ctx.fill();
  }

  // Draw current gaze position
  if (snapshot.gazePosition && !snapshot.gazeTrackingLost) {
    const gx = x + (snapshot.gazePosition.x / 1000) * width;
    const gy = y + (snapshot.gazePosition.y / 1000) * height;
    const conf = snapshot.gazePosition.confidence / 255;

    const gradient = ctx.createRadialGradient(gx, gy, 0, gx, gy, 14);
    gradient.addColorStop(0, `rgba(59, 130, 246, ${0.6 * conf})`);
    gradient.addColorStop(1, "rgba(59, 130, 246, 0)");
    ctx.beginPath();
    ctx.arc(gx, gy, 14, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(gx, gy, 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(147, 197, 253, ${conf})`;
    ctx.fill();
  }

  // Active fixation ring
  if (snapshot.gazeFixation) {
    const fx = x + (snapshot.gazeFixation.x / 1000) * width;
    const fy = y + (snapshot.gazeFixation.y / 1000) * height;
    const ringRadius = 8 + Math.min(12, snapshot.gazeFixation.durationMs / 100);
    ctx.beginPath();
    ctx.arc(fx, fy, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(251, 191, 36, 0.6)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Tracking lost indicator
  if (snapshot.gazeTrackingLost) {
    ctx.fillStyle = "rgba(239, 68, 68, 0.6)";
    ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("GAZE LOST", x + 8, y + 14);
  }

  ctx.restore();
}

function drawSignaturePreview(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  snapshot: ReplayLaneSnapshot,
) {
  const rs = getComputedStyle(document.documentElement);
  drawRoundedRect(ctx, x, y, width, height, 16);
  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-sig-bg").trim() || "#0c121d";
  ctx.fill();
  ctx.strokeStyle = rs.getPropertyValue("--replay-canvas-border").trim() || "rgba(255,255,255,0.08)";
  ctx.stroke();

  const allPoints = snapshot.signatureStrokes.flat();
  if (allPoints.length === 0) {
    ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-faint").trim() || "rgba(255,255,255,0.28)";
    ctx.font = "500 16px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("No signature motion yet", x + 20, y + height / 2);
    return;
  }

  let minX = allPoints[0]!.x;
  let maxX = allPoints[0]!.x;
  let minY = allPoints[0]!.y;
  let maxY = allPoints[0]!.y;
  for (const point of allPoints) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const padding = 18;
  const scale = Math.min((width - padding * 2) / contentWidth, (height - padding * 2) / contentHeight);
  const offsetX = x + padding + (width - padding * 2 - contentWidth * scale) / 2;
  const offsetY = y + padding + (height - padding * 2 - contentHeight * scale) / 2;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#8ed3ff";
  ctx.lineWidth = 3;
  for (const stroke of snapshot.signatureStrokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(offsetX + (stroke[0]!.x - minX) * scale, offsetY + (stroke[0]!.y - minY) * scale);
    for (let index = 1; index < stroke.length; index += 1) {
      const point = stroke[index]!;
      ctx.lineTo(offsetX + (point.x - minX) * scale, offsetY + (point.y - minY) * scale);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawReplayOverview(
  canvas: HTMLCanvasElement,
  params: {
    title: string;
    mode: ReplayMode;
    source: "wasm" | "ts";
    durationMs: number;
    currentMs: number;
    lanes: Array<{ lane: PreparedReplayLane; snapshot: ReplayLaneSnapshot }>;
  },
) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(960, Math.round(rect.width || 960));
  const height = Math.max(420, Math.round(rect.height || 420));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const rs = getComputedStyle(document.documentElement);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, rs.getPropertyValue("--replay-canvas-bg").trim() || "#091018");
  gradient.addColorStop(1, rs.getPropertyValue("--replay-canvas-bg2").trim() || "#101a28");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text").trim() || "rgba(255,255,255,0.92)";
  ctx.font = "700 24px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(params.title, 28, 36);

  ctx.font = "500 13px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-dim").trim() || "rgba(255,255,255,0.54)";
  ctx.fillText(
    `Mode: ${params.mode === "sync" ? "Dual signer sync" : "Solo replay"}  |  Core: ${params.source === "wasm" ? "Rust/WASM" : "TypeScript fallback"}`,
    28,
    58,
  );

  const progress = params.durationMs > 0 ? Math.min(1, params.currentMs / params.durationMs) : 0;
  drawRoundedRect(ctx, 28, 74, width - 56, 12, 6);
  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-track").trim() || "rgba(255,255,255,0.08)";
  ctx.fill();
  drawRoundedRect(ctx, 28, 74, (width - 56) * progress, 12, 6);
  ctx.fillStyle = "#5ac8fa";
  ctx.fill();

  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-label").trim() || "rgba(255,255,255,0.8)";
  ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`${formatDuration(params.currentMs)} / ${formatDuration(params.durationMs)}`, width - 200, 58);

  const cards = params.lanes.length === 0 ? 1 : params.lanes.length;
  const gutter = 20;
  const cardWidth = (width - 56 - gutter * (cards - 1)) / cards;
  const cardHeight = height - 126;

  params.lanes.forEach(({ lane, snapshot }, index) => {
    const cardX = 28 + index * (cardWidth + gutter);
    const cardY = 104;

    drawRoundedRect(ctx, cardX, cardY, cardWidth, cardHeight, 20);
    ctx.fillStyle = rs.getPropertyValue("--replay-canvas-card").trim() || "rgba(8,10,16,0.62)";
    ctx.fill();
    ctx.strokeStyle = rs.getPropertyValue("--replay-canvas-border").trim() || "rgba(255,255,255,0.08)";
    ctx.stroke();

    ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text").trim() || "rgba(255,255,255,0.92)";
    ctx.font = "700 18px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(lane.label, cardX + 18, cardY + 28);

    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle =
      lane.automationReview?.verdict === "agent"
        ? "#fca5a5"
        : lane.automationReview?.verdict === "human"
          ? "#86efac"
          : "#fcd34d";
    ctx.fillText((lane.automationReview?.verdict ?? "uncertain").toUpperCase(), cardX + cardWidth - 110, cardY + 28);

    ctx.font = "500 12px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-dim").trim() || "rgba(255,255,255,0.6)";
    ctx.fillText(describeReplayEvent(snapshot.currentEvent), cardX + 18, cardY + 50, cardWidth - 36);

    ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-muted").trim() || "rgba(255,255,255,0.45)";
    ctx.fillText(`Events: ${snapshot.elapsedEventCount}/${lane.eventCount}`, cardX + 18, cardY + 74);
    ctx.fillText(`Scroll: ${Math.round(snapshot.scrollRatio * 100)}%`, cardX + cardWidth - 120, cardY + 74);

    drawRoundedRect(ctx, cardX + 18, cardY + 94, 18, cardHeight - 130, 8);
    ctx.fillStyle = rs.getPropertyValue("--replay-canvas-track").trim() || "rgba(255,255,255,0.08)";
    ctx.fill();
    const scrollHeight = (cardHeight - 130) * Math.max(0.12, snapshot.scrollRatio || 0.12);
    drawRoundedRect(
      ctx,
      cardX + 18,
      cardY + 94 + (cardHeight - 130 - scrollHeight) * snapshot.scrollRatio,
      18,
      scrollHeight,
      8,
    );
    ctx.fillStyle = "#93c5fd";
    ctx.fill();

    drawSignaturePreview(ctx, cardX + 50, cardY + 94, cardWidth - 68, 140, snapshot);

    // Draw gaze overlay on the signature preview area (shared coordinate space)
    drawGazeOverlay(ctx, cardX + 50, cardY + 94, cardWidth - 68, 140, snapshot);

    ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-label").trim() || "rgba(255,255,255,0.78)";
    ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(`Page ${snapshot.page}/${Math.max(1, snapshot.totalPages)}`, cardX + 18, cardY + 262);
    ctx.fillText(`Target: ${trim(snapshot.currentTarget, 32) ?? "None"}`, cardX + 18, cardY + 284, cardWidth - 36);
    ctx.fillText(`Focus: ${trim(snapshot.focusedTarget, 32) ?? "None"}`, cardX + 18, cardY + 306, cardWidth - 36);
    ctx.fillText(
      `Highlight: ${trim(snapshot.highlightedLabel, 32) ?? "None"}`,
      cardX + 18,
      cardY + 328,
      cardWidth - 36,
    );

    const metrics = lane.signatureMotion;
    ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-muted").trim() || "rgba(255,255,255,0.52)";
    ctx.font = "500 12px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(
      metrics
        ? `Signature: ${metrics.strokeCount} strokes, ${metrics.directionChangeCount} turns, uniformity ${(metrics.motionUniformityScore * 100).toFixed(0)}%`
        : "Signature: no motion analysis",
      cardX + 18,
      cardY + 358,
      cardWidth - 36,
    );
  });
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ForensicReplayPanel({ documentId }: Props) {
  const replayQuery = trpc.document.getForensicReplay.useQuery({ id: documentId }, { refetchOnWindowFocus: false });

  const participants = useMemo(() => {
    return (replayQuery.data?.signers ?? []).filter((signer) => signer.replay) as unknown as ReplayParticipantSummary[];
  }, [replayQuery.data]);

  const [prepared, setPrepared] = useState<PreparedReplaySession | null>(null);
  const [mode, setMode] = useState<ReplayMode>("sync");
  const [selectedSignerId, setSelectedSignerId] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [currentMs, setCurrentMs] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

  useEffect(() => {
    if (!selectedSignerId && prepared?.lanes[0]) {
      setSelectedSignerId(prepared.lanes[0].signerId);
    }
  }, [prepared, selectedSignerId]);

  const selectedLane = useMemo(
    () => prepared?.lanes.find((lane) => lane.signerId === selectedSignerId) ?? prepared?.lanes[0] ?? null,
    [prepared, selectedSignerId],
  );

  const visibleLanes = useMemo(() => {
    if (!prepared) return [];
    if (mode === "sync") return prepared.lanes.slice(0, 2);
    return selectedLane ? [selectedLane] : [];
  }, [mode, prepared, selectedLane]);

  const activeDuration =
    mode === "sync" ? (prepared?.durationMs ?? 0) : (selectedLane?.durationMs ?? prepared?.durationMs ?? 0);

  useEffect(() => {
    setCurrentMs((value) => Math.min(value, activeDuration));
  }, [activeDuration]);

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
  }, [activeDuration, playing, speed]);

  const snapshots = useMemo(() => {
    return visibleLanes.map((lane) => ({
      lane,
      snapshot: buildReplayLaneSnapshot(lane, currentMs),
    }));
  }, [currentMs, visibleLanes]);

  useEffect(() => {
    if (!canvasRef.current || !prepared) return;
    drawReplayOverview(canvasRef.current, {
      title: replayQuery.data?.title ?? "Forensic Replay",
      mode,
      source: prepared.source,
      durationMs: activeDuration,
      currentMs,
      lanes: snapshots,
    });
  }, [activeDuration, currentMs, mode, prepared, replayQuery.data?.title, snapshots]);

  const recentActivity = useMemo(() => {
    const visibleLaneIds = new Set(visibleLanes.map((lane) => lane.lane));
    const source = prepared?.mergedEvents ?? [];
    return source
      .filter((event) => event.atMs <= currentMs && visibleLaneIds.has(event.lane))
      .slice(-6)
      .reverse();
  }, [currentMs, prepared?.mergedEvents, visibleLanes]);

  const exportReplayVideo = async () => {
    if (!prepared || visibleLanes.length === 0) return;
    if (typeof MediaRecorder === "undefined") {
      setExportError("Video export is not available in this browser.");
      return;
    }

    setExportError(null);
    setExporting(true);

    try {
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
          title: replayQuery.data?.title ?? "Forensic Replay",
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

  if (!replayQuery.data) {
    return (
      <div className="rounded-2xl border border-border bg-surface-card p-6">
        <p className="text-sm text-secondary">Creator session required to load full forensic replay data.</p>
      </div>
    );
  }

  if (prepared.lanes.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface-card p-6">
        <p className="text-sm text-secondary">No deterministic replay tape was stored for this document yet.</p>
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

      <div className="space-y-3">
        <canvas ref={canvasRef} className="h-[420px] w-full rounded-2xl border border-border bg-surface-card" />
        <div className="flex items-center gap-3">
          <span className="min-w-20 text-xs font-medium text-muted">{formatDuration(currentMs)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(1, activeDuration)}
            value={Math.min(currentMs, Math.max(1, activeDuration))}
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
            <div key={lane.signerId} className="rounded-2xl border border-border bg-surface-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-primary">{lane.label}</h3>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${verdictTone(lane.automationReview?.verdict)}`}
                    >
                      {(lane.automationReview?.verdict ?? "uncertain").toUpperCase()}
                    </span>
                    {lane.policyOutcome?.blocked && (
                      <span className="rounded-full border border-red-400/20 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold text-red-200">
                        BLOCKED
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm text-muted">{describeReplayEvent(snapshot.currentEvent)}</p>
                </div>
                <div className="text-right text-xs text-muted">
                  <div>
                    {snapshot.elapsedEventCount}/{lane.eventCount} events
                  </div>
                  <div>{formatDuration(snapshot.durationMs)} total</div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-xl border border-border bg-surface-card p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Current Target</p>
                  <p className="mt-2 text-sm text-primary">{trim(snapshot.currentTarget, 44) ?? "None"}</p>
                </div>
                <div className="rounded-xl border border-border bg-surface-card p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Scroll / Page</p>
                  <p className="mt-2 text-sm text-primary">
                    {Math.round(snapshot.scrollRatio * 100)}% · {snapshot.page}/{Math.max(1, snapshot.totalPages)}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-surface-card p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Signature Motion</p>
                  <p className="mt-2 text-sm text-primary">
                    {lane.signatureMotion
                      ? `${lane.signatureMotion.strokeCount} strokes · ${lane.signatureMotion.directionChangeCount} turns`
                      : "Not available"}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-surface-card p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Eye Tracking</p>
                  <p className="mt-2 text-sm text-primary">
                    {snapshot.gazeActive
                      ? `${snapshot.gazeTrail.length} pts · ${snapshot.gazeBlinkCount} blinks${snapshot.gazeTrackingLost ? " · LOST" : ""}`
                      : "Not active"}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-surface-card p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Storage / Policy</p>
                  <p className="mt-2 text-sm text-primary">
                    {(lane.storage?.mode ?? "embedded_pdf").replace(/_/g, " ")} ·{" "}
                    {lane.policyOutcome?.action ?? "ALLOW"}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                <div className="rounded-xl border border-border bg-surface-card p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Recent Keys</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {snapshot.recentKeys.length > 0 ? (
                      snapshot.recentKeys.map((value, index) => (
                        <span
                          key={`${lane.signerId}-key-${index}`}
                          className="rounded-md bg-surface-hover px-2 py-1 text-xs text-secondary"
                        >
                          {value}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-muted">No keystrokes in current window.</span>
                    )}
                  </div>

                  <div className="mt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Clipboard / Fields</p>
                    <div className="mt-3 space-y-2 text-xs text-secondary">
                      {snapshot.recentClipboard.map((entry, index) => (
                        <div key={`${lane.signerId}-clipboard-${index}`} className="flex justify-between gap-3">
                          <span>{entry.action}</span>
                          <span className="truncate text-right text-muted">{trim(entry.summary, 44)}</span>
                        </div>
                      ))}
                      {snapshot.recentFields.map((entry, index) => (
                        <div key={`${lane.signerId}-field-${index}`} className="flex justify-between gap-3">
                          <span>{trim(entry.target, 22) ?? "field"}</span>
                          <span className="truncate text-right text-muted">{trim(entry.value, 36)}</span>
                        </div>
                      ))}
                      {snapshot.recentClipboard.length === 0 && snapshot.recentFields.length === 0 && (
                        <div className="text-muted">No recent clipboard or field commits.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-surface-card p-4">
                  <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {lane.automationReview?.verdict === "agent" ? (
                      <Bot className="h-3.5 w-3.5 text-red-300" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-sky-300" />
                    )}
                    AI + Signature Summary
                  </p>
                  <div className="mt-3 space-y-2 text-xs text-secondary">
                    <div className="flex justify-between gap-3">
                      <span>Verdict</span>
                      <span>{lane.automationReview?.verdict ?? "uncertain"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Confidence</span>
                      <span>{Math.round((lane.automationReview?.confidence ?? 0) * 100)}%</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Automation score</span>
                      <span>{(lane.automationReview?.automationScore ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Motion uniformity</span>
                      <span>
                        {lane.signatureMotion
                          ? `${Math.round(lane.signatureMotion.motionUniformityScore * 100)}%`
                          : "n/a"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Motion complexity</span>
                      <span>
                        {lane.signatureMotion
                          ? `${Math.round(lane.signatureMotion.motionComplexityScore * 100)}%`
                          : "n/a"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Max pause</span>
                      <span>{lane.signatureMotion ? `${Math.round(lane.signatureMotion.maxPauseMs)}ms` : "n/a"}</span>
                    </div>
                    {lane.policyOutcome?.blocked ? (
                      <div className="mt-3 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-red-200">
                        <div className="flex items-center gap-2 font-semibold">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          Policy blocked this signer
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-red-200/85">{lane.policyOutcome.reason}</p>
                      </div>
                    ) : (
                      <p className="mt-3 text-[11px] leading-relaxed text-muted">
                        {lane.automationReview?.rationale ?? "No AI rationale stored for this lane."}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

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
      </div>
    </div>
  );
}
