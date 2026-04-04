"use client";

/**
 * AI Scraper Review — shows AI corrections after PDF analysis.
 * Side-by-side diff with Accept/Reject controls.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  RefreshCw,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { trpc } from "~/lib/trpc";
import { W3SButton } from "~/components/ui/motion";
import type { PdfAnalysisResult } from "~/lib/pdf-types";

type ScraperFixChange = {
  type: string;
  description: string;
};

type Props = {
  analysisResult: PdfAnalysisResult;
  rawContent?: string;
  onAccept: (corrected: PdfAnalysisResult) => void;
  onReject: () => void;
  documentId?: string;
};

export function AiScraperReview({ analysisResult, rawContent, onAccept, onReject, documentId }: Props) {
  const [corrected, setCorrected] = useState<PdfAnalysisResult | null>(null);
  const [changes, setChanges] = useState<ScraperFixChange[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedChanges, setExpandedChanges] = useState(true);
  const [latencyMs, setLatencyMs] = useState(0);

  const scraperFix = trpc.ai.scraperFix.useMutation();

  const handleRunFix = async () => {
    setIsRunning(true);
    setError(null);
    try {
      const result = await scraperFix.mutateAsync({
        documentId,
        analysisResult,
        rawContent,
      });
      setCorrected(result.corrected as PdfAnalysisResult);
      setChanges(result.changes as ScraperFixChange[]);
      setLatencyMs(result.latencyMs!);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsRunning(false);
    }
  };

  // Not yet run — show CTA
  if (!corrected && !isRunning && !error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4"
      >
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-blue-400" />
          <div className="flex-1">
            <h3 className="mb-1 text-sm font-medium text-white">AI Smart Fix</h3>
            <p className="mb-3 text-xs text-zinc-400">
              Let AI review the PDF analysis and fix any missed fields, wrong types, or incomplete detections. This
              typically catches 15-30% more fields than the automated parser alone.
            </p>
            <W3SButton onClick={handleRunFix} className="text-xs">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Run AI Fix
            </W3SButton>
          </div>
        </div>
      </motion.div>
    );
  }

  // Running
  if (isRunning) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-6 text-center"
      >
        <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-blue-400" />
        <p className="text-sm text-zinc-300">Analyzing document with AI...</p>
        <p className="mt-1 text-xs text-zinc-500">This usually takes 3-8 seconds</p>
      </motion.div>
    );
  }

  // Error
  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-red-500/20 bg-red-500/5 p-4"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div className="flex-1">
            <h3 className="mb-1 text-sm font-medium text-red-300">AI Fix Failed</h3>
            <p className="mb-3 text-xs text-zinc-400">{error}</p>
            <div className="flex gap-2">
              <button
                onClick={handleRunFix}
                className="flex items-center gap-1 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-white/10"
              >
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
              <button
                onClick={onReject}
                className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-zinc-400 transition hover:bg-white/10"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  // Show results
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="overflow-hidden rounded-xl border border-blue-500/20 bg-blue-500/5"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium text-white">AI Corrections</span>
          <span className="text-xs text-zinc-500">{latencyMs}ms</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">
            {changes.length} change{changes.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Changes list */}
      {changes.length > 0 && (
        <div className="px-4 py-2">
          <button
            onClick={() => setExpandedChanges(!expandedChanges)}
            className="flex items-center gap-1 text-xs text-zinc-400 transition hover:text-zinc-300"
          >
            {expandedChanges ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Changes
          </button>
          <AnimatePresence>
            {expandedChanges && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-2 max-h-[200px] space-y-1 overflow-y-auto">
                  {changes.map((change, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      {change.type.includes("added") ? (
                        <Plus className="mt-0.5 h-3 w-3 shrink-0 text-green-400" />
                      ) : change.type.includes("removed") ? (
                        <Minus className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
                      ) : (
                        <RefreshCw className="mt-0.5 h-3 w-3 shrink-0 text-yellow-400" />
                      )}
                      <span className="text-zinc-300">{change.description}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {changes.length === 0 && (
        <div className="px-4 py-4 text-center">
          <Check className="mx-auto mb-2 h-5 w-5 text-green-400" />
          <p className="text-xs text-zinc-400">AI found no issues — the automated analysis looks correct.</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 border-t border-white/5 px-4 py-2">
        <div className="text-center">
          <div className="text-sm font-medium text-white">
            {corrected?.detectedFields.length ?? analysisResult.detectedFields.length}
          </div>
          <div className="text-xs text-zinc-500">Fields</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-medium text-white">
            {corrected?.detectedSigners.length ?? analysisResult.detectedSigners.length}
          </div>
          <div className="text-xs text-zinc-500">Signers</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-medium text-white">
            {corrected?.signatureBlocks.length ?? analysisResult.signatureBlocks.length}
          </div>
          <div className="text-xs text-zinc-500">Sig Blocks</div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 border-t border-white/5 p-3">
        <button
          onClick={() => corrected && onAccept(corrected)}
          disabled={!corrected || changes.length === 0}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-600/20 px-3 py-2 text-sm text-green-300 transition hover:bg-green-600/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Check className="h-4 w-4" /> Accept AI Fixes
        </button>
        <button
          onClick={onReject}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-sm text-zinc-400 transition hover:bg-white/10"
        >
          <X className="h-4 w-4" /> Keep Original
        </button>
      </div>
    </motion.div>
  );
}
