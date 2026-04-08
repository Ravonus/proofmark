"use client";

import { ChevronDown, ChevronUp, Lock, Pause, Play, RotateCcw, SkipBack, SkipForward, Unlock } from "lucide-react";
import type { ReplayState } from "./replay-document-helpers";
import { formatTime, laneColor, TQ } from "./replay-document-helpers";
import { ReplayTimeline, type SignerData, type VisibleReplayState } from "./replay-document-parts";

type ReplayControlsProps = {
  barMinimized: boolean;
  setBarMinimized: (fn: (prev: boolean) => boolean) => void;
  effectiveCursorMs: number;
  durationMs: number;
  playing: boolean;
  speed: number;
  speedIndex: number;
  followEnabled: boolean;
  activeSignerIndex: number | null;
  activeState: ReplayState | null;
  signers: SignerData[];
  visibleStates: VisibleReplayState[];
  onPlayPause: () => void;
  onSeek: (ms: number) => void;
  onRestart: () => void;
  onCycleSpeed: () => void;
  onToggleFollow: () => void;
};

export function ReplayControls({
  barMinimized,
  setBarMinimized,
  effectiveCursorMs,
  durationMs,
  playing,
  speed,
  followEnabled,
  activeSignerIndex,
  activeState,
  signers,
  visibleStates,
  onPlayPause,
  onSeek,
  onRestart,
  onCycleSpeed,
  onToggleFollow,
}: ReplayControlsProps) {
  return (
    <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-40 flex justify-center px-4 pb-4">
      <div
        className="glass-card pointer-events-auto flex w-full max-w-4xl flex-col rounded-2xl border border-border shadow-2xl"
        style={{
          backdropFilter: "blur(20px)",
          background: "var(--glass-bg)",
        }}
      >
        <button
          onClick={() => setBarMinimized((v) => !v)}
          className="text-muted/60 flex w-full items-center justify-center gap-2 px-4 py-1.5 text-[10px] transition-colors hover:text-muted"
        >
          {barMinimized ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          <span>{barMinimized ? "Show controls" : ""}</span>
          {barMinimized && (
            <span className="font-medium text-secondary">
              {formatTime(effectiveCursorMs)} / {formatTime(durationMs)}
            </span>
          )}
        </button>

        {!barMinimized && (
          <ControlsBody
            effectiveCursorMs={effectiveCursorMs}
            durationMs={durationMs}
            playing={playing}
            speed={speed}
            followEnabled={followEnabled}
            activeSignerIndex={activeSignerIndex}
            activeState={activeState}
            signers={signers}
            visibleStates={visibleStates}
            onPlayPause={onPlayPause}
            onSeek={onSeek}
            onRestart={onRestart}
            onCycleSpeed={onCycleSpeed}
            onToggleFollow={onToggleFollow}
          />
        )}
      </div>
    </div>
  );
}

function ControlsBody({
  effectiveCursorMs,
  durationMs,
  playing,
  speed,
  followEnabled,
  activeSignerIndex,
  activeState,
  signers,
  visibleStates,
  onPlayPause,
  onSeek,
  onRestart,
  onCycleSpeed,
  onToggleFollow,
}: Omit<ReplayControlsProps, "barMinimized" | "setBarMinimized" | "speedIndex">) {
  return (
    <div className="flex flex-col gap-3 px-4 pb-3">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onSeek(effectiveCursorMs - 5000)}
          className="rounded-xl bg-surface-elevated p-2 text-secondary transition-colors hover:text-primary"
          aria-label="Back 5 seconds"
        >
          <SkipBack className="h-4 w-4" />
        </button>
        <button
          onClick={onPlayPause}
          className="rounded-xl bg-accent p-2 text-white transition-colors hover:bg-accent-hover"
          aria-label={playing ? "Pause replay" : "Play replay"}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          onClick={() => onSeek(effectiveCursorMs + 5000)}
          className="rounded-xl bg-surface-elevated p-2 text-secondary transition-colors hover:text-primary"
          aria-label="Forward 5 seconds"
        >
          <SkipForward className="h-4 w-4" />
        </button>
        <button
          onClick={onRestart}
          className="rounded-xl bg-surface-elevated p-2 text-secondary transition-colors hover:text-primary"
          aria-label="Restart replay"
        >
          <RotateCcw className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={Math.max(durationMs, 1)}
            step={Math.max(100, TQ)}
            value={effectiveCursorMs}
            onChange={(event) => onSeek(Number(event.target.value))}
            className="w-full accent-[var(--accent)]"
          />
        </div>

        <button
          onClick={onCycleSpeed}
          className="rounded-xl bg-surface-elevated px-3 py-2 text-xs font-semibold text-secondary transition-colors hover:text-primary"
        >
          {speed}x
        </button>

        <button
          onClick={onToggleFollow}
          className={`rounded-xl p-2 text-xs font-semibold transition-colors ${followEnabled ? "bg-accent/20 text-accent" : "bg-surface-elevated text-secondary"}`}
          aria-label={followEnabled ? "Disable auto-follow" : "Enable auto-follow"}
          title={followEnabled ? "Following — click to disable" : "Follow disabled — click to enable"}
        >
          {followEnabled ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
        </button>
      </div>

      {visibleStates.map(({ signer }) => (
        <div key={`tl-${signer.id}`} className="flex items-center gap-2">
          <span className="text-muted/60 w-16 truncate text-[10px]" title={signer.label}>
            {signer.label.split(" ")[0]}
          </span>
          <div className="flex-1">
            <ReplayTimeline
              events={signer.events}
              interactions={signer.interactions}
              durationMs={signer.durationMs}
              cursorMs={effectiveCursorMs}
              onSeek={onSeek}
              color={laneColor(signer.index)}
              docViewStartMs={signer.documentViewingStartedMs}
            />
          </div>
        </div>
      ))}

      <div className="flex items-center justify-between gap-3 text-xs text-muted">
        <div className="flex items-center gap-3">
          <span className="font-medium text-secondary">
            {formatTime(effectiveCursorMs)} / {formatTime(durationMs)}
          </span>
          <span>{activeState?.lastAction || "Waiting for replay"}</span>
        </div>
        <span>
          {!followEnabled
            ? "Follow disabled"
            : activeSignerIndex !== null
              ? `Following ${signers[activeSignerIndex]?.label ?? "signer"}`
              : "Following visible lanes"}
        </span>
      </div>
    </div>
  );
}
