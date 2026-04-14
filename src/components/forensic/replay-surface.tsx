"use client";

import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type ActiveStroke,
  type PlaybackState,
  type SceneSnapshot,
  TSMultiSignerController,
  TSPlaybackController,
} from "~/lib/forensic/playback-controller";
import { decodeReplayEventsSync } from "~/lib/forensic/replay-codec";
import type { ForensicReplayTape } from "~/lib/forensic/types";

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

function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: ActiveStroke,
  color: string,
  scaleX: number,
  scaleY: number,
) {
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

function drawScrollIndicator(
  ctx: CanvasRenderingContext2D,
  snap: SceneSnapshot,
  canvasWidth: number,
  canvasHeight: number,
  color: string,
) {
  if (snap.scrollMax <= 0) return;
  const ratio = Math.min(1, snap.scrollY / snap.scrollMax);
  const barHeight = canvasHeight * 0.6;
  const barWidth = 4;
  const barX = canvasWidth - 12;
  const barY = (canvasHeight - barHeight) / 2;

  ctx.fillStyle =
    getComputedStyle(document.documentElement).getPropertyValue("--replay-canvas-track").trim() ||
    "rgba(255,255,255,0.1)";
  ctx.fillRect(barX, barY, barWidth, barHeight);

  const thumbHeight = Math.max(8, barHeight * 0.1);
  const thumbY = barY + ratio * (barHeight - thumbHeight);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.fillRect(barX, thumbY, barWidth, thumbHeight);
  ctx.globalAlpha = 1;
}

function drawPageIndicator(
  ctx: CanvasRenderingContext2D,
  snap: SceneSnapshot,
  canvasWidth: number,
  canvasHeight: number,
) {
  if (snap.totalPages <= 1) return;
  const text = `${snap.page}/${snap.totalPages}`;
  ctx.font = "11px monospace";
  ctx.fillStyle =
    getComputedStyle(document.documentElement).getPropertyValue("--replay-canvas-text-dim").trim() ||
    "rgba(255,255,255,0.5)";
  ctx.textAlign = "center";
  ctx.fillText(text, canvasWidth / 2, canvasHeight - 8);
}

type DrawLaneParams = {
  ctx: CanvasRenderingContext2D;
  snap: SceneSnapshot;
  color: string;
  signer: SignerInput | undefined;
  docW: number;
  docH: number;
  docPadding: number;
  canvasWidth: number;
  canvasHeight: number;
  rootStyles: CSSStyleDeclaration;
};

function drawLane({
  ctx,
  snap,
  color,
  signer,
  docW,
  docH,
  docPadding,
  canvasWidth,
  canvasHeight,
  rootStyles,
}: DrawLaneParams) {
  const vp = signer?.replay.viewport;
  const scaleX = vp ? docW / vp.width : 1;
  const scaleY = vp ? docH / vp.height : 1;

  for (const stroke of snap.activeStrokes) {
    drawStroke(ctx, stroke, color, scaleX, scaleY);
  }

  drawScrollIndicator(ctx, snap, canvasWidth, docH + docPadding, color);
  drawPageIndicator(ctx, snap, canvasWidth, docH + docPadding);

  if (snap.hidden) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(docPadding, docPadding, docW, docH);
    ctx.font = "14px monospace";
    ctx.fillStyle = rootStyles.getPropertyValue("--replay-canvas-text-dim").trim() || "rgba(255,255,255,0.4)";
    ctx.textAlign = "center";
    ctx.fillText("Tab Hidden", canvasWidth / 2, canvasHeight / 2 - 24);
  }
}

