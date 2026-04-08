"use client";

import { isImageDataUrl } from "~/lib/document/field-values";
import type { ReplayState } from "./replay-document-helpers";
import { laneColor } from "./replay-document-helpers";
import type { SignerData } from "./replay-document-parts";

type SignatureBlockProps = {
  signerIdx: number;
  signers: SignerData[];
  states: Array<{ signer: SignerData; state: ReplayState | null }>;
};

function VerdictInlineBadge({ signer }: { signer: SignerData | undefined }) {
  const sigVerdict = signer?.serverReview?.verdict;
  const sigVerdictIcon =
    sigVerdict === "agent"
      ? "\u{1F916}"
      : sigVerdict === "human"
        ? "\u{1F464}"
        : sigVerdict === "uncertain"
          ? "\u2753"
          : null;
  const sigVerdictColor = sigVerdict === "agent" ? "#f87171" : sigVerdict === "human" ? "#34d399" : "#9ca3af";

  if (!sigVerdictIcon) return null;
  return (
    <span
      className="ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none"
      style={{
        background: `${sigVerdictColor}15`,
        color: sigVerdictColor,
        border: `1px solid ${sigVerdictColor}30`,
      }}
      title={`${signer?.label}: ${sigVerdict}`}
    >
      {sigVerdictIcon} {sigVerdict}
    </span>
  );
}

function ProgressiveStrokes({
  signerIdx,
  signer,
  replayState,
}: {
  signerIdx: number;
  signer: SignerData | undefined;
  replayState: ReplayState;
}) {
  const clearedPts = (replayState.clearedStrokes ?? []).flatMap((attempt) => attempt.flatMap((s) => s.points));
  const activePts = (replayState.signatureStrokes ?? []).flatMap((s) => s.points);
  const allPts = [...clearedPts, ...activePts];
  if (allPts.length < 2) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of allPts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const pad = 8;
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const vbW = Math.max(1, maxX - minX);
  const color = laneColor(signerIdx);
  const sw = Math.max(1.5, vbW * 0.007);
  const hasClearedStrokes = replayState.clearedStrokes.length > 0;

  return (
    <div
      className="inline-block rounded-md border border-black/10 bg-[var(--sig-bg)] px-3 py-2 shadow-sm"
      data-forensic-id={`signature-${signer?.label?.toLowerCase().split(" ")[0] ?? signerIdx}`}
    >
      <div className="relative h-14 w-48">
        <svg
          viewBox={`${minX} ${minY} ${vbW} ${Math.max(1, maxY - minY)}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
        >
          {(replayState.clearedStrokes ?? []).map((attempt, ai) =>
            attempt.map((stroke) => {
              if (stroke.points.length < 2) return null;
              const d = stroke.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
              return (
                <path
                  key={`cleared-${ai}-${stroke.strokeId}`}
                  d={d}
                  fill="none"
                  stroke="#555"
                  strokeWidth={sw}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.25}
                />
              );
            }),
          )}
          {(replayState.signatureStrokes ?? []).map((stroke) => {
            if (stroke.points.length < 2) return null;
            const d = stroke.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
            return (
              <path
                key={`active-${stroke.strokeId}`}
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={sw}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </svg>
        <div className="absolute -bottom-0.5 left-0 flex items-center">
          <span className="text-[8px] font-medium" style={{ color }}>
            {"\u270D\uFE0F"}{" "}
            {hasClearedStrokes ? `Attempt ${(replayState.clearedStrokes.length ?? 0) + 1}` : "Drawing..."}
          </span>
          <VerdictInlineBadge signer={signer} />
        </div>
      </div>
    </div>
  );
}

export function SignatureBlockRenderer({ signerIdx, signers, states }: SignatureBlockProps) {
  const signer = signers[signerIdx];
  const replayState = states.find((s) => s.signer.index === signerIdx)?.state ?? null;
  const hasStrokes = replayState && replayState.signatureStrokes.length > 0;
  const isCommitted = replayState?.signatureCommitted ?? false;
  const hasClearedStrokes = replayState && replayState.clearedStrokes.length > 0;

  // During replay: show progressive stroke animation until committed
  if ((hasStrokes || hasClearedStrokes) && !isCommitted && replayState) {
    return <ProgressiveStrokes signerIdx={signerIdx} signer={signer} replayState={replayState} />;
  }

  // After commit or when replay is past the signature: show final image
  if (signer?.status === "SIGNED" && signer.handSignatureData && isImageDataUrl(signer.handSignatureData)) {
    return (
      <div
        className="inline-block rounded-md border border-black/10 bg-[var(--sig-bg)] px-3 py-2 shadow-sm"
        data-forensic-id={`signature-${signer.label?.toLowerCase().split(" ")[0] ?? signerIdx}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL signature, not a remote image */}
        <img
          src={signer.handSignatureData}
          alt={`${signer.label} signature`}
          className="sig-theme-img h-12 w-auto object-contain"
        />
        <div className="mt-1 flex items-center">
          <span className="text-[9px] text-emerald-600/60">
            Signed by {signer.label}
            {signer.signedAt && ` (${new Date(signer.signedAt).toLocaleDateString()})`}
          </span>
          <VerdictInlineBadge signer={signer} />
        </div>
      </div>
    );
  }

  if (signer?.status === "SIGNED") {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-green-400/80">
        Signed by {signer.label} <VerdictInlineBadge signer={signer} />
      </div>
    );
  }

  return (
    <div
      className="inline-block h-8 w-48 border-b-2 border-border"
      data-forensic-id={`signature-${signer?.label?.toLowerCase().split(" ")[0] ?? signerIdx}`}
    />
  );
}
