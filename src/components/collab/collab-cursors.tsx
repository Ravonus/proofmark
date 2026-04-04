"use client";

/**
 * Collaborative cursor and selection overlay.
 *
 * Renders remote participants' cursors and text selections
 * on top of the document editor. Each user has a unique color
 * and their name is shown on hover/near their cursor.
 *
 * Works by positioning absolutely within the editor container
 * based on token indices and character offsets.
 */

import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AwarenessUser } from "./use-collab-session";

type Props = {
  /** Remote users' awareness states */
  remoteUsers: AwarenessUser[];
  /** Function to get pixel position from token index + char offset */
  getPositionFromToken: (
    tokenIndex: number,
    charOffset: number,
  ) => { top: number; left: number; height: number } | null;
};

export function CollabCursors({ remoteUsers, getPositionFromToken }: Props) {
  // Filter to users with active cursors or selections
  const activeCursors = remoteUsers.filter((u) => u.cursor || u.selection);

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <AnimatePresence>
        {activeCursors.map((user) => (
          <RemoteCursor key={user.userId} user={user} getPositionFromToken={getPositionFromToken} />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ── Remote Cursor ──

function RemoteCursor({
  user,
  getPositionFromToken,
}: {
  user: AwarenessUser;
  getPositionFromToken: Props["getPositionFromToken"];
}) {
  const [showLabel, setShowLabel] = useState(true);
  const labelTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Show label briefly when cursor moves, then hide
  useEffect(() => {
    setShowLabel(true);
    clearTimeout(labelTimeout.current);
    labelTimeout.current = setTimeout(() => setShowLabel(false), 3000);
    return () => clearTimeout(labelTimeout.current);
  }, [user.cursor?.tokenIndex, user.cursor?.charOffset]);

  // Render cursor
  if (user.cursor) {
    const pos = getPositionFromToken(user.cursor.tokenIndex, user.cursor.charOffset);
    if (!pos) return null;

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        className="absolute"
        style={{
          top: pos.top,
          left: pos.left,
          zIndex: 35,
        }}
      >
        {/* Cursor line */}
        <div
          className="w-0.5 rounded-full"
          style={{
            backgroundColor: user.color,
            height: pos.height,
          }}
        />

        {/* Cursor flag with name */}
        <AnimatePresence>
          {showLabel && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute -top-5 left-0 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-white shadow-lg"
              style={{ backgroundColor: user.color }}
            >
              {user.displayName}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  // Render selection
  if (user.selection) {
    return <RemoteSelection user={user} getPositionFromToken={getPositionFromToken} />;
  }

  return null;
}

// ── Remote Selection Highlight ──

function RemoteSelection({
  user,
  getPositionFromToken,
}: {
  user: AwarenessUser;
  getPositionFromToken: Props["getPositionFromToken"];
}) {
  if (!user.selection) return null;

  const { anchor, head } = user.selection;

  // Simple case: same token
  if (anchor.tokenIndex === head.tokenIndex) {
    const startOffset = Math.min(anchor.charOffset, head.charOffset);
    const endOffset = Math.max(anchor.charOffset, head.charOffset);

    const startPos = getPositionFromToken(anchor.tokenIndex, startOffset);
    const endPos = getPositionFromToken(anchor.tokenIndex, endOffset);
    if (!startPos || !endPos) return null;

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <div
          className="absolute rounded-sm"
          style={{
            top: startPos.top,
            left: startPos.left,
            width: endPos.left - startPos.left,
            height: startPos.height,
            backgroundColor: user.color,
            opacity: 0.2,
          }}
        />
        {/* Selection label */}
        <div
          className="absolute -top-4 whitespace-nowrap rounded-sm px-1 py-0.5 text-[9px] font-medium text-white"
          style={{
            left: startPos.left,
            top: startPos.top - 16,
            backgroundColor: user.color,
            opacity: 0.85,
          }}
        >
          {user.displayName}
        </div>
      </motion.div>
    );
  }

  // Multi-token selection: highlight each token in the range
  const startToken = Math.min(anchor.tokenIndex, head.tokenIndex);
  const endToken = Math.max(anchor.tokenIndex, head.tokenIndex);
  const highlights: React.ReactNode[] = [];

  for (let t = startToken; t <= endToken; t++) {
    const charStart = t === startToken ? Math.min(anchor.charOffset, head.charOffset) : 0;
    const charEnd = t === endToken ? Math.max(anchor.charOffset, head.charOffset) : 999;

    const startPos = getPositionFromToken(t, charStart);
    const endPos = getPositionFromToken(t, charEnd);
    if (!startPos || !endPos) continue;

    highlights.push(
      <div
        key={t}
        className="absolute rounded-sm"
        style={{
          top: startPos.top,
          left: startPos.left,
          width: Math.max(endPos.left - startPos.left, 4),
          height: startPos.height,
          backgroundColor: user.color,
          opacity: 0.2,
        }}
      />,
    );
  }

  const firstPos = getPositionFromToken(startToken, 0);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {highlights}
      {firstPos && (
        <div
          className="absolute whitespace-nowrap rounded-sm px-1 py-0.5 text-[9px] font-medium text-white"
          style={{
            left: firstPos.left,
            top: firstPos.top - 16,
            backgroundColor: user.color,
            opacity: 0.85,
          }}
        >
          {user.displayName}
        </div>
      )}
    </motion.div>
  );
}
