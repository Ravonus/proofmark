"use client";

/**
 * Collaboration session panel — create, join, and list sessions.
 *
 * Shown as a modal/drawer from the dashboard or document editor.
 * Handles session creation for both document-based and PDF-review modes.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Plus, LogIn, X, Copy, Check, FileText, Loader2, Clock, Crown } from "lucide-react";
import { trpc } from "~/lib/trpc";

type SessionListItem = {
  session: {
    id: string;
    title: string;
    createdAt: string | number | Date;
    hostUserId: string;
  };
  participants: { isActive: boolean }[];
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  /** Navigate to an active session */
  onJoinSession: (sessionId: string) => void;
  /** Pre-fill document ID when starting from the editor */
  documentId?: string;
  documentTitle?: string;
  /** Current user display name */
  displayName: string;
};

export function CollabSessionPanel({ isOpen, onClose, onJoinSession, documentId, documentTitle, displayName }: Props) {
  const [tab, setTab] = useState<"create" | "join" | "active">("active");
  const [title, setTitle] = useState(documentTitle ? `Review: ${documentTitle}` : "");
  const [joinToken, setJoinToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [reviewOnly, setReviewOnly] = useState(!documentId);

  const capabilities = trpc.collab.capabilities.useQuery();
  const sessions = trpc.collab.list.useQuery({ status: "active" });
  const createSession = trpc.collab.create.useMutation();
  const joinSession = trpc.collab.join.useMutation();

  const available = capabilities.data?.available ?? false;

  const handleCreate = async () => {
    if (!title.trim()) return;
    const result = (await createSession.mutateAsync({
      title: title.trim(),
      documentId: documentId,
      displayName,
      settings: { reviewOnly },
    })) as { joinToken: string; sessionId: string };
    setCreatedToken(result.joinToken);
    void sessions.refetch();
  };

  const handleJoin = async () => {
    if (!joinToken.trim()) return;
    const result = (await joinSession.mutateAsync({
      joinToken: joinToken.trim(),
      displayName,
    })) as { sessionId: string };
    onJoinSession(result.sessionId);
  };

  const copyToken = (token: string) => {
    void navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-full max-w-lg rounded-xl border border-white/10 bg-zinc-900 p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-white">Live Collaboration</h2>
            </div>
            <button onClick={onClose} className="text-zinc-400 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          {!available && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-300">
              Collaboration requires a Pro or Enterprise plan.
            </div>
          )}

          {/* Tabs */}
          <div className="mb-4 flex gap-1 rounded-lg bg-zinc-800 p-1">
            {(["active", "create", "join"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {t === "active" ? "Active" : t === "create" ? "Create" : "Join"}
              </button>
            ))}
          </div>

          {/* Active sessions */}
          {tab === "active" && (
            <div className="space-y-2">
              {sessions.isLoading && (
                <div className="flex items-center justify-center py-8 text-zinc-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
              {(sessions.data as SessionListItem[] | undefined)?.length === 0 && (
                <p className="py-8 text-center text-sm text-zinc-500">
                  No active sessions. Create one or join with a code.
                </p>
              )}
              {(sessions.data as SessionListItem[] | undefined)?.map((s) => (
                <button
                  key={s.session.id}
                  onClick={() => onJoinSession(s.session.id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-white/5 bg-zinc-800/50 p-3 text-left transition-colors hover:border-blue-500/30 hover:bg-zinc-800"
                >
                  <FileText className="h-4 w-4 shrink-0 text-blue-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{s.session.title}</p>
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {s.participants.filter((p: { isActive: boolean }) => p.isActive).length}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(s.session.createdAt).toLocaleDateString()}
                      </span>
                      {s.session.hostUserId === displayName && (
                        <span className="flex items-center gap-1 text-amber-400">
                          <Crown className="h-3 w-3" />
                          Host
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Create session */}
          {tab === "create" && (
            <div className="space-y-4">
              {createdToken ? (
                <div className="space-y-3">
                  <p className="text-sm text-emerald-400">Session created! Share this code:</p>
                  <div className="flex items-center gap-2 rounded-lg bg-zinc-800 p-3">
                    <code className="flex-1 font-mono text-lg tracking-wider text-white">{createdToken}</code>
                    <button
                      onClick={() => copyToken(createdToken)}
                      className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                    >
                      {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      setCreatedToken(null);
                      setTitle("");
                    }}
                    className="text-sm text-blue-400 hover:text-blue-300"
                  >
                    Create another
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-400">Session Title</label>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g., NDA Review with Client"
                      className="w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500/50 focus:outline-none"
                    />
                  </div>

                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={reviewOnly}
                      onChange={(e) => setReviewOnly(e.target.checked)}
                      className="rounded border-zinc-600 bg-zinc-800"
                    />
                    Review-only mode (no editing, just review & annotate)
                  </label>

                  {documentId && <p className="text-xs text-zinc-500">Linked to: {documentTitle || documentId}</p>}

                  <button
                    onClick={handleCreate}
                    disabled={!title.trim() || createSession.isPending || !available}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {createSession.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    Create Session
                  </button>
                </>
              )}
            </div>
          )}

          {/* Join session */}
          {tab === "join" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-400">Join Code</label>
                <input
                  type="text"
                  value={joinToken}
                  onChange={(e) => setJoinToken(e.target.value)}
                  placeholder="Enter session code"
                  className="w-full rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 font-mono text-sm text-white placeholder:text-zinc-500 focus:border-blue-500/50 focus:outline-none"
                />
              </div>

              <button
                onClick={handleJoin}
                disabled={!joinToken.trim() || joinSession.isPending || !available}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {joinSession.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                Join Session
              </button>

              {joinSession.isError && <p className="text-sm text-red-400">{joinSession.error.message}</p>}
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
