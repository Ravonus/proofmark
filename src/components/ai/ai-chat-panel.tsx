"use client";

/**
 * AI Chat Panel — sliding panel for the editor assistant.
 *
 * Uses Zustand store for state persistence across mount/unmount.
 * Uses shared chat primitives for UI consistency with signer chat.
 */

import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, Wand2, Eraser, Check } from "lucide-react";
import { trpc } from "~/lib/trpc";
import { useEditorChatStore } from "~/stores/ai-chat";
import { ChatBubble, ChatInput, ChatLoading, QuickActions, useAutoScroll, type QuickAction } from "./chat-primitives";
import type { AiEditOperation } from "~/server/db/schema";

const QUICK_ACTIONS: QuickAction[] = [
  {
    label: "Clean up formatting",
    icon: Eraser,
    prompt: "Please clean up the formatting and ensure consistent style throughout the document.",
  },
  {
    label: "Review completeness",
    icon: Check,
    prompt:
      "Review this document for completeness. Are there any missing sections, fields, or clauses that should be added?",
  },
  {
    label: "Improve clarity",
    icon: Wand2,
    prompt: "Suggest improvements to make this document clearer and more professional.",
  },
];

type Props = {
  isOpen: boolean;
  onClose: () => void;
  documentId: string;
  documentTitle: string;
  tokens: unknown[];
  signerCount: number;
  signerLabels: string[];
  onApplyEdits: (operations: AiEditOperation[]) => void;
};

export function AiChatPanel({
  isOpen,
  onClose,
  documentId,
  documentTitle,
  tokens,
  signerCount,
  signerLabels,
  onApplyEdits,
}: Props) {
  const store = useEditorChatStore();
  const editorChat = trpc.ai.editorChat.useMutation();
  const scrollRef = useAutoScroll([store.messages.length, store.isLoading]);

  const handleSend = useCallback(async () => {
    const msg = store.input.trim();
    if (!msg || store.isLoading) return;

    store.addUserMessage(msg);
    store.setLoading(true);

    try {
      const result = await editorChat.mutateAsync({
        documentId,
        conversationId: store.conversationId ?? undefined,
        documentTitle,
        tokens: tokens as any[],
        signerCount,
        signerLabels,
        selectedRange: store.selectedRange,
        message: msg,
      });

      store.setConversationId(result.conversationId);
      store.addAssistantMessage(result.text, result.editOperations as AiEditOperation[] | undefined);
    } catch (e) {
      store.addErrorMessage((e as Error).message);
    }
  }, [store, editorChat, documentId, documentTitle, tokens, signerCount, signerLabels]);

  const handleApplyEdits = useCallback(
    (index: number) => {
      const msg = store.messages[index];
      if (!msg?.editOperations) return;
      onApplyEdits(msg.editOperations);
      store.markEditsApplied(index);
    },
    [store, onApplyEdits],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed right-0 top-0 z-50 flex h-full w-[420px] max-w-[90vw] flex-col border-l border-white/10 bg-zinc-950/95 shadow-2xl backdrop-blur-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-400" />
              <span className="text-sm font-medium text-white">AI Assistant</span>
            </div>
            <div className="flex items-center gap-2">
              {store.selectedRange && (
                <button
                  onClick={() => store.setSelectedRange(undefined)}
                  className="rounded bg-blue-500/20 px-2 py-1 text-xs text-blue-300 transition hover:bg-blue-500/30"
                >
                  Selection: {store.selectedRange.start}-{store.selectedRange.end}
                </button>
              )}
              <button onClick={onClose} className="rounded p-1 transition hover:bg-white/10">
                <X className="h-4 w-4 text-zinc-400" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
            {store.messages.length === 0 && (
              <div className="space-y-4 pt-8">
                <div className="text-center">
                  <Sparkles className="mx-auto mb-3 h-8 w-8 text-blue-400/50" />
                  <p className="text-sm text-zinc-400">
                    Ask me to edit, improve, or review your document.
                    {store.selectedRange
                      ? " I'll focus on the selected section."
                      : " Select text in the editor for targeted edits."}
                  </p>
                </div>
                <QuickActions actions={QUICK_ACTIONS} onSelect={store.setInput} />
              </div>
            )}

            {store.messages.map((msg, i) => (
              <ChatBubble
                key={`${msg.timestamp}-${i}`}
                role={msg.role}
                content={msg.content}
                editOperations={msg.editOperations}
                appliedEdits={msg.appliedEdits}
                onApplyEdits={() => handleApplyEdits(i)}
                onDismissEdits={() => store.dismissEdits(i)}
              />
            ))}

            {store.isLoading && <ChatLoading />}
            <div ref={scrollRef} />
          </div>

          {/* Input */}
          <div className="border-t border-white/10 p-3">
            <ChatInput
              value={store.input}
              onChange={store.setInput}
              onSend={handleSend}
              disabled={store.isLoading}
              placeholder={
                store.selectedRange ? "Ask about the selected section..." : "Ask anything about the document..."
              }
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
