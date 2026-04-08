"use client";

import { Bot, ShieldAlert, Sparkles } from "lucide-react";
import { describeReplayEvent, type PreparedReplayLane, type ReplayLaneSnapshot } from "./replay-runtime";

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

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function MetricStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-card p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 text-sm text-primary">{value}</p>
    </div>
  );
}

function LaneSnapshotMetrics({ lane, snapshot }: { lane: PreparedReplayLane; snapshot: ReplayLaneSnapshot }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <MetricStatCard label="Current Target" value={trim(snapshot.currentTarget, 44) ?? "None"} />
      <MetricStatCard
        label="Scroll / Page"
        value={`${Math.round(snapshot.scrollRatio * 100)}% · ${snapshot.page}/${Math.max(1, snapshot.totalPages)}`}
      />
      <MetricStatCard
        label="Signature Motion"
        value={
          lane.signatureMotion
            ? `${lane.signatureMotion.strokeCount} strokes · ${lane.signatureMotion.directionChangeCount} turns`
            : "Not available"
        }
      />
      <MetricStatCard
        label="Eye Tracking"
        value={
          snapshot.gazeActive
            ? `${snapshot.gazeTrail.length} pts · ${snapshot.gazeBlinkCount} blinks${snapshot.gazeTrackingLost ? " · LOST" : ""}`
            : "Not active"
        }
      />
      <MetricStatCard
        label="Storage / Policy"
        value={`${(lane.storage?.mode ?? "embedded_pdf").replace(/_/g, " ")} · ${lane.policyOutcome?.action ?? "ALLOW"}`}
      />
    </div>
  );
}

function RecentActivity({ lane, snapshot }: { lane: PreparedReplayLane; snapshot: ReplayLaneSnapshot }) {
  return (
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
  );
}

function AISummaryPanel({ lane }: { lane: PreparedReplayLane }) {
  return (
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
            {lane.signatureMotion ? `${Math.round(lane.signatureMotion.motionUniformityScore * 100)}%` : "n/a"}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span>Motion complexity</span>
          <span>
            {lane.signatureMotion ? `${Math.round(lane.signatureMotion.motionComplexityScore * 100)}%` : "n/a"}
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
  );
}

export function LaneSnapshotCard({ lane, snapshot }: { lane: PreparedReplayLane; snapshot: ReplayLaneSnapshot }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-card p-5">
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

      <LaneSnapshotMetrics lane={lane} snapshot={snapshot} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <RecentActivity lane={lane} snapshot={snapshot} />
        <AISummaryPanel lane={lane} />
      </div>
    </div>
  );
}
