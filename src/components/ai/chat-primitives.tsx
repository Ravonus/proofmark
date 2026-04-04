"use client";

/**
 * Shared chat UI primitives — reusable across editor assistant and signer Q&A.
 *
 * ChatBubble: renders a single message with optional edit actions
 * ChatInput: textarea + send button with keyboard handling
 * QuickActions: clickable prompt suggestions
 * ChatLoading: typing indicator
 */

import { useRef, useEffect } from "react";
import { Check, XCircle, Loader2, Send } from "lucide-react";
import type { AiEditOperation } from "~/server/db/schema";

// ── ChatBubble ──

export type ChatBubbleProps = {
  role: "user" | "assistant";
  content: string;
  editOperations?: AiEditOperation[];
  appliedEdits?: boolean;
  onApplyEdits?: () => void;
  onDismissEdits?: () => void;
};

export function ChatBubble({
  role,
  content,
  editOperations,
  appliedEdits,
  onApplyEdits,
  onDismissEdits,
}: ChatBubbleProps) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
          isUser
            ? "border border-blue-500/20 bg-blue-600/20 text-blue-100"
            : "border border-white/5 bg-white/5 text-zinc-200"
        }`}
      >
        <div className="whitespace-pre-wrap">{content}</div>

        {editOperations && editOperations.length > 0 && (
          <div className="mt-2 border-t border-white/10 pt-2">
            <div className="mb-2 text-xs text-zinc-400">
              {editOperations.length} edit{editOperations.length !== 1 ? "s" : ""} suggested
            </div>
            {appliedEdits ? (
              <div className="flex items-center gap-1 text-xs text-green-400">
                <Check className="h-3 w-3" /> Applied
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={onApplyEdits}
                  className="flex items-center gap-1 rounded bg-green-500/20 px-2 py-1 text-xs text-green-300 transition hover:bg-green-500/30"
                >
                  <Check className="h-3 w-3" /> Apply
                </button>
                <button
                  onClick={onDismissEdits}
                  className="flex items-center gap-1 rounded bg-red-500/20 px-2 py-1 text-xs text-red-300 transition hover:bg-red-500/30"
                >
                  <XCircle className="h-3 w-3" /> Dismiss
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ChatInput ──

export function ChatInput({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
  rows = 2,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSend();
    }
  };

  return (
    <div className="flex gap-2">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "Ask anything..."}
        rows={rows}
        className="flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition placeholder:text-zinc-500 focus:border-blue-500/50 focus:outline-none"
      />
      <button
        onClick={onSend}
        disabled={!value.trim() || disabled}
        className="self-end rounded-xl bg-blue-600 p-2.5 transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Send className="h-4 w-4 text-white" />
      </button>
    </div>
  );
}

// ── QuickActions ──

export type QuickAction = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  prompt: string;
};

export function QuickActions({ actions, onSelect }: { actions: QuickAction[]; onSelect: (prompt: string) => void }) {
  return (
    <div className="space-y-2">
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={() => onSelect(action.prompt)}
          className="flex w-full items-center gap-2.5 rounded-lg border border-white/5 bg-white/5 px-3 py-2.5 text-left transition hover:bg-white/10"
        >
          <action.icon className="h-4 w-4 shrink-0 text-blue-400" />
          <span className="text-sm text-zinc-300">{action.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── ChatLoading ──

export function ChatLoading({ text }: { text?: string }) {
  return (
    <div className="flex justify-start">
      <div className="rounded-xl border border-white/5 bg-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          {text && <span className="text-xs text-zinc-500">{text}</span>}
        </div>
      </div>
    </div>
  );
}

// ── useAutoScroll ──

export function useAutoScroll(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth" });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}
