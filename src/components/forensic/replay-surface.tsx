"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import type { ForensicReplayTape } from "~/lib/forensic/types";
import {
  TSPlaybackController,
  TSMultiSignerController,
  type PlaybackState,
  type SceneSnapshot,
  type ActiveStroke,
} from "~/lib/forensic/playback-controller";
import { decodeReplayEventsSync } from "~/lib/forensic/replay-codec";

type SignerInput = {
  signerId: string;
  label: string;
  replay: ForensicReplayTape;
  lane: number;
};

type Props = {
  signers: SignerInput[];
  width?: number;
  height?: number;
  onTimeUpdate?: (ms: number) => void;
  onStateChange?: (state: PlaybackState) => void;
};

const SPEEDS = [0.5, 1, 2, 4];

function formatTime(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

function laneColor(lane: number): string {
  const colors = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#8b5cf6", "#06b6d4"];
  return colors[lane % colors.length]!;
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: ActiveStroke, color: string, scaleX: number, scaleY: number) {
  if (stroke.points.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const first = stroke.points[0]!;
  ctx.moveTo(first.x * scaleX, first.y * scaleY);
  for (let i = 1; i < stroke.points.length; i++) {
    const pt = stroke.points[i]!;
    ctx.lineTo(pt.x * scaleX, pt.y * scaleY);
  }
  ctx.stroke();
}

function drawScrollIndicator(ctx: CanvasRenderingContext2D, snap: SceneSnapshot, canvasWidth: number, canvasHeight: number, color: string) {
  if (snap.scrollMax <= 0) return;
  const ratio = Math.min(1, snap.scrollY / snap.scrollMax);
  const barHeight = canvasHeight * 0.6;
  const barWidth = 4;
  const barX = canvasWidth - 12;
  const barY = (canvasHeight - barHeight) / 2;

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--replay-canvas-track").trim() || "rgba(255,255,255,0.1)";
  ctx.fillRect(barX, barY, barWidth, barHeight);

  const thumbHeight = Math.max(8, barHeight * 0.1);
  const thumbY = barY + ratio * (barHeight - thumbHeight);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.fillRect(barX, thumbY, barWidth, thumbHeight);
  ctx.globalAlpha = 1;
}

function drawPageIndicator(ctx: CanvasRenderingContext2D, snap: SceneSnapshot, canvasWidth: number, canvasHeight: number) {
  if (snap.totalPages <= 1) return;
  const text = `${snap.page}/${snap.totalPages}`;
  ctx.font = "11px monospace";
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--replay-canvas-text-dim").trim() || "rgba(255,255,255,0.5)";
  ctx.textAlign = "center";
  ctx.fillText(text, canvasWidth / 2, canvasHeight - 8);
}

export function ReplaySurface({ signers, width = 640, height = 480, onTimeUpdate, onStateChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<TSMultiSignerController | null>(null);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef(0);

  const [state, setState] = useState<PlaybackState>("idle");
  const [cursorMs, setCursorMs] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [activeLane, setActiveLane] = useState<number | null>(null);

  const speed = SPEEDS[speedIndex]!;

  const controller = useMemo(() => {
    const controllers = signers.map((s) => {
      const events = s.replay.tapeBase64 ? decodeReplayEventsSync(s.replay.tapeBase64) : [];
      return new TSPlaybackController(events, s.lane);
    });
    const multi = new TSMultiSignerController(controllers);
    controllerRef.current = multi;
    return multi;
  }, [signers]);

  const durationMs = controller.durationMs;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const rootStyles = getComputedStyle(document.documentElement);
    ctx.fillStyle = rootStyles.getPropertyValue("--replay-surface-bg").trim() || "#0f172a";
    ctx.fillRect(0, 0, width, height);

    // Document area
    const docPadding = 16;
    const docW = width - docPadding * 2;
    const docH = height - docPadding * 2 - 48; // leave room for controls
    ctx.fillStyle = rootStyles.getPropertyValue("--replay-surface-doc").trim() || "#1e293b";
    ctx.fillRect(docPadding, docPadding, docW, docH);

    const ctrl = controllerRef.current;
    if (!ctrl) return;

    const snapshots = ctrl.snapshots();

    for (const [lane, snap] of snapshots) {
      if (activeLane !== null && activeLane !== lane) continue;
      const color = laneColor(lane);

      // Scale factors — assume first signer viewport as reference
      const signer = signers.find((s) => s.lane === lane);
      const vp = signer?.replay.viewport;
      const scaleX = vp ? docW / vp.width : 1;
      const scaleY = vp ? docH / vp.height : 1;

      // Draw active signature strokes
      for (const stroke of snap.activeStrokes) {
        drawStroke(ctx, stroke, color, scaleX, scaleY);
      }

      // Draw scroll indicator
      drawScrollIndicator(ctx, snap, width, docH + docPadding, color);

      // Draw page indicator
      drawPageIndicator(ctx, snap, width, docH + docPadding);

      // Hidden indicator
      if (snap.hidden) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(docPadding, docPadding, docW, docH);
        ctx.font = "14px monospace";
        ctx.fillStyle = rootStyles.getPropertyValue("--replay-canvas-text-dim").trim() || "rgba(255,255,255,0.4)";
        ctx.textAlign = "center";
        ctx.fillText("Tab Hidden", width / 2, height / 2 - 24);
      }
    }

    // Lane labels
    let labelY = docH + docPadding + 20;
    for (const signer of signers) {
      if (activeLane !== null && activeLane !== signer.lane) continue;
      const color = laneColor(signer.lane);
      ctx.fillStyle = color;
      ctx.font = "11px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`● ${signer.label}`, docPadding + (signer.lane * 120), labelY);
    }
  }, [width, height, signers, activeLane]);

  const loop = useCallback(() => {
    const now = performance.now();
    const dt = now - lastTickRef.current;
    lastTickRef.current = now;

    const ctrl = controllerRef.current;
    if (ctrl && ctrl.state === "playing") {
      ctrl.tick(Math.round(dt));
      const nextCursorMs = ctrl.cursorMs;
      setCursorMs(nextCursorMs);
      onTimeUpdate?.(nextCursorMs);

      if (nextCursorMs >= ctrl.durationMs) {
        setState("ended");
        onStateChange?.("ended");
      }
    }

    draw();
    rafRef.current = requestAnimationFrame(loop);
  }, [draw, onTimeUpdate, onStateChange]);

  useEffect(() => {
    lastTickRef.current = performance.now();
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [loop]);

  const handlePlay = () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    if (ctrl.state === "playing") {
      ctrl.pause();
      setState("paused");
      onStateChange?.("paused");
    } else {
      ctrl.setSpeed(speed);
      if (ctrl.state === "ended" || ctrl.state === "idle") ctrl.play();
      else ctrl.resume();
      setState("playing");
      onStateChange?.("playing");
      lastTickRef.current = performance.now();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const ms = parseInt(e.target.value, 10);
    controllerRef.current?.seek(ms);
    setCursorMs(ms);
    onTimeUpdate?.(ms);
  };

  const handleReset = () => {
    controllerRef.current?.seek(0);
    setCursorMs(0);
    setState("paused");
    onStateChange?.("paused");
  };

  const handleSpeedCycle = () => {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    controllerRef.current?.setSpeed(SPEEDS[next]!);
  };

  const handleSkip = (direction: number) => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    const target = Math.max(0, Math.min(ctrl.durationMs, ctrl.cursorMs + direction * 5000));
    ctrl.seek(target);
    setCursorMs(target);
    onTimeUpdate?.(target);
  };

  const handleLaneToggle = (lane: number) => {
    setActiveLane((prev) => (prev === lane ? null : lane));
  };

  return (
    <div className="flex flex-col gap-2" style={{ width }}>
      <canvas
        ref={canvasRef}
        style={{ width, height, borderRadius: 8 }}
        className="border border-border"
      />

      {/* Controls bar */}
      <div className="flex items-center gap-2 px-2">
        <button onClick={() => handleSkip(-1)} className="p-1 text-secondary hover:text-primary" title="Back 5s">
          <SkipBack size={16} />
        </button>
        <button onClick={handlePlay} className="p-1 text-primary hover:text-primary" title={state === "playing" ? "Pause" : "Play"}>
          {state === "playing" ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button onClick={() => handleSkip(1)} className="p-1 text-secondary hover:text-primary" title="Forward 5s">
          <SkipForward size={16} />
        </button>
        <button onClick={handleReset} className="p-1 text-secondary hover:text-primary" title="Reset">
          <RotateCcw size={14} />
        </button>

        <input
          type="range"
          min={0}
          max={durationMs}
          value={cursorMs}
          onChange={handleSeek}
          className="flex-1 h-1 accent-blue-500 cursor-pointer"
        />

        <span className="text-[11px] text-muted font-mono tabular-nums min-w-[72px] text-right">
          {formatTime(cursorMs)} / {formatTime(durationMs)}
        </span>

        <button onClick={handleSpeedCycle} className="text-[11px] text-muted hover:text-primary font-mono px-1" title="Change speed">
          {speed}x
        </button>
      </div>

      {/* Lane selector (multi-signer) */}
      {signers.length > 1 && (
        <div className="flex gap-2 px-2">
          <button
            onClick={() => setActiveLane(null)}
            className={`text-[10px] px-2 py-0.5 rounded font-mono ${activeLane === null ? "bg-surface-elevated text-primary" : "text-muted hover:text-secondary"}`}
          >
            All
          </button>
          {signers.map((s) => (
            <button
              key={s.lane}
              onClick={() => handleLaneToggle(s.lane)}
              className={`text-[10px] px-2 py-0.5 rounded font-mono ${activeLane === s.lane ? "text-primary" : "text-muted hover:text-secondary"}`}
              style={activeLane === s.lane ? { backgroundColor: laneColor(s.lane) + "33" } : undefined}
            >
              <span style={{ color: laneColor(s.lane) }}>●</span> {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
