"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useCallback } from "react";
import { DocumentPaper } from "../document-editor/document-paper";
import { DocumentHeader, SignerList } from "../signing/sign-document-parts";
import { ReplayControls } from "./replay-controls";
import { ReplayGazeOverlay } from "./replay-document-parts";
import { ReplayFieldRenderer } from "./replay-field-renderer";
import { SignatureBlockRenderer } from "./replay-signature-block";
import { SignerDrawerList } from "./replay-signer-drawer";
import { useReplayData, useReplayPlayback } from "./replay-viewer-hooks";

const SPEEDS = [0.5, 1, 2, 4, 8];

type Props = { documentId?: string; shareToken?: string };

export function ReplayDocumentViewer({ documentId, shareToken }: Props) {
  const { data, signers, tokens, signerListItems, shareLookupPending, shareLookupError, queryError, queryLoading } =
    useReplayData(documentId, shareToken);

  const playback = useReplayPlayback(signers);

  const handleRestart = useCallback(() => {
    playback.setPlaying(false);
    playback.setCursorMs(0);
  }, [playback.setPlaying, playback.setCursorMs]);

  const handleCycleSpeed = useCallback(() => {
    playback.setSpeedIndex((current: number) => (current + 1) % SPEEDS.length);
  }, [playback.setSpeedIndex]);

  const handleToggleFollow = useCallback(() => {
    playback.setFollowEnabled((v: boolean) => !v);
    if (playback.followEnabled) playback.setFollowIndex(null);
  }, [playback.followEnabled, playback.setFollowEnabled, playback.setFollowIndex]);

  if (shareLookupPending || queryLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--replay-page-bg)]">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (shareLookupError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--replay-page-bg)] px-4">
        <div className="glass-card max-w-md rounded-2xl p-6 text-center text-sm text-red-300">{shareLookupError}</div>
      </div>
    );
  }

  if (queryError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--replay-page-bg)] px-4">
        <div className="glass-card max-w-md rounded-2xl p-6 text-center text-sm text-muted">
          {queryError?.message ?? "Replay data is not available for this document."}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--replay-page-bg)]">
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 pb-32">
        <ReplayHeader
          drawerOpen={playback.drawerOpen}
          onToggleDrawer={() => playback.setDrawerOpen((current) => !current)}
        />

        <DocumentHeader
          doc={{
            title: data.title,
            status: data.status,
            signers: signerListItems,
          }}
          signedCount={signerListItems.filter((signer) => signer.status === "SIGNED").length}
          totalRecipients={signerListItems.length}
        />

        <DocumentPaper
          paperRef={playback.paperRef}
          tokens={tokens}
          overlay={<ReplayGazeOverlay paperRef={playback.paperRef} lanes={playback.visibleStates} />}
          renderField={({ field, forensicId }) => (
            <ReplayFieldRenderer
              field={field}
              forensicId={forensicId}
              documentId={data.documentId}
              mergedFieldValues={playback.mergedFieldValues}
              activeState={playback.activeState}
              signers={signers}
            />
          )}
          renderSignatureBlock={({ signerIdx }) => (
            <SignatureBlockRenderer signerIdx={signerIdx} signers={signers} states={playback.states} />
          )}
        />

        <SignerList signers={signerListItems} currentAddress={null} />
      </div>

      {playback.drawerOpen && (
        <aside className="glass-card fixed right-4 top-24 z-30 max-h-[calc(100vh-10rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border p-4 shadow-2xl">
          <div className="space-y-1 border-b border-border pb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Replay Lanes</p>
            <p className="text-sm text-secondary">
              {playback.visibleStates.length} visible of {signers.length} signer
              {signers.length === 1 ? "" : "s"}
            </p>
          </div>
          <SignerDrawerList
            signers={signers}
            states={playback.states}
            activeSignerIndex={playback.activeSignerIndex}
            soloIndex={playback.soloIndex}
            hiddenSigners={playback.hiddenSigners}
            expandedSigners={playback.expandedSigners}
            setFollowIndex={playback.setFollowIndex}
            setExpandedSigners={playback.setExpandedSigners}
            onToggleSigner={playback.handleToggleSigner}
            onSoloSigner={playback.handleSoloSigner}
          />
        </aside>
      )}

      <ReplayControls
        barMinimized={playback.barMinimized}
        setBarMinimized={playback.setBarMinimized}
        effectiveCursorMs={playback.effectiveCursorMs}
        durationMs={playback.durationMs}
        playing={playback.playing}
        speed={playback.speed}
        speedIndex={playback.speedIndex}
        followEnabled={playback.followEnabled}
        activeSignerIndex={playback.activeSignerIndex}
        activeState={playback.activeState}
        signers={signers}
        visibleStates={playback.visibleStates}
        onPlayPause={playback.handlePlayPause}
        onSeek={playback.handleSeek}
        onRestart={handleRestart}
        onCycleSpeed={handleCycleSpeed}
        onToggleFollow={handleToggleFollow}
      />
    </div>
  );
}

function ReplayHeader({ drawerOpen, onToggleDrawer }: { drawerOpen: boolean; onToggleDrawer: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1">
        <p className="text-accent/70 text-[10px] font-semibold uppercase tracking-[0.3em]">Forensic Replay</p>
        <p className="text-sm text-muted">
          Playback runs on the same paper document renderer used during signing, with gaze points resolved against live
          document anchors.
        </p>
      </div>
      <button
        onClick={onToggleDrawer}
        className="rounded-xl border border-border bg-surface-card p-2 text-secondary transition-colors hover:text-primary"
        aria-label={drawerOpen ? "Hide replay panel" : "Show replay panel"}
      >
        {drawerOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
      </button>
    </div>
  );
}
