// @ts-nocheck -- premium module with dynamic types from private repo
"use client";

/**
 * useAutoCollab — automatically creates or joins a collab session when a
 * document is opened.  Returns the active sessionId (or null while loading)
 * plus helpers for the share-link popover.
 *
 * Usage:
 *   const { sessionId, session, isHost, leave } = useAutoCollab({
 *     documentId, documentTitle, displayName, enabled,
 *   });
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { trpc } from "~/lib/trpc";

type UseAutoCollabOpts = {
  /** The document to bind the session to */
  documentId: string | undefined;
  /** Displayed as session title on first creation */
  documentTitle?: string;
  /** Current user display name */
  displayName: string;
  /** Gate: only fire when collab is available (premium) and user is authenticated */
  enabled: boolean;
};

export function useAutoCollab({ documentId, documentTitle, displayName, enabled }: UseAutoCollabOpts) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const initiated = useRef(false);

  const getOrCreate = trpc.collab.getOrCreateForDocument.useMutation();

  const collabSessionQuery = trpc.collab.get.useQuery(
    { sessionId: sessionId! },
    { enabled: !!sessionId },
  );

  // Auto-create/join on mount
  useEffect(() => {
    if (!enabled || !documentId || !displayName || initiated.current) return;
    initiated.current = true;

    getOrCreate
      .mutateAsync({ documentId, documentTitle, displayName })
      .then((res) => setSessionId(res.sessionId))
      .catch(() => {
        // Silently fail — collab is optional; user can still use the doc
        initiated.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, documentId, displayName]);

  const leave = useCallback(() => {
    setSessionId(null);
    initiated.current = false;
  }, []);

  const session = collabSessionQuery.data;

  return {
    sessionId,
    session,
    isHost: session?.myRole === "host",
    displayName,
    leave,
    loading: getOrCreate.isPending,
  };
}
