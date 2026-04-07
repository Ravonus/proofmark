"use client";

/**
 * AI Signer Chat — floating chat widget for signers.
 *
 * Uses Zustand store so conversation persists if widget is closed/reopened.
 * Uses shared chat primitives for UI consistency.
 */

import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, BookOpen, HelpCircle, FileText } from "lucide-react";
import { trpc } from "~/lib/platform/trpc";
import { useSignerChatStore } from "~/stores/ai-chat";
import { ChatBubble, ChatInput, ChatLoading, QuickActions, useAutoScroll, type QuickAction } from "./chat-primitives";

type Props = {
  documentId: string;
  claimToken: string;
  documentTitle: string;
  signerLabel: string;
};

export function AiSignerChat({ documentId, claimToken, documentTitle, signerLabel }: Props) {
  const store = useSignerChatStore();
  const signerAsk = trpc.ai.signerAsk.useMutation();
  const signerSummary = trpc.ai.signerSummary.useMutation();
  const capabilities = trpc.ai.capabilities.useQuery(undefined, { staleTime: 60_000 });
  const scrollRef = useAutoScroll([store.messages.length, store.isLoading]);

  if (capabilities.data && !capabilities.data.available) return null;

  const handleSend = async () => {
    const msg = store.input.trim();
    if (!msg || store.isLoading) return;

    store.addUserMessage(msg);
    store.setLoading(true);

    try {
      const result = await signerAsk.mutateAsync({
        documentId,
        claimToken,
        conversationId: store.conversationId ?? undefined,
        question: msg,
      });
      store.setConversationId(result.conversationId);
      store.addAssistantMessage(result.answer);
    } catch (e) {
      store.addErrorMessage((e as Error).message);
    }
  };

  const handleGetSummary = async () => {
    if (store.hasSummary || store.isLoading) return;
    store.addUserMessage("Can you give me a summary of this document?");
    store.setLoading(true);

    try {
      const result = await signerSummary.mutateAsync({ documentId, claimToken });
      store.addAssistantMessage(result.summary);
      store.setSummaryLoaded();
    } catch (e) {
      store.addErrorMessage((e as Error).message);
    }
  };

  const quickQuestions: QuickAction[] = [
    { label: "Summarize this document", icon: BookOpen, prompt: "__SUMMARY__" },
    {
      label: "What am I agreeing to?",
      icon: FileText,
      prompt: "What exactly am I agreeing to by signing this document?",
    },
    {
      label: "What are the key dates?",
      icon: HelpCircle,
      prompt: "What are the important dates and deadlines in this document?",
    },
  ];

  const handleQuickAction = (prompt: string) => {
    if (prompt === "__SUMMARY__") {
      void handleGetSummary();
    } else {
      store.setInput(prompt);
    }
  };

  return (
    <>
      {/* Floating trigger */}
      <AnimatePresence>
        {!store.isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => store.setOpen(true)}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-white shadow-lg shadow-blue-600/25 transition hover:bg-blue-500"
          >
            <Sparkles className="h-5 w-5" />
            <span className="text-sm font-medium">Ask AI</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {store.isOpen && (
          <motion.div
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="bg-zinc-950/98 fixed bottom-0 right-0 z-50 flex h-[80vh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 shadow-2xl backdrop-blur-xl sm:bottom-6 sm:right-6 sm:h-[600px] sm:max-h-[600px] sm:w-[400px] sm:rounded-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 bg-zinc-900/50 px-4 py-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-400" />
                <div>
                  <span className="text-sm font-medium text-white">Document Assistant</span>
                  <p className="max-w-[200px] truncate text-xs text-zinc-500">{documentTitle}</p>
                </div>
              </div>
              <button onClick={() => store.setOpen(false)} className="rounded-lg p-1.5 transition hover:bg-white/10">
                <X className="h-4 w-4 text-zinc-400" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {store.messages.length === 0 && (
                <div className="space-y-4 pt-4">
                  <div className="text-center">
                    <Sparkles className="mx-auto mb-3 h-8 w-8 text-blue-400/40" />
                    <p className="mb-1 text-sm font-medium text-zinc-300">Hi {signerLabel}!</p>
                    <p className="mx-auto max-w-[280px] text-xs text-zinc-500">
                      I can help you understand this document before you sign. Ask me anything.
                    </p>
                  </div>
                  <QuickActions actions={quickQuestions} onSelect={handleQuickAction} />
                </div>
              )}

              {store.messages.map((msg, i) => (
                <ChatBubble key={`${msg.timestamp}-${i}`} role={msg.role} content={msg.content} />
              ))}

              {store.isLoading && <ChatLoading text="Analyzing document..." />}
              <div ref={scrollRef} />
            </div>

            {/* Disclaimer */}
            <p className="px-4 py-1 text-center text-[10px] text-zinc-600">
              AI explanations are not legal advice. Consult a professional for legal questions.
            </p>

            {/* Input */}
            <div className="border-t border-white/10 p-3">
              <ChatInput
                value={store.input}
                onChange={store.setInput}
                onSend={handleSend}
                disabled={store.isLoading}
                placeholder="Ask about the document..."
                rows={1}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
