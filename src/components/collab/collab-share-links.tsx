// @ts-nocheck -- premium module with dynamic types from private repo
"use client";

/**
 * Shareable links panel — create and manage deep links to document sections.
 *
 * Links can include AI breakdowns and expire after a set time.
 * Recipients jump directly to the referenced section.
 */

import { useState } from "react";
import { Link2, Plus, Copy, Check, Sparkles, Clock, X } from "lucide-react";
import { trpc } from "~/lib/trpc";

type ShareLink = {
  id: string;
  token: string;
  anchor: {
    kind: "doc" | "pdf";
    tokenIndex?: number;
    page?: number;
  } | null;
  aiBreakdown: string | null;
  expiresAt: string | number | Date | null;
};

type Props = {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Anchor for a new link — set by the editor when user selects "Share this section" */
  pendingAnchor?: {
    kind: "doc" | "pdf";
    tokenIndex?: number;
    charOffset?: number;
    length?: number;
    page?: number;
    rect?: { x: number; y: number; width: number; height: number };
  } | null;
  onClearPendingAnchor: () => void;
};

export function CollabShareLinks({ sessionId, isOpen, onClose, pendingAnchor, onClearPendingAnchor }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generateBreakdown, setGenerateBreakdown] = useState(true);
  const [expiresInHours, setExpiresInHours] = useState<number | null>(null);

  const links = trpc.collab.sessionLinks.useQuery({ sessionId });
  const createLink = trpc.collab.createLink.useMutation({
    onSuccess: () => {
      void links.refetch();
      onClearPendingAnchor();
    },
  });

  const copyLink = (token: string, id: string) => {
    const url = `${window.location.origin}/collab/link/${token}`;
    void navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCreateLink = async () => {
    if (!pendingAnchor) return;
    await createLink.mutateAsync({
      sessionId,
      anchor: pendingAnchor,
      generateBreakdown,
      expiresInHours: expiresInHours ?? undefined,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 flex-col border-l border-white/10 bg-zinc-900/95">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">Shared Links</h3>
        </div>
        <button onClick={onClose} className="text-zinc-400 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Create link from pending anchor */}
      {pendingAnchor && (
        <div className="border-b border-white/10 p-4">
          <p className="mb-3 text-xs text-zinc-400">Create a shareable link to the selected section:</p>

          <label className="mb-2 flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={generateBreakdown}
              onChange={(e) => setGenerateBreakdown(e.target.checked)}
              className="rounded border-zinc-600 bg-zinc-800"
            />
            <Sparkles className="h-3 w-3 text-blue-400" />
            Include AI breakdown
          </label>

          <div className="mb-3">
            <label className="mb-1 block text-[10px] text-zinc-500">Expires</label>
            <select
              value={expiresInHours ?? ""}
              onChange={(e) => setExpiresInHours(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full rounded-md border border-white/10 bg-zinc-800 px-2 py-1 text-xs text-white"
            >
              <option value="">Never</option>
              <option value="24">24 hours</option>
              <option value="72">3 days</option>
              <option value="168">1 week</option>
              <option value="720">30 days</option>
            </select>
          </div>

          <button
            onClick={handleCreateLink}
            disabled={createLink.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            Create Link
          </button>
        </div>
      )}

      {/* Links list */}
      <div className="flex-1 overflow-y-auto">
        {(links.data as ShareLink[] | undefined)?.length === 0 && !pendingAnchor && (
          <p className="px-4 py-8 text-center text-xs text-zinc-500">
            No shared links yet. Select a section in the document to create one.
          </p>
        )}
        {(links.data as ShareLink[] | undefined)?.map((link) => (
          <div key={link.id} className="border-b border-white/5 px-4 py-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-xs text-zinc-300">{link.token}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => copyLink(link.token, link.id)}
                  className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
                  title="Copy link"
                >
                  {copiedId === link.id ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                </button>
              </div>
            </div>

            {/* Anchor description */}
            <p className="mb-1 text-[10px] text-zinc-500">
              {link.anchor?.kind === "doc" ? `Token ${String(link.anchor.tokenIndex)}` : `Page ${String(link.anchor?.page)}`}
            </p>

            {/* AI breakdown badge */}
            {link.aiBreakdown && (
              <div className="mb-1 flex items-center gap-1 text-[10px] text-blue-400">
                <Sparkles className="h-2.5 w-2.5" />
                AI breakdown included
              </div>
            )}

            {/* Expiry */}
            {link.expiresAt && (
              <p className="flex items-center gap-1 text-[10px] text-zinc-600">
                <Clock className="h-2.5 w-2.5" />
                Expires {new Date(link.expiresAt).toLocaleDateString()}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