function ReplayControls({
  state,
  cursorMs,
  durationMs,
  speed,
  signers,
  activeLane,
  onSkip,
  onPlay,
  onReset,
  onSeek,
  onSpeedCycle,
  onLaneToggle,
  onLaneClear,
}: {
  state: PlaybackState;
  cursorMs: number;
  durationMs: number;
  speed: number;
  signers: SignerInput[];
  activeLane: number | null;
  onSkip: (direction: number) => void;
  onPlay: () => void;
  onReset: () => void;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSpeedCycle: () => void;
  onLaneToggle: (lane: number) => void;
  onLaneClear: () => void;
}) {
  return (
    <>
      {/* Controls bar */}
      <div className="flex items-center gap-2 px-2">
        <button onClick={() => onSkip(-1)} className="p-1 text-secondary hover:text-primary" title="Back 5s">
          <SkipBack size={16} />
        </button>
        <button
          onClick={onPlay}
          className="p-1 text-primary hover:text-primary"
          title={state === "playing" ? "Pause" : "Play"}
        >
          {state === "playing" ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button onClick={() => onSkip(1)} className="p-1 text-secondary hover:text-primary" title="Forward 5s">
          <SkipForward size={16} />
        </button>
        <button onClick={onReset} className="p-1 text-secondary hover:text-primary" title="Reset">
          <RotateCcw size={14} />
        </button>

        <input
          type="range"
          min={0}
          max={durationMs}
          value={cursorMs}
          onChange={onSeek}
          className="h-1 flex-1 cursor-pointer accent-blue-500"
        />

        <span className="min-w-[72px] text-right font-mono text-[11px] tabular-nums text-muted">
          {formatTime(cursorMs)} / {formatTime(durationMs)}
        </span>

        <button
          onClick={onSpeedCycle}
          className="px-1 font-mono text-[11px] text-muted hover:text-primary"
          title="Change speed"
        >
          {speed}x
        </button>
      </div>

      {/* Lane selector (multi-signer) */}
      {signers.length > 1 && (
        <div className="flex gap-2 px-2">
          <button
            onClick={onLaneClear}
            className={`rounded px-2 py-0.5 font-mono text-[10px] ${activeLane === null ? "bg-surface-elevated text-primary" : "text-muted hover:text-secondary"}`}
          >
            All
          </button>
          {signers.map((s) => (
            <button
              key={s.lane}
              onClick={() => onLaneToggle(s.lane)}
              className={`rounded px-2 py-0.5 font-mono text-[10px] ${activeLane === s.lane ? "text-primary" : "text-muted hover:text-secondary"}`}
              style={activeLane === s.lane ? { backgroundColor: laneColor(s.lane) + "33" } : undefined}
            >
              <span style={{ color: laneColor(s.lane) }}>●</span> {s.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function useAnimationLoop(params: {
  controllerRef: React.RefObject<TSMultiSignerController | null>;
  lastTickRef: React.RefObject<number>;
  rafRef: React.RefObject<number>;
  draw: () => void;
  setCursorMs: React.Dispatch<React.SetStateAction<number>>;
  setState: React.Dispatch<React.SetStateAction<PlaybackState>>;
  onTimeUpdate?: (ms: number) => void;
  onStateChange?: (state: PlaybackState) => void;
}) {
  const { controllerRef, lastTickRef, rafRef, draw, setCursorMs, setState, onTimeUpdate, onStateChange } = params;

  const loop = useCallback(() => {
    const now = performance.now();
    const dt = now - lastTickRef.current;
    lastTickRef.current = now;

    const ctrl = controllerRef.current;
    if (ctrl?.state === "playing") {
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
  }, [controllerRef, lastTickRef, rafRef, draw, setCursorMs, setState, onTimeUpdate, onStateChange]);

  useEffect(() => {
    lastTickRef.current = performance.now();
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [lastTickRef, rafRef, loop]);
}

function usePlayHandler(params: {
  controllerRef: React.RefObject<TSMultiSignerController | null>;
  lastTickRef: React.RefObject<number>;
  speed: number;
  setState: React.Dispatch<React.SetStateAction<PlaybackState>>;
  onStateChange?: (state: PlaybackState) => void;
}) {
  const { controllerRef, lastTickRef, speed, setState, onStateChange } = params;
  return useCallback(() => {
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
  }, [controllerRef, lastTickRef, speed, setState, onStateChange]);
}

function usePlaybackController(signers: SignerInput[]) {
  const controllerRef = useRef<TSMultiSignerController | null>(null);
  const controller = useMemo(() => {
    const controllers = signers.map((s) => {
      const events = s.replay.tapeBase64 ? decodeReplayEventsSync(s.replay.tapeBase64) : [];
      return new TSPlaybackController(events, s.lane);
    });
    const multi = new TSMultiSignerController(controllers);
    controllerRef.current = multi;
    return multi;
  }, [signers]);
  return { controller, controllerRef };
}

export function ReplaySurface({ signers, width = 640, height = 480, onTimeUpdate, onStateChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef(0);

  const [state, setState] = useState<PlaybackState>("idle");
  const [cursorMs, setCursorMs] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [activeLane, setActiveLane] = useState<number | null>(null);

  const speed = SPEEDS[speedIndex]!;
  const { controller, controllerRef } = usePlaybackController(signers);
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

    const docPadding = 16;
    const docW = width - docPadding * 2;
    const docH = height - docPadding * 2 - 48;
    ctx.fillStyle = rootStyles.getPropertyValue("--replay-surface-doc").trim() || "#1e293b";
    ctx.fillRect(docPadding, docPadding, docW, docH);

    const ctrl = controllerRef.current;
    if (!ctrl) return;

    const visibleSnapshots = [...ctrl.snapshots()].filter(([lane]) => activeLane === null || activeLane === lane);

    for (const [lane, snap] of visibleSnapshots) {
      drawLane({
        ctx,
        snap,
        color: laneColor(lane),
        signer: signers.find((s) => s.lane === lane),
        docW,
        docH,
        docPadding,
        canvasWidth: width,
        canvasHeight: height,
        rootStyles,
      });
    }

    const labelY = docH + docPadding + 20;
    const visibleSigners = signers.filter((s) => activeLane === null || activeLane === s.lane);
    for (const signer of visibleSigners) {
      ctx.fillStyle = laneColor(signer.lane);
      ctx.font = "11px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`● ${signer.label}`, docPadding + signer.lane * 120, labelY);
    }
  }, [width, height, signers, activeLane]);

  useAnimationLoop({
    controllerRef,
    lastTickRef,
    rafRef,
    draw,
    setCursorMs,
    setState,
    onTimeUpdate,
    onStateChange,
  });

  const handlePlay = usePlayHandler({
    controllerRef,
    lastTickRef,
    speed,
    setState,
    onStateChange,
  });

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
      <canvas ref={canvasRef} style={{ width, height, borderRadius: 8 }} className="border border-border" />

      <ReplayControls
        state={state}
        cursorMs={cursorMs}
        durationMs={durationMs}
        speed={speed}
        signers={signers}
        activeLane={activeLane}
        onSkip={handleSkip}
        onPlay={handlePlay}
        onReset={handleReset}
        onSeek={handleSeek}
        onSpeedCycle={handleSpeedCycle}
        onLaneToggle={handleLaneToggle}
        onLaneClear={() => setActiveLane(null)}
      />
    </div>
  );
}
