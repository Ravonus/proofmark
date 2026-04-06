// @ts-nocheck -- premium module with dynamic types from private repo
"use client";

/**
 * Invite landing page — resolves an invite token, joins with the assigned role,
 * and redirects to the collab session.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "~/lib/trpc";
import { useConnectedIdentity } from "~/components/hooks/use-connected-identity";
import { Loader2, CheckCircle, XCircle, Edit3, Eye, MessageSquare } from "lucide-react";

const ROLE_META: Record<string, { label: string; icon: typeof Edit3; color: string }> = {
  editor: { label: "Editor", icon: Edit3, color: "text-blue-400" },
  viewer: { label: "Viewer", icon: Eye, color: "text-emerald-400" },
  commentor: { label: "Helper", icon: MessageSquare, color: "text-purple-400" },
};

export default function CollabInvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const identity = useConnectedIdentity();
  const displayName = identity.session?.user?.name ?? identity.wallet?.address?.slice(0, 8) ?? "Anonymous";

  const [status, setStatus] = useState<"joining" | "success" | "error">("joining");
  const [errorMsg, setErrorMsg] = useState("");

  const joinViaInvite = trpc.collab.joinViaInvite.useMutation();

  useEffect(() => {
    if (!params.token || !displayName || status !== "joining") return;

    joinViaInvite
      .mutateAsync({ inviteToken: params.token, displayName })
      .then((result) => {
        setStatus("success");
        // Redirect to the collab session after a brief pause
        setTimeout(() => {
          router.push(`/collab/${result.sessionId}`);
        }, 1500);
      })
      .catch((err) => {
        setStatus("error");
        setErrorMsg(err?.message ?? "Failed to join session");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.token, displayName]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-zinc-900 p-8 text-center shadow-2xl">
        {status === "joining" && (
          <>
            <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-blue-400" />
            <h2 className="mb-2 text-lg font-semibold text-white">Joining session...</h2>
            <p className="text-sm text-zinc-400">Resolving your invite link</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="mx-auto mb-4 h-8 w-8 text-emerald-400" />
            <h2 className="mb-2 text-lg font-semibold text-white">You're in!</h2>
            <p className="text-sm text-zinc-400">Redirecting to the document...</p>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="mx-auto mb-4 h-8 w-8 text-red-400" />
            <h2 className="mb-2 text-lg font-semibold text-white">Could not join</h2>
            <p className="mb-4 text-sm text-zinc-400">{errorMsg}</p>
            <button
              onClick={() => router.push("/")}
              className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-white transition-colors hover:bg-zinc-700"
            >
              Go home
            </button>
          </>
        )}
      </div>
    </div>
  );
}
