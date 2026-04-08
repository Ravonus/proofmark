"use client";

import { Eye, EyeOff } from "lucide-react";
import type { ReplayState } from "./replay-document-helpers";
import { formatTime, laneColor } from "./replay-document-helpers";
import { ActionIcon, type SignerData, VerdictBadge } from "./replay-document-parts";

type SignerDrawerListProps = {
  signers: SignerData[];
  states: Array<{ signer: SignerData; state: ReplayState | null }>;
  activeSignerIndex: number | null;
  soloIndex: number | null;
  hiddenSigners: Set<number>;
  expandedSigners: Set<number>;
  setFollowIndex: (fn: (prev: number | null) => number | null) => void;
  setExpandedSigners: (fn: (prev: Set<number>) => Set<number>) => void;
  onToggleSigner: (index: number) => void;
  onSoloSigner: (index: number) => void;
};

function CategoryAnalysis({ signer }: { signer: SignerData }) {
  const profile = signer.sessionProfile;
  if (!profile) return null;

  const overallVerdict = signer.serverReview?.verdict;
  const overrideToAgent = overallVerdict === "agent";

  const resolveVerdict = (catVerdict: string, humanLabel: string) => {
    if (overrideToAgent && catVerdict === humanLabel) return "overridden";
    return catVerdict;
  };
  const verdictLabel = (v: string) => (v === "overridden" ? "\u26A0 flagged" : v);
  const verdictColor = (v: string) =>
    v === "overridden"
      ? "text-amber-400"
      : v === "human" || v === "natural" || v === "passed"
        ? "text-emerald-400"
        : v === "bot" || v === "synthetic" || v === "absent"
          ? "text-red-400"
          : "text-muted";
  const verdictSource = (v: string): "human" | "bot" | "unknown" =>
    v === "overridden"
      ? "bot"
      : v === "human" || v === "natural" || v === "passed"
        ? "human"
        : v === "bot" || v === "synthetic" || v === "absent"
          ? "bot"
          : "unknown";

  return (
    <div className="mt-3 space-y-2">
      <p className="text-muted/70 text-[10px] font-semibold uppercase tracking-[0.18em]">Category Analysis</p>
      {overrideToAgent && (
        <p className="text-[9px] text-amber-400/70">
          Overall verdict: agent — individual signals may appear human but deeper analysis detected automation.
        </p>
      )}
      <CategoryRow
        label="Typing"
        verdict={resolveVerdict(profile.typing.verdict, "human")}
        reason={profile.typing.reason}
        verdictLabel={verdictLabel}
        verdictColor={verdictColor}
        verdictSource={verdictSource}
      />
      {profile.signature && (
        <CategoryRow
          label="Signature"
          verdict={resolveVerdict(profile.signature.verdict, "human")}
          reason={profile.signature.reason}
          verdictLabel={verdictLabel}
          verdictColor={verdictColor}
          verdictSource={verdictSource}
        />
      )}
      {profile.gaze.active && (
        <CategoryRow
          label="Eye Gaze"
          verdict={resolveVerdict(profile.gaze.verdict, "natural")}
          reason={profile.gaze.reasons[0] ?? ""}
          verdictLabel={verdictLabel}
          verdictColor={verdictColor}
          verdictSource={verdictSource}
        />
      )}
      <PointerRow
        profile={profile}
        resolveVerdict={resolveVerdict}
        verdictLabel={verdictLabel}
        verdictColor={verdictColor}
        verdictSource={verdictSource}
      />
      {profile.liveness?.available && (
        <div className="flex items-center gap-2 text-[11px]">
          <ActionIcon source={profile.liveness.verdict === "passed" ? "human" : "bot"} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-medium text-secondary">Liveness</span>
              <span
                className={`text-[9px] font-semibold uppercase ${profile.liveness.verdict === "passed" ? "text-emerald-400" : "text-red-400"}`}
              >
                {profile.liveness.verdict}
              </span>
            </div>
            <p className="text-[10px] text-muted">{Math.round(profile.liveness.passRatio * 100)}% pass rate</p>
          </div>
        </div>
      )}
      <div className="mt-2 flex gap-3 text-[10px]">
        <span className="text-emerald-400/80">Human: {Math.round(profile.humanEvidenceScore * 100)}%</span>
        <span className="text-red-400/80">Agent: {Math.round(profile.automationEvidenceScore * 100)}%</span>
      </div>
    </div>
  );
}

