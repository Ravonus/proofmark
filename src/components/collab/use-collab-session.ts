"use client";

/**
 * React hook for managing a collaborative session.
 *
 * Handles WebSocket connection, Yjs document sync,
 * awareness protocol (cursors/selections/presence),
 * and custom message handling.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import { encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

// Wire protocol constants (must match premium/collaboration/constants.ts)
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_CUSTOM = 2;

// ── Types ──

export type AwarenessUser = {
  userId: string;
  displayName: string;
  color: string;
  role: string;
  cursor: { tokenIndex: number; charOffset: number } | null;
  selection: {
    anchor: { tokenIndex: number; charOffset: number };
    head: { tokenIndex: number; charOffset: number };
  } | null;
  activity: "idle" | "typing" | "selecting" | "highlighting" | "ai-chatting";
  lastActiveAt: number;
};

export type CustomWsMessage = {
  type: string;
  sessionId: string;
  payload: any;
};

export type UseCollabSessionOptions = {
  sessionId: string;
  wsUrl?: string;
  user: { userId: string; displayName: string; color: string; role: string };
  onDocUpdate?: (doc: Y.Doc) => void;
  onAwarenessUpdate?: (states: AwarenessUser[]) => void;
  onCustomMessage?: (message: CustomWsMessage) => void;
  onConnectionChange?: (connected: boolean) => void;
};

export type UseCollabSessionReturn = {
  doc: Y.Doc | null;
  awareness: Awareness | null;
  connected: boolean;
  remoteUsers: AwarenessUser[];
  updateCursor: (cursor: { tokenIndex: number; charOffset: number } | null) => void;
  updateSelection: (selection: AwarenessUser["selection"]) => void;
  updateActivity: (activity: AwarenessUser["activity"]) => void;
  broadcastMessage: (message: CustomWsMessage) => void;
  disconnect: () => void;
};

// ── Encoding helpers ──

function sendEncoded(ws: WebSocket, encodeFn: (enc: encoding.Encoder) => void): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  const encoder = encoding.createEncoder();
  encodeFn(encoder);
  ws.send(encoding.toUint8Array(encoder));
}

function collectRemoteStates(awareness: Awareness): AwarenessUser[] {
  const states: AwarenessUser[] = [];
  awareness.getStates().forEach((state, clientId) => {
    if (clientId !== awareness.clientID && state.user) {
      states.push(state.user as AwarenessUser);
    }
  });
  return states;
}

// ── Hook ──

export function useCollabSession(options: UseCollabSessionOptions): UseCollabSessionReturn {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [awareness, setAwareness] = useState<Awareness | null>(null);
  const [connected, setConnected] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState<AwarenessUser[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const awarenessRef = useRef<Awareness | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // ── Connection lifecycle ──

  useEffect(() => {
    const yDoc = new Y.Doc();
    const yAwareness = new Awareness(yDoc);
    awarenessRef.current = yAwareness;
    setDoc(yDoc);
    setAwareness(yAwareness);

    // Initialize local awareness
    yAwareness.setLocalStateField("user", {
      ...options.user,
      cursor: null,
      selection: null,
      activity: "idle" as const,
      lastActiveAt: Date.now(),
    });

    // Track remote awareness
    yAwareness.on("change", () => {
      const states = collectRemoteStates(yAwareness);
      setRemoteUsers(states);
      optionsRef.current.onAwarenessUpdate?.(states);
    });

    // Forward local doc updates to server
    yDoc.on("update", (update: Uint8Array, origin: any) => {
      if (origin === "remote") return;
      const ws = wsRef.current;
      if (ws) {
        sendEncoded(ws, (enc) => {
          encoding.writeVarUint(enc, MSG_SYNC);
          syncProtocol.writeUpdate(enc, update);
        });
      }
      optionsRef.current.onDocUpdate?.(yDoc);
    });

    // Connect — prefer Rust engine WS gateway (port 9090), fall back to Node WS (port 3101)
    const rustEnginePort = process.env.NEXT_PUBLIC_RUST_ENGINE_PORT ?? "9090";
    const nodeWsPort = process.env.NEXT_PUBLIC_COLLAB_WS_PORT ?? "3101";
    const proto = location.protocol === "https:" ? "wss:" : "ws:";

    const wsUrl =
      options.wsUrl ??
      `${proto}//${location.hostname}:${rustEnginePort}/ws/collab/${options.sessionId}?userId=${encodeURIComponent(options.user.userId)}&displayName=${encodeURIComponent(options.user.displayName)}&color=${encodeURIComponent(options.user.color)}&role=${encodeURIComponent(options.user.role)}`;

    // Fallback URL if Rust engine is unavailable
    const fallbackWsUrl = `${proto}//${location.hostname}:${nodeWsPort}/ws/collab/${options.sessionId}`;

    let ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    let hasFallenBack = false;

    const onWsOpen = () => {
      setConnected(true);
      optionsRef.current.onConnectionChange?.(true);
      // Send initial awareness
      sendEncoded(ws, (enc) => {
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(yAwareness, [yAwareness.clientID]));
      });
    };

    ws.onopen = onWsOpen;

    // Fallback: if Rust WS fails to connect, try Node WS
    const originalOnError = () => {
      if (!hasFallenBack && !options.wsUrl) {
        hasFallenBack = true;
        console.info("[collab] Rust WS unavailable, falling back to Node WS");
        ws = new WebSocket(fallbackWsUrl);
        wsRef.current = ws;
        ws.binaryType = "arraybuffer";
        ws.onopen = onWsOpen;
        ws.onmessage = onWsMessage;
        ws.onclose = onWsClose;
        ws.onerror = () => {
          setConnected(false);
        };
      } else {
        setConnected(false);
      }
    };
    ws.onerror = originalOnError;

    const onWsMessage = (event: MessageEvent) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer));
      const msgType = decoding.readVarUint(decoder);

      switch (msgType) {
        case MSG_SYNC: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MSG_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, yDoc, "remote");
          if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
          optionsRef.current.onDocUpdate?.(yDoc);
          break;
        }
        case MSG_AWARENESS:
          applyAwarenessUpdate(yAwareness, decoding.readVarUint8Array(decoder), "remote");
          break;
        case MSG_CUSTOM: {
          const message = JSON.parse(decoding.readVarString(decoder)) as CustomWsMessage;
          optionsRef.current.onCustomMessage?.(message);
          break;
        }
      }
    };

    ws.onmessage = onWsMessage;

    const onWsClose = () => {
      setConnected(false);
      optionsRef.current.onConnectionChange?.(false);
    };
    ws.onclose = onWsClose;

    return () => {
      ws.close();
      yAwareness.destroy();
      yDoc.destroy();
      wsRef.current = null;
      awarenessRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.sessionId]);

  // ── Local awareness updates (DRY helper) ──

  const updateLocalAwareness = useCallback((patch: Partial<AwarenessUser>) => {
    const a = awarenessRef.current;
    if (!a) return;
    const current = a.getLocalState()?.user as AwarenessUser | undefined;
    if (!current) return;
    a.setLocalStateField("user", { ...current, ...patch, lastActiveAt: Date.now() });
    // Broadcast
    const ws = wsRef.current;
    if (ws) {
      sendEncoded(ws, (enc) => {
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(a, [a.clientID]));
      });
    }
  }, []);

  const updateCursor = useCallback(
    (cursor: AwarenessUser["cursor"]) => updateLocalAwareness({ cursor, activity: cursor ? "typing" : "idle" }),
    [updateLocalAwareness],
  );

  const updateSelection = useCallback(
    (selection: AwarenessUser["selection"]) =>
      updateLocalAwareness({ selection, activity: selection ? "selecting" : "idle" }),
    [updateLocalAwareness],
  );

  const updateActivity = useCallback(
    (activity: AwarenessUser["activity"]) => updateLocalAwareness({ activity }),
    [updateLocalAwareness],
  );

  const broadcastMessage = useCallback((message: CustomWsMessage) => {
    const ws = wsRef.current;
    if (ws) {
      sendEncoded(ws, (enc) => {
        encoding.writeVarUint(enc, MSG_CUSTOM);
        encoding.writeVarString(enc, JSON.stringify(message));
      });
    }
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
  }, []);

  return {
    doc,
    awareness,
    connected,
    remoteUsers,
    updateCursor,
    updateSelection,
    updateActivity,
    broadcastMessage,
    disconnect,
  };
}
