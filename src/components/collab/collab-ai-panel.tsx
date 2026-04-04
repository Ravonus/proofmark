// @ts-nocheck
"use client";

/**
 * Collaboration AI panel — shared and private AI conversations.
 *
 * Tabs:
 * - Shared: visible to all participants, everyone can ask questions
 * - Private: only the current user can see, for preparation/research
 *
 * Integrates with the existing AI provider layer through the collab tRPC router.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Sparkles, Lock, Globe, Loader2 } from "lucide-react";
import { trpc } from "~/lib/trpc";

type Message = {
  role: "user" | "assistant";
  content: string;
  userId?: string;
  displayName?: string;
  timestamp: number;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  displayName: string;
};

export function CollabAiPanel({ isOpen, onClose, sessionId, displayName }: Props) {
  const [mode, setMode] = useState<"shared" | "private">("shared");
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sharedMessages, setSharedMessages] = useState<Message[]>([]);
  const [privateMessages, setPrivateMessages] = useState<Message[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const sendShared = trpc.collab.sendSharedAiMessage.useMutation();
  const sendPrivate = trpc.collab.sendPrivateAiMessage.useMutation();

  // Load existing threads
  const sharedThreads = trpc.collab.getSharedThreads.useQuery({ sessionId });
  const privateThreads = trpc.collab.getPrivateThreads.useQuery({ sessionId });

  // Hydrate messages from loaded threads
  useEffect(() => {
    if (sharedThreads.data?.[0]?.messages) {
      setSharedMessages(sharedThreads.data[0].messages as Message[]);
    }
  }, [sharedThreads.data]);

  useEffect(() => {
    if (privateThreads.data?.[0]?.messages) {
      setPrivateMessages(privateThreads.data[0].messages as Message[]);
    }
  }, [privateThreads.data]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [sharedMessages, privateMessages, scrollToBottom]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen, mode]);

  const currentMessages = mode === "shared" ? sharedMessages : privateMessages;
  const setCurrentMessages = mode === "shared" ? setSharedMessages : setPrivateMessages;

  const handleSend = async () => {
    const msg = input.trim();
    if (!msg || isLoading) return;

    setInput("");
    setIsLoading(true);

    // Optimistic user message
    const userMsg: Message = {
      role: "user",
      content: msg,
      userId: displayName,
      displayName,
      timestamp: Date.now(),
    };
    setCurrentMessages((prev) => [...prev, userMsg]);

    try {
      if (mode === "shared") {
        const result = await sendShared.mutateAsync({
          sessionId,
          message: msg,
          displayName,
        });
        setCurrentMessages((prev) => [
          ...prev,
          {
            role: "assistant" as const,
            content: result.aiMessage.content,
            timestamp: result.aiMessage.timestamp,
          },
        ]);
      } else {
        const result = await sendPrivate.mutateAsync({
          sessionId,
          message: msg,
        });
        setCurrentMessages((prev) => [
          ...prev,
          {
            role: "assistant" as const,
            content: result.aiMessage.content,
            timestamp: result.aiMessage.timestamp,
          },
        ]);
      }
    } catch (err: any) {
      setCurrentMessages((prev) => [
        ...prev,
        {
          role: "assistant" as const,
          content: `Error: ${err.message}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-96 flex-col border-l border-white/10 bg-zinc-900/95">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-white">AI Assistant</h3>
        </div>
        <button onClick={onClose} className="text-zinc-400 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-1 border-b border-white/10 p-2">
        <button
          onClick={() => setMode("shared")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "shared" ? "bg-blue-600/20 text-blue-300" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Globe className="h-3 w-3" />
          Shared
        </button>
        <button
          onClick={() => setMode("private")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            mode === "private" ? "bg-purple-600/20 text-purple-300" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Lock className="h-3 w-3" />
          Private
        </button>
      </div>

      {/* Mode description */}
      <div className="border-b border-white/5 px-4 py-2">
        <p className="text-[10px] text-zinc-500">
          {mode === "shared"
            ? "Everyone in the session can see this conversation."
            : "Only you can see this — use it for research and preparation."}
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {currentMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Sparkles className="mb-3 h-8 w-8 text-zinc-600" />
            <p className="mb-1 text-sm text-zinc-400">
              {mode === "shared" ? "Ask the AI about this contract" : "Research privately"}
            </p>
            <p className="text-xs text-zinc-600">The AI can see the document and annotations</p>
          </div>
        )}

        {currentMessages.map((msg, i) => (
          <div key={i} className={`mb-3 ${msg.role === "user" ? "ml-8" : "mr-4"}`}>
            {msg.role === "user" && msg.displayName && mode === "shared" && (
              <p className="mb-0.5 text-[10px] font-medium text-zinc-500">{msg.displayName}</p>
            )}
            <div
              className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
                msg.role === "user" ? "bg-blue-600/20 text-blue-100" : "bg-zinc-800 text-zinc-300"
              }`}
            >
              {msg.content}
            </div>
            <p className="mt-0.5 text-[10px] text-zinc-600">{new Date(msg.timestamp).toLocaleTimeString()}</p>
          </div>
        ))}

        {isLoading && (
          <div className="mb-3 mr-4">
            <div className="flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              Thinking...
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-white/10 p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === "shared" ? "Ask the group AI..." : "Ask privately..."}
            rows={1}
            className="max-h-24 min-h-[36px] flex-1 resize-none rounded-lg border border-white/10 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-blue-500/50 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className={`rounded-lg p-2 transition-colors ${
              mode === "shared" ? "bg-blue-600 hover:bg-blue-500" : "bg-purple-600 hover:bg-purple-500"
            } text-white disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