function CategoryRow({
  label,
  verdict,
  reason,
  verdictLabel,
  verdictColor,
  verdictSource,
}: {
  label: string;
  verdict: string;
  reason: string;
  verdictLabel: (v: string) => string;
  verdictColor: (v: string) => string;
  verdictSource: (v: string) => "human" | "bot" | "unknown";
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <ActionIcon source={verdictSource(verdict)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="font-medium text-secondary">{label}</span>
          <span className={`text-[9px] font-semibold uppercase ${verdictColor(verdict)}`}>{verdictLabel(verdict)}</span>
        </div>
        <p className="truncate text-[10px] text-muted">{reason}</p>
      </div>
    </div>
  );
}

function PointerRow({
  profile,
  resolveVerdict,
  verdictLabel,
  verdictColor,
  verdictSource,
}: {
  profile: NonNullable<SignerData["sessionProfile"]>;
  resolveVerdict: (catVerdict: string, humanLabel: string) => string;
  verdictLabel: (v: string) => string;
  verdictColor: (v: string) => string;
  verdictSource: (v: string) => "human" | "bot" | "unknown";
}) {
  const rawV = profile.pointer.clickWithoutMovement ? "bot" : profile.pointer.mouseMoveCount > 20 ? "human" : "unknown";
  const v = resolveVerdict(rawV, "human");
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <ActionIcon source={verdictSource(v)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <span className="font-medium text-secondary">Pointer</span>
          <span className={`text-[9px] font-semibold uppercase ${verdictColor(v)}`}>{verdictLabel(v)}</span>
        </div>
        <p className="text-[10px] text-muted">
          {profile.pointer.mouseMoveCount} moves, {profile.pointer.clickCount} clicks
        </p>
      </div>
    </div>
  );
}

function SignerDetails({ signer, state }: { signer: SignerData; state: ReplayState | null }) {
  return (
    <>
      <CategoryAnalysis signer={signer} />

      {/* Stats grid */}
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs text-muted">
        <div>
          <p className="text-muted/70 text-[10px] uppercase tracking-[0.18em]">Duration</p>
          <p className="mt-1 text-secondary">{formatTime(signer.durationMs)}</p>
        </div>
        <div>
          <p className="text-muted/70 text-[10px] uppercase tracking-[0.18em]">Events</p>
          <p className="mt-1 text-secondary">{signer.tape?.metrics.eventCount ?? 0}</p>
        </div>
        <div>
          <p className="text-muted/70 text-[10px] uppercase tracking-[0.18em]">Gaze</p>
          <p className="mt-1 text-secondary">{signer.tape?.metrics.gazePointCount ?? 0} pts</p>
        </div>
        <div>
          <p className="text-muted/70 text-[10px] uppercase tracking-[0.18em]">Focus</p>
          <p className="mt-1 text-secondary">{state?.focusedFieldId ?? "None"}</p>
        </div>
      </div>

      {/* Sessions */}
      {signer.forensicSessions.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-muted/70 mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]">
            Sessions ({signer.forensicSessions.length})
          </p>
          <div className="space-y-1.5">
            {signer.forensicSessions.map((session, i) => (
              <div key={session.sessionId ?? i} className="flex items-center gap-2 text-[11px]">
                <ActionIcon
                  source={
                    session.classification?.verdict === "bot"
                      ? "bot"
                      : session.classification?.verdict === "human"
                        ? "human"
                        : "unknown"
                  }
                />
                <span className="text-secondary">Session {session.visitIndex + 1}</span>
                <span className="text-muted">{formatTime(session.durationMs)}</span>
                <span
                  className={`ml-auto text-[9px] font-semibold uppercase ${session.classification?.verdict === "human" ? "text-emerald-400" : session.classification?.verdict === "bot" ? "text-red-400" : "text-amber-400"}`}
                >
                  {session.classification?.verdict ?? "?"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-action breakdown */}
      {signer.interactions.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-muted/70 mb-2 text-[10px] font-semibold uppercase tracking-[0.18em]">Actions</p>
          <div className="space-y-1.5">
            {signer.interactions.map((interaction, i) => (
              <div key={i} className="flex items-start gap-2 text-[11px]">
                <ActionIcon source={interaction.source} />
                <div className="min-w-0">
                  <span className={`font-medium ${interaction.critical ? "text-amber-300" : "text-secondary"}`}>
                    {interaction.action.replace(/_/g, " ")}
                    {interaction.critical && <span className="ml-1 text-[9px] text-amber-400/70">(critical)</span>}
                  </span>
                  <p className="mt-0.5 truncate text-[10px] leading-tight text-muted">{interaction.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {signer.serverReview?.rationale && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-muted/70 mb-1 text-[10px] font-semibold uppercase tracking-[0.18em]">Rationale</p>
          <p className="text-[11px] leading-relaxed text-secondary">{signer.serverReview.rationale}</p>
        </div>
      )}
    </>
  );
}

export function SignerDrawerList({
  signers,
  states,
  activeSignerIndex,
  soloIndex,
  hiddenSigners,
  expandedSigners,
  setFollowIndex,
  setExpandedSigners,
  onToggleSigner,
  onSoloSigner,
}: SignerDrawerListProps) {
  return (
    <div className="mt-4 space-y-3">
      {signers.map((signer) => {
        const state = states[signer.index]?.state ?? null;
        const hidden = soloIndex === null && hiddenSigners.has(signer.index);
        const active = activeSignerIndex === signer.index;
        return (
          <SignerCard
            key={signer.id}
            signer={signer}
            state={state}
            active={active}
            hidden={hidden}
            expanded={expandedSigners.has(signer.index)}
            soloActive={soloIndex === signer.index}
            onFollow={() => setFollowIndex((current) => (current === signer.index ? null : signer.index))}
            onToggle={() => onToggleSigner(signer.index)}
            onSolo={() => onSoloSigner(signer.index)}
            onToggleExpand={() =>
              setExpandedSigners((prev) => {
                const next = new Set(prev);
                if (next.has(signer.index)) {
                  next.delete(signer.index);
                } else {
                  next.add(signer.index);
                }
                return next;
              })
            }
          />
        );
      })}
    </div>
  );
}

function SignerCard({
  signer,
  state,
  active,
  hidden,
  expanded,
  soloActive,
  onFollow,
  onToggle,
  onSolo,
  onToggleExpand,
}: {
  signer: SignerData;
  state: ReplayState | null;
  active: boolean;
  hidden: boolean;
  expanded: boolean;
  soloActive: boolean;
  onFollow: () => void;
  onToggle: () => void;
  onSolo: () => void;
  onToggleExpand: () => void;
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${active ? "border-accent/40 bg-accent/10" : "border-border bg-surface-card"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: laneColor(signer.index) }}
            />
            <p className="text-sm font-medium text-primary">{signer.label}</p>
          </div>
          <VerdictBadge classification={signer.classification} serverReview={signer.serverReview} />
          <p className="text-xs text-muted">{state?.lastAction || "Waiting for replay activity"}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onFollow}
            className="rounded-lg p-2 text-secondary transition-colors hover:bg-surface-elevated hover:text-primary"
            aria-label={`Follow ${signer.label}`}
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onToggle}
            className="rounded-lg p-2 text-secondary transition-colors hover:bg-surface-elevated hover:text-primary"
            aria-label={`${hidden ? "Show" : "Hide"} ${signer.label}`}
          >
            {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={onSolo}
            className={`rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
              soloActive ? "bg-accent text-white" : "bg-surface-elevated text-secondary"
            }`}
          >
            {soloActive ? "Sync" : "Solo"}
          </button>
        </div>
      </div>

      <button
        onClick={onToggleExpand}
        className="text-muted/60 mt-2 w-full text-left text-[10px] transition-colors hover:text-muted"
      >
        {expanded ? "Hide details" : "Show details"}
      </button>

      {expanded && <SignerDetails signer={signer} state={state} />}
    </div>
  );
}
