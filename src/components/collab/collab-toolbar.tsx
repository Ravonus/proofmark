// @ts-nocheck
"use client";

/**
 * Collaboration toolbar — shown at the top of the editor during an active session.
 *
 * Displays:
 * - Session title and status
 * - Connected participants with avatar dots
 * - Join code (copyable)
 * - Session controls (pause, close, save)
 * - Connection indicator
 */

import { useState } from "react";
import {
  Copy,
  Check,
  Pause,
  Save,
  X,
  Wifi,
  WifiOff,
  Crown,
  Eye,
  Edit3,
  MessageSquare,
  ChevronDown,
} from "lucide-react";
import { trpc } from "~/lib/trpc";
import type { AwarenessUser } from "./use-collab-session";

type Participant = {
  userId: string;
  displayName: string;
  color: string;
  role: string;
  isActive: boolean;
};

type Props = {
  sessionId: string;
  sessionTitle: string;
  joinToken: string;
  isHost: boolean;
  connected: boolean;
  participants: Participant[];
  remoteUsers: AwarenessUser[];
  onClose: () => void;
  hasDocument: boolean;
};

const ROLE_ICONS: Record<string, typeof Edit3> = {
  host: Crown,
  editor: Edit3,
  commentor: MessageSquare,
  viewer: Eye,
};

export function CollabToolbar({
  sessionId,
  sessionTitle,
  joinToken,
  isHost,
  connected,
  participants,
  remoteUsers,
  onClose,
  hasDocument,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);

  const togglePause = trpc.collab.togglePause.useMutation();
  const closeSession = trpc.collab.close.useMutation();
  const saveToDoc = trpc.collab.saveToDocument.useMutation();

  const activeParticipants = participants.filter((p) => p.isActive);

  const copyToken = () => {
    navigator.clipboard.writeText(joinToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = async () => {
    if (isHost) {
      if (confirm("Close this session for everyone?")) {
        await closeSession.mutateAsync({ sessionId });
      }
    }
    onClose();
  };

  const handleSave = async () => {
    await saveToDoc.mutateAsync({ sessionId });
  };

  // Map remote awareness to online status
  const onlineUserIds = new Set(remoteUsers.map((u) => u.userId));

  return (
    <div className="flex items-center gap-3 border-b border-white/10 bg-zinc-900/80 px-4 py-2 backdrop-blur-sm">
      {/* Connection indicator */}
      <div className="flex items-center gap-1.5">
        {connected ? (
          <Wifi className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <WifiOff className="h-3.5 w-3.5 text-red-400" />
        )}
        <span className="text-xs font-medium text-zinc-400">{connected ? "Live" : "Disconnected"}</span>
      </div>

      <div className="h-4 w-px bg-zinc-700" />

      {/* Session title */}
      <span className="truncate text-sm font-medium text-white">{sessionTitle}</span>

      <div className="h-4 w-px bg-zinc-700" />

      {/* Join code */}
      <button
        onClick={copyToken}
        className="flex items-center gap-1.5 rounded-md bg-zinc-800 px-2 py-1 font-mono text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
        title="Copy join code"
      >
        <span>{joinToken}</span>
        {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Participant avatars */}
      <div className="relative">
        <button
          onClick={() => setShowParticipants(!showParticipants)}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
        >
          <div className="flex -space-x-1.5">
            {activeParticipants.slice(0, 5).map((p) => (
              <div
                key={p.userId}
                className="relative flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-900 text-[10px] font-bold text-white"
                style={{ backgroundColor: p.color }}
                title={`${p.displayName} (${p.role})`}
              >
                {p.displayName.charAt(0).toUpperCase()}
                {/* Online indicator dot */}
                {onlineUserIds.has(p.userId) && (
                  <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-zinc-900 bg-emerald-400" />
                )}
              </div>
            ))}
            {activeParticipants.length > 5 && (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-zinc-900 bg-zinc-700 text-[10px] font-bold text-zinc-300">
                +{activeParticipants.length - 5}
              </div>
            )}
          </div>
          <ChevronDown className="h-3 w-3" />
        </button>

        {/* Participant dropdown */}
        {showParticipants && (
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-white/10 bg-zinc-900 p-2 shadow-xl">
            <p className="mb-2 px-2 text-xs font-medium text-zinc-400">Participants ({activeParticipants.length})</p>
            {activeParticipants.map((p) => {
              const RoleIcon = ROLE_ICONS[p.role] || Eye;
              const isOnline = onlineUserIds.has(p.userId);
              const remoteState = remoteUsers.find((u) => u.userId === p.userId);

              return (
                <div key={p.userId} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                  <div
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: p.color }}
                  >
                    {p.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-white">{p.displayName}</p>
                    <p className="flex items-center gap-1 text-[10px] text-zinc-500">
                      <RoleIcon className="h-2.5 w-2.5" />
                      {p.role}
                      {remoteState?.activity && remoteState.activity !== "idle" && (
                        <span className="text-blue-400"> · {remoteState.activity}</span>
                      )}
                    </p>
                  </div>
                  <div
                    className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-400" : "bg-zinc-600"}`}
                    title={isOnline ? "Online" : "Offline"}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1">
        {isHost && hasDocument && (
          <button
            onClick={handleSave}
            disabled={saveToDoc.isPending}
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            title="Save to document"
          >
            <Save className="h-4 w-4" />
          </button>
        )}
        {isHost && (
          <button
            onClick={() => togglePause.mutate({ sessionId })}
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
            title="Pause/Resume"
          >
            <Pause className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={handleClose}
          className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-red-400"
          title={isHost ? "Close session" : "Leave session"}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
