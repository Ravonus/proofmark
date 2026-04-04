/**
 * AI chat stores — Zustand state for editor assistant and signer Q&A.
 *
 * Persists conversation across component mount/unmount cycles.
 * Separated into two stores since they serve different user contexts.
 */

import { create } from "zustand";
import type { StoreApi } from "zustand";
import type { AiEditOperation } from "~/server/db/schema";

// ── Shared types ──

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  editOperations?: AiEditOperation[];
  appliedEdits?: boolean;
  timestamp: number;
};

type ChatState = {
  messages: ChatMessage[];
  conversationId: string | null;
  isLoading: boolean;
  input: string;
  error: string | null;
};

type ChatActions = {
  setInput: (input: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  addUserMessage: (content: string) => void;
  addAssistantMessage: (content: string, editOps?: AiEditOperation[]) => void;
  addErrorMessage: (error: string) => void;
  setConversationId: (id: string) => void;
  markEditsApplied: (messageIndex: number) => void;
  dismissEdits: (messageIndex: number) => void;
  clearConversation: () => void;
};

const INITIAL_CHAT: ChatState = {
  messages: [],
  conversationId: null,
  isLoading: false,
  input: "",
  error: null,
};

function chatActions(set: StoreApi<ChatState>["setState"]): ChatActions {
  return {
    setInput: (input) => set({ input }),
    setLoading: (isLoading) => set({ isLoading, error: null }),
    setError: (error) => set({ error, isLoading: false }),

    addUserMessage: (content) =>
      set((s: ChatState) => ({
        messages: [...s.messages, { role: "user" as const, content, timestamp: Date.now() }],
        input: "",
      })),

    addAssistantMessage: (content, editOperations) =>
      set((s: ChatState) => ({
        messages: [...s.messages, { role: "assistant" as const, content, editOperations, timestamp: Date.now() }],
        isLoading: false,
      })),

    addErrorMessage: (error) =>
      set((s: ChatState) => ({
        messages: [...s.messages, { role: "assistant" as const, content: `Error: ${error}`, timestamp: Date.now() }],
        isLoading: false,
      })),

    setConversationId: (conversationId) => set({ conversationId }),

    markEditsApplied: (index) =>
      set((s: ChatState) => ({
        messages: s.messages.map((m, i) => (i === index ? { ...m, appliedEdits: true } : m)),
      })),

    dismissEdits: (index) =>
      set((s: ChatState) => ({
        messages: s.messages.map((m, i) => (i === index ? { ...m, editOperations: undefined } : m)),
      })),

    clearConversation: () => set(INITIAL_CHAT),
  };
}

// ── Editor Assistant Store ──

type EditorChatState = ChatState &
  ChatActions & {
    selectedRange: { start: number; end: number } | undefined;
    setSelectedRange: (range: { start: number; end: number } | undefined) => void;
  };

export const useEditorChatStore = create<EditorChatState>()((set) => ({
  ...INITIAL_CHAT,
  ...chatActions(set),
  selectedRange: undefined,
  setSelectedRange: (selectedRange) => set({ selectedRange }),
}));

// ── Signer Q&A Store ──

type SignerChatState = ChatState &
  ChatActions & {
    isOpen: boolean;
    hasSummary: boolean;
    setOpen: (open: boolean) => void;
    setSummaryLoaded: () => void;
  };

export const useSignerChatStore = create<SignerChatState>()((set) => ({
  ...INITIAL_CHAT,
  ...chatActions(set),
  isOpen: false,
  hasSummary: false,
  setOpen: (isOpen) => set({ isOpen }),
  setSummaryLoaded: () => set({ hasSummary: true }),
}));
