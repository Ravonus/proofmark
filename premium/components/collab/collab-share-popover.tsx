// @ts-nocheck -- premium module with dynamic types from private repo
"use client";

/**
 * CollabSharePopover — generates role-based invite links for a collab session.
 *
 * Roles:
 *  - edit   → joins as "editor"
 *  - view   → joins as "viewer"
 *  - helper → joins as "commentor" (can comment/annotate, not edit)
 */

import { useState, useRef, useEffect } from "react";
import { Share2, Copy, Check, Link2, Edit3, Eye, MessageSquare, Loader2, ChevronDown } from "lucide-react";
import { trpc } from "~/lib/trpc";

type RoleOption = {
  role: "editor" | "viewer" | "commentor";
  label: string;
  description: string;
  icon: typeof Edit3;
  color: string;
};

const ROLE_OPTIONS: RoleOption[] = [
  {
    role: "editor",
    label: "Edit",
    description: "Can edit, comment & annotate",
    icon: Edit3,
    color: "text-blue-400",
  },
  {
    role: "viewer",
    label: "View",
    description: "Read-only access",
    icon: Eye,
    color: "text-emerald-400",
  },
  {
    role: "commentor",
    label: "Helper",
    description: "Can comment & annotate, no editing",
    icon: MessageSquare,
    color: "text-purple-400",
  },
];

type Props = {
  sessionId: string;
  /** Join token from the session (fallback for simple join) */
  joinToken?: string;
};

export function CollabSharePopover({ sessionId, joinToken }: Props) {
  const [open, setOpen] = useState(false);
  const [copiedRole, setCopiedRole] = useState<string | null>(null);
  const [generatingRole, setGeneratingRole] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const popoverRef = useRef<HTMLDivElement>(null);

  const createInvite = trpc.collab.createInviteLink.useMutation();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const generateLink = async (role: "editor" | "viewer" | "commentor") => {
    if (links[role]) {
      copyToClipboard(links[role], role);
      return;
    }
    setGeneratingRole(role);
    try {
      const result = await createInvite.mutateAsync({
        sessionId,
        role,
        expiresInHours: 168, // 1 week default
      });
      const url = `${window.location.origin}/collab/invite/${result.token}`;
      setLinks((prev) => ({ ...prev, [role]: url }));
      copyToClipboard(url, role);
    } catch {
      // silently fail
    } finally {
      setGeneratingRole(null);
    }
  };

  const copyToClipboard = (url: string, role: string) => {
    void navigator.clipboard.writeText(url);
    setCopiedRole(role);
    setTimeout(() => setCopiedRole(null), 2000);
  };

  const copyJoinToken = () => {
    if (!joinToken) return;
    void navigator.clipboard.writeText(joinToken);
    setCopiedRole("token");
    setTimeout(() => setCopiedRole(null), 2000);
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500"
      >
        <Share2 className="h-3.5 w-3.5" />
        Share
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-white/10 bg-zinc-900 p-4 shadow-2xl">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Link2 className="h-4 w-4 text-blue-400" />
            Share this document
          </h3>

          <div className="space-y-2">
            {ROLE_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const isGenerating = generatingRole === opt.role;
              const isCopied = copiedRole === opt.role;
              const hasLink = !!links[opt.role];

              return (
                <button
                  key={opt.role}
                  onClick={() => generateLink(opt.role)}
                  disabled={isGenerating}
                  className="flex w-full items-center gap-3 rounded-lg border border-white/5 bg-zinc-800/50 p-3 text-left transition-colors hover:border-blue-500/20 hover:bg-zinc-800 disabled:opacity-60"
                >
                  <div className={`rounded-md bg-zinc-700/50 p-1.5 ${opt.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{opt.label}</p>
                    <p className="text-[11px] text-zinc-400">{opt.description}</p>
                  </div>
                  <div className="shrink-0">
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                    ) : isCopied ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Copy className="h-4 w-4 text-zinc-500" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Join code fallback */}
          {joinToken && (
            <div className="mt-3 border-t border-white/5 pt-3">
              <button
                onClick={copyJoinToken}
                className="flex w-full items-center justify-between rounded-lg bg-zinc-800/50 px-3 py-2 text-left"
              >
                <div>
                  <p className="text-[11px] text-zinc-500">Join code</p>
                  <p className="font-mono text-xs tracking-wider text-zinc-300">{joinToken}</p>
                </div>
                {copiedRole === "token" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-zinc-500" />
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
